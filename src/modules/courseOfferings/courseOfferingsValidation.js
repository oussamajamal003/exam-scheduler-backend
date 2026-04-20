import { z } from 'zod';

const uuidParamSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
});

export const getCourseOfferingSchema = uuidParamSchema;

export const createCourseOfferingSchema = z.object({
  body: z.object({
    courseId: z.string().uuid(),
    semesterId: z.string().uuid(),
    section: z.string().min(1).optional(),
    expectedStudents: z.coerce.number().int().min(0).optional(),
    capacity: z.coerce.number().int().min(0).optional(),
    status: z.enum(['ACTIVE', 'INACTIVE', 'CANCELLED']).optional(),
    createdBy: z.string().optional(),
  }),
});

export const updateCourseOfferingSchema = z.object({
  params: uuidParamSchema.shape.params,
  body: z.object({
    courseId: z.string().uuid().optional(),
    semesterId: z.string().uuid().optional(),
    section: z.string().min(1).optional(),
    expectedStudents: z.coerce.number().int().min(0).optional(),
    capacity: z.coerce.number().int().min(0).optional(),
    status: z.enum(['ACTIVE', 'INACTIVE', 'CANCELLED']).optional(),
    createdBy: z.string().optional(),
  }),
});

export const getCourseOfferingsSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(10),
    search: z.string().optional(),
    courseId: z.string().uuid().optional(),
    semesterId: z.string().uuid().optional(),
    status: z.enum(['ACTIVE', 'INACTIVE', 'CANCELLED']).optional(),
  }).catchall(z.any()),
});