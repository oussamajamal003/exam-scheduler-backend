import prisma from '../../config/prisma.js';
import { AppError } from '../../utils/AppError.js';

const examInclude = {
  courseOffering: { include: { course: { include: { program: true } }, semester: true, registrations: true } },
  assignments: {
    include: {
      schedule: true,
      room: true,
      supervisor: { include: { user: { select: { id: true, name: true, email: true } } } },
      timeSlot: true,
    },
  },
};

const buildAccessWhere = (user) => {
  if (user?.role === 'STUDENT') {
    if (!user.studentId) throw new AppError('Student profile is not linked to this user', 403);
    return { courseOffering: { registrations: { some: { studentId: user.studentId } } } };
  }

  if (user?.role === 'SUPERVISOR') {
    if (!user.supervisorId) throw new AppError('Supervisor profile is not linked to this user', 403);
    return { assignments: { some: { supervisorId: user.supervisorId } } };
  }

  return {};
};

export const getAll = async (query, user) => {
  const { page = 1, limit = 10 } = query;
  const skip = (page - 1) * limit;
  const where = buildAccessWhere(user);

  const [data, total] = await Promise.all([
    prisma.exam.findMany({ where, skip: parseInt(skip), take: parseInt(limit), include: examInclude }),
    prisma.exam.count({ where })
  ]);
  return { data, meta: { total, page: parseInt(page), limit: parseInt(limit) } };
};

export const getById = async (id, user) => {
  const data = await prisma.exam.findFirst({ where: { id, ...buildAccessWhere(user) }, include: examInclude });
  if (!data) throw new AppError('Exam not found', 404);
  return data;
};

export const generateFromCourses = async (data) => {
  const { semesterId } = data;
  if (!semesterId) throw new AppError('semesterId is required', 400);
  
  const offerings = await prisma.courseOffering.findMany({
    where: { semesterId },
    include: { exams: true }
  });
  
  const createdExams = [];
  for (const offering of offerings) {
    if (offering.exams.length === 0) {
      const exam = await prisma.exam.create({
        data: {
          courseOfferingId: offering.id,
          status: 'DRAFT',
          duration: 120 // default 2 hours
        }
      });
      createdExams.push(exam);
    }
  }
  return { generated: createdExams.length };
};