import { z } from 'zod';
import { uuidParamSchema, listQueryBase } from '../../validations/common.js';

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
  query: listQueryBase.extend({
    courseOfferingId: z.string().uuid().optional(),
    semesterId: z.string().uuid().optional(),
    scheduleId: z.string().uuid().optional(),
    status: z.enum(['DRAFT', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
  }).catchall(z.any()),
});
