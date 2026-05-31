import prisma from '../../config/prisma.js';
import { AppError } from '../../utils/AppError.js';
import { parseListQuery, buildOrderBy, buildMeta } from '../../utils/queryParser.js';
import { assertNoScheduleAssignmentsForDependency, findImpactedScheduleIds, synchronizeSchedules } from '../schedules/scheduleSyncService.js';

const COURSE_SORT_FIELDS = {
  code:      (dir) => ({ code: dir }),
  title:     (dir) => ({ title: dir }),
  credits:   (dir) => ({ credits: dir }),
  createdAt: (dir) => ({ createdAt: dir }),
};

export const getAll = async (query = {}) => {
  const { page, limit, skip, sortField, sortDirection, search } = parseListQuery(query);

  const where = {};
  if (query.programId) where.programId = query.programId;
  if (query.departmentId) where.program = { departmentId: query.departmentId };
  if (search) {
    const searchFilter = { contains: search, mode: 'insensitive' };
    where.OR = [{ title: searchFilter }, { code: searchFilter }];
  }

  const orderBy = buildOrderBy(sortField, sortDirection, COURSE_SORT_FIELDS, [{ code: 'asc' }]);

  const [data, total] = await Promise.all([
    prisma.course.findMany({
      where,
      skip,
      take: limit,
      orderBy,
      include: {
        program: true,
        semester: true,
        courseOfferings: {
          orderBy: [{ createdAt: 'desc' }],
          take: 1,
          include: { semester: true },
        },
        _count: { select: { courseOfferings: true } },
      },
    }),
    prisma.course.count({ where }),
  ]);

  return { data, meta: buildMeta(total, page, limit) };
};

export const getById = async (id) => {
  const data = await prisma.course.findUnique({
    where: { id },
    include: {
      program: true,
      semester: true,
      courseOfferings: {
        include: {
          semester: true,
          _count: { select: { registrations: true, exams: true } },
        },
      },
    },
  });
  if (!data) throw new AppError('Not found', 404);
  return data;
};

const courseInclude = {
  program: true,
  semester: true,
  courseOfferings: {
    orderBy: [
      { createdAt: 'desc' },
    ],
    take: 1,
    include: { semester: true },
  },
};

const normalizeUniqueText = (value) => String(value ?? '').trim();

const assertUniqueCourseIdentity = async ({ code, title, excludeId, client = prisma }) => {
  const normalizedCode = normalizeUniqueText(code);
  const normalizedTitle = normalizeUniqueText(title);

  if (normalizedCode) {
    const codeMatch = await client.course.findFirst({
      where: { code: { equals: normalizedCode, mode: 'insensitive' }, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
      select: { id: true },
    });
    if (codeMatch) throw new AppError(`Course code "${normalizedCode}" already exists.`, 409);
  }

  if (normalizedTitle) {
    const titleMatch = await client.course.findFirst({
      where: { title: { equals: normalizedTitle, mode: 'insensitive' }, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
      select: { id: true },
    });
    if (titleMatch) throw new AppError(`Course name "${normalizedTitle}" already exists.`, 409);
  }
};

export const create = async (data) => {
  const courseData = { ...data };
  if (!courseData.semesterId) courseData.semesterId = null;

  await assertUniqueCourseIdentity({ code: courseData.code, title: courseData.title });

  const course = await prisma.course.create({
    data: courseData,
    include: { program: true },
  });

  return prisma.course.findUnique({ where: { id: course.id }, include: courseInclude });
};

export const update = async (id, data) => {
  const courseData = { ...data };
  if ('semesterId' in courseData && !courseData.semesterId) {
    courseData.semesterId = null;
  }

  if (courseData.code !== undefined || courseData.title !== undefined) {
    const current = await prisma.course.findUnique({
      where: { id },
      select: { code: true, title: true },
    });
    if (!current) throw new AppError('Not found', 404);
    await assertUniqueCourseIdentity({
      code: courseData.code ?? current.code,
      title: courseData.title ?? current.title,
      excludeId: id,
    });
  }

  return prisma.$transaction(async (tx) => {
    const scheduleIds = await findImpactedScheduleIds({ dependency: 'course', ids: [id] }, tx);
    await tx.course.update({ where: { id }, data: courseData });
    await synchronizeSchedules(scheduleIds, tx);
    return tx.course.findUnique({ where: { id }, include: courseInclude });
  });
};

export const remove = async (id) => {
  return prisma.$transaction(async (tx) => {
    const scheduleIds = await findImpactedScheduleIds({ dependency: 'course', ids: [id] }, tx);
    await assertNoScheduleAssignmentsForDependency({ dependency: 'course', ids: [id], entityLabel: 'Course' }, tx);
    const deleted = await tx.course.delete({ where: { id } });
    await synchronizeSchedules(scheduleIds, tx);
    return deleted;
  });
};
