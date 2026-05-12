import { z } from 'zod';
import { uuidParamSchema } from '../../validations/common.js';

export const getCenterSchema = uuidParamSchema;

export const createCenterSchema = z.object({
  body: z.object({
    name: z.string().min(1),
    location: z.string().optional(),
    code: z.string().optional(),
    description: z.string().optional(),
    isActive: z.boolean().optional().default(true),
    supervisors: z.array(z.string().min(1)).optional().default([]),
  }),
});

export const updateCenterSchema = z.object({
  params: uuidParamSchema.shape.params,
  body: z.object({
    name: z.string().min(1).optional(),
    location: z.string().optional(),
    code: z.string().optional(),
    description: z.string().optional(),
    isActive: z.boolean().optional(),
    supervisors: z.array(z.string().min(1)).optional(),
  }),
});

export const getCentersSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(5000).optional().default(10),
    search: z.string().optional(),
  }).catchall(z.any()),
});