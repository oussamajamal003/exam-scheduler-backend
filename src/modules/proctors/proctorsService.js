import prisma from '../../config/prisma.js';
import { AppError } from '../../utils/AppError.js';
import bcrypt from 'bcrypt';
import { normalizeRole } from '../../guards/roleGuard.js';
import {
  assertTimeSlotsExist,
  buildAvailabilityWrite,
  proctorAvailabilityInclude,
} from './proctorAvailability.js';

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
  center: true,
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

export const getAll = async (query = {}) => {
  const page = parseInt(query.page) || 1;
  const limit = parseInt(query.limit) || 10;
  const skip = (page - 1) * limit;

  const where = {};
  if (query.centerId) where.centerId = query.centerId;
  if (query.userId) where.userId = query.userId;
  if (query.search) {
    where.user = {
      OR: [
        { name: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
      ],
    };
  }

  const [data, total] = await Promise.all([
    prisma.proctor.findMany({
      where,
      skip,
      take: limit,
      include: proctorInclude,
    }),
    prisma.proctor.count({ where })
  ]);
  
  return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
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
  let { userId, centerId, name, email, center, timeSlotIds, ...rest } = data;

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
    const hashedPassword = await bcrypt.hash(`${email.split('@')[0]}@Temp123`, 10);

    const user = await prisma.user.upsert({
      where: { email },
      update: { name, password: hashedPassword, role: 'PROCTOR' },
      create: { name, email, password: hashedPassword, role: 'PROCTOR' }
    });
    userId = user.id;
  }
  
  if (!centerId && center) {
    const centerRecord = await prisma.center.upsert({
      where: { name: center },
      update: {},
      create: { name: center }
    });
    centerId = centerRecord.id;
  }
  
  if (!userId || !centerId) {
    throw new AppError('Unable to resolve user or center for proctor', 400);
  }

  const availableTimeSlotIds = await assertTimeSlotsExist(timeSlotIds);
  
  return await prisma.proctor.create({
    data: {
      ...rest,
      userId,
      centerId,
      availableTimeSlots: buildAvailabilityWrite(availableTimeSlotIds),
    },
    include: proctorInclude,
  });
};

export const update = async (id, data) => {
  let { userId, centerId, name, email, center, timeSlotIds, ...rest } = data;
  const updatePayload = { ...rest };
  
  const existing = await prisma.proctor.findUnique({ where: { id }, select: { userId: true } });
  if (!existing) throw new AppError('Proctor not found', 404);
  
  if (name || email) {
    if (email) assertProctorEmail(email);

    await prisma.user.update({
      where: { id: existing.userId },
      data: { ...(name && { name }), ...(email && { email }) }
    });
  }

  if (center) {
    const centerRecord = await prisma.center.upsert({
      where: { name: center },
      update: {},
      create: { name: center }
    });
    updatePayload.centerId = centerRecord.id;
  } else if (centerId) {
    updatePayload.centerId = centerId;
  }

  if (timeSlotIds !== undefined) {
    const availableTimeSlotIds = await assertTimeSlotsExist(timeSlotIds);
    updatePayload.availableTimeSlots = buildAvailabilityWrite(availableTimeSlotIds, {
      replaceExisting: true,
    });
  }
  
  return await prisma.proctor.update({
    where: { id },
    data: updatePayload,
    include: proctorInclude,
  });
};

export const remove = async (id) => {
  return await prisma.proctor.delete({ where: { id } });
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