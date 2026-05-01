import prisma from '../../config/prisma.js';
import { AppError } from '../../utils/AppError.js';

// -------------------- include shape --------------------
const conflictInclude = {
  schedule: {
    select: {
      id: true,
      name: true,
      isFinal: true,
      createdAt: true,
    },
  },
};

// -------------------- helpers --------------------
const getRequiredSeats = (assignment) => {
  const expected = assignment.exam?.courseOffering?.expectedStudents ?? 0;
  const registered = assignment.exam?.courseOffering?.registrations?.length ?? 0;
  return Math.max(expected, registered, 1);
};

const loadScheduleForDetection = async (scheduleId) => {
  const schedule = await prisma.schedule.findUnique({
    where: { id: scheduleId },
    include: {
      assignments: {
        include: {
          exam: {
            include: {
              courseOffering: {
                include: {
                  course: true,
                  semester: true,
                  registrations: { select: { studentId: true } },
                },
              },
            },
          },
          room: true,
          supervisor: { include: { user: { select: { id: true, name: true, email: true } } } },
          timeSlot: true,
        },
      },
    },
  });

  if (!schedule) throw new AppError('Schedule not found', 404);
  return schedule;
};

// Compute conflicts using ConflictType enum values from the Prisma schema:
// STUDENT_OVERLAP | SUPERVISOR_DOUBLE_BOOKED | ROOM_OVERCAPACITY |
// RESOURCE_UNAVAILABLE | TIME_CONSTRAINT_VIOLATION
const computeConflicts = (schedule) => {
  const conflicts = [];

  // 1) STUDENT_OVERLAP — same student in multiple exams in same timeslot
  const studentSlotMap = new Map();
  for (const assignment of schedule.assignments) {
    const regs = assignment.exam?.courseOffering?.registrations ?? [];
    for (const reg of regs) {
      const key = `${reg.studentId}:${assignment.timeSlotId}`;
      if (!studentSlotMap.has(key)) studentSlotMap.set(key, []);
      studentSlotMap.get(key).push(assignment);
    }
  }
  for (const [key, assignments] of studentSlotMap.entries()) {
    const distinctExams = new Set(assignments.map((a) => a.examId));
    if (distinctExams.size < 2) continue;
    const [studentId, timeSlotId] = key.split(':');
    conflicts.push({
      type: 'STUDENT_OVERLAP',
      description: `Student ${studentId} has ${distinctExams.size} exams scheduled in timeslot ${timeSlotId}.`,
    });
  }

  // 2) RESOURCE_UNAVAILABLE — same room used for multiple distinct exams in same slot
  const roomSlotMap = new Map();
  for (const assignment of schedule.assignments) {
    const key = `${assignment.roomId}:${assignment.timeSlotId}`;
    if (!roomSlotMap.has(key)) roomSlotMap.set(key, []);
    roomSlotMap.get(key).push(assignment);
  }
  for (const [key, assignments] of roomSlotMap.entries()) {
    const distinctExams = new Set(assignments.map((a) => a.examId));
    if (distinctExams.size < 2) continue;
    const [roomId, timeSlotId] = key.split(':');
    conflicts.push({
      type: 'RESOURCE_UNAVAILABLE',
      description: `Room ${roomId} is assigned to ${distinctExams.size} distinct exams in timeslot ${timeSlotId}.`,
    });
  }

  // 3) ROOM_OVERCAPACITY — total room capacity for an exam slot < required seats
  // Grouped per (examId, timeSlotId) to support multi-room exams.
  const examSlotRoomMap = new Map();
  for (const assignment of schedule.assignments) {
    const key = `${assignment.examId}:${assignment.timeSlotId}`;
    if (!examSlotRoomMap.has(key)) examSlotRoomMap.set(key, []);
    examSlotRoomMap.get(key).push(assignment);
  }
  for (const [key, assignments] of examSlotRoomMap.entries()) {
    const totalCapacity = assignments.reduce((sum, a) => sum + (a.room?.capacity ?? 0), 0);
    const neededSeats = getRequiredSeats(assignments[0]);
    if (totalCapacity < neededSeats) {
      const [examId, timeSlotId] = key.split(':');
      conflicts.push({
        type: 'ROOM_OVERCAPACITY',
        description: `Exam ${examId} in timeslot ${timeSlotId} requires ${neededSeats} seats but allocated rooms provide ${totalCapacity}.`,
      });
    }
  }

  // 4) SUPERVISOR_DOUBLE_BOOKED
  const supervisorSlotMap = new Map();
  for (const assignment of schedule.assignments) {
    const key = `${assignment.supervisorId}:${assignment.timeSlotId}`;
    if (!supervisorSlotMap.has(key)) supervisorSlotMap.set(key, []);
    supervisorSlotMap.get(key).push(assignment);
  }
  for (const [key, assignments] of supervisorSlotMap.entries()) {
    const distinctExams = new Set(assignments.map((a) => a.examId));
    if (distinctExams.size < 2) continue;
    const [supervisorId, timeSlotId] = key.split(':');
    conflicts.push({
      type: 'SUPERVISOR_DOUBLE_BOOKED',
      description: `Supervisor ${supervisorId} is assigned to ${distinctExams.size} distinct exams in timeslot ${timeSlotId}.`,
    });
  }

  // 5) RESOURCE_UNAVAILABLE — room marked non-AVAILABLE
  for (const assignment of schedule.assignments) {
    if (assignment.room?.status && assignment.room.status !== 'AVAILABLE') {
      conflicts.push({
        type: 'RESOURCE_UNAVAILABLE',
        description: `Room ${assignment.roomId} (status=${assignment.room.status}) is assigned to exam ${assignment.examId}.`,
      });
    }
  }

  return conflicts;
};

