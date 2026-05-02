import prisma from '../../config/prisma.js';
import { AppError } from '../../utils/AppError.js';

const buildEnrollmentInclude = {
  student: { include: { user: { select: { id: true, name: true, email: true } }, program: true } },
  courseOffering: { include: { course: { include: { program: true } }, semester: true } },
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

export const getAll = async (query = {}, user) => {
  const page = parseInt(query.page) || 1;
  const limit = parseInt(query.limit) || 10;
  const skip = (page - 1) * limit;

  let where = {};
  if (query.studentId) where.studentId = query.studentId;
  if (query.courseOfferingId) where.courseOfferingId = query.courseOfferingId;
  if (query.semesterId) where.courseOffering = { semesterId: query.semesterId };
  if (query.courseId) {
    where.courseOffering = {
      ...(where.courseOffering || {}),
      courseId: query.courseId,
    };
  }

  where = applyEnrollmentAccess(where, user);

  const [data, total] = await Promise.all([
    prisma.registration.findMany({
      where,
      skip,
      take: limit,
      include: buildEnrollmentInclude,
    }),
    prisma.registration.count({ where })
  ]);
  
  return { data: data.map(normalizeEnrollment), meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
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
  const enrollment = await prisma.registration.create({
    data,
    include: buildEnrollmentInclude,
  });
  return normalizeEnrollment(enrollment);
};

export const bulkImport = async (items = []) => {
  return await prisma.$transaction(async (tx) => {
    const created = [];
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

    return created;
  });
};

export const update = async (id, data) => {
  const enrollment = await prisma.registration.update({
    where: { id },
    data,
    include: buildEnrollmentInclude,
  });
  return normalizeEnrollment(enrollment);
};

export const remove = async (id) => {
  return await prisma.registration.delete({ where: { id } });
};
