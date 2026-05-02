import { z } from 'zod';
import { uuidParamSchema } from '../../validations/common.js';

export const getTimeSlotSchema = uuidParamSchema;

export const getAvailableTimeSlotsSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(5000).optional().default(10),
    scheduleId: z.string().uuid().optional(),
    startFrom: z.string().datetime().optional(),
    endTo: z.string().datetime().optional(),
  }).catchall(z.any()),
});

export const createTimeSlotSchema = z.object({
  body: z.object({
    startTime: z.string().datetime(),
    endTime: z.string().datetime(),
    date: z.string().datetime().optional(),
    duration: z.number().int().min(0).optional(),
  }),
});

export const updateTimeSlotSchema = z.object({
  params: uuidParamSchema.shape.params,
  body: z.object({
    startTime: z.string().datetime().optional(),
    endTime: z.string().datetime().optional(),
    date: z.string().datetime().optional(),
    duration: z.number().int().min(0).optional(),
  }),
});

export const getTimeSlotsSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(5000).optional().default(10),
    search: z.string().optional(),
    startFrom: z.string().datetime().optional(),
    endTo: z.string().datetime().optional(),
    scheduleId: z.string().uuid().optional(),
  }).catchall(z.any())
});
