import { z } from 'zod';
import { uuidParamSchema, listQueryBase } from '../../validations/common.js';

export const getEnrollmentSchema = uuidParamSchema;

export const getEnrollmentStudentSchema = z.object({
  params: z.object({
    studentId: z.string().uuid(),
  }),
});

export const getEnrollmentOfferingSchema = z.object({
  params: z.object({
    offeringId: z.string().uuid(),
  }),
});

export const createEnrollmentSchema = z.object({
  body: z.object({
    studentId: z.string().uuid(),
    courseOfferingId: z.string().uuid(),
    status: z.string().optional().default('ACTIVE'),
  }),
});

export const bulkImportEnrollmentsSchema = z.object({
  body: z.object({
    enrollments: z.array(
      z.object({
        studentId: z.string().uuid(),
        courseOfferingId: z.string().uuid(),
        status: z.string().optional().default('ACTIVE'),
      })
    ).min(1),
  }),
});

export const updateEnrollmentSchema = z.object({
  params: uuidParamSchema.shape.params,
  body: z.object({
    studentId: z.string().uuid().optional(),
    courseOfferingId: z.string().uuid().optional(),
    status: z.string().optional(),
  }),
});

export const getEnrollmentsSchema = z.object({
  query: listQueryBase.extend({
    studentId: z.string().uuid().optional(),
    courseOfferingId: z.string().uuid().optional(),
    departmentId: z.string().uuid().optional(),
    semesterId: z.string().uuid().optional(),
    courseId: z.string().uuid().optional(),
    status: z.string().optional(),
  }).catchall(z.any()),
});

export const getEnrollmentFiltersSchema = z.object({
  query: z.object({
    semesterId: z.string().uuid().optional(),
  }).catchall(z.any()),
});
