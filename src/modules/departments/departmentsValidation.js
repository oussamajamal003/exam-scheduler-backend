import { z } from 'zod';
import { uuidParamSchema } from '../../validations/common.js';

export const getDepartmentSchema = uuidParamSchema;

export const createDepartmentSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Department name is required'),
    code: z.string().min(1, 'Department code is required'),
  }),
});

export const updateDepartmentSchema = z.object({
  params: uuidParamSchema.shape.params,
  body: z.object({
    name: z.string().min(1).optional(),
    code: z.string().min(1).optional(),
  }),
});

export const getDepartmentsSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(5000).optional().default(10),
    search: z.string().optional(),
  }).catchall(z.any()),
});
