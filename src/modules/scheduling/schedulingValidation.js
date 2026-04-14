import { z } from 'zod';

export const prepareSchedulingSchema = z.object({
  body: z.object({
    semesterId: z.string().uuid(),
    startDate: z.string().datetime(),
    endDate: z.string().datetime(),
  }),
});

export const validateInputSchema = z.object({
  body: z.object({
    semesterId: z.string().uuid(),
  }),
});

export const generateScheduleSchema = z.object({
  body: z.object({
    semesterId: z.string().uuid(),
    scheduleName: z.string().min(3),
  }),
});

export const getAnalysisSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
});

export const publishScheduleSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
});