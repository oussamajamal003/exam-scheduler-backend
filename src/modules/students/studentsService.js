import prisma from '../../config/prisma.js';
import bcrypt from 'bcrypt';
import { AppError } from '../../utils/AppError.js';
import { normalizeRole } from '../../guards/roleGuard.js';
import { parseListQuery, buildOrderBy, buildMeta } from '../../utils/queryParser.js';
import { assertNoScheduleAssignmentsForDependency, findImpactedScheduleIds, synchronizeSchedules } from '../schedules/scheduleSyncService.js';

const isStudentEmail = (email) => email?.toLowerCase().endsWith('@st.uni.edu');

const assertStudentEmail = (email) => {
  if (!isStudentEmail(email)) {
    throw new AppError('Student email must end with @st.uni.edu', 400);
  }
};

const assertStudentAccess = (id, user) => {
  if (user?.role === 'STUDENT' && user.studentId !== id) {
    throw new AppError('You can only access your own student data', 403);
  }
};

const STUDENT_SORT_FIELDS = {
  name:         (dir) => ({ user: { name: dir } }),
  universityId: (dir) => ({ universityId: dir }),
  email:        (dir) => ({ user: { email: dir } }),
  createdAt:    (dir) => ({ user: { createdAt: dir } }),
};

export const getAllStudents = async (query) => {
  const { page, limit, skip, sortField, sortDirection, search } = parseListQuery(query);

  const where = {};
  if (query.programId) where.programId = query.programId;
  if (query.departmentId) where.program = { departmentId: query.departmentId };
  if (search) {
    where.OR = [
      { universityId: { contains: search, mode: 'insensitive' } },
      { user: { name: { contains: search, mode: 'insensitive' } } },
      { user: { email: { contains: search, mode: 'insensitive' } } },
    ];
  }

  const orderBy = buildOrderBy(sortField, sortDirection, STUDENT_SORT_FIELDS, { user: { name: 'asc' } });

  const [students, total] = await Promise.all([
    prisma.student.findMany({
      where,
      skip,
      take: limit,
      orderBy,
      include: { user: { select: { name: true, email: true } }, program: { include: { department: true } } },
    }),
    prisma.student.count({ where }),
  ]);

  return { data: students, meta: buildMeta(total, page, limit) };
};

export const getStudentById = async (id, user) => {
  assertStudentAccess(id, user);

  const student = await prisma.student.findUnique({
    where: { id },
    include: {
      user: { select: { name: true, email: true, role: true } },
      program: { include: { department: true } },
      registrations: { include: { courseOffering: { include: { course: true, semester: true } } } }
    },
  });

  if (!student) throw new AppError('Student not found', 404);
  return student;
};

export const createStudent = async (data) => {
  const existing = await prisma.student.findUnique({ where: { universityId: data.universityId } });
  if (existing) throw new AppError('University ID already in use', 400);

  // Support two create flows:
  // 1) Direct relation: userId + universityId (+ programId)
  // 2) Admin UI profile payload: firstName + lastName + email + universityId (+ programId)
  if (data.userId) {
    const user = await prisma.user.findUnique({ where: { id: data.userId } });
    if (!user) throw new AppError('User not found', 404);
    assertStudentEmail(user.email);
    if (normalizeRole(user.role) !== 'STUDENT') {
      throw new AppError('Linked user must have STUDENT role', 400);
    }

    return await prisma.student.create({
      data: {
        userId: data.userId,
        universityId: data.universityId,
        programId: data.programId,
      },
      include: { user: true, program: { include: { department: true } } }
    });
  }

  const fullName = `${data.firstName} ${data.lastName}`.trim();
  assertStudentEmail(data.email);

  const existingUser = await prisma.user.findUnique({ where: { email: data.email } });
  if (existingUser) throw new AppError('User with this email already exists', 409);

  const tempPassword = `${data.universityId}@Temp123`;
  const hashedPassword = await bcrypt.hash(tempPassword, 10);

  return await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name: fullName,
        email: data.email,
        password: hashedPassword,
        role: 'STUDENT',
      },
    });

    return await tx.student.create({
      data: {
        userId: user.id,
        universityId: data.universityId,
        programId: data.programId,
      },
      include: { user: true, program: { include: { department: true } } }
    });
  });
};

