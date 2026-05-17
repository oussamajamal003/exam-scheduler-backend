import prisma from '../../config/prisma.js';
import { AppError } from '../../utils/AppError.js';

const scheduleInclude = {
  _count: { select: { assignments: true } },
  assignments: {
    include: {
      exam: {
        include: {
          courseOffering: {
            include: {
              course: true,
              semester: true,
              registrations: {
                include: {
                  student: {
                    include: {
                      user: { select: { id: true, name: true, email: true } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      room: { include: { center: true } },
      proctor: { include: { user: { select: { id: true, name: true, email: true } } } },
      timeSlot: true,
    },
  },
};

export const getAll = async (query = {}) => {
  const page = parseInt(query.page) || 1;
  const limit = parseInt(query.limit) || 10;
  const skip = (page - 1) * limit;

  const where = {};
  if (query.isFinal !== undefined) where.isFinal = query.isFinal === 'true' || query.isFinal === true;
  if (query.search) {
    where.name = { contains: query.search, mode: 'insensitive' };
  }

  const [data, total] = await Promise.all([
    prisma.schedule.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: scheduleInclude,
    }),
    prisma.schedule.count({ where }),
  ]);

  return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
};

export const getById = async (id) => {
  const schedule = await prisma.schedule.findUnique({
    where: { id },
    include: scheduleInclude,
  });

  if (!schedule) throw new AppError('Schedule not found', 404);
  return schedule;
};

export const create = async (data, user) => {
  if (data.isFinal === true) {
    throw new AppError('Schedules must be published through the publish action.', 400);
  }

  return prisma.schedule.create({
    data: {
      name: data.name,
      isFinal: false,
      createdBy: user?.id,
    },
    include: scheduleInclude,
  });
};

export const update = async (id, data) => {
  const existing = await getById(id);

  if (data.isFinal === true) {
    throw new AppError('Schedules must be published through the publish action.', 400);
  }

  if (existing.isFinal && data.name !== undefined) {
    throw new AppError(
      'Published schedules cannot be renamed. Return to draft first.',
      403
    );
  }

  return prisma.schedule.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.isFinal !== undefined ? { isFinal: data.isFinal } : {}),
    },
    include: scheduleInclude,
  });
};

export const remove = async (id) => {
  const existing = await getById(id);
  if (existing.isFinal) {
    throw new AppError(
      'Published schedules cannot be deleted. Return to draft first.',
      403
    );
  }
  return prisma.schedule.delete({ where: { id } });
};

export const unpublish = async (id) => {
  const existing = await getById(id);
  if (!existing.isFinal) {
    throw new AppError('Schedule is already in draft.', 400);
  }
  return prisma.schedule.update({
    where: { id },
    data: { isFinal: false },
    include: scheduleInclude,
  });
};