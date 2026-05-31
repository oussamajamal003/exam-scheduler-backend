import { z } from 'zod';
import { listQueryBase } from '../../validations/common.js';

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
  query: listQueryBase.extend({
    status: z.enum(['DRAFT', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
    phase: z.enum(['all', 'upcoming', 'completed']).optional(),
    roomId: z.string().uuid().optional(),
    proctorId: z.string().uuid().optional(),
    timeSlotId: z.string().uuid().optional(),
    courseId: z.string().uuid().optional(),
    semesterId: z.string().uuid().optional(),
    centerId: z.string().uuid().optional(),
    examDate: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
  }).optional(),
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
      assignmentIds: z.array(z.string().uuid()).min(1).optional(),
      roomId: z.string().uuid().optional(),
      proctorId: z.string().uuid().optional(),
      proctorIds: z.array(z.string().uuid()).min(1).optional(),
      timeSlotId: z.string().uuid().optional(),
      exam: examUpdateSchema.optional(),
    })
    .refine(
      (d) => !(d.proctorId !== undefined && d.proctorIds !== undefined),
      { message: 'Provide either proctorId or proctorIds, not both.' }
    )
    .refine(
      (d) =>
        d.assignmentIds !== undefined ||
        d.roomId !== undefined ||
        d.proctorId !== undefined ||
        d.proctorIds !== undefined ||
        d.timeSlotId !== undefined ||
        d.exam !== undefined,
      { message: 'At least one updatable field must be provided.' }
    ),
});
