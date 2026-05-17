import prisma from '../../config/prisma.js';
import { AppError } from '../../utils/AppError.js';

const courseOfferingInclude = {
  course: { include: { program: true } },
  semester: true,
  registrations: {
    include: {
      student: { include: { user: { select: { id: true, name: true, email: true } }, program: true } },
    },
  },
  exams: true,
  _count: { select: { registrations: true, exams: true } },
};

const getHasExamForCourseType = (courseType = 'COURSE') => courseType === 'COURSE';

const normalizeExamEligibilityInput = (data, currentOffering = null) => {
  const courseType = data.courseType ?? currentOffering?.courseType ?? 'COURSE';
  return {
    ...data,
    courseType,
    hasExam: getHasExamForCourseType(courseType),
  };
};

const toCourseOfferingWriteData = (data) => {
  const { courseId, semesterId, ...rest } = data;

  return {
    ...rest,
    ...(courseId ? { course: { connect: { id: courseId } } } : {}),
    ...(semesterId ? { semester: { connect: { id: semesterId } } } : {}),
  };
};

const normalizeCourseOffering = (offering) => {
  if (!offering) return offering;

  const course = offering.course
    ? {
        ...offering.course,
        name: offering.course.name ?? offering.course.title,
      }
    : null;

  return {
    ...offering,
    course,
    program: course?.program ?? null,
    enrollments: offering.registrations ?? [],
  };
};

export const getAll = async (query = {}) => {
  const page = parseInt(query.page) || 1;
  const limit = parseInt(query.limit) || 10;
  const skip = (page - 1) * limit;

  const where = {};
  if (query.courseId) where.courseId = query.courseId;
  if (query.semesterId) where.semesterId = query.semesterId;
  if (query.courseType) where.courseType = query.courseType;
  if (query.hasExam !== undefined) where.hasExam = query.hasExam === true || query.hasExam === 'true';
  if (query.status) where.status = query.status;
  if (query.search) {
    where.OR = [
      { section: { contains: query.search, mode: 'insensitive' } },
      { course: { code: { contains: query.search, mode: 'insensitive' } } },
      { course: { title: { contains: query.search, mode: 'insensitive' } } },
    ];
  }

  const [data, total] = await Promise.all([
    prisma.courseOffering.findMany({
      where,
      skip,
      take: limit,
      orderBy: [{ semester: { startDate: 'desc' } }, { course: { code: 'asc' } }],
      include: courseOfferingInclude,
    }),
    prisma.courseOffering.count({ where }),
  ]);

  return { data: data.map(normalizeCourseOffering), meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
};

export const getById = async (id) => {
  const data = await prisma.courseOffering.findUnique({
    where: { id },
    include: {
      course: { include: { program: true } },
      semester: true,
      registrations: {
        include: {
          student: { include: { user: { select: { id: true, name: true, email: true } }, program: true } },
        },
      },
      exams: {
        include: {
          assignments: {
            include: {
              schedule: true,
              room: true,
              proctor: { include: { user: { select: { id: true, name: true, email: true } } } },
              timeSlot: true,
            },
          },
        },
      },
      _count: { select: { registrations: true, exams: true } },
    },
  });

  if (!data) throw new AppError('Course offering not found', 404);
  return normalizeCourseOffering(data);
};

export const create = async (data) => {
  const offering = await prisma.courseOffering.create({
    data: toCourseOfferingWriteData(normalizeExamEligibilityInput(data)),
    include: courseOfferingInclude,
  });
  return normalizeCourseOffering(offering);
};

export const update = async (id, data) => {
  const currentOffering = await prisma.courseOffering.findUnique({ where: { id } });
  if (!currentOffering) throw new AppError('Course offering not found', 404);

  const normalizedData = normalizeExamEligibilityInput(data, currentOffering);
  if (normalizedData.courseType === 'PROJECT') {
    const exams = await prisma.exam.findMany({
      where: { courseOfferingId: id },
      select: { id: true, _count: { select: { assignments: true } } },
    });
    const hasScheduledExam = exams.some((exam) => exam._count.assignments > 0);

    if (hasScheduledExam) {
      throw new AppError('Cannot mark this offering as PROJECT while it has scheduled exam assignments. Remove those assignments first.', 409);
    }
  }

  const offering = await prisma.$transaction(async (tx) => {
    if (normalizedData.courseType === 'PROJECT') {
      await tx.exam.deleteMany({ where: { courseOfferingId: id } });
    }

    return tx.courseOffering.update({
      where: { id },
      data: toCourseOfferingWriteData(normalizedData),
      include: courseOfferingInclude,
    });
  });
  return normalizeCourseOffering(offering);
};

export const remove = async (id) => {
  return await prisma.courseOffering.delete({ where: { id } });
};