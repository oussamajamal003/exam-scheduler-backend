import bcrypt from 'bcrypt';
import prisma from '../../config/prisma.js';
import { AppError } from '../../utils/AppError.js';

const selectSettings = {
  id: true,
  userId: true,
  schedulePublishedNotifications: true,
  examAssignmentUpdates: true,
  roomTimeChanges: true,
  announcementsMessages: true,
  createdAt: true,
  updatedAt: true,
};

const ensureAuthenticatedUser = (user) => {
  if (!user?.id) throw new AppError('Authenticated user not found.', 401);
  return user.id;
};

export const getSettings = async (user) => {
  const userId = ensureAuthenticatedUser(user);

  return prisma.userSettings.upsert({
    where: { userId },
    update: {},
    create: { userId },
    select: selectSettings,
  });
};

export const updateSettings = async (user, data) => {
  const userId = ensureAuthenticatedUser(user);

  await prisma.userSettings.upsert({
    where: { userId },
    update: data,
    create: { userId, ...data },
  });

  return getSettings(user);
};

export const changePassword = async (user, { currentPassword, newPassword, logoutOtherSessions = false }) => {
  const userId = ensureAuthenticatedUser(user);
  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, password: true },
  });

  if (!existing) throw new AppError('User not found.', 404);

  const isCurrentPasswordValid = await bcrypt.compare(currentPassword, existing.password);
  if (!isCurrentPasswordValid) {
    throw new AppError('Current password is incorrect.', 400);
  }

  const hashedPassword = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: { id: userId },
    data: { password: hashedPassword },
  });

  return {
    changed: true,
    logoutOtherSessionsApplied: false,
    logoutOtherSessionsRequested: Boolean(logoutOtherSessions),
  };
};
