import bcrypt from 'bcrypt';
import prisma from '../../config/prisma.js';
import { AppError } from '../../utils/AppError.js';

const profileSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  createdAt: true,
  updatedAt: true,
};

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

const isStudentEmail = (email) => email?.toLowerCase().endsWith('@st.uni.edu');

const isProctorEmail = (email) => {
  const lower = email?.toLowerCase();
  return Boolean(lower) && lower.endsWith('@uni.edu') && !lower.endsWith('@st.uni.edu');
};

const assertProfileEmailForRole = (role, email) => {
  if (!email) return;

  if (role === 'STUDENT' && !isStudentEmail(email)) {
    throw new AppError('Student email must end with @st.uni.edu', 400);
  }

  if (role === 'PROCTOR' && !isProctorEmail(email)) {
    throw new AppError('Proctor email must end with @uni.edu and not @st.uni.edu', 400);
  }
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


export const getProfile = async (user) => {
  const userId = ensureAuthenticatedUser(user);

  return prisma.user.findUnique({
    where: { id: userId },
    select: profileSelect,
  });
};

export const updateProfile = async (user, data) => {
  const userId = ensureAuthenticatedUser(user);

  if (data.email) {
    assertProfileEmailForRole(user.role, data.email);
    const duplicate = await prisma.user.findUnique({ where: { email: data.email } });
    if (duplicate && duplicate.id !== userId) {
      throw new AppError('Email is already in use by another account.', 409);
    }
  }

  return prisma.user.update({
    where: { id: userId },
    data: {
      ...(data.name ? { name: data.name } : {}),
      ...(data.email ? { email: data.email } : {}),
    },
    select: profileSelect,
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
