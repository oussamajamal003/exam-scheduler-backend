import prisma from '../../config/prisma.js';
import { AppError } from '../../utils/AppError.js';

export const getAll = async (query) => {
  const { page = 1, limit = 10 } = query;
  const skip = (page - 1) * limit;
  const [data, total] = await Promise.all([
    prisma.exam.findMany({ skip: parseInt(skip), take: parseInt(limit), include: { courseOffering: { include: { course: true } } } }),
    prisma.exam.count()
  ]);
  return { data, meta: { total, page: parseInt(page), limit: parseInt(limit) } };
};

export const getById = async (id) => {
  const data = await prisma.exam.findUnique({ where: { id }, include: { courseOffering: { include: { course: true } }, assignments: true } });
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