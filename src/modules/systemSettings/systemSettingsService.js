import prisma from '../../config/prisma.js';
import { AppError } from '../../utils/AppError.js';
import { parseListQuery, buildMeta } from '../../utils/queryParser.js';
import { deleteStudent } from '../students/studentsService.js';
import { remove as removeProctor } from '../proctors/proctorsService.js';

const SYSTEM_SETTINGS_ID = 'system';

const systemSelect = {
  id: true,
  systemName: true,
  maintenanceMode: true,
  allowScheduleGeneration: true,
  notificationsEnabled: true,
  academicYear: true,
  supportEmail: true,
  createdAt: true,
  updatedAt: true,
};

// ─── System settings (singleton) ─────────────────────────────────────────────
export const getSystemSettings = async () =>
  prisma.systemSettings.upsert({
    where: { id: SYSTEM_SETTINGS_ID },
    update: {},
    create: { id: SYSTEM_SETTINGS_ID },
    select: systemSelect,
  });

export const updateSystemSettings = async (data) =>
  prisma.systemSettings.upsert({
    where: { id: SYSTEM_SETTINGS_ID },
    update: data,
    create: { id: SYSTEM_SETTINGS_ID, ...data },
    select: systemSelect,
  });

// ─── Admin profile ───────────────────────────────────────────────────────────
const profileSelect = { id: true, name: true, email: true, role: true, createdAt: true, updatedAt: true };

export const getProfile = async (user) => {
  if (!user?.id) throw new AppError('Authenticated user not found.', 401);
  const profile = await prisma.user.findUnique({ where: { id: user.id }, select: profileSelect });
  if (!profile) throw new AppError('User not found.', 404);
  return profile;
};

export const updateProfile = async (user, data) => {
  if (!user?.id) throw new AppError('Authenticated user not found.', 401);

  if (data.email) {
    const duplicate = await prisma.user.findUnique({ where: { email: data.email } });
    if (duplicate && duplicate.id !== user.id) {
      throw new AppError('Email is already in use by another account.', 409);
    }
  }

  return prisma.user.update({
    where: { id: user.id },
    data: {
      ...(data.name ? { name: data.name } : {}),
      ...(data.email ? { email: data.email } : {}),
    },
    select: profileSelect,
  });
};

// ─── User account management ─────────────────────────────────────────────────
const accountInclude = {
  student: { select: { id: true, universityId: true, program: { select: { name: true, code: true } } } },
  proctor: { select: { id: true, department: true, maxExamsPerDay: true } },
};

const toAccount = (record) => ({
  id: record.id,
  name: record.name,
  email: record.email,
  role: record.role,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
  studentId: record.student?.id ?? null,
  universityId: record.student?.universityId ?? null,
  programName: record.student?.program?.name ?? null,
  proctorId: record.proctor?.id ?? null,
  department: record.proctor?.department ?? null,
  maxExamsPerDay: record.proctor?.maxExamsPerDay ?? null,
});

export const listUserAccounts = async (query) => {
  const { page, limit, skip, search } = parseListQuery(query);

  const roleFilter = (query.role || '').toUpperCase();
  const where = {};
  if (roleFilter === 'STUDENT' || roleFilter === 'PROCTOR' || roleFilter === 'ADMIN') {
    where.role = roleFilter;
  } else {
    where.role = { in: ['STUDENT', 'PROCTOR'] };
  }
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
      { student: { universityId: { contains: search, mode: 'insensitive' } } },
    ];
  }

  const [records, total] = await Promise.all([
    prisma.user.findMany({
      where,
      skip,
      take: limit,
      orderBy: { name: 'asc' },
      include: accountInclude,
    }),
    prisma.user.count({ where }),
  ]);

  return { data: records.map(toAccount), meta: buildMeta(total, page, limit) };
};

export const getUserAccount = async (userId) => {
  const record = await prisma.user.findUnique({ where: { id: userId }, include: accountInclude });
  if (!record) throw new AppError('Account not found.', 404);
  return toAccount(record);
};

export const updateUserAccount = async (userId, data) => {
  const record = await prisma.user.findUnique({ where: { id: userId }, include: accountInclude });
  if (!record) throw new AppError('Account not found.', 404);

  if (data.email && data.email !== record.email) {
    const duplicate = await prisma.user.findUnique({ where: { email: data.email } });
    if (duplicate && duplicate.id !== userId) {
      throw new AppError('Email is already in use by another account.', 409);
    }
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      ...(data.name ? { name: data.name } : {}),
      ...(data.email ? { email: data.email } : {}),
    },
  });

  if (record.proctor && (data.department !== undefined || data.maxExamsPerDay !== undefined)) {
    await prisma.proctor.update({
      where: { id: record.proctor.id },
      data: {
        ...(data.department !== undefined ? { department: data.department } : {}),
        ...(data.maxExamsPerDay !== undefined ? { maxExamsPerDay: data.maxExamsPerDay } : {}),
      },
    });
  }

  return getUserAccount(userId);
};

export const deleteUserAccount = async (actingUser, userId) => {
  const record = await prisma.user.findUnique({ where: { id: userId }, include: accountInclude });
  if (!record) throw new AppError('Account not found.', 404);

  if (record.role === 'ADMIN' && record.id !== actingUser?.id) {
    throw new AppError('Admins can only delete their own admin account.', 403);
  }

  // Deleting the linked entity also removes the user account (handled in entity services).
  if (record.student) {
    await deleteStudent(record.student.id);
    return { id: userId, deleted: true };
  }

  if (record.proctor) {
    await removeProctor(record.proctor.id);
    return { id: userId, deleted: true };
  }

  await prisma.user.delete({ where: { id: userId } });
  return { id: userId, deleted: true };
};
