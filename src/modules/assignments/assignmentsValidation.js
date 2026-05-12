import { z } from 'zod';

const examUpdateSchema = z
  .object({
    duration: z.number().int().positive().optional(),
    status: z
      .enum(['DRAFT', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'])
      .optional(),
  })
  .refine((d) => d.duration !== undefined || d.status !== undefined, {
    message: 'exam must include at least one of: duration, status',
  });

export const listAssignmentsSchema = z.object({
  params: z.object({
    scheduleId: z.string().uuid(),
  }),
});

export const getAssignmentSchema = z.object({
  params: z.object({
    scheduleId: z.string().uuid(),
    assignmentId: z.string().uuid(),
  }),
});

export const deleteAssignmentSchema = z.object({
  params: z.object({
    scheduleId: z.string().uuid(),
    assignmentId: z.string().uuid(),
  }),
  query: z.object({
    deleteGroup: z
      .union([z.boolean(), z.enum(["true", "false"])])
      .optional(),
  }).optional(),
});

export const updateAssignmentSchema = z.object({
  params: z.object({
    scheduleId: z.string().uuid(),
    assignmentId: z.string().uuid(),
  }),
  body: z
    .object({
      roomId: z.string().uuid().optional(),
      proctorId: z.string().uuid().optional(),
      timeSlotId: z.string().uuid().optional(),
      exam: examUpdateSchema.optional(),
    })
    .refine(
      (d) =>
        d.roomId !== undefined ||
        d.proctorId !== undefined ||
        d.timeSlotId !== undefined ||
        d.exam !== undefined,
      { message: 'At least one updatable field must be provided.' }
    ),
});
