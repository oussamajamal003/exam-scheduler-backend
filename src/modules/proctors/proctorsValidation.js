import { z } from 'zod';
import { uuidParamSchema, listQueryBase } from '../../validations/common.js';

const proctorEmailSchema = z.string().email().refine(
  (email) => {
    const lower = email.toLowerCase();
    return lower.endsWith('@uni.edu') && !lower.endsWith('@st.uni.edu');
  },
  'Proctor email must end with @uni.edu and not @st.uni.edu'
);

export const getProctorSchema = uuidParamSchema;

export const createProctorSchema = z.object({
  body: z.object({
    userId: z.string().uuid().optional(),
    name: z.string().min(1).optional(),
    email: proctorEmailSchema.optional(),
    department: z.string().min(1).optional(),
    timeSlotIds: z.array(z.string().uuid()).optional(),
  }),
});

export const updateProctorSchema = z.object({
  params: uuidParamSchema.shape.params,
  body: z.object({
    name: z.string().min(1).optional(),
    email: proctorEmailSchema.optional(),
    department: z.string().min(1).optional(),
    userId: z.string().uuid().optional(),
    timeSlotIds: z.array(z.string().uuid()).optional(),
  }),
});

export const getProctorsSchema = z.object({
  query: listQueryBase.extend({
    userId: z.string().uuid().optional(),
    department: z.string().optional(),
  }).catchall(z.any()),
});
