import prisma from '../../config/prisma.js';
import { AppError } from '../../utils/AppError.js';
import { assertProctorAvailableForTimeSlot } from '../proctors/proctorAvailability.js';

const MAX_STUDENT_EXAMS_PER_DAY = 2;

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
  proctorId: true,
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
              semester: { select: { id: true, name: true, startDate: true, endDate: true } },
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
  proctor: {
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

const ensureProctorExists = async (proctorId) => {
  const proctor = await prisma.proctor.findUnique({
    where: { id: proctorId },
    select: { id: true },
  });
  if (!proctor) throw new AppError('Proctor not found', 404);
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

const loadProctorForConstraintCheck = async (proctorId) => {
  const proctor = await prisma.proctor.findUnique({
    where: { id: proctorId },
    select: { id: true, centerId: true, maxExamsPerDay: true, user: { select: { name: true } } },
  });
  if (!proctor) throw new AppError('Proctor not found', 404);
  return proctor;
};

const loadTimeSlotForConstraintCheck = async (timeSlotId) => {
  const timeSlot = await prisma.timeSlot.findUnique({
    where: { id: timeSlotId },
    select: { id: true, date: true, startTime: true, endTime: true },
  });
  if (!timeSlot) throw new AppError('Time slot not found', 404);
  return timeSlot;
};

const timeRangesOverlap = (startA, endA, startB, endB) => startA < endB && startB < endA;

const getDayBounds = (value) => {
  const start = new Date(value);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
};

const validateSlotWindow = (timeSlot, semester, examDuration) => {
  const slotStart = new Date(timeSlot.startTime);
  const slotEnd = new Date(timeSlot.endTime);
  const semesterStart = new Date(semester.startDate);
  const semesterEnd = new Date(semester.endDate);

  if (Number.isNaN(slotStart.getTime()) || Number.isNaN(slotEnd.getTime()) || slotEnd <= slotStart) {
    throw new AppError('Selected time slot has invalid start or end times.', 400);
  }

  if (Number.isNaN(semesterStart.getTime()) || Number.isNaN(semesterEnd.getTime())) {
    throw new AppError('Exam semester dates are invalid.', 400);
  }

  if (slotStart < semesterStart || slotEnd > semesterEnd) {
    throw new AppError('Selected time slot falls outside the semester exam window.', 400);
  }

  const slotDurationMinutes = Math.round((slotEnd.getTime() - slotStart.getTime()) / 60000);
  if (slotDurationMinutes < examDuration) {
    throw new AppError(`Selected time slot only provides ${slotDurationMinutes} minutes, below the exam duration of ${examDuration} minutes.`, 400);
  }
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

const validateRoomAvailability = async ({ scheduleId, roomId, timeSlotId, assignmentId }) => {
  const clash = await prisma.examAssignment.findFirst({
    where: {
      roomId,
      timeSlotId,
      NOT: { id: assignmentId },
      OR: [{ scheduleId }, { schedule: { isFinal: true } }],
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

const validateResourceCenterMatch = ({ room, proctor }) => {
  if (room.centerId !== proctor.centerId) {
    throw new AppError('Assigned proctor must belong to the same center as the selected room.', 400);
  }
};

const validateRoomTemporalAvailability = async ({ scheduleId, roomId, timeSlot, assignmentId }) => {
  const clashes = await prisma.examAssignment.findMany({
    where: {
      roomId,
      NOT: { id: assignmentId },
      OR: [{ scheduleId }, { schedule: { isFinal: true } }],
      timeSlot: {
        startTime: { lt: timeSlot.endTime },
        endTime: { gt: timeSlot.startTime },
      },
    },
    select: { id: true },
    take: 1,
  });

  if (clashes.length > 0) {
    throw new AppError('Room is already reserved in an overlapping time window.', 400);
  }
};

const validateProctorAvailability = async ({
  scheduleId,
  proctorId,
  timeSlotId,
  assignmentId,
}) => {
  await assertProctorAvailableForTimeSlot({ proctorId, timeSlotId });

  const clash = await prisma.examAssignment.findFirst({
    where: {
      proctorId,
      timeSlotId,
      NOT: { id: assignmentId },
      OR: [{ scheduleId }, { schedule: { isFinal: true } }],
    },
    select: {
      id: true,
      proctor: { include: { user: { select: { name: true } } } },
    },
  });
  if (clash) {
    const name = clash.proctor?.user?.name ?? proctorId;
    throw new AppError(
      `Proctor "${name}" is already assigned to another exam in this time slot.`,
      400
    );
  }
};

const validateProctorTemporalAvailability = async ({ scheduleId, proctorId, timeSlot, assignmentId }) => {
  const clashes = await prisma.examAssignment.findMany({
    where: {
      proctorId,
      NOT: { id: assignmentId },
      OR: [{ scheduleId }, { schedule: { isFinal: true } }],
      timeSlot: {
        startTime: { lt: timeSlot.endTime },
        endTime: { gt: timeSlot.startTime },
      },
    },
    select: { id: true },
    take: 1,
  });

  if (clashes.length > 0) {
    throw new AppError('Proctor is already assigned in an overlapping time window.', 400);
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

const validateStudentTemporalOverlap = async ({ scheduleId, studentIds, timeSlot, assignmentId }) => {
  if (studentIds.length === 0) return;

  const clash = await prisma.examAssignment.findFirst({
    where: {
      NOT: { id: assignmentId },
      OR: [{ scheduleId }, { schedule: { isFinal: true } }],
      timeSlot: {
        startTime: { lt: timeSlot.endTime },
        endTime: { gt: timeSlot.startTime },
      },
      exam: {
        courseOffering: {
          registrations: { some: { studentId: { in: studentIds } } },
        },
      },
    },
    select: { id: true },
  });

  if (clash) {
    throw new AppError('One or more students would be assigned to overlapping exam windows.', 400);
  }
};

const validateStudentDailyLoad = async ({ scheduleId, studentIds, timeSlot, assignmentId }) => {
  if (studentIds.length === 0) return;

  const { start, end } = getDayBounds(timeSlot.date ?? timeSlot.startTime);
  const sameDayAssignments = await prisma.examAssignment.findMany({
    where: {
      NOT: { id: assignmentId },
      OR: [{ scheduleId }, { schedule: { isFinal: true } }],
      timeSlot: {
        startTime: { gte: start, lt: end },
      },
      exam: {
        courseOffering: {
          registrations: { some: { studentId: { in: studentIds } } },
        },
      },
    },
    select: {
      examId: true,
      exam: {
        select: {
          courseOffering: {
            select: {
              registrations: {
                where: { studentId: { in: studentIds } },
                select: { studentId: true },
              },
            },
          },
        },
      },
    },
  });

  const perStudentExamIds = new Map();
  for (const assignment of sameDayAssignments) {
    for (const registration of assignment.exam?.courseOffering?.registrations ?? []) {
      if (!perStudentExamIds.has(registration.studentId)) perStudentExamIds.set(registration.studentId, new Set());
      perStudentExamIds.get(registration.studentId).add(assignment.examId);
    }
  }

  for (const studentId of studentIds) {
    if ((perStudentExamIds.get(studentId)?.size ?? 0) >= MAX_STUDENT_EXAMS_PER_DAY) {
      throw new AppError(`Selected time slot would exceed the daily exam limit of ${MAX_STUDENT_EXAMS_PER_DAY} for at least one student.`, 400);
    }
  }
};

const validateProctorDailyLoad = async ({ scheduleId, proctor, timeSlot, assignmentId }) => {
  const maxExamsPerDay = proctor.maxExamsPerDay ?? 2;
  const { start, end } = getDayBounds(timeSlot.date ?? timeSlot.startTime);
  const sameDayAssignments = await prisma.examAssignment.findMany({
    where: {
      proctorId: proctor.id,
      NOT: { id: assignmentId },
      OR: [{ scheduleId }, { schedule: { isFinal: true } }],
      timeSlot: {
        startTime: { gte: start, lt: end },
      },
    },
    select: { examId: true },
  });

  const distinctExamIds = new Set(sameDayAssignments.map((assignment) => assignment.examId));
  if (distinctExamIds.size >= maxExamsPerDay) {
    throw new AppError(`Selected proctor would exceed the daily invigilation limit of ${maxExamsPerDay} exams.`, 400);
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

  const { roomId, proctorId, timeSlotId, exam: examPatch } = payload;

  // Validate referenced resources exist when provided.
  if (roomId !== undefined) await ensureRoomExists(roomId);
  if (proctorId !== undefined) await ensureProctorExists(proctorId);
  if (timeSlotId !== undefined) await ensureTimeSlotExists(timeSlotId);

  const assignmentData = {};
  if (roomId !== undefined) assignmentData.roomId = roomId;
  if (proctorId !== undefined) assignmentData.proctorId = proctorId;
  if (timeSlotId !== undefined) assignmentData.timeSlotId = timeSlotId;

  // Effective values after applying the patch — used for hard-constraint checks.
  const effective = {
    roomId: roomId ?? existing.roomId,
    proctorId: proctorId ?? existing.proctorId,
    timeSlotId: timeSlotId ?? existing.timeSlotId,
    examId: existing.examId,
  };

  const effectiveExamDuration = examPatch?.duration ?? existing.exam?.duration ?? 120;
  const [room, proctor, timeSlot] = await Promise.all([
    validateRoomStatus(effective.roomId),
    loadProctorForConstraintCheck(effective.proctorId),
    loadTimeSlotForConstraintCheck(effective.timeSlotId),
  ]);
  const semester = existing.exam?.courseOffering?.semester;
  const studentIds = (existing.exam?.courseOffering?.registrations ?? []).map((registration) => registration.studentId);

  if (!semester) {
    throw new AppError('Exam semester could not be resolved for assignment validation.', 400);
  }

  // Re-check hard scheduling constraints. Each helper throws AppError(400) on
  // failure, which short-circuits before any database write.
  await validateRoomCapacity(room, effective.examId);
  validateResourceCenterMatch({ room, proctor });
  validateSlotWindow(timeSlot, semester, effectiveExamDuration);
  await validateRoomAvailability({
    scheduleId,
    roomId: effective.roomId,
    timeSlotId: effective.timeSlotId,
    assignmentId,
  });
  await validateRoomTemporalAvailability({ scheduleId, roomId: effective.roomId, timeSlot, assignmentId });
  await validateProctorAvailability({
    scheduleId,
    proctorId: effective.proctorId,
    timeSlotId: effective.timeSlotId,
    assignmentId,
  });
  await validateProctorTemporalAvailability({ scheduleId, proctorId: effective.proctorId, timeSlot, assignmentId });
  await validateProctorDailyLoad({ scheduleId, proctor, timeSlot, assignmentId });
  await validateStudentOverlap({
    scheduleId,
    examId: effective.examId,
    timeSlotId: effective.timeSlotId,
    assignmentId,
  });
  await validateStudentTemporalOverlap({ scheduleId, studentIds, timeSlot, assignmentId });
  await validateStudentDailyLoad({ scheduleId, studentIds, timeSlot, assignmentId });

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

export const remove = async (scheduleId, assignmentId, options = {}) => {
  const schedule = await ensureScheduleExists(scheduleId);
  if (schedule.isFinal) {
    throw new AppError(
      'Published schedules cannot be modified. Return to draft first.',
      403
    );
  }
  const existing = await loadAssignmentInSchedule(scheduleId, assignmentId);

  if (options.deleteGroup) {
    await prisma.examAssignment.deleteMany({
      where: {
        scheduleId,
        examId: existing.examId,
        timeSlotId: existing.timeSlotId,
      },
    });
    return;
  }

  // Delete only the join row — related Exam/Course/Room/Proctor/TimeSlot
  // entities are intentionally left intact.
  await prisma.examAssignment.delete({ where: { id: assignmentId } });
};
