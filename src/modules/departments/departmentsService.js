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

const departmentInclude = {
  programs: {
    include: {
      courses: true,
      _count: { select: { students: true, courses: true } },
    },
  },
  _count: { select: { programs: true } },
};

const normalizeDepartment = (department) => {
  const courses = department.programs?.flatMap((program) => program.courses ?? []) ?? [];
  return {
    ...department,
    courses,
    totalCourses: courses.length,
    programsCount: department.programs?.length ?? department._count?.programs ?? 0,
  };
};

const DEPT_SORT_FIELDS = {
  name:      (dir) => ({ name: dir }),
  code:      (dir) => ({ code: dir }),
  createdAt: (dir) => ({ createdAt: dir }),
};

export const getAll = async (query = {}) => {
  const { page, limit, skip, sortField, sortDirection, search } = parseListQuery(query);

  const where = {};
  if (search) Object.assign(where, buildSearchFilter(search));

  const orderBy = buildOrderBy(sortField, sortDirection, DEPT_SORT_FIELDS, [{ name: 'asc' }]);

  const [data, total] = await Promise.all([
    prisma.department.findMany({ where, skip, take: limit, orderBy, include: departmentInclude }),
    prisma.department.count({ where }),
  ]);

  return { data: data.map(normalizeDepartment), meta: buildMeta(total, page, limit) };
};

export const getById = async (id) => {
  const data = await prisma.department.findUnique({
    where: { id },
    include: departmentInclude,
  });

  if (!data) throw new AppError('Department not found', 404);
  return normalizeDepartment(data);
};

export const create = async (data) => {
  const department = await prisma.department.create({
    data,
    include: departmentInclude,
  });
  return normalizeDepartment(department);
};

export const update = async (id, data) => {
  return prisma.$transaction(async (tx) => {
    const scheduleIds = await findImpactedScheduleIds({ dependency: 'department', ids: [id] }, tx);
    const department = await tx.department.update({
      where: { id },
      data,
      include: departmentInclude,
    });
    await synchronizeSchedules(scheduleIds, tx);
    return normalizeDepartment(department);
  });
};

export const remove = async (id) => {
  return prisma.$transaction(async (tx) => {
    const scheduleIds = await findImpactedScheduleIds({ dependency: 'department', ids: [id] }, tx);
    await assertNoScheduleAssignmentsForDependency({ dependency: 'department', ids: [id], entityLabel: 'Department' }, tx);
    const deleted = await tx.department.delete({ where: { id } });
    await synchronizeSchedules(scheduleIds, tx);
    return deleted;
  });
};
