import { z } from 'zod';

const uuidParamSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
});

export const getScheduleSchema = uuidParamSchema;

export const createScheduleSchema = z.object({
  body: z.object({
    name: z.string().min(1),
    isFinal: z.boolean().optional(),
  }),
});

export const updateScheduleSchema = z.object({
  params: uuidParamSchema.shape.params,
  body: z.object({
    name: z.string().min(1).optional(),
    isFinal: z.boolean().optional(),
  }),
});

export const getSchedulesSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(10),
    search: z.string().optional(),
    isFinal: z.coerce.boolean().optional(),
  }).catchall(z.any())
});
