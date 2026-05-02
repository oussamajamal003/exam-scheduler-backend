import { z } from 'zod';
import { uuidParamSchema } from '../../validations/common.js';

const studentEmailSchema = z.string().email('Invalid email address').refine(
  (email) => email.toLowerCase().endsWith('@st.uni.edu'),
  'Student email must end with @st.uni.edu'
);

export const createStudentSchema = z.object({
  body: z.union([
    z.object({
      userId: z.string().uuid(),
      universityId: z
        .string()
        .min(1, "University ID is required")
        .regex(/^\d+$/, "University ID must contain only numbers"),
      programId: z.string().uuid().optional(),
    }),
    z.object({
      firstName: z
        .string()
        .min(2, "First name must be at least 2 characters")
        .regex(/^[a-zA-Z\s]+$/, "First name must contain only letters"),
      lastName: z
        .string()
        .min(2, "Last name must be at least 2 characters")
        .regex(/^[a-zA-Z\s]+$/, "Last name must contain only letters"),
      email: studentEmailSchema,
      universityId: z
        .string()
        .min(1, "University ID is required")
        .regex(/^\d+$/, "University ID must contain only numbers"),
      programId: z.string().uuid().optional(),
    }),
  ]),
});

export const updateStudentSchema = z.object({
  body: z.union([
    z.object({
      universityId: z
        .string()
        .min(1, "University ID is required")
        .regex(/^\d+$/, "University ID must contain only numbers")
        .optional(),
      programId: z.string().uuid().optional(),
    }),
    z.object({
      firstName: z
        .string()
        .min(2, "First name must be at least 2 characters")
        .regex(/^[a-zA-Z\s]+$/, "First name must contain only letters")
        .optional(),
      lastName: z
        .string()
        .min(2, "Last name must be at least 2 characters")
        .regex(/^[a-zA-Z\s]+$/, "Last name must contain only letters")
        .optional(),
      email: studentEmailSchema.optional(),
      universityId: z
        .string()
        .min(1, "University ID is required")
        .regex(/^\d+$/, "University ID must contain only numbers")
        .optional(),
      programId: z.string().uuid().optional(),
    }),
  ]),
  params: z.object({
    id: z.string().uuid(),
  })
});

export const getStudentSchema = z.object({
  params: uuidParamSchema.shape.params,
});

export const getStudentsSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(5000).optional().default(10),
    search: z.string().optional(),
    programId: z.string().uuid().optional(),
  }).catchall(z.any()),
});