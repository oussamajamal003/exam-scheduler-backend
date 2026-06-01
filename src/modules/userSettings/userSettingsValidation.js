import { z } from 'zod';

const passwordRules = z
  .string()
  .min(8, 'Password must be at least 8 characters long')
  .regex(/[a-z]/, 'Password must include a lowercase letter')
  .regex(/[A-Z]/, 'Password must include an uppercase letter')
  .regex(/[0-9]/, 'Password must include a number')
  .regex(/[^A-Za-z0-9]/, 'Password must include a special character');

export const updateSettingsSchema = z.object({
  body: z.object({
    schedulePublishedNotifications: z.boolean().optional(),
    examAssignmentUpdates: z.boolean().optional(),
    roomTimeChanges: z.boolean().optional(),
    announcementsMessages: z.boolean().optional(),
  }),
});

export const updateProfileSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1, 'Name is required').optional(),
    email: z.string().trim().email('A valid email address is required').optional(),
  }),
});

export const changePasswordSchema = z.object({
  body: z
    .object({
      currentPassword: z.string().min(1, 'Current password is required'),
      newPassword: passwordRules,
      confirmNewPassword: z.string().min(1, 'Confirm password is required'),
      logoutOtherSessions: z.boolean().optional(),
    })
    .refine((value) => value.newPassword === value.confirmNewPassword, {
      path: ['confirmNewPassword'],
      message: 'Passwords do not match',
    })
    .refine((value) => value.currentPassword !== value.newPassword, {
      path: ['newPassword'],
      message: 'New password must be different from the current password',
    }),
});
