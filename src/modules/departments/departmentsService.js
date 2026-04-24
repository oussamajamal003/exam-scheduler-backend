import prisma from '../../config/prisma.js';
import { AppError } from '../../utils/AppError.js';

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

export const getAll = async (query = {}) => {
  const page = parseInt(query.page) || 1;
  const limit = parseInt(query.limit) || 10;
  const skip = (page - 1) * limit;

  const where = {};
  if (query.search) {
    Object.assign(where, buildSearchFilter(query.search));
  }

  const [data, total] = await Promise.all([
    prisma.department.findMany({
      where,
      skip,
      take: limit,
      orderBy: { name: 'asc' },
      include: departmentInclude,
    }),
    prisma.department.count({ where }),
  ]);

  return { data: data.map(normalizeDepartment), meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
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
  const department = await prisma.department.update({
    where: { id },
    data,
    include: departmentInclude,
  });
  return normalizeDepartment(department);
};

export const remove = async (id) => {
  return await prisma.department.delete({ where: { id } });
};
