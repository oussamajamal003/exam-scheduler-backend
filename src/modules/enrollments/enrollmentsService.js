import prisma from '../../config/prisma.js';
import { AppError } from '../../utils/AppError.js';

const buildEnrollmentInclude = {
  student: { include: { user: { select: { id: true, name: true, email: true } }, program: true } },
  courseOffering: { include: { course: true, semester: true } },
};

export const getAll = async (query = {}) => {
  const page = parseInt(query.page) || 1;
  const limit = parseInt(query.limit) || 10;
  const skip = (page - 1) * limit;

  const where = {};
  if (query.studentId) where.studentId = query.studentId;
  if (query.courseOfferingId) where.courseOfferingId = query.courseOfferingId;
  if (query.semesterId) where.courseOffering = { semesterId: query.semesterId };
  if (query.courseId) {
    where.courseOffering = {
      ...(where.courseOffering || {}),
      courseId: query.courseId,
    };
  }

  const [data, total] = await Promise.all([
    prisma.registration.findMany({
      where,
      skip,
      take: limit,
      include: buildEnrollmentInclude,
    }),
    prisma.registration.count({ where })
  ]);
  
  return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
};

export const getById = async (id) => {
  const data = await prisma.registration.findUnique({
    where: { id },
    include: {
      student: { include: { user: { select: { id: true, name: true, email: true, role: true } }, program: true } },
      courseOffering: {
        include: {
          course: true,
          semester: true,
          exams: true,
        },
      },
    },
  });
  if (!data) throw new AppError('Not found', 404);
  return data;
};

export const getByStudent = async (studentId, query = {}) => {
  return await getAll({ ...query, studentId });
};

export const getByOffering = async (offeringId, query = {}) => {
  return await getAll({ ...query, courseOfferingId: offeringId });
};

export const create = async (data) => {
  return await prisma.registration.create({
    data,
    include: buildEnrollmentInclude,
  });
};

export const bulkImport = async (items = []) => {
  return await prisma.$transaction(async (tx) => {
    const created = [];

    for (const item of items) {
      const enrollment = await tx.registration.create({
        data: item,
        include: buildEnrollmentInclude,
      });
      created.push(enrollment);
    }

    return created;
  });
};

export const update = async (id, data) => {
  return await prisma.registration.update({
    where: { id },
    data,
    include: buildEnrollmentInclude,
  });
};

export const remove = async (id) => {
  return await prisma.registration.delete({ where: { id } });
};
