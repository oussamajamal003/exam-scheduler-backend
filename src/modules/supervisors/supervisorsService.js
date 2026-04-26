import prisma from '../../config/prisma.js';
import { AppError } from '../../utils/AppError.js';
import bcrypt from 'bcrypt';
import { normalizeRole } from '../../guards/roleGuard.js';

const isSupervisorEmail = (email) => {
  if (!email) return false;
  const lower = email.toLowerCase();
  return lower.endsWith('@uni.edu') && !lower.endsWith('@st.uni.edu');
};

const assertSupervisorEmail = (email) => {
  if (!isSupervisorEmail(email)) {
    throw new AppError('Supervisor email must end with @uni.edu and not @st.uni.edu', 400);
  }
};

const assertSupervisorAccess = (id, user) => {
  if (user?.role === 'SUPERVISOR' && user.supervisorId !== id) {
    throw new AppError('You can only access your own supervisor data', 403);
  }
};

const supervisorInclude = {
  user: { select: { id: true, name: true, email: true, role: true } },
  center: true,
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
    prisma.supervisor.findMany({
      where,
      skip,
      take: limit,
      include: supervisorInclude,
    }),
    prisma.supervisor.count({ where })
  ]);
  
  return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
};

export const getById = async (id, user) => {
  assertSupervisorAccess(id, user);

  const data = await prisma.supervisor.findUnique({
    where: { id },
    include: supervisorInclude,
  });
  if (!data) throw new AppError('Not found', 404);
  return data;
};

export const create = async (data) => {
  let { userId, centerId, name, email, center, ...rest } = data;

  if (userId) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError('User not found', 404);
    assertSupervisorEmail(user.email);
    if (normalizeRole(user.role) !== 'SUPERVISOR') {
      throw new AppError('Linked user must have SUPERVISOR role', 400);
    }
  }
  
  if (!userId && (name && email)) {
    assertSupervisorEmail(email);
    const hashedPassword = await bcrypt.hash(`${email.split('@')[0]}@Temp123`, 10);

    const user = await prisma.user.upsert({
      where: { email },
      update: { name, password: hashedPassword, role: 'SUPERVISOR' },
      create: { name, email, password: hashedPassword, role: 'SUPERVISOR' }
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
    throw new AppError('Unable to resolve user or center for supervisor', 400);
  }
  
  return await prisma.supervisor.create({
    data: { ...rest, userId, centerId },
    include: supervisorInclude,
  });
};

export const update = async (id, data) => {
  let { userId, centerId, name, email, center, ...rest } = data;
  const updatePayload = { ...rest };
  
  const existing = await prisma.supervisor.findUnique({ where: { id }, select: { userId: true } });
  if (!existing) throw new AppError('Supervisor not found', 404);
  
  if (name || email) {
    if (email) assertSupervisorEmail(email);

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
  
  return await prisma.supervisor.update({
    where: { id },
    data: updatePayload,
    include: supervisorInclude,
  });
};

export const remove = async (id) => {
  return await prisma.supervisor.delete({ where: { id } });
};

export const getWorkload = async (id, user) => {
  assertSupervisorAccess(id, user);

  const supervisor = await prisma.supervisor.findUnique({
    where: { id },
    include: { assignments: { include: { timeSlot: true, exam: { include: { courseOffering: { include: { course: true } } } } } } }
  });
  if (!supervisor) throw new AppError('Supervisor not found', 404);
  return { workloadCount: supervisor.assignments.length, assignments: supervisor.assignments };
};