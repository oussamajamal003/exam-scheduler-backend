import prisma from '../../config/prisma.js';
import { AppError } from '../../utils/AppError.js';
import { parseListQuery, buildOrderBy, buildMeta } from '../../utils/queryParser.js';
import { findImpactedScheduleIds, synchronizeSchedules } from '../schedules/scheduleSyncService.js';

const buildEnrollmentInclude = {
  student: { include: { user: { select: { id: true, name: true, email: true } }, program: { include: { department: true } } } },
  courseOffering: { include: { course: { include: { program: { include: { department: true } } } }, semester: true } },
};

const buildEnrollmentListSelect = {
  id: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  student: {
    select: {
      id: true,
      universityId: true,
      user: { select: { id: true, name: true, email: true } },
      program: { select: { id: true, name: true, code: true, department: { select: { id: true, name: true, code: true } } } },
    },
  },
  courseOffering: {
    select: {
      id: true,
      section: true,
      instructor: true,
      course: {
        select: {
          id: true,
          code: true,
          title: true,
          program: { select: { id: true, name: true, code: true, department: { select: { id: true, name: true, code: true } } } },
        },
      },
      semester: { select: { id: true, name: true } },
    },
  },
};

const buildFilterCourseOfferingSelect = {
  id: true,
  section: true,
  instructor: true,
  course: {
    select: {
      id: true,
      code: true,
      title: true,
      program: { select: { id: true, name: true, code: true, department: { select: { id: true, name: true, code: true } } } },
    },
  },
  semester: { select: { id: true, name: true } },
};

const normalizeEnrollment = (enrollment) => {
  if (!enrollment) return enrollment;

  const course = enrollment.courseOffering?.course
    ? {
        ...enrollment.courseOffering.course,
        name: enrollment.courseOffering.course.name ?? enrollment.courseOffering.course.title,
      }
    : null;
  const courseOffering = enrollment.courseOffering
    ? {
        ...enrollment.courseOffering,
        course,
        program: course?.program ?? null,
      }
    : null;

  return {
    ...enrollment,
    student: enrollment.student
      ? {
          ...enrollment.student,
          fullName: enrollment.student.user?.name ?? null,
        }
      : null,
    courseOffering,
    program: courseOffering?.program ?? null,
    semester: courseOffering?.semester ?? null,
  };
};

const applyEnrollmentAccess = (where, user) => {
  if (user?.role !== 'STUDENT') return where;
  if (!user.studentId) throw new AppError('Student profile is not linked to this user', 403);

  return { ...where, studentId: user.studentId };
};

const ENROLLMENT_SORT_FIELDS = {
  status:    (dir) => ({ status: dir }),
  createdAt: (dir) => ({ createdAt: dir }),
};

const buildEnrollmentWhere = (query = {}, search) => {
  const where = {};

  if (query.studentId) where.studentId = query.studentId;
  if (query.courseOfferingId) where.courseOfferingId = query.courseOfferingId;
  if (query.status) where.status = query.status;
  if (query.semesterId || query.courseId || query.departmentId) {
    where.courseOffering = {
      ...(query.semesterId ? { semesterId: query.semesterId } : {}),
      ...(query.courseId ? { courseId: query.courseId } : {}),
      ...(query.departmentId
        ? { course: { program: { departmentId: query.departmentId } } }
        : {}),
    };
  }

  if (search) {
    where.OR = [
      { student: { universityId: { contains: search, mode: 'insensitive' } } },
      { student: { user: { name: { contains: search, mode: 'insensitive' } } } },
      { student: { user: { email: { contains: search, mode: 'insensitive' } } } },
      { courseOffering: { section: { contains: search, mode: 'insensitive' } } },
      { courseOffering: { semester: { name: { contains: search, mode: 'insensitive' } } } },
      { courseOffering: { course: { code: { contains: search, mode: 'insensitive' } } } },
      { courseOffering: { course: { title: { contains: search, mode: 'insensitive' } } } },
      { courseOffering: { course: { program: { name: { contains: search, mode: 'insensitive' } } } } },
      { courseOffering: { course: { program: { department: { name: { contains: search, mode: 'insensitive' } } } } } },
    ];
  }

  return where;
};

