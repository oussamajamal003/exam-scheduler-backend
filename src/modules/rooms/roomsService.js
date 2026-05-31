import prisma from '../../config/prisma.js';
import { AppError } from '../../utils/AppError.js';
import { parseListQuery, buildOrderBy, buildMeta } from '../../utils/queryParser.js';
import {
  findImpactedScheduleIds,
  removeAssignmentsForDependencyDelete,
  assertNoScheduleAssignmentsForDependency,
  synchronizeSchedules,
} from '../schedules/scheduleSyncService.js';

const roomInclude = {
  center: true,
  assignments: {
    include: {
      schedule: true,
      exam: { include: { courseOffering: { include: { course: true, semester: true } } } },
      proctor: { include: { user: { select: { id: true, name: true, email: true } } } },
      timeSlot: true,
    },
  },
};

const normalizeRoom = (room) => ({
  ...room,
  status: room.status ? room.status.toLowerCase().replace(/^./, str => str.toUpperCase()) : 'Available',
});

// Room has no createdAt — sort fields limited to name, capacity, status
const ROOM_SORT_FIELDS = {
  name:     (dir) => ({ name: dir }),
  capacity: (dir) => ({ capacity: dir }),
  status:   (dir) => ({ status: dir }),
};

const assertUniqueRoomName = async ({ name, excludeId, client = prisma }) => {
  const normalizedName = String(name ?? '').trim();
  if (!normalizedName) return;

  const match = await client.room.findFirst({
    where: { name: { equals: normalizedName, mode: 'insensitive' }, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
    select: { id: true },
  });
  if (match) throw new AppError(`Room name "${normalizedName}" already exists.`, 409);
};

export const getAll = async (query = {}) => {
  const { page, limit, skip, sortField, sortDirection, search } = parseListQuery(query);

  const where = {};
  if (query.centerId) where.centerId = query.centerId;
  if (query.minCapacity) where.capacity = { gte: parseInt(query.minCapacity) };
  if (query.status) where.status = query.status;
  if (search) {
    where.OR = [{ name: { contains: search, mode: 'insensitive' } }];
  }

  const orderBy = buildOrderBy(sortField, sortDirection, ROOM_SORT_FIELDS, [{ name: 'asc' }]);

  const [data, total] = await Promise.all([
    prisma.room.findMany({ where, skip, take: limit, orderBy, include: roomInclude }),
    prisma.room.count({ where }),
  ]);

  return { data: data.map(normalizeRoom), meta: buildMeta(total, page, limit) };
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
  await assertUniqueRoomName({ name: data.name });
  const room = await prisma.room.create({ data, include: roomInclude });
  return normalizeRoom(room);
};

export const update = async (id, data) => {
  return prisma.$transaction(async (tx) => {
    const scheduleIds = await findImpactedScheduleIds({ dependency: 'room', ids: [id] }, tx);

    if (data.center) {
      const center = await tx.center.upsert({
        where: { name: data.center },
        update: {},
        create: { name: data.center },
      });
      data.centerId = center.id;
    }
    delete data.center;

    if (data.status) {
      data.status = data.status.toUpperCase();
    }

    if (data.name !== undefined) {
      await assertUniqueRoomName({ name: data.name, excludeId: id, client: tx });
    }

    const room = await tx.room.update({ where: { id }, data, include: roomInclude });
    await synchronizeSchedules(scheduleIds, tx);
    return normalizeRoom(room);
  });
};

export const remove = async (id) => {
  return prisma.$transaction(async (tx) => {
    const scheduleIds = await findImpactedScheduleIds({ dependency: 'room', ids: [id] }, tx);
    await assertNoScheduleAssignmentsForDependency({ dependency: 'room', ids: [id], entityLabel: 'Room' }, tx);
    await removeAssignmentsForDependencyDelete({ dependency: 'room', ids: [id] }, tx);
    const deleted = await tx.room.delete({ where: { id } });
    await synchronizeSchedules(scheduleIds, tx);
    return deleted;
  });
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