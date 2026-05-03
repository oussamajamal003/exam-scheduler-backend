import { z } from 'zod';

const conflictTypeEnum = z.enum([
  'STUDENT_OVERLAP',
  'SUPERVISOR_DOUBLE_BOOKED',
  'ROOM_OVERCAPACITY',
  'RESOURCE_UNAVAILABLE',
  'TIME_CONSTRAINT_VIOLATION',
]);

const uuidParamSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
});

export const getConflictSchema = uuidParamSchema;
export const getConflictsByScheduleSchema = uuidParamSchema;
export const getConflictExplanationSchema = uuidParamSchema;
export const getConflictSuggestionsSchema = uuidParamSchema;
export const resolveConflictSchema = uuidParamSchema;

export const detectConflictsSchema = z.object({
  body: z.object({
    scheduleId: z.string().uuid(),
  }),
});

export const createConflictSchema = z.object({
  body: z.object({
    scheduleId: z.string().uuid(),
    type: conflictTypeEnum,
    description: z.string().min(1),
    resolved: z.boolean().optional(),
  }),
});

export const updateConflictSchema = z.object({
  params: uuidParamSchema.shape.params,
  body: z.object({
    scheduleId: z.string().uuid().optional(),
    type: conflictTypeEnum.optional(),
    description: z.string().min(1).optional(),
    resolved: z.boolean().optional(),
  }),
});

export const getConflictsSchema = z.object({
  query: z
    .object({
      page: z.coerce.number().int().min(1).optional().default(1),
      limit: z.coerce.number().int().min(1).max(100).optional().default(10),
      search: z.string().optional(),
      scheduleId: z.string().uuid().optional(),
      type: conflictTypeEnum.optional(),
      resolved: z.coerce.boolean().optional(),
    })
    .catchall(z.any()),
});
