import { z } from 'zod';

const optionalBoolean = z.boolean().optional();

export const updateSystemSettingsSchema = z.object({
  body: z.object({
    systemName: z.string().trim().min(2, 'System name must be at least 2 characters').max(120).optional(),
    maintenanceMode: optionalBoolean,
    allowScheduleGeneration: optionalBoolean,
    notificationsEnabled: optionalBoolean,
    academicYear: z.string().trim().max(40).nullish(),
    supportEmail: z.string().trim().email('Invalid support email').nullish(),
  }),
});

export const updateNotificationsSchema = z.object({
  body: z.object({
    schedulePublishedNotifications: optionalBoolean,
    examAssignmentUpdates: optionalBoolean,
    roomTimeChanges: optionalBoolean,
    announcementsMessages: optionalBoolean,
  }),
});

export const updateProfileSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2, 'Name must be at least 2 characters').max(120).optional(),
    email: z.string().trim().email('Invalid email').optional(),
  }),
});

export const listAccountsSchema = z.object({
  query: z.object({
    role: z.enum(['STUDENT', 'PROCTOR', 'ADMIN']).optional(),
    search: z.string().trim().optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  }).passthrough(),
});

export const accountIdSchema = z.object({
  params: z.object({ userId: z.string().uuid('Invalid account id') }),
});

export const updateAccountSchema = z.object({
  params: z.object({ userId: z.string().uuid('Invalid account id') }),
  body: z.object({
    name: z.string().trim().min(2).max(120).optional(),
    email: z.string().trim().email('Invalid email').optional(),
    department: z.string().trim().max(120).nullish(),
    maxExamsPerDay: z.coerce.number().int().min(1).max(20).optional(),
  }),
});
