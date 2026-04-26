import { z } from 'zod';
import { uuidParamSchema } from '../../validations/common.js';

const supervisorEmailSchema = z.string().email().refine(
  (email) => {
    const lower = email.toLowerCase();
    return lower.endsWith('@uni.edu') && !lower.endsWith('@st.uni.edu');
  },
  'Supervisor email must end with @uni.edu and not @st.uni.edu'
);

export const getSupervisorSchema = uuidParamSchema;

export const createSupervisorSchema = z.object({
  body: z.object({
    userId: z.string().uuid().optional(),
    centerId: z.string().uuid().optional(),
    name: z.string().min(1).optional(),
    email: supervisorEmailSchema.optional(),
    department: z.string().min(1).optional(),
    center: z.string().min(1).optional(),
  }),
});

export const updateSupervisorSchema = z.object({
  params: uuidParamSchema.shape.params,
  body: z.object({
    name: z.string().min(1).optional(),
    email: supervisorEmailSchema.optional(),
    department: z.string().min(1).optional(),
    center: z.string().min(1).optional(),
    userId: z.string().uuid().optional(),
    centerId: z.string().uuid().optional(),
  }),
});

export const getSupervisorsSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(10),
    search: z.string().optional(),
    centerId: z.string().uuid().optional(),
    userId: z.string().uuid().optional(),
  }).catchall(z.any())
});