// -------------------- service API --------------------

export const getAll = async (query = {}) => {
  const page = parseInt(query.page) || 1;
  const limit = parseInt(query.limit) || 10;
  const skip = (page - 1) * limit;

  const where = {};
  if (query.scheduleId) where.scheduleId = query.scheduleId;
  if (query.type) where.type = query.type;
  if (query.resolved !== undefined) {
    where.resolved = query.resolved === true || query.resolved === 'true';
  }
  if (query.search) {
    where.description = { contains: query.search, mode: 'insensitive' };
  }

  const [data, total] = await Promise.all([
    prisma.conflict.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: conflictInclude,
    }),
    prisma.conflict.count({ where }),
  ]);

  return {
    data,
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
  };
};

export const getById = async (id) => {
  const conflict = await prisma.conflict.findUnique({
    where: { id },
    include: conflictInclude,
  });
  if (!conflict) throw new AppError('Conflict not found', 404);
  return conflict;
};

export const getByScheduleId = async (scheduleId) => {
  const schedule = await prisma.schedule.findUnique({
    where: { id: scheduleId },
    select: { id: true },
  });
  if (!schedule) throw new AppError('Schedule not found', 404);

  return prisma.conflict.findMany({
    where: { scheduleId },
    orderBy: { createdAt: 'desc' },
    include: conflictInclude,
  });
};

export const detect = async (data, user) => {
  const { scheduleId } = data;
  if (!scheduleId) throw new AppError('scheduleId is required', 400);

  const schedule = await loadScheduleForDetection(scheduleId);
  const detected = computeConflicts(schedule);

  // Persist: replace existing unresolved conflicts for this schedule with the
  // freshly computed set so GET endpoints reflect the latest detection run.
  const persisted = await prisma.$transaction(async (tx) => {
    await tx.conflict.deleteMany({ where: { scheduleId, resolved: false } });

    if (detected.length === 0) return [];

    await tx.conflict.createMany({
      data: detected.map((c) => ({
        scheduleId,
        type: c.type,
        description: c.description,
        resolved: false,
        createdBy: user?.id,
      })),
    });

    return tx.conflict.findMany({
      where: { scheduleId, resolved: false },
      orderBy: { createdAt: 'desc' },
      include: conflictInclude,
    });
  });

  return {
    scheduleId,
    detectedCount: persisted.length,
    conflicts: persisted,
  };
};
