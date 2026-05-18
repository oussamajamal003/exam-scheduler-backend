import prisma from '../../config/prisma.js';
import { AppError } from '../../utils/AppError.js';

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

export const getAll = async (query = {}) => {
  const page = parseInt(query.page) || 1;
  const limit = parseInt(query.limit) || 10;
  const skip = (page - 1) * limit;

  const where = {};
  if (query.search) {
    where.name = { contains: query.search, mode: 'insensitive' };
  }

  const [data, total] = await Promise.all([
    prisma.semester.findMany({
      where,
      skip,
      take: limit,
      orderBy: [{ startDate: 'desc' }],
      include: semesterInclude,
    }),
    prisma.semester.count({ where }),
  ]);

  return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
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
  return await prisma.semester.create({
    data,
    include: semesterInclude,
  });
};

export const update = async (id, data) => {
  const current = await prisma.semester.findUnique({ where: { id } });
  if (!current) throw new AppError('Semester not found', 404);

  return await prisma.semester.update({
    where: { id },
    data,
    include: semesterInclude,
  });
};

export const remove = async (id) => {
  return await prisma.semester.delete({ where: { id } });
};