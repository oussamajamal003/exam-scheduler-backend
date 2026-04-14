import { z } from 'zod';

const uuidParamSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
});

export const getExamSchema = uuidParamSchema;

export const createExamSchema = z.object({
  body: z.object({
    courseOfferingId: z.string().uuid(),
    status: z.enum(['DRAFT', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
    duration: z.number().int().positive().optional(),
  }),
});

export const updateExamSchema = z.object({
  params: uuidParamSchema.shape.params,
  body: z.object({
    courseOfferingId: z.string().uuid().optional(),
    status: z.enum(['DRAFT', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
    duration: z.number().int().positive().optional(),
  }),
});

export const getExamsSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(10),
    search: z.string().optional(),
    courseOfferingId: z.string().uuid().optional(),
    scheduleId: z.string().uuid().optional(),
    status: z.enum(['DRAFT', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
  }).catchall(z.any())
});
