import { z } from 'zod';
import { uuidParamSchema } from '../../validations/common.js';

export const getCourseSchema = uuidParamSchema;

export const createCourseSchema = z.object({
  body: z.object({
    code: z.string().min(1),
    title: z.string().min(1),
    programId: z.string().uuid().optional(),
    credits: z.number().int().min(0).optional(),
    description: z.string().optional(),
    isActive: z.boolean().optional().default(true),
  }),
});

export const updateCourseSchema = z.object({
  params: uuidParamSchema.shape.params,
  body: z.object({
    code: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
    programId: z.string().uuid().optional(),
    credits: z.number().int().min(0).optional(),
    description: z.string().optional(),
    isActive: z.boolean().optional(),
  }),
});

export const getCoursesSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(10),
    search: z.string().optional(),
    programId: z.string().uuid().optional(),
  }).catchall(z.any())
});
