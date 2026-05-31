import { Prisma } from '@prisma/client';
import prisma from '../../config/prisma.js';
import { AppError } from '../../utils/AppError.js';
import {
  NOTIFICATION_TYPES,
  createSchedulePublicationNotifications,
} from '../notifications/notificationsService.js';
import {
  assertScheduleNameAvailable,
  normalizeScheduleName,
  remapScheduleNameConflict,
} from './scheduleNameService.js';

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

const getLogicalAssignmentsCount = (assignments = []) => {
  const keys = new Set();
  for (const assignment of assignments) {
    keys.add(assignment.examId);
  }
  return keys.size;
};

const withLogicalAssignmentsCount = (schedule) => {
  if (!schedule) return schedule;

  return {
    ...schedule,
    logicalAssignmentsCount: getLogicalAssignmentsCount(schedule.assignments),
  };
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

  return {
    data: data.map(withLogicalAssignmentsCount),
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
  };
};

export const getById = async (id) => {
  const schedule = await prisma.schedule.findUnique({
    where: { id },
    include: scheduleInclude,
  });

  if (!schedule) throw new AppError('Schedule not found', 404);
  return withLogicalAssignmentsCount(schedule);
};

export const create = async (data, user) => {
  if (data.isFinal === true) {
    throw new AppError('Schedules must be published through the publish action.', 400);
  }

  const normalizedName = normalizeScheduleName(data.name);

  let schedule;
  try {
    schedule = await prisma.$transaction(async (tx) => {
      await assertScheduleNameAvailable(tx, normalizedName);

      return tx.schedule.create({
        data: {
          name: normalizedName,
          isFinal: false,
          createdBy: user?.id,
        },
        include: scheduleInclude,
      });
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 30000,
      maxWait: 10000,
    });
  } catch (error) {
    await remapScheduleNameConflict(prisma, normalizedName, error);
  }

  return withLogicalAssignmentsCount(schedule);
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

  const normalizedName = data.name !== undefined ? normalizeScheduleName(data.name) : undefined;

  let schedule;
  try {
    schedule = await prisma.$transaction(async (tx) => {
      if (normalizedName !== undefined) {
        await assertScheduleNameAvailable(tx, normalizedName, { excludeId: id });
      }

      return tx.schedule.update({
        where: { id },
        data: {
          ...(normalizedName !== undefined ? { name: normalizedName } : {}),
          ...(data.isFinal !== undefined ? { isFinal: data.isFinal } : {}),
        },
        include: scheduleInclude,
      });
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 30000,
      maxWait: 10000,
    });
  } catch (error) {
    await remapScheduleNameConflict(prisma, normalizedName ?? existing.name, error, { excludeId: id });
  }

  return withLogicalAssignmentsCount(schedule);
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

  // Notify the recipients of the current publish round exactly once. The
  // publishedVersion stays the same so a subsequent republish increments to a
  // new version and emits a SCHEDULE_REPUBLISHED keyed to that next version,
  // keeping unpublish and republish notifications independent.
  const currentVersion = existing.publishedVersion ?? 0;

  const schedule = await prisma.$transaction(
    async (tx) => {
      const updated = await tx.schedule.update({
        where: { id },
        data: { isFinal: false },
        include: scheduleInclude,
      });

      await createSchedulePublicationNotifications({
        scheduleId: id,
        eventType: NOTIFICATION_TYPES.SCHEDULE_UNPUBLISHED,
        scheduleVersion: currentVersion,
        client: tx,
      });

      return updated;
    },
    { timeout: 30000, maxWait: 10000 },
  );

  return withLogicalAssignmentsCount(schedule);
};