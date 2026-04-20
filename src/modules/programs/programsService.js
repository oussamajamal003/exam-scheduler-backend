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
    prisma.program.findMany({
      where,
      skip,
      take: limit,
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { students: true, courses: true } },
      },
    }),
    prisma.program.count({ where }),
  ]);

  return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
};

export const getById = async (id) => {
  const data = await prisma.program.findUnique({
    where: { id },
    include: {
      _count: { select: { students: true, courses: true } },
      students: {
        include: {
          user: { select: { id: true, name: true, email: true, role: true } },
        },
      },
      courses: {
        include: {
          _count: { select: { courseOfferings: true } },
        },
      },
    },
  });

  if (!data) throw new AppError('Program not found', 404);
  return data;
};

export const create = async (data) => {
  return await prisma.program.create({
    data,
    include: {
      _count: { select: { students: true, courses: true } },
    },
  });
};

export const update = async (id, data) => {
  return await prisma.program.update({
    where: { id },
    data,
    include: {
      _count: { select: { students: true, courses: true } },
    },
  });
};

export const remove = async (id) => {
  return await prisma.program.delete({ where: { id } });
};