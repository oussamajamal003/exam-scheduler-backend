import { z } from 'zod';

const uuidParamSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
});

export const getCourseSchema = uuidParamSchema;

export const createCourseSchema = z.object({
  body: z.object({
    code: z.string().min(1),
    title: z.string().min(1),
    programId: z.string().uuid().optional(),
  }),
});

export const updateCourseSchema = z.object({
  params: uuidParamSchema.shape.params,
  body: z.object({
    code: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
    programId: z.string().uuid().optional(),
  }),
});

export const getCoursesSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(10),
    search: z.string().optional(),
    programId: z.string().uuid().optional(),
  }).catchall(z.any())
});
