import { z } from 'zod';

const uuidParamSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
});

export const getTimeSlotSchema = uuidParamSchema;

export const createTimeSlotSchema = z.object({
  body: z.object({
    startTime: z.string().datetime(),
    endTime: z.string().datetime(),
  }),
});

export const updateTimeSlotSchema = z.object({
  params: uuidParamSchema.shape.params,
  body: z.object({
    startTime: z.string().datetime().optional(),
    endTime: z.string().datetime().optional(),
  }),
});

export const getTimeSlotsSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(10),
    search: z.string().optional(),
    startFrom: z.string().datetime().optional(),
    endTo: z.string().datetime().optional(),
    scheduleId: z.string().uuid().optional(),
  }).catchall(z.any())
});
