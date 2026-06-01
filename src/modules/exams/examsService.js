import prisma from '../../config/prisma.js';
import { AppError } from '../../utils/AppError.js';
import { parseListQuery, buildOrderBy, buildMeta } from '../../utils/queryParser.js';
import { findImpactedScheduleIds, synchronizeSchedules } from '../schedules/scheduleSyncService.js';

const examInclude = {
  courseOffering: { include: { course: { include: { program: true } }, semester: true, registrations: true } },
  assignments: {
    include: {
      schedule: true,
      room: true,
      proctor: { include: { user: { select: { id: true, name: true, email: true } } } },
      timeSlot: true,
    },
  },
};

const buildAccessWhere = (user) => {
  if (user?.role === 'STUDENT') {
    if (!user.studentId) throw new AppError('Student profile is not linked to this user', 403);
    return { courseOffering: { registrations: { some: { studentId: user.studentId } } } };
  }

  if (user?.role === 'PROCTOR') {
    if (!user.proctorId) throw new AppError('Proctor profile is not linked to this user', 403);
    return { assignments: { some: { proctorId: user.proctorId } } };
  }

  return {};
};

// Exam has no createdAt — sort by status or duration only
const EXAM_SORT_FIELDS = {
  status:   (dir) => ({ status: dir }),
  duration: (dir) => ({ duration: dir }),
};

export const getAll = async (query, user) => {
  const { page, limit, skip, sortField, sortDirection, search } = parseListQuery(query);
  const where = buildAccessWhere(user);

  if (query.status) where.status = query.status;
  if (query.courseOfferingId) where.courseOfferingId = query.courseOfferingId;

  // Build nested courseOffering filter for semesterId + search
  const offeringWhere = {};
  if (query.semesterId) offeringWhere.semesterId = query.semesterId;
  if (search) {
    offeringWhere.OR = [
      { course: { code:  { contains: search, mode: 'insensitive' } } },
      { course: { title: { contains: search, mode: 'insensitive' } } },
      { semester: { name: { contains: search, mode: 'insensitive' } } },
    ];
  }
  if (Object.keys(offeringWhere).length > 0) {
    where.courseOffering = offeringWhere;
  }

  const orderBy = buildOrderBy(sortField, sortDirection, EXAM_SORT_FIELDS, [{ status: 'asc' }, { duration: 'asc' }]);

  const [data, total] = await Promise.all([
    prisma.exam.findMany({ where, skip, take: limit, orderBy, include: examInclude }),
    prisma.exam.count({ where }),
  ]);
  return { data, meta: buildMeta(total, page, limit) };
};

export const getById = async (id, user) => {
  const data = await prisma.exam.findFirst({ where: { id, ...buildAccessWhere(user) }, include: examInclude });
  if (!data) throw new AppError('Exam not found', 404);
  return data;
};

export const generateFromCourses = async (data) => {
  const { semesterId } = data;
  if (!semesterId) throw new AppError('semesterId is required', 400);
  const defaultExamDuration = 120;

  const createdExams = await prisma.$transaction(async (tx) => {
    const offerings = await tx.courseOffering.findMany({
      where: {
        semesterId,
        courseType: 'COURSE',
        hasExam: true,
      },
      include: { exams: true }
    });

    const rows = [];
    for (const offering of offerings) {
      if (offering.exams.length === 0) {
        const exam = await tx.exam.create({
          data: {
            courseOfferingId: offering.id,
            status: 'DRAFT',
            duration: defaultExamDuration,
          }
        });
        rows.push(exam);
      }
    }

    if (rows.length > 0) {
      const scheduleIds = await findImpactedScheduleIds({ dependency: 'semester', ids: [semesterId] }, tx);
      await synchronizeSchedules(scheduleIds, tx);
    }

    return rows;
  });
  return { generated: createdExams.length };
};