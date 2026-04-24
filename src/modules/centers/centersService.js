import prisma from '../../config/prisma.js';
import { AppError } from '../../utils/AppError.js';

const centerInclude = {
  rooms: true,
  supervisors: {
    include: {
      user: { select: { id: true, name: true, email: true, role: true } },
    },
  },
  _count: { select: { rooms: true, supervisors: true } },
};

const normalizeCenter = (center) => ({
  ...center,
  roomsCount: center.rooms?.length ?? center._count?.rooms ?? 0,
  supervisorsCount: center.supervisors?.length ?? center._count?.supervisors ?? 0,
});

export const getAll = async (query = {}) => {
  const page = parseInt(query.page) || 1;
  const limit = parseInt(query.limit) || 10;
  const skip = (page - 1) * limit;

  const where = {};
  if (query.search) {
    where.OR = [
      { name: { contains: query.search, mode: 'insensitive' } },
      { location: { contains: query.search, mode: 'insensitive' } },
    ];
  }

  const [data, total] = await Promise.all([
    prisma.center.findMany({
      where,
      skip,
      take: limit,
      orderBy: { name: 'asc' },
      include: centerInclude,
    }),
    prisma.center.count({ where }),
  ]);

  return { data: data.map(normalizeCenter), meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
};

export const getById = async (id) => {
  const data = await prisma.center.findUnique({
    where: { id },
    include: centerInclude,
  });

  if (!data) throw new AppError('Center not found', 404);
  return normalizeCenter(data);
};

export const create = async (data) => {
  const center = await prisma.center.create({
    data,
    include: centerInclude,
  });
  return normalizeCenter(center);
};

export const update = async (id, data) => {
  const center = await prisma.center.update({
    where: { id },
    data,
    include: centerInclude,
  });
  return normalizeCenter(center);
};

export const remove = async (id) => {
  return await prisma.center.delete({ where: { id } });
};