import { z } from 'zod';

export const createStudentSchema = z.object({
  body: z.object({
    userId: z.string().uuid(),
    universityId: z.string().min(3),
    programId: z.string().uuid().optional(),
  }),
});

export const updateStudentSchema = z.object({
  body: z.object({
    universityId: z.string().min(3).optional(),
    programId: z.string().uuid().optional(),
  }),
  params: z.object({
    id: z.string().uuid(),
  })
});

export const getStudentSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
});

export const getStudentsSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(10),
    search: z.string().optional(),
    programId: z.string().uuid().optional(),
  }).catchall(z.any()),
});