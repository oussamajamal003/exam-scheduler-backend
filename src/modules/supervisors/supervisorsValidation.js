import { z } from 'zod';

const uuidParamSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
});

export const getSupervisorSchema = uuidParamSchema;

export const createSupervisorSchema = z.object({
  body: z.object({
    userId: z.string().uuid(),
    centerId: z.string().uuid(),
  }),
});

export const updateSupervisorSchema = z.object({
  params: uuidParamSchema.shape.params,
  body: z.object({
    userId: z.string().uuid().optional(),
    centerId: z.string().uuid().optional(),
  }),
});

export const getSupervisorsSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(10),
    search: z.string().optional(),
    centerId: z.string().uuid().optional(),
    userId: z.string().uuid().optional(),
  }).catchall(z.any())
});
