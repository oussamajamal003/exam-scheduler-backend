import { z } from 'zod';

const uuidParamSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
});

export const getRoomSchema = uuidParamSchema;

export const createRoomSchema = z.object({
  body: z.object({
    centerId: z.string().uuid(),
    name: z.string().min(1),
    capacity: z.number().int().positive(),
  }),
});

export const updateRoomSchema = z.object({
  params: uuidParamSchema.shape.params,
  body: z.object({
    centerId: z.string().uuid().optional(),
    name: z.string().min(1).optional(),
    capacity: z.number().int().positive().optional(),
  }),
});

export const getRoomsSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(10),
    search: z.string().optional(),
    centerId: z.string().uuid().optional(),
    minCapacity: z.coerce.number().int().positive().optional(),
  }).catchall(z.any())
});
