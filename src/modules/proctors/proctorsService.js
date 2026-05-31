import prisma from '../../config/prisma.js';
import { AppError } from '../../utils/AppError.js';
import bcrypt from 'bcrypt';
import { normalizeRole } from '../../guards/roleGuard.js';
import {
  assertTimeSlotsExist,
  buildAvailabilityWrite,
  proctorAvailabilityInclude,
} from './proctorAvailability.js';
import { parseListQuery, buildOrderBy, buildMeta } from '../../utils/queryParser.js';
import {
  assertNoScheduleAssignmentsForDependency,
  findImpactedScheduleIds,
  removeAssignmentsForDependencyDelete,
  synchronizeSchedules,
} from '../schedules/scheduleSyncService.js';

const isProctorEmail = (email) => {
  if (!email) return false;
  const lower = email.toLowerCase();
  return lower.endsWith('@uni.edu') && !lower.endsWith('@st.uni.edu');
};

const assertProctorEmail = (email) => {
  if (!isProctorEmail(email)) {
    throw new AppError('Proctor email must end with @uni.edu and not @st.uni.edu', 400);
  }
};

const assertProctorAccess = (id, user) => {
  if (user?.role === 'PROCTOR' && user.proctorId !== id) {
    throw new AppError('You can only access your own proctor data', 403);
  }
};

const proctorInclude = {
  user: { select: { id: true, name: true, email: true, role: true } },
  ...proctorAvailabilityInclude,
  assignments: {
    include: {
      schedule: true,
      exam: { include: { courseOffering: { include: { course: true, semester: true } } } },
      room: true,
      timeSlot: true,
    },
  },
};

const PROCTOR_SORT_FIELDS = {
  name:      (dir) => ({ user: { name: dir } }),
  email:     (dir) => ({ user: { email: dir } }),
  department:(dir) => ({ department: dir }),
  createdAt: (dir) => ({ user: { createdAt: dir } }),
};

export const getAll = async (query = {}) => {
  const { page, limit, skip, sortField, sortDirection, search } = parseListQuery(query);

  const where = {};
  if (query.userId) where.userId = query.userId;
  if (query.department) {
    where.department = { contains: query.department, mode: 'insensitive' };
  }

  if (search) {
    where.user = {
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ],
    };
  }

  const orderBy = buildOrderBy(sortField, sortDirection, PROCTOR_SORT_FIELDS, { user: { name: 'asc' } });

  const [data, total] = await Promise.all([
    prisma.proctor.findMany({ where, skip, take: limit, orderBy, include: proctorInclude }),
    prisma.proctor.count({ where }),
  ]);

  return { data, meta: buildMeta(total, page, limit) };
};

export const getById = async (id, user) => {
  assertProctorAccess(id, user);

  const data = await prisma.proctor.findUnique({
    where: { id },
    include: proctorInclude,
  });
  if (!data) throw new AppError('Not found', 404);
  return data;
};

export const create = async (data) => {
  let { userId, name, email, timeSlotIds, ...rest } = data;

  if (userId) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError('User not found', 404);
    assertProctorEmail(user.email);
    if (normalizeRole(user.role) !== 'PROCTOR') {
      throw new AppError('Linked user must have PROCTOR role', 400);
    }
  }
  
  if (!userId && (name && email)) {
    assertProctorEmail(email);
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) throw new AppError('User with this email already exists', 409);
    const hashedPassword = await bcrypt.hash(`${email.split('@')[0]}@Temp123`, 10);

    const user = await prisma.user.create({
      data: { name, email, password: hashedPassword, role: 'PROCTOR' }
    });
    userId = user.id;
  }
  
  if (!userId) {
    throw new AppError('Unable to resolve user for proctor', 400);
  }

  const availableTimeSlotIds = await assertTimeSlotsExist(timeSlotIds);
  
  return await prisma.proctor.create({
    data: {
      ...rest,
      userId,
      availableTimeSlots: buildAvailabilityWrite(availableTimeSlotIds),
    },
    include: proctorInclude,
  });
};

export const update = async (id, data) => {
  let { userId, name, email, timeSlotIds, ...rest } = data;
  const updatePayload = { ...rest };
  
  const existing = await prisma.proctor.findUnique({ where: { id }, select: { userId: true } });
  if (!existing) throw new AppError('Proctor not found', 404);
  return prisma.$transaction(async (tx) => {
    const scheduleIds = await findImpactedScheduleIds({ dependency: 'proctor', ids: [id] }, tx);

    if (name || email) {
      if (email) assertProctorEmail(email);
      if (email) {
        const duplicateUser = await tx.user.findUnique({ where: { email } });
        if (duplicateUser && duplicateUser.id !== existing.userId) {
          throw new AppError('User with this email already exists', 409);
        }
      }

      await tx.user.update({
        where: { id: existing.userId },
        data: { ...(name && { name }), ...(email && { email }) }
      });
    }

    if (timeSlotIds !== undefined) {
      const availableTimeSlotIds = await assertTimeSlotsExist(timeSlotIds);
      updatePayload.availableTimeSlots = buildAvailabilityWrite(availableTimeSlotIds, {
        replaceExisting: true,
      });
    }

    const proctor = await tx.proctor.update({
      where: { id },
      data: updatePayload,
      include: proctorInclude,
    });
    await synchronizeSchedules(scheduleIds, tx);
    return proctor;
  });
};

export const remove = async (id) => {
  return prisma.$transaction(async (tx) => {
    const scheduleIds = await findImpactedScheduleIds({ dependency: 'proctor', ids: [id] }, tx);
    await assertNoScheduleAssignmentsForDependency({ dependency: 'proctor', ids: [id], entityLabel: 'Proctor' }, tx);
    await removeAssignmentsForDependencyDelete({ dependency: 'proctor', ids: [id] }, tx);
    const deleted = await tx.proctor.delete({ where: { id } });
    await synchronizeSchedules(scheduleIds, tx);
    return deleted;
  });
};

export const getWorkload = async (id, user) => {
  assertProctorAccess(id, user);

  const proctor = await prisma.proctor.findUnique({
    where: { id },
    include: {
      assignments: {
        include: {
          timeSlot: true,
          room: true,
          exam: {
            include: {
              courseOffering: {
                include: { course: true, semester: true },
              },
            },
          },
        },
      },
    },
  });
  if (!proctor) throw new AppError('Proctor not found', 404);
  return { workloadCount: proctor.assignments.length, assignments: proctor.assignments };
};