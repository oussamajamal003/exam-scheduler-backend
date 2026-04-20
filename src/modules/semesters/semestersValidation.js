import { z } from 'zod';
import { uuidParamSchema } from '../../validations/common.js';

export const getSemesterSchema = uuidParamSchema;

export const createSemesterSchema = z.object({
  body: z.object({
    name: z.string().min(1),
    startDate: z.string().datetime(),
    endDate: z.string().datetime(),
    isActive: z.boolean().optional(),
  }),
});

export const updateSemesterSchema = z.object({
  params: uuidParamSchema.shape.params,
  body: z.object({
    name: z.string().min(1).optional(),
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
    isActive: z.boolean().optional(),
  }),
});

export const getSemestersSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(10),
    search: z.string().optional(),
    isActive: z.coerce.boolean().optional(),
  }).catchall(z.any()),
});