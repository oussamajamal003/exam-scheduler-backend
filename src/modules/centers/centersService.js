import prisma from '../../config/prisma.js';
import { AppError } from '../../utils/AppError.js';
import { parseListQuery, buildOrderBy, buildMeta } from '../../utils/queryParser.js';
import {
  findImpactedScheduleIds,
  removeAssignmentsForDependencyDelete,
  synchronizeSchedules,
  assertNoScheduleAssignmentsForDependency,
} from '../schedules/scheduleSyncService.js';

const centerInclude = {
  rooms: true,
  _count: { select: { rooms: true } },
};

const normalizeSupervisors = (supervisors = []) => {
  return [...new Set((supervisors ?? []).map((value) => value?.trim()).filter(Boolean))];
};

const buildCenterWriteData = async (payload) => {
  const { supervisors, ...data } = payload;

  if (supervisors === undefined) {
    return data;
  }

  return {
    ...data,
    supervisors: normalizeSupervisors(supervisors),
  };
};

const normalizeCenter = (center) => ({
  ...center,
  roomsCount: center.rooms?.length ?? center._count?.rooms ?? 0,
  supervisorsCount: center.supervisors?.length ?? 0,
});

const CENTER_SORT_FIELDS = {
  name:      (dir) => ({ name: dir }),
  code:      (dir) => ({ code: dir }),
  createdAt: (dir) => ({ createdAt: dir }),
};

const assertUniqueCenterName = async ({ name, excludeId, client = prisma }) => {
  const normalizedName = String(name ?? '').trim();
  if (!normalizedName) return;

  const match = await client.center.findFirst({
    where: { name: { equals: normalizedName, mode: 'insensitive' }, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
    select: { id: true },
  });
  if (match) throw new AppError(`Center name "${normalizedName}" already exists.`, 409);
};

export const getAll = async (query = {}) => {
  const { page, limit, skip, sortField, sortDirection, search } = parseListQuery(query);

  const where = {};
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { location: { contains: search, mode: 'insensitive' } },
    ];
  }
  if (query.isActive !== undefined) where.isActive = query.isActive === 'true';

  const orderBy = buildOrderBy(sortField, sortDirection, CENTER_SORT_FIELDS, [{ name: 'asc' }]);

  const [data, total] = await Promise.all([
    prisma.center.findMany({ where, skip, take: limit, orderBy, include: centerInclude }),
    prisma.center.count({ where }),
  ]);

  return { data: data.map(normalizeCenter), meta: buildMeta(total, page, limit) };
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
  const centerData = await buildCenterWriteData(data);
  await assertUniqueCenterName({ name: centerData.name });
  const center = await prisma.center.create({
    data: centerData,
    include: centerInclude,
  });
  return normalizeCenter(center);
};

export const update = async (id, data) => {
  const centerData = await buildCenterWriteData(data);
  return prisma.$transaction(async (tx) => {
    const scheduleIds = await findImpactedScheduleIds({ dependency: 'center', ids: [id] }, tx);
    if (centerData.name !== undefined) {
      await assertUniqueCenterName({ name: centerData.name, excludeId: id, client: tx });
    }
    const center = await tx.center.update({
      where: { id },
      data: centerData,
      include: centerInclude,
    });
    await synchronizeSchedules(scheduleIds, tx);
    return normalizeCenter(center);
  });
};

export const remove = async (id) => {
  return prisma.$transaction(async (tx) => {
    const scheduleIds = await findImpactedScheduleIds({ dependency: 'center', ids: [id] }, tx);
    await assertNoScheduleAssignmentsForDependency({ dependency: 'center', ids: [id], entityLabel: 'Center' }, tx);
    await removeAssignmentsForDependencyDelete({ dependency: 'center', ids: [id] }, tx);
    const deleted = await tx.center.delete({ where: { id } });
    await synchronizeSchedules(scheduleIds, tx);
    return deleted;
  });
};