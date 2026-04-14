import prisma from '../../config/prisma.js';
import { AppError } from '../../utils/AppError.js';

export const getAllStudents = async (query) => {
  const { page = 1, limit = 10, search, programId } = query;
  const parsedPage = parseInt(page);
  const parsedLimit = parseInt(limit);
  const skip = (parsedPage - 1) * parsedLimit;

  const where = {};
  if (programId) where.programId = programId;
  if (search) {
    where.OR = [
      { universityId: { contains: search, mode: 'insensitive' } },
      { user: { name: { contains: search, mode: 'insensitive' } } },
      { user: { email: { contains: search, mode: 'insensitive' } } },
    ];
  }

  const [students, total] = await Promise.all([
    prisma.student.findMany({
      where,
      skip,
      take: parsedLimit,
      include: { user: { select: { name: true, email: true } }, program: true }
    }),
    prisma.student.count({ where }),
  ]);

  return {
    data: students,
    meta: {
      total,
      page: parsedPage,
      limit: parsedLimit,
      totalPages: Math.ceil(total / parsedLimit),
    },
  };
};

export const getStudentById = async (id) => {
  const student = await prisma.student.findUnique({
    where: { id },
    include: {
      user: { select: { name: true, email: true, role: true } },
      program: true,
      registrations: { include: { courseOffering: { include: { course: true, semester: true } } } }
    },
  });

  if (!student) throw new AppError('Student not found', 404);
  return student;
};

export const createStudent = async (data) => {
  const existing = await prisma.student.findUnique({ where: { universityId: data.universityId } });
  if (existing) throw new AppError('University ID already in use', 400);

  return await prisma.student.create({
    data,
    include: { user: true }
  });
};

export const updateStudent = async (id, data) => {
  const student = await prisma.student.findUnique({ where: { id } });
  if (!student) throw new AppError('Student not found', 404);

  return await prisma.student.update({
    where: { id },
    data,
  });
};

export const deleteStudent = async (id) => {
  const student = await prisma.student.findUnique({ where: { id } });
  if (!student) throw new AppError('Student not found', 404);

  return await prisma.student.delete({ where: { id } });
};

export const getStudentExams = async (id) => {
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