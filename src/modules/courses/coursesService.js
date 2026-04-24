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
        courseOfferings: {
          orderBy: [
            { semester: { isCurrent: 'desc' } },
            { semester: { isActive: 'desc' } },
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
  courseOfferings: {
    orderBy: [
      { semester: { isCurrent: 'desc' } },
      { semester: { isActive: 'desc' } },
      { createdAt: 'desc' },
    ],
    take: 1,
    include: { semester: true },
  },
};

export const create = async (data) => {
  const { semesterId, ...courseData } = data;

  return prisma.$transaction(async (tx) => {
    const course = await tx.course.create({ data: courseData, include: { program: true } });

    if (semesterId) {
      await tx.courseOffering.create({ data: { courseId: course.id, semesterId } });
    }

    return tx.course.findUnique({ where: { id: course.id }, include: courseInclude });
  });
};

export const update = async (id, data) => {
  const { semesterId, ...courseData } = data;

  return prisma.$transaction(async (tx) => {
    await tx.course.update({ where: { id }, data: courseData });

    if (semesterId) {
      const existing = await tx.courseOffering.findFirst({ where: { courseId: id } });
      if (existing) {
        await tx.courseOffering.update({ where: { id: existing.id }, data: { semesterId } });
      } else {
        await tx.courseOffering.create({ data: { courseId: id, semesterId } });
      }
    }

    return tx.course.findUnique({ where: { id }, include: courseInclude });
  });
};

export const remove = async (id) => {
  return await prisma.course.delete({ where: { id } });
};
