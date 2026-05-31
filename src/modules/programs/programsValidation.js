import { z } from 'zod';
import { uuidParamSchema, listQueryBase } from '../../validations/common.js';

export const getProgramSchema = uuidParamSchema;

export const createProgramSchema = z.object({
  body: z.object({
    name: z.string().min(1),
    code: z.string().min(1),
    description: z.string().optional(),
    departmentId: z.string().uuid().optional(),
    isActive: z.boolean().optional().default(true),
  }),
});

export const updateProgramSchema = z.object({
  params: uuidParamSchema.shape.params,
  body: z.object({
    name: z.string().min(1).optional(),
    code: z.string().min(1).optional(),
    description: z.string().optional(),
    departmentId: z.string().uuid().optional(),
    isActive: z.boolean().optional(),
  }),
});

export const getProgramsSchema = z.object({
  query: listQueryBase.extend({
    departmentId: z.string().uuid().optional(),
    isActive: z.enum(['true', 'false']).optional(),
  }).catchall(z.any()),
});