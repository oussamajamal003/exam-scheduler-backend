import prisma from '../../config/prisma.js';
import { AppError } from '../../utils/AppError.js';
import { parseListQuery, buildOrderBy, buildMeta } from '../../utils/queryParser.js';
import { assertNoScheduleAssignmentsForDependency, findImpactedScheduleIds, synchronizeSchedules } from '../schedules/scheduleSyncService.js';

const buildSearchFilter = (search) => ({
  OR: [
    { name: { contains: search, mode: 'insensitive' } },
    { code: { contains: search, mode: 'insensitive' } },
  ],
});

const PROGRAM_SORT_FIELDS = {
  name:      (dir) => ({ name: dir }),
  code:      (dir) => ({ code: dir }),
  createdAt: (dir) => ({ createdAt: dir }),
};

export const getAll = async (query = {}) => {
  const { page, limit, skip, sortField, sortDirection, search } = parseListQuery(query);

  const where = {};
  if (search) Object.assign(where, buildSearchFilter(search));
  if (query.departmentId) where.departmentId = query.departmentId;
  if (query.isActive !== undefined) where.isActive = query.isActive === 'true';

  const orderBy = buildOrderBy(sortField, sortDirection, PROGRAM_SORT_FIELDS, [{ name: 'asc' }]);

  const [data, total] = await Promise.all([
    prisma.program.findMany({
      where, skip, take: limit, orderBy,
      include: { department: true, courses: true, _count: { select: { students: true, courses: true } } },
    }),
    prisma.program.count({ where }),
  ]);

  return { data, meta: buildMeta(total, page, limit) };
};

export const getById = async (id) => {
  const data = await prisma.program.findUnique({
    where: { id },
    include: {
      department: true,
      _count: { select: { students: true, courses: true } },
      students: {
        include: {
          user: { select: { id: true, name: true, email: true, role: true } },
        },
      },
      courses: {
        include: {
          _count: { select: { courseOfferings: true } },
        },
      },
    },
  });

  if (!data) throw new AppError('Program not found', 404);
  return data;
};

export const create = async (data) => {
  return await prisma.program.create({
    data,
    include: {
      department: true,
      courses: true,
      _count: { select: { students: true, courses: true } },
    },
  });
};

export const update = async (id, data) => {
  return prisma.$transaction(async (tx) => {
    const scheduleIds = await findImpactedScheduleIds({ dependency: 'program', ids: [id] }, tx);
    const updated = await tx.program.update({
      where: { id },
      data,
      include: {
        department: true,
        courses: true,
        _count: { select: { students: true, courses: true } },
      },
    });
    await synchronizeSchedules(scheduleIds, tx, { forceUpdateNotification: true });
    return updated;
  });
};

export const remove = async (id) => {
  return prisma.$transaction(async (tx) => {
    const scheduleIds = await findImpactedScheduleIds({ dependency: 'program', ids: [id] }, tx);
    await assertNoScheduleAssignmentsForDependency({ dependency: 'program', ids: [id], entityLabel: 'Program' }, tx);
    const deleted = await tx.program.delete({ where: { id } });
    await synchronizeSchedules(scheduleIds, tx);
    return deleted;
  });
};