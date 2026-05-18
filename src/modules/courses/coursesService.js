import prisma from '../../config/prisma.js';
import { AppError } from '../../utils/AppError.js';

export const getAll = async (query = {}) => {
  const page = parseInt(query.page) || 1;
  const limit = parseInt(query.limit) || 10;
  const skip = (page - 1) * limit;

  const where = {};
  if (query.programId) where.programId = query.programId;
  if (query.search) {
    const searchFilter = { contains: query.search, mode: 'insensitive' };
    where.OR = [
      { title: searchFilter },
      { code: searchFilter }
    ];
  }

  const [data, total] = await Promise.all([
    prisma.course.findMany({
      where,
      skip,
      take: limit,
      include: {
        program: true,
        semester: true,
        courseOfferings: {
          orderBy: [
            { createdAt: 'desc' },
          ],
          take: 1,
          include: {
            semester: true,
          },
        },
        _count: { select: { courseOfferings: true } },
      },
    }),
    prisma.course.count({ where })
  ]);
  
  return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
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

export const create = async (data) => {
  const courseData = { ...data };
  if (!courseData.semesterId) courseData.semesterId = null;

  // Friendly check for the [code, semesterId] uniqueness so we can return a
  // clear message: the same course code is allowed across different semesters,
  // but not within the same semester (or twice with no semester).
  const existing = await prisma.course.findFirst({
    where: { code: courseData.code, semesterId: courseData.semesterId },
    select: { id: true, semester: { select: { name: true } } },
  });
  if (existing) {
    const where = existing.semester?.name
      ? `in ${existing.semester.name}`
      : 'with no semester assigned';
    throw new AppError(
      `A course with code "${courseData.code}" already exists ${where}. Pick a different semester to create another.`,
      409
    );
  }

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

  // If code or semesterId is changing, ensure the new pair is still unique.
  if (courseData.code !== undefined || 'semesterId' in courseData) {
    const current = await prisma.course.findUnique({
      where: { id },
      select: { code: true, semesterId: true },
    });
    if (!current) throw new AppError('Not found', 404);
    const nextCode = courseData.code ?? current.code;
    const nextSemesterId =
      'semesterId' in courseData ? courseData.semesterId : current.semesterId;
    const clash = await prisma.course.findFirst({
      where: {
        code: nextCode,
        semesterId: nextSemesterId,
        NOT: { id },
      },
      select: { id: true, semester: { select: { name: true } } },
    });
    if (clash) {
      const where = clash.semester?.name
        ? `in ${clash.semester.name}`
        : 'with no semester assigned';
      throw new AppError(
        `A course with code "${nextCode}" already exists ${where}.`,
        409
      );
    }
  }

  await prisma.course.update({ where: { id }, data: courseData });

  return prisma.course.findUnique({ where: { id }, include: courseInclude });
};

export const remove = async (id) => {
  return await prisma.course.delete({ where: { id } });
};
