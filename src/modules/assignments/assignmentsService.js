import prisma from '../../config/prisma.js';
import { AppError } from '../../utils/AppError.js';

// -------------------- response shape --------------------
//
// `assignmentSelect` defines the exact response contract consumed by the
// schedule table UI. Keeping it as a `select` (not a deep `include`) avoids
// leaking unrelated fields and makes the response stable.
const assignmentSelect = {
  id: true,
  scheduleId: true,
  examId: true,
  roomId: true,
  supervisorId: true,
  timeSlotId: true,
  exam: {
    select: {
      id: true,
      status: true,
      duration: true,
      courseOffering: {
        select: {
          id: true,
          course: {
            select: { id: true, title: true, code: true, credits: true },
          },
          semester: { select: { id: true, name: true } },
          registrations: {
            select: {
              id: true,
              studentId: true,
              status: true,
              student: {
                select: {
                  id: true,
                  user: { select: { id: true, name: true, email: true } },
                },
              },
            },
          },
        },
      },
    },
  },
  room: {
    select: {
      id: true,
      name: true,
      capacity: true,
      status: true,
      center: { select: { id: true, name: true, location: true } },
    },
  },
  supervisor: {
    select: {
      id: true,
      user: { select: { id: true, name: true, email: true } },
    },
  },
  timeSlot: {
    select: {
      id: true,
      date: true,
      startTime: true,
      endTime: true,
      duration: true,
    },
  },
  schedule: { select: { id: true, name: true, isFinal: true } },
};

// -------------------- internal helpers --------------------
const ensureScheduleExists = async (scheduleId) => {
  const schedule = await prisma.schedule.findUnique({
    where: { id: scheduleId },
    select: { id: true, isFinal: true },
  });
  if (!schedule) throw new AppError('Schedule not found', 404);
  return schedule;
};

const loadAssignmentInSchedule = async (scheduleId, assignmentId) => {
  const assignment = await prisma.examAssignment.findUnique({
    where: { id: assignmentId },
    select: assignmentSelect,
  });
  if (!assignment) throw new AppError('Assignment not found', 404);
  if (assignment.scheduleId !== scheduleId) {
    throw new AppError('Assignment does not belong to this schedule', 404);
  }
  return assignment;
};

const ensureRoomExists = async (roomId) => {
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { id: true },
  });
  if (!room) throw new AppError('Room not found', 404);
};

const ensureSupervisorExists = async (supervisorId) => {
  const supervisor = await prisma.supervisor.findUnique({
    where: { id: supervisorId },
    select: { id: true },
  });
  if (!supervisor) throw new AppError('Supervisor not found', 404);
};

const ensureTimeSlotExists = async (timeSlotId) => {
  const timeSlot = await prisma.timeSlot.findUnique({
    where: { id: timeSlotId },
    select: { id: true },
  });
  if (!timeSlot) throw new AppError('Time slot not found', 404);
};

// -------------------- hard constraint checks --------------------
//
// Re-validate scheduling rules whenever an assignment is mutated. Only
// constraints affected by the proposed change are re-checked, but every check
// excludes the current assignment from the comparison so that a no-op update
// never trips on itself.

const validateRoomStatus = async (roomId) => {
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { id: true, name: true, status: true, capacity: true },
  });
  if (!room) throw new AppError('Room not found', 404);
  if (room.status !== 'AVAILABLE') {
    throw new AppError(
      `Room "${room.name}" is not available (status: ${room.status}).`,
      400
    );
  }
  return room;
};

const validateRoomCapacity = async (room, examId) => {
  const enrolledCount = await prisma.registration.count({
    where: { courseOffering: { exams: { some: { id: examId } } } },
  });
  if (room.capacity < enrolledCount) {
    throw new AppError(
      `Room "${room.name}" capacity (${room.capacity}) is below enrolled student count (${enrolledCount}).`,
      400
    );
  }
};

const validateRoomAvailability = async ({ roomId, timeSlotId, assignmentId }) => {
  const clash = await prisma.examAssignment.findFirst({
    where: {
      roomId,
      timeSlotId,
      NOT: { id: assignmentId },
    },
    select: { id: true, room: { select: { name: true } } },
  });
  if (clash) {
    throw new AppError(
      `Room "${clash.room?.name ?? roomId}" is already booked for this time slot by another assignment.`,
      400
    );
  }
};

const validateSupervisorAvailability = async ({
  supervisorId,
  timeSlotId,
  assignmentId,
}) => {
  const clash = await prisma.examAssignment.findFirst({
    where: {
      supervisorId,
      timeSlotId,
      NOT: { id: assignmentId },
    },
    select: {
      id: true,
      supervisor: { include: { user: { select: { name: true } } } },
    },
  });
  if (clash) {
    const name = clash.supervisor?.user?.name ?? supervisorId;
    throw new AppError(
      `Supervisor "${name}" is already assigned to another exam in this time slot.`,
      400
    );
  }
};

