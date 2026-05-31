import { z } from 'zod';
import { uuidParamSchema, listQueryBase } from '../../validations/common.js';

export const getCourseSchema = uuidParamSchema;

export const getCoursesSchema = z.object({
  query: listQueryBase.extend({
    programId: z.string().uuid().optional(),
    departmentId: z.string().uuid().optional(),
  }).catchall(z.any()),
});

export const createCourseSchema = z.object({
  body: z.object({
    code: z.string().min(1),
    title: z.string().min(1),
    programId: z.string().uuid().optional(),
    semesterId: z.string().uuid().optional(),
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
    semesterId: z.string().uuid().optional(),
    credits: z.number().int().min(0).optional(),
    description: z.string().optional(),
    isActive: z.boolean().optional(),
  }),
});

