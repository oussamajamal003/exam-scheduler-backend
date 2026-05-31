import { z } from 'zod';
import { uuidParamSchema, listQueryBase } from '../../validations/common.js';

export const getSemesterSchema = uuidParamSchema;

export const createSemesterSchema = z.object({
  body: z.object({
    name: z.string().min(1),
    startDate: z.string().datetime(),
    endDate: z.string().datetime(),
    academicYear: z.string().optional(),
    isActive: z.boolean().optional(),
  }),
});

export const updateSemesterSchema = z.object({
  params: uuidParamSchema.shape.params,
  body: z.object({
    name: z.string().min(1).optional(),
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
    academicYear: z.string().optional(),
    isActive: z.boolean().optional(),
  }),
});

export const getSemestersSchema = z.object({
  query: listQueryBase.extend({
    academicYear: z.string().optional(),
    startFrom: z.string().optional(),
    endTo: z.string().optional(),
  }).catchall(z.any()),
});