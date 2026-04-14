import { z } from 'zod';

const uuidParamSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
});

export const getEnrollmentSchema = uuidParamSchema;

export const createEnrollmentSchema = z.object({
  body: z.object({
    studentId: z.string().uuid(),
    courseOfferingId: z.string().uuid(),
  }),
});

export const updateEnrollmentSchema = z.object({
  params: uuidParamSchema.shape.params,
  body: z.object({
    studentId: z.string().uuid().optional(),
    courseOfferingId: z.string().uuid().optional(),
  }),
});

export const getEnrollmentsSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(10),
    search: z.string().optional(),
    studentId: z.string().uuid().optional(),
    courseOfferingId: z.string().uuid().optional(),
    semesterId: z.string().uuid().optional(),
    courseId: z.string().uuid().optional(),
  }).catchall(z.any())
});
