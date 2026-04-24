import prisma from '../../config/prisma.js';
import { AppError } from '../../utils/AppError.js';

const timeSlotInclude = {
  assignments: {
    include: {
      schedule: true,
      exam: { include: { courseOffering: { include: { course: true, semester: true } } } },
      room: true,
      supervisor: { include: { user: { select: { id: true, name: true, email: true } } } },
    },
  },
};

const buildTimeSlotWhere = (query = {}, availableOnly = false) => {
  const where = {};

  if (query.startFrom || query.endTo) {
    where.startTime = {
      ...(query.startFrom ? { gte: new Date(query.startFrom) } : {}),
      ...(query.endTo ? { lte: new Date(query.endTo) } : {}),
    };
  }

  if (query.scheduleId) {
    where.assignments = availableOnly
      ? { none: { scheduleId: query.scheduleId } }
      : { some: { scheduleId: query.scheduleId } };
  } else if (availableOnly) {
    where.assignments = { none: {} };
  }

  return where;
};

export const getAll = async (query = {}) => {
  const page = parseInt(query.page) || 1;
  const limit = parseInt(query.limit) || 10;
  const skip = (page - 1) * limit;

  const where = buildTimeSlotWhere(query);

  const [data, total] = await Promise.all([
    prisma.timeSlot.findMany({
      where,
      skip,
      take: limit,
      orderBy: { startTime: 'asc' },
      include: timeSlotInclude,
    }),
    prisma.timeSlot.count({ where })
  ]);
  
  return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
};

export const getAvailable = async (query = {}) => {
  const page = parseInt(query.page) || 1;
  const limit = parseInt(query.limit) || 10;
  const skip = (page - 1) * limit;

  const where = buildTimeSlotWhere(query, true);

  const [data, total] = await Promise.all([
    prisma.timeSlot.findMany({
      where,
      skip,
      take: limit,
      orderBy: { startTime: 'asc' },
      include: timeSlotInclude,
    }),
    prisma.timeSlot.count({ where }),
  ]);

  return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
};

export const getById = async (id) => {
  const data = await prisma.timeSlot.findUnique({
    where: { id },
    include: timeSlotInclude,
  });
  if (!data) throw new AppError('Not found', 404);
  return data;
};

export const create = async (data) => {
  return await prisma.timeSlot.create({ data, include: timeSlotInclude });
};

export const update = async (id, data) => {
  return await prisma.timeSlot.update({ where: { id }, data, include: timeSlotInclude });
};

export const remove = async (id) => {
  return await prisma.timeSlot.delete({ where: { id } });
};
