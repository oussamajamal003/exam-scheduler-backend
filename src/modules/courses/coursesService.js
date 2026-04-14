import prisma from '../../config/prisma.js';
import { AppError } from '../../utils/AppError.js';

export const getAll = async (query = {}) => {
  const page = parseInt(query.page) || 1;
  const limit = parseInt(query.limit) || 10;
  const skip = (page - 1) * limit;

  const where = {};
  if (query.programId) where.programId = query.programId;
  if (query.search) {
    const searchFilter = { contains: query.search, mode: 'insensitive' };
    where.OR = [
      { title: searchFilter },
      { code: searchFilter }
    ];
  }

  const [data, total] = await Promise.all([
    prisma.course.findMany({
      where,
      skip,
      take: limit,
      include: {
        program: true,
        _count: { select: { courseOfferings: true } },
      },
    }),
    prisma.course.count({ where })
  ]);
  
  return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
};

export const getById = async (id) => {
  const data = await prisma.course.findUnique({
    where: { id },
    include: {
      program: true,
      courseOfferings: {
        include: {
          semester: true,
          _count: { select: { registrations: true, exams: true } },
        },
      },
    },
  });
  if (!data) throw new AppError('Not found', 404);
  return data;
};

export const create = async (data) => {
  return await prisma.course.create({ data, include: { program: true } });
};

export const update = async (id, data) => {
  return await prisma.course.update({ where: { id }, data, include: { program: true } });
};

export const remove = async (id) => {
  return await prisma.course.delete({ where: { id } });
};
