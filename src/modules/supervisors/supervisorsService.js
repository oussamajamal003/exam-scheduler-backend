import prisma from '../../config/prisma.js';
import { AppError } from '../../utils/AppError.js';

export const getAll = async (query = {}) => {
  const page = parseInt(query.page) || 1;
  const limit = parseInt(query.limit) || 10;
  const skip = (page - 1) * limit;

  const where = {};
  if (query.centerId) where.centerId = query.centerId;
  if (query.userId) where.userId = query.userId;
  if (query.search) {
    where.user = {
      OR: [
        { name: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
      ],
    };
  }

  const [data, total] = await Promise.all([
    prisma.supervisor.findMany({
      where,
      skip,
      take: limit,
      include: {
        user: { select: { id: true, name: true, email: true, role: true } },
        center: true,
        _count: { select: { assignments: true } },
      },
    }),
    prisma.supervisor.count({ where })
  ]);
  
  return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
};

export const getById = async (id) => {
  const data = await prisma.supervisor.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, name: true, email: true, role: true } },
      center: true,
      assignments: {
        include: {
          schedule: true,
          exam: {
            include: {
              courseOffering: { include: { course: true, semester: true } },
            },
          },
          room: true,
          timeSlot: true,
        },
      },
    },
  });
  if (!data) throw new AppError('Not found', 404);
  return data;
};

export const create = async (data) => {
  let { userId, centerId, name, email, center, ...rest } = data;
  
  if (!userId && (name && email)) {
    const user = await prisma.user.upsert({
      where: { email },
      update: { name, role: 'SUPERVISOR' },
      create: { name, email, password: 'password123', role: 'SUPERVISOR' }
    });
    userId = user.id;
  }
  
  if (!centerId && center) {
    const centerRecord = await prisma.center.upsert({
      where: { name: center },
      update: {},
      create: { name: center }
    });
    centerId = centerRecord.id;
  }
  
  if (!userId || !centerId) {
    throw new AppError('Unable to resolve user or center for supervisor', 400);
  }
  
  return await prisma.supervisor.create({
    data: { ...rest, userId, centerId },
    include: {
      user: { select: { id: true, name: true, email: true, role: true } },
      center: true,
    },
  });
};

export const update = async (id, data) => {
  let { userId, centerId, name, email, center, ...rest } = data;
  const updatePayload = { ...rest };
  
  const existing = await prisma.supervisor.findUnique({ where: { id }, select: { userId: true } });
  
  if (name || email) {
    await prisma.user.update({
      where: { id: existing.userId },
      data: { ...(name && { name }), ...(email && { email }) }
    });
  }

  if (center) {
    const centerRecord = await prisma.center.upsert({
      where: { name: center },
      update: {},
      create: { name: center }
    });
    updatePayload.centerId = centerRecord.id;
  } else if (centerId) {
    updatePayload.centerId = centerId;
  }
  
  return await prisma.supervisor.update({
    where: { id },
    data: updatePayload,
    include: {
      user: { select: { id: true, name: true, email: true, role: true } },
      center: true,
    },
  });
};

export const remove = async (id) => {
  return await prisma.supervisor.delete({ where: { id } });
};

export const getWorkload = async (id) => {
  const supervisor = await prisma.supervisor.findUnique({
    where: { id },
    include: { assignments: { include: { timeSlot: true, exam: { include: { courseOffering: { include: { course: true } } } } } } }
  });
  if (!supervisor) throw new AppError('Supervisor not found', 404);
  return { workloadCount: supervisor.assignments.length, assignments: supervisor.assignments };
};