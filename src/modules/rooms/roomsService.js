import prisma from '../../config/prisma.js';
import { AppError } from '../../utils/AppError.js';

export const getAll = async (query = {}) => {
  const page = parseInt(query.page) || 1;
  const limit = parseInt(query.limit) || 10;
  const skip = (page - 1) * limit;

  const where = {};
  if (query.centerId) where.centerId = query.centerId;
  if (query.minCapacity) where.capacity = { gte: parseInt(query.minCapacity) };
  if (query.search) {
    where.OR = [
      { name: { contains: query.search, mode: 'insensitive' } }
    ];
  }

  const [data, total] = await Promise.all([
    prisma.room.findMany({
      where,
      skip,
      take: limit,
      include: {
        center: true,
        _count: { select: { assignments: true } },
      },
    }),
    prisma.room.count({ where })
  ]);
  
  return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
};

export const getById = async (id) => {
  const data = await prisma.room.findUnique({
    where: { id },
    include: {
      center: true,
      assignments: {
        include: {
          schedule: true,
          exam: { include: { courseOffering: { include: { course: true, semester: true } } } },
          supervisor: { include: { user: { select: { id: true, name: true, email: true } } } },
          timeSlot: true,
        },
      },
    },
  });
  if (!data) throw new AppError('Not found', 404);
  return data;
};

export const create = async (data) => {
  return await prisma.room.create({ data, include: { center: true } });
};

export const update = async (id, data) => {
  return await prisma.room.update({ where: { id }, data, include: { center: true } });
};

export const remove = async (id) => {
  return await prisma.room.delete({ where: { id } });
};

export const getAvailable = async (query) => {
  const { timeSlotId, capacity } = query;
  let where = {};
  if (capacity) where.capacity = { gte: parseInt(capacity) };
  if (timeSlotId) {
    where.assignments = { none: { timeSlotId } };
  }
  return await prisma.room.findMany({ where, include: { center: true } });
};