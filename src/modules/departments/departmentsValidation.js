import { z } from 'zod';
import { uuidParamSchema, listQueryBase } from '../../validations/common.js';

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
  query: listQueryBase.extend({}).catchall(z.any()),
});
