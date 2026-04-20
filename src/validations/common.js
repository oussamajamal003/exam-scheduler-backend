import { z } from 'zod';

export const uuidParamSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
});