const validateStudentOverlap = async ({
  scheduleId,
  examId,
  timeSlotId,
  assignmentId,
}) => {
  // Students registered in this exam (via its course offering)
  const registrations = await prisma.registration.findMany({
    where: { courseOffering: { exams: { some: { id: examId } } } },
    select: { studentId: true },
  });
  const studentIds = registrations.map((r) => r.studentId);
  if (studentIds.length === 0) return;

  // Other assignments in the same schedule + same timeSlot whose exam shares any of those students
  const conflict = await prisma.examAssignment.findFirst({
    where: {
      scheduleId,
      timeSlotId,
      NOT: { id: assignmentId },
      exam: {
        courseOffering: {
          registrations: { some: { studentId: { in: studentIds } } },
        },
      },
    },
    select: {
      id: true,
      exam: {
        select: {
          courseOffering: {
            select: { course: { select: { code: true, title: true } } },
          },
        },
      },
    },
  });
  if (conflict) {
    const c = conflict.exam?.courseOffering?.course;
    const label = c?.code ?? c?.title ?? conflict.id;
    throw new AppError(
      `One or more students enrolled in this exam are already scheduled for "${label}" in the same time slot.`,
      400
    );
  }
};

// -------------------- service API --------------------

export const listForSchedule = async (scheduleId) => {
  await ensureScheduleExists(scheduleId);
  return prisma.examAssignment.findMany({
    where: { scheduleId },
    select: assignmentSelect,
    orderBy: [{ timeSlot: { startTime: 'asc' } }, { id: 'asc' }],
  });
};

export const getOne = async (scheduleId, assignmentId) => {
  await ensureScheduleExists(scheduleId);
  return loadAssignmentInSchedule(scheduleId, assignmentId);
};

export const update = async (scheduleId, assignmentId, payload) => {
  const schedule = await ensureScheduleExists(scheduleId);
  if (schedule.isFinal) {
    throw new AppError(
      'Published schedules cannot be modified. Return to draft first.',
      403
    );
  }
  const existing = await loadAssignmentInSchedule(scheduleId, assignmentId);

  const { roomId, supervisorId, timeSlotId, exam: examPatch } = payload;

  // Validate referenced resources exist when provided.
  if (roomId !== undefined) await ensureRoomExists(roomId);
  if (supervisorId !== undefined) await ensureSupervisorExists(supervisorId);
  if (timeSlotId !== undefined) await ensureTimeSlotExists(timeSlotId);

  const assignmentData = {};
  if (roomId !== undefined) assignmentData.roomId = roomId;
  if (supervisorId !== undefined) assignmentData.supervisorId = supervisorId;
  if (timeSlotId !== undefined) assignmentData.timeSlotId = timeSlotId;

  // Effective values after applying the patch — used for hard-constraint checks.
  const effective = {
    roomId: roomId ?? existing.roomId,
    supervisorId: supervisorId ?? existing.supervisorId,
    timeSlotId: timeSlotId ?? existing.timeSlotId,
    examId: existing.examId,
  };

  // Re-check hard scheduling constraints. Each helper throws AppError(400) on
  // failure, which short-circuits before any database write.
  const room = await validateRoomStatus(effective.roomId);
  await validateRoomCapacity(room, effective.examId);
  await validateRoomAvailability({
    roomId: effective.roomId,
    timeSlotId: effective.timeSlotId,
    assignmentId,
  });
  await validateSupervisorAvailability({
    supervisorId: effective.supervisorId,
    timeSlotId: effective.timeSlotId,
    assignmentId,
  });
  await validateStudentOverlap({
    scheduleId,
    examId: effective.examId,
    timeSlotId: effective.timeSlotId,
    assignmentId,
  });

  await prisma.$transaction(async (tx) => {
    if (Object.keys(assignmentData).length > 0) {
      await tx.examAssignment.update({
        where: { id: assignmentId },
        data: assignmentData,
      });
    }
    if (examPatch) {
      const examData = {};
      if (examPatch.duration !== undefined) examData.duration = examPatch.duration;
      if (examPatch.status !== undefined) examData.status = examPatch.status;
      if (Object.keys(examData).length > 0) {
        await tx.exam.update({
          where: { id: existing.examId },
          data: examData,
        });
      }
    }
  });

  return prisma.examAssignment.findUnique({
    where: { id: assignmentId },
    select: assignmentSelect,
  });
};

export const remove = async (scheduleId, assignmentId) => {
  const schedule = await ensureScheduleExists(scheduleId);
  if (schedule.isFinal) {
    throw new AppError(
      'Published schedules cannot be modified. Return to draft first.',
      403
    );
  }
  await loadAssignmentInSchedule(scheduleId, assignmentId);

  // Delete only the join row — related Exam/Course/Room/Supervisor/TimeSlot
  // entities are intentionally left intact.
  await prisma.examAssignment.delete({ where: { id: assignmentId } });
};
