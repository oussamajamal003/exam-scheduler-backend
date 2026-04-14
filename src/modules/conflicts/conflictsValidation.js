import { z } from 'zod';

const uuidParamSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
});

export const getConflictSchema = uuidParamSchema;

export const createConflictSchema = z.object({
  body: z.object({
    scheduleId: z.string().uuid(),
    type: z.enum([
      'STUDENT_OVERLAP',
      'SUPERVISOR_DOUBLE_BOOKED',
      'ROOM_OVERCAPACITY',
      'RESOURCE_UNAVAILABLE',
      'TIME_CONSTRAINT_VIOLATION',
    ]),
    description: z.string().min(1),
    resolved: z.boolean().optional(),
  }),
});

export const updateConflictSchema = z.object({
  params: uuidParamSchema.shape.params,
  body: z.object({
    scheduleId: z.string().uuid().optional(),
    type: z.enum([
      'STUDENT_OVERLAP',
      'SUPERVISOR_DOUBLE_BOOKED',
      'ROOM_OVERCAPACITY',
      'RESOURCE_UNAVAILABLE',
      'TIME_CONSTRAINT_VIOLATION',
    ]).optional(),
    description: z.string().min(1).optional(),
    resolved: z.boolean().optional(),
  }),
});

export const getConflictsSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(10),
    search: z.string().optional(),
    scheduleId: z.string().uuid().optional(),
    type: z.enum([
      'STUDENT_OVERLAP',
      'SUPERVISOR_DOUBLE_BOOKED',
      'ROOM_OVERCAPACITY',
      'RESOURCE_UNAVAILABLE',
      'TIME_CONSTRAINT_VIOLATION',
    ]).optional(),
    resolved: z.coerce.boolean().optional(),
  }).catchall(z.any())
});
