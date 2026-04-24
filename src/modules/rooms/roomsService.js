import prisma from '../../config/prisma.js';
import { AppError } from '../../utils/AppError.js';

const roomInclude = {
  center: true,
  assignments: {
    include: {
      schedule: true,
      exam: { include: { courseOffering: { include: { course: true, semester: true } } } },
      supervisor: { include: { user: { select: { id: true, name: true, email: true } } } },
      timeSlot: true,
    },
  },
};

const normalizeRoom = (room) => ({
  ...room,
  status: room.status ? room.status.toLowerCase().replace(/^./, str => str.toUpperCase()) : 'Available',
});

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
      include: roomInclude,
    }),
    prisma.room.count({ where })
  ]);
  
  return { data: data.map(normalizeRoom), meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
};

export const getById = async (id) => {
  const data = await prisma.room.findUnique({
    where: { id },
    include: roomInclude,
  });
  if (!data) throw new AppError('Not found', 404);
  return normalizeRoom(data);
};

export const create = async (data) => {
  let centerId = data.centerId;
  if (!centerId && data.center) {
    const center = await prisma.center.upsert({
      where: { name: data.center },
      update: {},
      create: { name: data.center },
    });
    centerId = center.id;
  }
  delete data.center;
  
  if (!centerId) {
    throw new AppError('Center name is required', 400);
  }
  
  // Transform status from frontend format to database enum
  if (data.status) {
    data.status = data.status.toUpperCase();
  }
  
  data.centerId = centerId;
  const room = await prisma.room.create({ data, include: roomInclude });
  return normalizeRoom(room);
};

export const update = async (id, data) => {
  if (data.center) {
    const center = await prisma.center.upsert({
      where: { name: data.center },
      update: {},
      create: { name: data.center },
    });
    data.centerId = center.id;
  }
  delete data.center;

  // Transform status from frontend format to database enum
  if (data.status) {
    data.status = data.status.toUpperCase();
  }

  const room = await prisma.room.update({ where: { id }, data, include: roomInclude });
  return normalizeRoom(room);
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
  const data = await prisma.room.findMany({ where, include: roomInclude });
  return data.map(normalizeRoom);
};