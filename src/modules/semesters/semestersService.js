import prisma from '../../config/prisma.js';
import { AppError } from '../../utils/AppError.js';
import { parseListQuery, buildOrderBy, buildMeta } from '../../utils/queryParser.js';
import { clearDemoDatasetByKeyWithTx, getDemoDatasetKeyForSemester } from '../demoData/demoDataService.js';
import { assertNoScheduleAssignmentsForDependency, findImpactedScheduleIds, synchronizeSchedules } from '../schedules/scheduleSyncService.js';

const semesterInclude = {
  courseOfferings: {
    include: {
      course: { include: { program: true } },
      semester: true,
      registrations: {
        include: {
          student: { include: { user: { select: { id: true, name: true, email: true } }, program: true } },
        },
      },
      exams: true,
    },
  },
};

const SEMESTER_SORT_FIELDS = {
  name:         (dir) => ({ name: dir }),
  startDate:    (dir) => ({ startDate: dir }),
  endDate:      (dir) => ({ endDate: dir }),
  academicYear: (dir) => ({ academicYear: dir }),
  createdAt:    (dir) => ({ createdAt: dir }),
};

const DEMO_SEMESTER_NAMES = new Set([
  'Demo Dataset A - Balanced Fall 2026',
  'Demo Dataset B - Expanded Spring 2027',
  'Demo Dataset C - Enterprise Fall 2027',
  'FEIT Spring 2026',
]);

const getSemesterGroupKey = (semester) => (
  (typeof semester.createdBy === 'string' && semester.createdBy.startsWith('demo-data:')) || DEMO_SEMESTER_NAMES.has(semester.name)
    ? `demo:${semester.name}`
    : `semester:${semester.id}`
);

const choosePreferredSemester = (current, candidate) => {
  if (!current) return candidate;

  const currentOfferings = current.courseOfferings?.length ?? 0;
  const candidateOfferings = candidate.courseOfferings?.length ?? 0;
  if (candidateOfferings !== currentOfferings) return candidateOfferings > currentOfferings ? candidate : current;

  const currentUpdatedAt = current.updatedAt instanceof Date ? current.updatedAt.getTime() : 0;
  const candidateUpdatedAt = candidate.updatedAt instanceof Date ? candidate.updatedAt.getTime() : 0;
  return candidateUpdatedAt > currentUpdatedAt ? candidate : current;
};

const collapseDuplicateDemoSemesters = (semesters) => {
  const preferredByKey = new Map();
  for (const semester of semesters) {
    const key = getSemesterGroupKey(semester);
    preferredByKey.set(key, choosePreferredSemester(preferredByKey.get(key), semester));
  }

  const deduped = [];
  const seenKeys = new Set();
  for (const semester of semesters) {
    const key = getSemesterGroupKey(semester);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    deduped.push(preferredByKey.get(key));
  }

  return deduped;
};

export const getAll = async (query = {}) => {
  const { page, limit, skip, sortField, sortDirection, search } = parseListQuery(query);

  const where = {};
  if (search) where.name = { contains: search, mode: 'insensitive' };
  if (query.academicYear) where.academicYear = query.academicYear;
  if (query.startFrom) where.startDate = { gte: new Date(query.startFrom) };
  if (query.endTo) {
    where.endDate = { ...(where.endDate || {}), lte: new Date(query.endTo) };
  }

  const orderBy = buildOrderBy(sortField, sortDirection, SEMESTER_SORT_FIELDS, [{ startDate: 'desc' }]);

  const rows = await prisma.semester.findMany({ where, orderBy, include: semesterInclude });
  const data = collapseDuplicateDemoSemesters(rows).slice(skip, skip + limit);
  const total = collapseDuplicateDemoSemesters(rows).length;

  return { data, meta: buildMeta(total, page, limit) };
};

export const getById = async (id) => {
  const data = await prisma.semester.findUnique({
    where: { id },
    include: {
      ...semesterInclude,
    },
  });

  if (!data) throw new AppError('Semester not found', 404);
  return data;
};

export const create = async (data) => {
  if (data.isActive) {
    return prisma.$transaction(async (tx) => {
      await tx.semester.updateMany({ where: { isActive: true }, data: { isActive: false } });
      return tx.semester.create({ data, include: semesterInclude });
    });
  }
  return await prisma.semester.create({
    data,
    include: semesterInclude,
  });
};

export const update = async (id, data) => {
  const current = await prisma.semester.findUnique({ where: { id } });
  if (!current) throw new AppError('Semester not found', 404);

  return prisma.$transaction(async (tx) => {
    const scheduleIds = await findImpactedScheduleIds({ dependency: 'semester', ids: [id] }, tx);
    if (data.isActive) {
      await tx.semester.updateMany({ where: { isActive: true, id: { not: id } }, data: { isActive: false } });
    }
    const updated = await tx.semester.update({
      where: { id },
      data,
      include: semesterInclude,
    });
    await synchronizeSchedules(scheduleIds, tx);
    return updated;
  });
};

export const remove = async (id) => {
  return prisma.$transaction(async (tx) => {
    const semester = await tx.semester.findUnique({ where: { id } });
    if (!semester) throw new AppError('Semester not found', 404);

    const scheduleIds = await findImpactedScheduleIds({ dependency: 'semester', ids: [id] }, tx);
    await assertNoScheduleAssignmentsForDependency({
      dependency: 'semester',
      ids: [id],
      entityLabel: 'Semester',
      message: 'Cannot delete semester. Delete related schedules first.',
    }, tx);

    const demoDatasetKey = getDemoDatasetKeyForSemester(semester);
    const deleted = demoDatasetKey
      ? await clearDemoDatasetByKeyWithTx(tx, demoDatasetKey).then(() => semester)
      : await tx.semester.delete({ where: { id } });

    await synchronizeSchedules(scheduleIds, tx);
    return deleted;
  });
};