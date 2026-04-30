import { z } from 'zod';
import { uuidParamSchema } from '../../validations/common.js';

export const getScheduleSchema = uuidParamSchema;

export const getSchedulesSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(10),
    search: z.string().optional(),
    isFinal: z.enum(['true', 'false']).optional(),
  }).catchall(z.any()),
});

export const createScheduleSchema = z.object({
  body: z.object({
    name: z.string().min(3),
    isFinal: z.boolean().optional().default(false),
  }),
});

export const updateScheduleSchema = z.object({
  params: uuidParamSchema.shape.params,
  body: z.object({
    name: z.string().min(3).optional(),
    isFinal: z.boolean().optional(),
  }).refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field is required',
  }),
});