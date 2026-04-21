import prisma from '../../config/prisma.js';
import { AppError } from '../../utils/AppError.js';

const buildSearchFilter = (search) => ({
  OR: [
    { name: { contains: search, mode: 'insensitive' } },
    { code: { contains: search, mode: 'insensitive' } },
  ],
});

export const getAll = async (query = {}) => {
  const page = parseInt(query.page) || 1;
  const limit = parseInt(query.limit) || 10;
  const skip = (page - 1) * limit;

  const where = {};
  if (query.search) {
    Object.assign(where, buildSearchFilter(query.search));
  }

  const [data, total] = await Promise.all([
    prisma.department.findMany({
      where,
      skip,
      take: limit,
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { programs: true } },
      },
    }),
    prisma.department.count({ where }),
  ]);

  return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
};

export const getById = async (id) => {
  const data = await prisma.department.findUnique({
    where: { id },
    include: {
      programs: {
        include: {
          _count: { select: { students: true, courses: true } },
        },
      },
      _count: { select: { programs: true } },
    },
  });

  if (!data) throw new AppError('Department not found', 404);
  return data;
};

export const create = async (data) => {
  return await prisma.department.create({
    data,
    include: {
      _count: { select: { programs: true } },
    },
  });
};

export const update = async (id, data) => {
  return await prisma.department.update({
    where: { id },
    data,
    include: {
      _count: { select: { programs: true } },
    },
  });
};

export const remove = async (id) => {
  return await prisma.department.delete({ where: { id } });
};
