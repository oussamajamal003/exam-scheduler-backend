import prisma from '../../config/prisma.js';
import { AppError } from '../../utils/AppError.js';

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
      include: {
        student: { include: { user: { select: { id: true, name: true, email: true } }, program: true } },
        courseOffering: { include: { course: true, semester: true } },
      },
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
      courseOffering: { include: { course: true, semester: true, exams: true } },
    },
  });
  if (!data) throw new AppError('Not found', 404);
  return data;
};

export const create = async (data) => {
  return await prisma.registration.create({
    data,
    include: {
      student: { include: { user: { select: { id: true, name: true, email: true } } } },
      courseOffering: { include: { course: true, semester: true } },
    },
  });
};

export const update = async (id, data) => {
  return await prisma.registration.update({
    where: { id },
    data,
    include: {
      student: { include: { user: { select: { id: true, name: true, email: true } } } },
      courseOffering: { include: { course: true, semester: true } },
    },
  });
};

export const remove = async (id) => {
  return await prisma.registration.delete({ where: { id } });
};
