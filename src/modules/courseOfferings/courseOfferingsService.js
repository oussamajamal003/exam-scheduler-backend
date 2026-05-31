import prisma from '../../config/prisma.js';
import { AppError } from '../../utils/AppError.js';
import { parseListQuery, buildOrderBy, buildMeta } from '../../utils/queryParser.js';
import { assertNoScheduleAssignmentsForDependency, findImpactedScheduleIds, synchronizeSchedules } from '../schedules/scheduleSyncService.js';

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

// Lightweight select for list endpoints: only fields rendered by the table
// and search/indexing helpers, plus aggregate counts.
const courseOfferingListSelect = {
  id: true,
  courseId: true,
  semesterId: true,
  section: true,
  instructor: true,
  expectedStudents: true,
  capacity: true,
  credits: true,
  day: true,
  time: true,
  endTime: true,
  roomLabel: true,
  notes: true,
  courseType: true,
  hasExam: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  course: {
    select: {
      id: true,
      code: true,
      title: true,
      credits: true,
      program: {
        select: {
          id: true,
          name: true,
          code: true,
        },
      },
    },
  },
  semester: {
    select: {
      id: true,
      name: true,
      startDate: true,
      endDate: true,
    },
  },
  exams: {
    select: {
      id: true,
      assignments: {
        select: {
          id: true,
          schedule: { select: { id: true, name: true } },
          timeSlot: {
            select: {
              id: true,
              date: true,
              startTime: true,
              endTime: true,
            },
          },
        },
      },
    },
  },
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
    ...(Array.isArray(offering.registrations) ? { enrollments: offering.registrations } : {}),
    ...(Array.isArray(offering.exams) ? { exams: offering.exams } : {}),
  };
};

const OFFERING_SORT_FIELDS = {
  section:          (dir) => ({ section: dir }),
  expectedStudents: (dir) => ({ expectedStudents: dir }),
  status:           (dir) => ({ status: dir }),
  createdAt:        (dir) => ({ createdAt: dir }),
};

export const getAll = async (query = {}) => {
  const { page, limit, skip, sortField, sortDirection, search } = parseListQuery(query);

  const where = {};
  if (query.courseId) where.courseId = query.courseId;
  if (query.semesterId) where.semesterId = query.semesterId;
  if (query.departmentId) where.course = { ...(where.course ?? {}), program: { departmentId: query.departmentId } };
  if (query.courseType) where.courseType = query.courseType;
  if (query.hasExam !== undefined) where.hasExam = query.hasExam === true || query.hasExam === 'true';
  if (query.status) where.status = query.status;
  if (search) {
    where.OR = [
      { section: { contains: search, mode: 'insensitive' } },
      { course: { code: { contains: search, mode: 'insensitive' } } },
      { course: { title: { contains: search, mode: 'insensitive' } } },
    ];
  }

  const orderBy = buildOrderBy(
    sortField,
    sortDirection,
    OFFERING_SORT_FIELDS,
    [{ semester: { startDate: 'desc' } }, { course: { code: 'asc' } }],
  );

  const [data, total] = await Promise.all([
    prisma.courseOffering.findMany({ where, skip, take: limit, orderBy, select: courseOfferingListSelect }),
    prisma.courseOffering.count({ where }),
  ]);

  return { data: data.map(normalizeCourseOffering), meta: buildMeta(total, page, limit) };
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
    const scheduleIds = await findImpactedScheduleIds({ dependency: 'courseOffering', ids: [id] }, tx);
    if (normalizedData.courseType === 'PROJECT') {
      await tx.exam.deleteMany({ where: { courseOfferingId: id } });
    }

    const updated = await tx.courseOffering.update({
      where: { id },
      data: toCourseOfferingWriteData(normalizedData),
      include: courseOfferingInclude,
    });
    await synchronizeSchedules(scheduleIds, tx);
    return updated;
  });
  return normalizeCourseOffering(offering);
};

export const remove = async (id) => {
  return prisma.$transaction(async (tx) => {
    const scheduleIds = await findImpactedScheduleIds({ dependency: 'courseOffering', ids: [id] }, tx);
    await assertNoScheduleAssignmentsForDependency({ dependency: 'courseOffering', ids: [id], entityLabel: 'Course Offering' }, tx);
    const deleted = await tx.courseOffering.delete({ where: { id } });
    await synchronizeSchedules(scheduleIds, tx);
    return deleted;
  });
};