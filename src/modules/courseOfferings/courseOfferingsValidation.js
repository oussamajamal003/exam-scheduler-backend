import { z } from 'zod';

const courseTypeSchema = z.enum(['COURSE', 'PROJECT']);
const booleanQuerySchema = z.preprocess((value) => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}, z.boolean());

const enforceExamEligibilityConsistency = (body) => body.superRefine((data, ctx) => {
  const courseType = data.courseType ?? 'COURSE';
  const expectedHasExam = courseType === 'COURSE';

  if (data.hasExam !== undefined && data.hasExam !== expectedHasExam) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['hasExam'],
      message: courseType === 'PROJECT'
        ? 'PROJECT offerings cannot generate exams.'
        : 'COURSE offerings must generate exams.',
    });
  }
});

const uuidParamSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
});

export const getCourseOfferingSchema = uuidParamSchema;

export const createCourseOfferingSchema = z.object({
  body: enforceExamEligibilityConsistency(z.object({
    courseId: z.string().uuid(),
    semesterId: z.string().uuid(),
    section: z.string().min(1).optional(),
    instructor: z.string().optional(),
    expectedStudents: z.coerce.number().int().min(0).optional(),
    capacity: z.coerce.number().int().min(0).optional(),
    day: z.string().optional(),
    time: z.string().optional(),
    roomLabel: z.string().optional(),
    notes: z.string().optional(),
    courseType: courseTypeSchema.optional().default('COURSE'),
    hasExam: z.boolean().optional(),
    status: z.enum(['ACTIVE', 'INACTIVE', 'CANCELLED']).optional(),
    createdBy: z.string().optional(),
  })),
});

export const updateCourseOfferingSchema = z.object({
  params: uuidParamSchema.shape.params,
  body: enforceExamEligibilityConsistency(z.object({
    courseId: z.string().uuid().optional(),
    semesterId: z.string().uuid().optional(),
    section: z.string().min(1).optional(),
    instructor: z.string().optional(),
    expectedStudents: z.coerce.number().int().min(0).optional(),
    capacity: z.coerce.number().int().min(0).optional(),
    day: z.string().optional(),
    time: z.string().optional(),
    roomLabel: z.string().optional(),
    notes: z.string().optional(),
    courseType: courseTypeSchema.optional(),
    hasExam: z.boolean().optional(),
    status: z.enum(['ACTIVE', 'INACTIVE', 'CANCELLED']).optional(),
    createdBy: z.string().optional(),
  })),
});

export const getCourseOfferingsSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(5000).optional().default(10),
    search: z.string().optional(),
    courseId: z.string().uuid().optional(),
    semesterId: z.string().uuid().optional(),
    courseType: courseTypeSchema.optional(),
    hasExam: booleanQuerySchema.optional(),
    status: z.enum(['ACTIVE', 'INACTIVE', 'CANCELLED']).optional(),
  }).catchall(z.any()),
});