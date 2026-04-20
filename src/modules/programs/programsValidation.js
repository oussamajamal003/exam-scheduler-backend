import { z } from 'zod';
import { uuidParamSchema } from '../../validations/common.js';

export const getProgramSchema = uuidParamSchema;

export const createProgramSchema = z.object({
  body: z.object({
    name: z.string().min(1),
    code: z.string().min(1),
  }),
});

export const updateProgramSchema = z.object({
  params: uuidParamSchema.shape.params,
  body: z.object({
    name: z.string().min(1).optional(),
    code: z.string().min(1).optional(),
  }),
});

export const getProgramsSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(10),
    search: z.string().optional(),
  }).catchall(z.any()),
});