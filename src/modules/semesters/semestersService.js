import prisma from '../../config/prisma.js';
import { AppError } from '../../utils/AppError.js';

export const getAll = async (query = {}) => {
  const page = parseInt(query.page) || 1;
  const limit = parseInt(query.limit) || 10;
  const skip = (page - 1) * limit;

  const where = {};
  if (query.search) {
    where.name = { contains: query.search, mode: 'insensitive' };
  }
  if (query.isActive !== undefined) {
    where.isActive = query.isActive === 'true' || query.isActive === true;
  }

  const [data, total] = await Promise.all([
    prisma.semester.findMany({
      where,
      skip,
      take: limit,
      orderBy: [{ isActive: 'desc' }, { startDate: 'desc' }],
      include: {
        _count: { select: { courseOfferings: true } },
      },
    }),
    prisma.semester.count({ where }),
  ]);

  return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
};

export const getById = async (id) => {
  const data = await prisma.semester.findUnique({
    where: { id },
    include: {
      _count: { select: { courseOfferings: true } },
      courseOfferings: {
        include: {
          course: true,
          _count: { select: { registrations: true, exams: true } },
        },
      },
    },
  });

  if (!data) throw new AppError('Semester not found', 404);
  return data;
};

export const create = async (data) => {
  return await prisma.$transaction(async (tx) => {
    if (data.isActive) {
      await tx.semester.updateMany({ where: {}, data: { isActive: false } });
    }

    return await tx.semester.create({
      data,
      include: {
        _count: { select: { courseOfferings: true } },
      },
    });
  });
};

export const update = async (id, data) => {
  return await prisma.$transaction(async (tx) => {
    const current = await tx.semester.findUnique({ where: { id } });
    if (!current) throw new AppError('Semester not found', 404);

    if (data.isActive) {
      await tx.semester.updateMany({ where: { id: { not: id } }, data: { isActive: false } });
    }

    return await tx.semester.update({
      where: { id },
      data,
      include: {
        _count: { select: { courseOfferings: true } },
      },
    });
  });
};

export const remove = async (id) => {
  return await prisma.semester.delete({ where: { id } });
};