export const updateStudent = async (id, data) => {
  const student = await prisma.student.findUnique({
    where: { id },
    include: { user: true },
  });
  if (!student) throw new AppError('Student not found', 404);

  if (data.universityId) {
    const duplicate = await prisma.student.findUnique({ where: { universityId: data.universityId } });
    if (duplicate && duplicate.id !== id) {
      throw new AppError('University ID already in use', 400);
    }
  }

  const nextStudentData = {
    universityId: data.universityId ?? student.universityId,
    programId: data.programId ?? student.programId ?? null,
  };

  if (data.firstName || data.lastName || data.email) {
    const nextName = [data.firstName ?? student.user.name?.split(' ')[0] ?? '', data.lastName ?? student.user.name?.split(' ').slice(1).join(' ') ?? '']
      .filter(Boolean)
      .join(' ')
      .trim();

    if (data.email && data.email !== student.user.email) {
      assertStudentEmail(data.email);
      const duplicateUser = await prisma.user.findUnique({ where: { email: data.email } });
      if (duplicateUser && duplicateUser.id !== student.userId) {
        throw new AppError('User with this email already exists', 409);
      }
    }

    return await prisma.$transaction(async (tx) => {
      const scheduleIds = await findImpactedScheduleIds({ dependency: 'student', ids: [id] }, tx);
      await tx.user.update({
        where: { id: student.userId },
        data: {
          ...(nextName ? { name: nextName } : {}),
          ...(data.email ? { email: data.email } : {}),
        },
      });

      const updated = await tx.student.update({
        where: { id },
        data: nextStudentData,
        include: { user: true, program: { include: { department: true } } },
      });
      await synchronizeSchedules(scheduleIds, tx);
      return updated;
    });
  }

  return prisma.$transaction(async (tx) => {
    const scheduleIds = await findImpactedScheduleIds({ dependency: 'student', ids: [id] }, tx);
    const updated = await tx.student.update({
      where: { id },
      data: nextStudentData,
      include: { user: true, program: { include: { department: true } } },
    });
    await synchronizeSchedules(scheduleIds, tx);
    return updated;
  });
};

export const deleteStudent = async (id) => {
  const student = await prisma.student.findUnique({ where: { id } });
  if (!student) throw new AppError('Student not found', 404);

  return prisma.$transaction(async (tx) => {
    const scheduleIds = await findImpactedScheduleIds({ dependency: 'student', ids: [id] }, tx);
    await assertNoScheduleAssignmentsForDependency({ dependency: 'student', ids: [id], entityLabel: 'Student' }, tx);
    const deleted = await tx.student.delete({ where: { id } });
    await synchronizeSchedules(scheduleIds, tx);
    return deleted;
  });
};

export const getStudentExams = async (id, user) => {
  assertStudentAccess(id, user);

  // Finds exams for the registered course offerings of the student
  const student = await prisma.student.findUnique({
    where: { id },
    include: {
      registrations: {
        include: {
          courseOffering: {
            include: {
              course: true,
              exams: {
                include: {
                  assignments: {
                    include: {
                      schedule: true,
                      timeSlot: true,
                      room: true
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  });

  if (!student) throw new AppError('Student not found', 404);

  // Extract exams from course offerings
  const exams = student.registrations.flatMap(reg => 
    reg.courseOffering.exams.map(exam => ({
      courseName: reg.courseOffering.course.title,
      courseCode: reg.courseOffering.course.code,
      status: exam.status,
      duration: exam.duration,
      assignments: exam.assignments // AI could filter by Final schedule only here
    }))
  );

  return exams;
};