export const getAll = async (query = {}, user) => {
  const { page, limit, skip, sortField, sortDirection, search } = parseListQuery(query);

  const where = applyEnrollmentAccess(buildEnrollmentWhere(query, search), user);

  const orderBy = buildOrderBy(sortField, sortDirection, ENROLLMENT_SORT_FIELDS, [{ createdAt: 'desc' }]);

  const [data, total] = await Promise.all([
    prisma.registration.findMany({ where, skip, take: limit, orderBy, select: buildEnrollmentListSelect }),
    prisma.registration.count({ where }),
  ]);

  return { data: data.map(normalizeEnrollment), meta: buildMeta(total, page, limit) };
};

export const getFilterOptions = async (query = {}, user) => {
  const where = applyEnrollmentAccess(buildEnrollmentWhere({ semesterId: query.semesterId }), user);

  const [rows, courseOfferings] = await Promise.all([
    prisma.registration.findMany({
      where,
      select: buildEnrollmentListSelect,
      orderBy: [{ courseOffering: { course: { code: 'asc' } } }, { student: { user: { name: 'asc' } } }],
    }),
    user?.role === 'STUDENT'
      ? Promise.resolve([])
      : prisma.courseOffering.findMany({
          where: query.semesterId ? { semesterId: query.semesterId } : {},
          select: buildFilterCourseOfferingSelect,
          orderBy: [{ course: { code: 'asc' } }, { section: 'asc' }],
        }),
  ]);

  const studentsById = new Map();
  const offeringsById = new Map();
  const departmentsById = new Map();

  for (const row of rows) {
    if (row.student?.id) {
      studentsById.set(row.student.id, normalizeEnrollment(row).student);
    }

    const offering = normalizeEnrollment(row).courseOffering;
    if (offering?.id) {
      offeringsById.set(offering.id, offering);
    }

    const department = row.courseOffering?.course?.program?.department;
    if (department?.id) {
      departmentsById.set(department.id, department);
    }
  }

  for (const offering of courseOfferings) {
    const normalizedOffering = normalizeEnrollment({ id: 'filter-option', courseOffering: offering }).courseOffering;
    if (normalizedOffering?.id) {
      offeringsById.set(normalizedOffering.id, normalizedOffering);
    }

    const department = offering.course?.program?.department;
    if (department?.id) {
      departmentsById.set(department.id, department);
    }
  }

  return {
    students: [...studentsById.values()],
    courseOfferings: [...offeringsById.values()],
    departments: [...departmentsById.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
};

export const getById = async (id, user) => {
  const data = await prisma.registration.findFirst({
    where: applyEnrollmentAccess({ id }, user),
    include: {
      student: { include: { user: { select: { id: true, name: true, email: true, role: true } }, program: true } },
      courseOffering: {
        include: {
          course: { include: { program: true } },
          semester: true,
          exams: true,
        },
      },
    },
  });
  if (!data) throw new AppError('Not found', 404);
  return normalizeEnrollment(data);
};

export const getByStudent = async (studentId, query = {}, user) => {
  if (user?.role === 'STUDENT' && user.studentId !== studentId) {
    throw new AppError('You can only access your own enrollments', 403);
  }

  return await getAll({ ...query, studentId }, user);
};

export const getByOffering = async (offeringId, query = {}, user) => {
  return await getAll({ ...query, courseOfferingId: offeringId }, user);
};

// -------------------- capacity guard --------------------
const assertOfferingCapacity = async (courseOfferingId, tx = prisma) => {
  const offering = await tx.courseOffering.findUnique({
    where: { id: courseOfferingId },
    select: {
      capacity: true,
      course: { select: { code: true, title: true } },
      _count: { select: { registrations: true } },
    },
  });
  if (!offering) throw new AppError('Course offering not found.', 404);
  if (offering.capacity != null && offering.capacity > 0) {
    const enrolled = offering._count.registrations;
    if (enrolled >= offering.capacity) {
      const label = offering.course?.code ?? offering.course?.title ?? 'This course offering';
      throw new AppError(
        `"${label}" is full. Capacity: ${offering.capacity}, currently enrolled: ${enrolled}.`,
        409,
      );
    }
  }
};

export const create = async (data) => {
  await assertOfferingCapacity(data.courseOfferingId);
  return prisma.$transaction(async (tx) => {
    const scheduleIds = await findImpactedScheduleIds({ dependency: 'courseOffering', ids: [data.courseOfferingId] }, tx);
    const enrollment = await tx.registration.create({
      data,
      include: buildEnrollmentInclude,
    });
    await synchronizeSchedules(scheduleIds, tx);
    return normalizeEnrollment(enrollment);
  });
};

export const bulkImport = async (items = []) => {
  return await prisma.$transaction(async (tx) => {
    const created = [];
    const impactedOfferingIds = new Set(items.map((item) => item.courseOfferingId).filter(Boolean));
    // Track per-offering count added in this batch (on top of existing registrations)
    const batchCounters = new Map();

    for (const item of items) {
      // Fetch offering capacity once per offering per transaction
      const offeringId = item.courseOfferingId;
      if (!batchCounters.has(offeringId)) {
        const offering = await tx.courseOffering.findUnique({
          where: { id: offeringId },
          select: {
            capacity: true,
            course: { select: { code: true, title: true } },
            _count: { select: { registrations: true } },
          },
        });
        if (!offering) throw new AppError(`Course offering ${offeringId} not found.`, 404);
        batchCounters.set(offeringId, {
          capacity: offering.capacity,
          label: offering.course?.code ?? offering.course?.title ?? 'offering',
          current: offering._count.registrations,
          added: 0,
        });
      }
      const counter = batchCounters.get(offeringId);
      if (counter.capacity != null && counter.capacity > 0) {
        const projected = counter.current + counter.added;
        if (projected >= counter.capacity) {
          throw new AppError(
            `"${counter.label}" is full. Capacity: ${counter.capacity}, enrolled: ${projected}. No additional students can be enrolled.`,
            409,
          );
        }
      }
      counter.added += 1;

      const enrollment = await tx.registration.create({
        data: item,
        include: buildEnrollmentInclude,
      });
      created.push(normalizeEnrollment(enrollment));
    }

    const scheduleIds = await findImpactedScheduleIds({ dependency: 'courseOffering', ids: [...impactedOfferingIds] }, tx);
    await synchronizeSchedules(scheduleIds, tx);
    return created;
  });
};

export const update = async (id, data) => {
  const existing = await prisma.registration.findUnique({ where: { id }, select: { courseOfferingId: true } });
  if (!existing) throw new AppError('Not found', 404);

  return prisma.$transaction(async (tx) => {
    const impactedOfferingIds = [existing.courseOfferingId, data.courseOfferingId].filter(Boolean);
    const scheduleIds = await findImpactedScheduleIds({ dependency: 'courseOffering', ids: impactedOfferingIds }, tx);
    const enrollment = await tx.registration.update({
      where: { id },
      data,
      include: buildEnrollmentInclude,
    });
    await synchronizeSchedules(scheduleIds, tx);
    return normalizeEnrollment(enrollment);
  });
};

export const remove = async (id) => {
  const existing = await prisma.registration.findUnique({ where: { id }, select: { courseOfferingId: true } });
  if (!existing) throw new AppError('Not found', 404);

  return prisma.$transaction(async (tx) => {
    const scheduleIds = await findImpactedScheduleIds({ dependency: 'courseOffering', ids: [existing.courseOfferingId] }, tx);
    const deleted = await tx.registration.delete({ where: { id } });
    await synchronizeSchedules(scheduleIds, tx);
    return deleted;
  });
};
