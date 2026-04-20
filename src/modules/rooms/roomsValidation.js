import { z } from 'zod';
import { uuidParamSchema } from '../../validations/common.js';

export const getRoomSchema = uuidParamSchema;

export const createRoomSchema = z.object({
  body: z.object({
    center: z.string().min(2).optional(),
    centerId: z.string().uuid().optional(),
    name: z.string().min(2),
    capacity: z.coerce.number().int().positive(),
    status: z.enum(['Available', 'Maintenance']).optional().default('Available'),
  }),
});

export const updateRoomSchema = z.object({
  params: uuidParamSchema.shape.params,
  body: z.object({
    center: z.string().min(1).optional(),
    centerId: z.string().uuid().optional(),
    name: z.string().min(1).optional(),
    capacity: z.coerce.number().int().positive().optional(),
    status: z.enum(['Available', 'Maintenance']).optional(),
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
