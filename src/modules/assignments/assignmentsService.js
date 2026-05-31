import prisma from '../../config/prisma.js';
import { AppError } from '../../utils/AppError.js';
import { assertProctorAvailableForTimeSlot } from '../proctors/proctorAvailability.js';
import { parseListQuery, buildOrderBy, buildMeta, parseSearchDateRange } from '../../utils/queryParser.js';
import { createExamStatusChangeNotifications } from '../notifications/notificationsService.js';
import { synchronizeSchedules } from '../schedules/scheduleSyncService.js';

const MAX_STUDENT_EXAMS_PER_DAY = 2;
const PROCTOR_RATIO = 20;
const ASSIGNMENT_STATUSES = ['DRAFT', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];
const PUBLISHED_ASSIGNMENT_STATUSES = ['SCHEDULED', 'COMPLETED', 'CANCELLED'];
const NO_MATCH_ASSIGNMENT_ID = '00000000-0000-0000-0000-000000000000';

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

// Mirror the frontend display rule:
//   draft schedule  → every assignment is DRAFT
//   published       → SCHEDULED unless exam.status is COMPLETED or CANCELLED
const buildDisplayStatusWhere = (isFinal, status) => {
  if (!isFinal) {
    return status === 'DRAFT' ? {} : { id: NO_MATCH_ASSIGNMENT_ID };
  }

  if (status === 'COMPLETED' || status === 'CANCELLED') {
    return { exam: { status } };
  }

  if (status === 'SCHEDULED') {
    return {
      OR: [
        { exam: { status: null } },
        { exam: { status: { notIn: ['COMPLETED', 'CANCELLED'] } } },
      ],
    };
  }

  return { id: NO_MATCH_ASSIGNMENT_ID };
};

const countLogicalAssignments = async (where, client = prisma) => {
  const pairs = await client.examAssignment.findMany({
    where,
    select: { examId: true, timeSlotId: true },
    distinct: ['examId', 'timeSlotId'],
  });

  return pairs.length;
};

const getScheduleAssignmentCounts = async (scheduleId, client = prisma) => {
  const where = { scheduleId };
  const [raw, logical] = await Promise.all([
    client.examAssignment.count({ where }),
    countLogicalAssignments(where, client),
  ]);
  return { raw, logical };
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

const loadAssignmentsInSchedule = async (scheduleId, assignmentIds = []) => {
  const uniqueIds = [...new Set((assignmentIds ?? []).filter(Boolean))];
  if (uniqueIds.length === 0) return [];

  const assignments = await prisma.examAssignment.findMany({
    where: { id: { in: uniqueIds } },
    select: assignmentSelect,
  });

  if (assignments.length !== uniqueIds.length) {
    throw new AppError('One or more assignment rows could not be resolved for this edit.', 404);
  }

  if (assignments.some((assignment) => assignment.scheduleId !== scheduleId)) {
    throw new AppError('One or more selected assignment rows do not belong to this schedule.', 404);
  }

  const byId = new Map(assignments.map((assignment) => [assignment.id, assignment]));
  return uniqueIds.map((id) => byId.get(id)).filter(Boolean);
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

const resolveTimeSearch = async (search) => {
  const match = String(search).trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;

  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  if (hours > 23 || minutes > 59) return null;

  const rows = await prisma.$queryRaw`
    SELECT id FROM "time_slots"
    WHERE EXTRACT(HOUR FROM "startTime" AT TIME ZONE 'UTC') = ${hours}
      AND EXTRACT(MINUTE FROM "startTime" AT TIME ZONE 'UTC') = ${minutes}
    UNION
    SELECT id FROM "time_slots"
    WHERE EXTRACT(HOUR FROM "endTime" AT TIME ZONE 'UTC') = ${hours}
      AND EXTRACT(MINUTE FROM "endTime" AT TIME ZONE 'UTC') = ${minutes}
  `;

  return rows.map((row) => row.id);
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
    select: { id: true, maxExamsPerDay: true, user: { select: { name: true } } },
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

const toDateKey = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
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

const validateRoomCapacity = async ({ scheduleId, assignmentId, room, examId, timeSlotId }) => {
  const enrolledCount = await prisma.registration.count({
    where: { courseOffering: { exams: { some: { id: examId } } } },
  });
  const siblingAssignments = await prisma.examAssignment.findMany({
    where: {
      scheduleId,
      examId,
      timeSlotId,
      NOT: { id: assignmentId },
    },
    select: { room: { select: { id: true, name: true, capacity: true } } },
  });
  const uniqueRooms = new Map([[room.id, room]]);
  for (const assignment of siblingAssignments) {
    if (assignment.room?.id) uniqueRooms.set(assignment.room.id, assignment.room);
  }
  const totalCapacity = [...uniqueRooms.values()].reduce((sum, item) => sum + (item.capacity ?? 0), 0);

  if (totalCapacity < enrolledCount) {
    throw new AppError(
      `Selected room allocation capacity (${totalCapacity}) is below enrolled student count (${enrolledCount}).`,
      400
    );
  }
};

const validateRoomAvailability = async ({ scheduleId, roomId, timeSlotId, assignmentId, examId }) => {
  const clash = await prisma.examAssignment.findFirst({
    where: {
      roomId,
      timeSlotId,
      NOT: { id: assignmentId },
      OR: [{ scheduleId }, { schedule: { isFinal: true } }],
      ...(examId ? { examId: { not: examId } } : {}),
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

const validateRoomTemporalAvailability = async ({ scheduleId, roomId, timeSlot, assignmentId, examId }) => {
  const clashes = await prisma.examAssignment.findMany({
    where: {
      roomId,
      NOT: { id: assignmentId },
      OR: [{ scheduleId }, { schedule: { isFinal: true } }],
      ...(examId ? { examId: { not: examId } } : {}),
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

const validateRequiredProctorCount = async ({ scheduleId, assignmentId, examId, timeSlotId, proctorId }) => {
  const enrolledCount = await prisma.registration.count({
    where: { courseOffering: { exams: { some: { id: examId } } } },
  });
  const requiredProctors = Math.max(1, Math.ceil(enrolledCount / PROCTOR_RATIO));
  const siblingAssignments = await prisma.examAssignment.findMany({
    where: {
      scheduleId,
      examId,
      timeSlotId,
      NOT: { id: assignmentId },
    },
    select: { proctorId: true },
  });
  const uniqueProctorIds = new Set([proctorId, ...siblingAssignments.map((assignment) => assignment.proctorId)].filter(Boolean));

  if (uniqueProctorIds.size < requiredProctors) {
    throw new AppError(
      `Selected assignment would provide ${uniqueProctorIds.size} proctor${uniqueProctorIds.size === 1 ? '' : 's'}, but this exam requires ${requiredProctors} based on ${enrolledCount} enrolled student${enrolledCount === 1 ? '' : 's'}.`,
      400,
    );
  }
};

const getExamStudentIds = (assignment) => (
  assignment.exam?.courseOffering?.registrations ?? []
).map((registration) => registration.studentId).filter(Boolean);

const getExamLabel = (assignment) => {
  const course = assignment.exam?.courseOffering?.course;
  return [course?.code, course?.title].filter(Boolean).join(' — ') || assignment.examId;
};

const getTimeSlotRange = (assignment) => {
  const start = new Date(assignment.timeSlot?.startTime);
  const end = new Date(assignment.timeSlot?.endTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return { start, end };
};

const sameSlotDay = (left, right) => toDateKey(left.timeSlot?.date ?? left.timeSlot?.startTime) === toDateKey(right.timeSlot?.date ?? right.timeSlot?.startTime);

const loadOtherScheduleAssignmentsForValidation = async (scheduleId, excludedAssignmentIds = []) => prisma.examAssignment.findMany({
  where: {
    scheduleId,
    ...(excludedAssignmentIds.length > 0 ? { NOT: { id: { in: excludedAssignmentIds } } } : {}),
  },
  select: {
    id: true,
    scheduleId: true,
    examId: true,
    roomId: true,
    proctorId: true,
    timeSlotId: true,
    room: { select: { id: true, name: true, capacity: true, status: true } },
    proctor: { select: { id: true, maxExamsPerDay: true, user: { select: { name: true } } } },
    timeSlot: { select: { id: true, date: true, startTime: true, endTime: true } },
    exam: {
      select: {
        id: true,
        duration: true,
        courseOffering: {
          select: {
            course: { select: { code: true, title: true } },
            registrations: { select: { studentId: true } },
          },
        },
      },
    },
  },
});

const buildCandidateAssignmentForValidation = ({ existing, room, proctor, timeSlot, duration }) => ({
  ...existing,
  roomId: room.id,
  room,
  proctorId: proctor.id,
  proctor,
  timeSlotId: timeSlot.id,
  timeSlot,
  exam: existing.exam ? { ...existing.exam, duration } : existing.exam,
});

const buildCandidateAssignmentsForValidation = ({ existingAssignments, nextRoomId, roomMap, nextTimeSlotId, timeSlotMap, nextProctorIds, proctorMap, duration }) => (
  existingAssignments.map((assignment, index) => {
    const effectiveRoomId = nextRoomId ?? assignment.roomId;
    const effectiveTimeSlotId = nextTimeSlotId ?? assignment.timeSlotId;
    const effectiveProctorId = nextProctorIds?.[index] ?? assignment.proctorId;
    return {
      ...assignment,
      roomId: effectiveRoomId,
      room: roomMap.get(effectiveRoomId) ?? assignment.room,
      proctorId: effectiveProctorId,
      proctor: proctorMap.get(effectiveProctorId) ?? assignment.proctor,
      timeSlotId: effectiveTimeSlotId,
      timeSlot: timeSlotMap.get(effectiveTimeSlotId) ?? assignment.timeSlot,
      exam: assignment.exam ? { ...assignment.exam, duration } : assignment.exam,
    };
  })
);

const normalizeGroupedProctorIds = ({ existingAssignments, requestedProctorIds }) => {
  const remainingRequestedIds = [...requestedProctorIds];
  const normalizedProctorIds = new Array(existingAssignments.length);

  for (let index = 0; index < existingAssignments.length; index += 1) {
    const currentProctorId = existingAssignments[index]?.proctorId;
    const matchingRequestedIndex = remainingRequestedIds.indexOf(currentProctorId);
    if (matchingRequestedIndex === -1) continue;

    normalizedProctorIds[index] = currentProctorId;
    remainingRequestedIds.splice(matchingRequestedIndex, 1);
  }

  let remainingIndex = 0;
  for (let index = 0; index < existingAssignments.length; index += 1) {
    if (normalizedProctorIds[index]) continue;
    normalizedProctorIds[index] = remainingRequestedIds[remainingIndex];
    remainingIndex += 1;
  }

  return normalizedProctorIds;
};

const assertCandidateAgainstFullSchedule = ({ candidate, otherAssignments }) => {
  const candidateRange = getTimeSlotRange(candidate);
  if (!candidateRange) throw new AppError('Selected time slot has invalid start or end times.', 400);

  const candidateStudentIds = new Set(getExamStudentIds(candidate));
  const proctorDayExamIds = new Set();
  const studentDayExamIds = new Map();

  for (const other of otherAssignments) {
    const otherRange = getTimeSlotRange(other);
    if (!otherRange) continue;
    const overlaps = timeRangesOverlap(candidateRange.start, candidateRange.end, otherRange.start, otherRange.end);
    const differentExam = other.examId !== candidate.examId;

    if (differentExam && other.roomId === candidate.roomId && overlaps) {
      throw new AppError(
        `Room "${candidate.room?.name ?? candidate.roomId}" conflicts with ${getExamLabel(other)} in an overlapping time window.`,
        400,
      );
    }

    if (differentExam && other.proctorId === candidate.proctorId && overlaps) {
      const name = candidate.proctor?.user?.name ?? candidate.proctorId;
      throw new AppError(
        `Proctor "${name}" conflicts with ${getExamLabel(other)} in an overlapping time window.`,
        400,
      );
    }

    const sharedStudentIds = getExamStudentIds(other).filter((studentId) => candidateStudentIds.has(studentId));
    if (differentExam && sharedStudentIds.length > 0 && overlaps) {
      throw new AppError(
        `One or more students would have overlapping exams with ${getExamLabel(other)}.`,
        400,
      );
    }

    if (sameSlotDay(candidate, other)) {
      if (other.proctorId === candidate.proctorId && differentExam) {
        proctorDayExamIds.add(other.examId);
      }
      for (const studentId of sharedStudentIds) {
        if (!studentDayExamIds.has(studentId)) studentDayExamIds.set(studentId, new Set());
        if (differentExam) studentDayExamIds.get(studentId).add(other.examId);
      }
    }
  }

  const maxExamsPerDay = candidate.proctor?.maxExamsPerDay ?? 2;
  if (proctorDayExamIds.size >= maxExamsPerDay) {
    throw new AppError(`Selected proctor would exceed the daily invigilation limit of ${maxExamsPerDay} exams in this schedule.`, 400);
  }

  for (const examIds of studentDayExamIds.values()) {
    if (examIds.size >= MAX_STUDENT_EXAMS_PER_DAY) {
      throw new AppError(`Selected time slot would exceed the daily exam limit of ${MAX_STUDENT_EXAMS_PER_DAY} for at least one student in this schedule.`, 400);
    }
  }
};

const calculateCandidateScheduleQuality = ({ candidate, otherAssignments }) => {
  const assignments = [...otherAssignments, candidate];
  const examSlotGroups = new Map();
  const proctorLoads = new Map();
  const dayLoads = new Map();
  const studentSlots = new Map();

  for (const assignment of assignments) {
    const groupKey = `${assignment.examId}:${assignment.timeSlotId}`;
    const group = examSlotGroups.get(groupKey) ?? {
      seats: getExamStudentIds(assignment).length,
      rooms: new Map(),
    };
    if (assignment.room?.id) group.rooms.set(assignment.room.id, assignment.room.capacity ?? 0);
    examSlotGroups.set(groupKey, group);

    if (!proctorLoads.has(assignment.proctorId)) proctorLoads.set(assignment.proctorId, new Set());
    proctorLoads.get(assignment.proctorId).add(assignment.examId);

    const dayKey = toDateKey(assignment.timeSlot?.date ?? assignment.timeSlot?.startTime);
    dayLoads.set(dayKey, (dayLoads.get(dayKey) ?? 0) + 1);

    for (const studentId of getExamStudentIds(assignment)) {
      if (!studentSlots.has(studentId)) studentSlots.set(studentId, []);
      studentSlots.get(studentId).push(assignment.timeSlot);
    }
  }

  const utilizationValues = [...examSlotGroups.values()].map((group) => {
    const capacity = [...group.rooms.values()].reduce((total, capacityValue) => total + capacityValue, 0);
    return capacity > 0 ? Math.min(1, group.seats / capacity) : 0;
  });
  const workloadValues = [...proctorLoads.values()].map((examIds) => examIds.size);
  const dayLoadValues = [...dayLoads.values()];
  let spacingPairs = 0;
  let spacedPairs = 0;
  for (const slots of studentSlots.values()) {
    const ordered = slots
      .filter((slot) => slot?.startTime && slot?.endTime)
      .sort((left, right) => new Date(left.startTime).getTime() - new Date(right.startTime).getTime());
    for (let leftIndex = 0; leftIndex < ordered.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < ordered.length; rightIndex += 1) {
        spacingPairs += 1;
        if (toDateKey(ordered[leftIndex].startTime) !== toDateKey(ordered[rightIndex].startTime)) spacedPairs += 1;
      }
    }
  }

  const average = (values) => (values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length);
  const spreadScore = (values) => {
    if (values.length <= 1) return 100;
    const mean = average(values);
    if (mean === 0) return 100;
    const deviation = average(values.map((value) => Math.abs(value - mean)));
    return Math.max(0, Math.round((1 - Math.min(1, deviation / mean)) * 100));
  };

  const roomUtilization = Math.round(average(utilizationValues) * 100);
  const proctorWorkloadBalance = spreadScore(workloadValues);
  const examDistribution = spreadScore(dayLoadValues);
  const studentSpacing = spacingPairs === 0 ? 100 : Math.round((spacedPairs / spacingPairs) * 100);
  const score = Math.round((roomUtilization * 0.25) + (proctorWorkloadBalance * 0.25) + (studentSpacing * 0.2) + (examDistribution * 0.15) + 15);

  return {
    score: Math.max(0, Math.min(100, score)),
    metrics: {
      roomUtilization,
      proctorWorkloadBalance,
      studentSpacing,
      examDistribution,
    },
  };
};

const assertCandidateGroupAgainstFullSchedule = ({ candidates, otherAssignments }) => {
  if (!candidates.length) throw new AppError('No assignment rows available for update.', 400);

  const candidateExamId = candidates[0].examId;
  const candidateStudentIds = new Set(getExamStudentIds(candidates[0]));
  const candidateProctorIds = candidates.map((candidate) => candidate.proctorId).filter(Boolean);
  if (new Set(candidateProctorIds).size !== candidateProctorIds.length) {
    throw new AppError('Each assignment row must have a different proctor selected.', 400);
  }

  const requiredProctors = Math.max(1, Math.ceil(candidateStudentIds.size / PROCTOR_RATIO));
  if (new Set(candidateProctorIds).size < requiredProctors) {
    throw new AppError(
      `Selected assignment would provide ${new Set(candidateProctorIds).size} proctor${new Set(candidateProctorIds).size === 1 ? '' : 's'}, but this exam requires ${requiredProctors} based on ${candidateStudentIds.size} enrolled student${candidateStudentIds.size === 1 ? '' : 's'}.`,
      400,
    );
  }

  const candidateRanges = candidates.map((candidate) => ({
    candidate,
    range: getTimeSlotRange(candidate),
  }));
  if (candidateRanges.some(({ range }) => !range)) {
    throw new AppError('Selected time slot has invalid start or end times.', 400);
  }

  const uniqueRooms = new Map();
  for (const candidate of candidates) {
    if ((candidate.room?.status ?? 'AVAILABLE') !== 'AVAILABLE') {
      throw new AppError(`Room "${candidate.room?.name ?? candidate.roomId}" is not available.`, 400);
    }
    if (candidate.room?.id) uniqueRooms.set(candidate.room.id, candidate.room);
  }
  const totalCapacity = [...uniqueRooms.values()].reduce((sum, room) => sum + (room?.capacity ?? 0), 0);
  if (totalCapacity < candidateStudentIds.size) {
    throw new AppError(
      `Selected room allocation capacity (${totalCapacity}) is below enrolled student count (${candidateStudentIds.size}).`,
      400,
    );
  }

  const proctorDailyExamIds = new Map();
  const studentDailyExamIds = new Map();

  for (const other of otherAssignments) {
    const otherRange = getTimeSlotRange(other);
    if (!otherRange) continue;
    const sharedStudentIds = getExamStudentIds(other).filter((studentId) => candidateStudentIds.has(studentId));

    for (const { candidate, range } of candidateRanges) {
      const overlaps = timeRangesOverlap(range.start, range.end, otherRange.start, otherRange.end);
      const differentExam = other.examId !== candidateExamId;

      if (differentExam && other.roomId === candidate.roomId && overlaps) {
        throw new AppError(
          `Room "${candidate.room?.name ?? candidate.roomId}" conflicts with ${getExamLabel(other)} in an overlapping time window.`,
          400,
        );
      }

      if (differentExam && other.proctorId === candidate.proctorId && overlaps) {
        const name = candidate.proctor?.user?.name ?? candidate.proctorId;
        throw new AppError(
          `Proctor "${name}" conflicts with ${getExamLabel(other)} in an overlapping time window.`,
          400,
        );
      }

      if (differentExam && sharedStudentIds.length > 0 && overlaps) {
        throw new AppError(
          `One or more students would have overlapping exams with ${getExamLabel(other)}.`,
          400,
        );
      }

      if (!sameSlotDay(candidate, other) || !differentExam) continue;

      if (other.proctorId === candidate.proctorId) {
        if (!proctorDailyExamIds.has(candidate.proctorId)) proctorDailyExamIds.set(candidate.proctorId, new Set());
        proctorDailyExamIds.get(candidate.proctorId).add(other.examId);
      }

      for (const studentId of sharedStudentIds) {
        if (!studentDailyExamIds.has(studentId)) studentDailyExamIds.set(studentId, new Set());
        studentDailyExamIds.get(studentId).add(other.examId);
      }
    }
  }

  for (const candidate of candidates) {
    const maxExamsPerDay = candidate.proctor?.maxExamsPerDay ?? 2;
    const sameDayExamIds = new Set([candidateExamId, ...(proctorDailyExamIds.get(candidate.proctorId) ?? [])]);
    if (sameDayExamIds.size > maxExamsPerDay) {
      throw new AppError(`Selected proctor would exceed the daily invigilation limit of ${maxExamsPerDay} exams in this schedule.`, 400);
    }
  }

  for (const examIds of studentDailyExamIds.values()) {
    if (new Set([candidateExamId, ...examIds]).size > MAX_STUDENT_EXAMS_PER_DAY) {
      throw new AppError(`Selected time slot would exceed the daily exam limit of ${MAX_STUDENT_EXAMS_PER_DAY} for at least one student in this schedule.`, 400);
    }
  }
};

const calculateCandidateGroupScheduleQuality = ({ candidates, otherAssignments }) => {
  if (!candidates.length) {
    return { score: 0, metrics: { roomUtilization: 0, proctorWorkloadBalance: 0, studentSpacing: 0, examDistribution: 0 } };
  }

  const firstCandidate = candidates[0];
  const representative = {
    ...firstCandidate,
    room: candidates[0].room,
    proctor: candidates[0].proctor,
    timeSlot: candidates[0].timeSlot,
  };

  return calculateCandidateScheduleQuality({ candidate: representative, otherAssignments: [...otherAssignments, ...candidates.slice(1)] });
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
      examId: { not: examId },
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

const validateStudentTemporalOverlap = async ({ scheduleId, studentIds, timeSlot, assignmentId, examId }) => {
  if (studentIds.length === 0) return;

  const clash = await prisma.examAssignment.findFirst({
    where: {
      NOT: { id: assignmentId },
      OR: [{ scheduleId }, { schedule: { isFinal: true } }],
      ...(examId ? { examId: { not: examId } } : {}),
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

const ASSIGNMENT_SORT_FIELDS = {
  startTime:  (dir) => [{ timeSlot: { startTime: dir } }, { examId: 'asc' }, { roomId: 'asc' }, { proctorId: 'asc' }, { id: 'asc' }],
  endTime:    (dir) => [{ timeSlot: { endTime: dir } }, { examId: 'asc' }, { roomId: 'asc' }, { proctorId: 'asc' }, { id: 'asc' }],
  date:       (dir) => [{ timeSlot: { date: dir } }, { timeSlot: { startTime: 'asc' } }, { examId: 'asc' }, { roomId: 'asc' }, { proctorId: 'asc' }, { id: 'asc' }],
  course:     (dir) => [{ exam: { courseOffering: { course: { title: dir } } } }, { timeSlot: { startTime: 'asc' } }, { examId: 'asc' }, { roomId: 'asc' }, { proctorId: 'asc' }, { id: 'asc' }],
  room:       (dir) => [{ room: { name: dir } }, { timeSlot: { startTime: 'asc' } }, { examId: 'asc' }, { roomId: 'asc' }, { proctorId: 'asc' }, { id: 'asc' }],
  proctor:    (dir) => [{ proctor: { user: { name: dir } } }, { timeSlot: { startTime: 'asc' } }, { examId: 'asc' }, { roomId: 'asc' }, { proctorId: 'asc' }, { id: 'asc' }],
  status:     (dir) => [{ exam: { status: dir } }, { timeSlot: { startTime: 'asc' } }, { examId: 'asc' }, { roomId: 'asc' }, { proctorId: 'asc' }, { id: 'asc' }],
};

const LOGICAL_ASSIGNMENT_CHUNK_SIZE = 400;

const listLogicalAssignmentPage = async ({ where, orderBy, page, limit }) => {
  const logicalOffset = (page - 1) * limit;
  const targetEnd = logicalOffset + limit;
  const data = [];
  let rawSkip = 0;
  let logicalIndex = 0;
  let lastLogicalKey = null;

  while (logicalIndex < targetEnd) {
    const rows = await prisma.examAssignment.findMany({
      where,
      skip: rawSkip,
      take: LOGICAL_ASSIGNMENT_CHUNK_SIZE,
      orderBy,
      select: assignmentSelect,
    });

    if (rows.length === 0) break;

    for (const row of rows) {
      const logicalKey = `${row.examId}:${row.timeSlotId}`;
      if (logicalKey !== lastLogicalKey) {
        if (logicalIndex >= targetEnd) {
          return data;
        }
        logicalIndex += 1;
        lastLogicalKey = logicalKey;
      }

      if (logicalIndex > logicalOffset && logicalIndex <= targetEnd) {
        data.push(row);
      }
    }

    rawSkip += rows.length;
  }

  return data;
};

export const listForSchedule = async (scheduleId) => {
  await ensureScheduleExists(scheduleId);
  return prisma.examAssignment.findMany({
    where: { scheduleId },
    select: assignmentSelect,
    orderBy: [{ timeSlot: { startTime: 'asc' } }, { id: 'asc' }],
  });
};

export const listForSchedulePage = async (scheduleId, query = {}) => {
  const schedule = await ensureScheduleExists(scheduleId);
  const { page, limit, skip, sortField, sortDirection, search } = parseListQuery(query);

  const where = { scheduleId };
  const andClauses = [];

  // Direct ID filters
  if (query.roomId) where.roomId = query.roomId;
  if (query.proctorId) where.proctorId = query.proctorId;
  if (query.timeSlotId) where.timeSlotId = query.timeSlotId;

  // Room center filter
  if (query.centerId) where.room = { centerId: query.centerId };

  // Exam nested filters
  const examWhere = {};
  if (query.courseId) examWhere.courseOffering = { courseId: query.courseId };
  if (query.semesterId) {
    examWhere.courseOffering = { ...(examWhere.courseOffering ?? {}), semesterId: query.semesterId };
  }
  if (Object.keys(examWhere).length) where.exam = examWhere;
  if (query.status) andClauses.push(buildDisplayStatusWhere(schedule.isFinal, query.status));

  // TimeSlot date/phase filters
  const tsWhere = {};
  if (query.examDate) {
    tsWhere.date = { gte: new Date(`${query.examDate}T00:00:00.000Z`), lte: new Date(`${query.examDate}T23:59:59.999Z`) };
  } else {
    if (query.startDate) tsWhere.startTime = { gte: new Date(`${query.startDate}T00:00:00.000Z`) };
    if (query.endDate) tsWhere.startTime = { ...(tsWhere.startTime ?? {}), lte: new Date(`${query.endDate}T23:59:59.999Z`) };
  }
  if (query.phase === 'upcoming') tsWhere.startTime = { ...(tsWhere.startTime ?? {}), gte: new Date() };
  if (query.phase === 'completed') tsWhere.startTime = { ...(tsWhere.startTime ?? {}), lt: new Date() };
  if (Object.keys(tsWhere).length) where.timeSlot = tsWhere;

  // Full-text search across course, room, proctor, student, status, date
  if (search) {
    const si = { contains: search, mode: 'insensitive' };
    const searchClauses = [
      { exam: { courseOffering: { course: { title: si } } } },
      { exam: { courseOffering: { course: { code: si } } } },
      { room: { name: si } },
      { room: { center: { name: si } } },
      { proctor: { user: { name: si } } },
      { proctor: { user: { email: si } } },
      { exam: { courseOffering: { registrations: { some: { student: { user: { name: si } } } } } } },
      { exam: { courseOffering: { registrations: { some: { student: { user: { email: si } } } } } } },
    ];
    const statusUpper = search.toUpperCase();
    if (ASSIGNMENT_STATUSES.includes(statusUpper)) {
      searchClauses.push(buildDisplayStatusWhere(schedule.isFinal, statusUpper));
    }
    const dateRange = parseSearchDateRange(search);
    if (dateRange) {
      searchClauses.push({ timeSlot: { date: dateRange } });
      searchClauses.push({ AND: [{ timeSlot: { date: null } }, { timeSlot: { startTime: dateRange } }] });
    }
    const timeSlotIds = await resolveTimeSearch(search);
    if (timeSlotIds !== null && timeSlotIds.length > 0) {
      searchClauses.push({ timeSlotId: { in: timeSlotIds } });
    }
    where.OR = searchClauses;
  }

  if (andClauses.length > 0) {
    where.AND = andClauses;
  }

  const orderBy = buildOrderBy(sortField, sortDirection, ASSIGNMENT_SORT_FIELDS, [
    { timeSlot: { startTime: 'asc' } },
    { examId: 'asc' },
    { roomId: 'asc' },
    { proctorId: 'asc' },
    { id: 'asc' },
  ]);

  const [data, logicalTotal] = await Promise.all([
    listLogicalAssignmentPage({ where, orderBy, page, limit }),
    countLogicalAssignments(where),
  ]);

  return {
    data,
    meta: {
      ...buildMeta(logicalTotal, page, limit),
      logicalTotal,
      logicalTotalCount: logicalTotal,
    },
  };
};

export const getOne = async (scheduleId, assignmentId) => {
  await ensureScheduleExists(scheduleId);
  return loadAssignmentInSchedule(scheduleId, assignmentId);
};

export const update = async (scheduleId, assignmentId, payload) => {
  const schedule = await ensureScheduleExists(scheduleId);
  const { assignmentIds: requestedAssignmentIds, roomId, proctorId, proctorIds, timeSlotId, exam: examPatch } = payload;
  const existing = await loadAssignmentInSchedule(scheduleId, assignmentId);

  if (schedule.isFinal) {
    const requestedStatus = examPatch?.status;
    const isAllowedPublishedStatusUpdate =
      roomId === undefined &&
      proctorId === undefined &&
      timeSlotId === undefined &&
      examPatch !== undefined &&
      examPatch.duration === undefined &&
      PUBLISHED_ASSIGNMENT_STATUSES.includes(requestedStatus);

    if (!isAllowedPublishedStatusUpdate) {
      throw new AppError(
        'Published schedules only allow assignment status updates to Scheduled, Completed, or Cancelled.',
        403
      );
    }

    if (requestedStatus !== existing.exam?.status) {
      return prisma.$transaction(async (tx) => {
        await tx.exam.update({
          where: { id: existing.examId },
          data: { status: requestedStatus },
        });

        await synchronizeSchedules([scheduleId], tx);
        await createExamStatusChangeNotifications({ assignment: existing, newStatus: requestedStatus }, tx);

        return tx.examAssignment.findUnique({
          where: { id: assignmentId },
          select: assignmentSelect,
        });
      });
    }

    return prisma.examAssignment.findUnique({
      where: { id: assignmentId },
      select: assignmentSelect,
    });
  }

  const groupedAssignmentIds = requestedAssignmentIds?.length
    ? [...new Set(requestedAssignmentIds)]
    : [assignmentId];

  if (groupedAssignmentIds.length > 1 || Array.isArray(proctorIds)) {
    if (!groupedAssignmentIds.includes(assignmentId)) {
      throw new AppError('The edited assignment must be included in the selected assignment group.', 400);
    }

    const groupedAssignments = await loadAssignmentsInSchedule(scheduleId, groupedAssignmentIds);
    const examIds = new Set(groupedAssignments.map((assignment) => assignment.examId));
    if (examIds.size !== 1) {
      throw new AppError('Grouped assignment editing only supports rows from the same exam.', 400);
    }

    const nextProctorIds = Array.isArray(proctorIds)
      ? normalizeGroupedProctorIds({
          existingAssignments: groupedAssignments,
          requestedProctorIds: proctorIds,
        })
      : groupedAssignments.map((assignment, index) => (index === 0 && proctorId ? proctorId : assignment.proctorId));
    if (nextProctorIds.length !== groupedAssignments.length) {
      throw new AppError('Select one proctor for each existing assignment row in this exam.', 400);
    }

    const effectiveExamDuration = examPatch?.duration ?? existing.exam?.duration ?? 120;
    const effectiveTimeSlotIds = groupedAssignments.map((assignment) => timeSlotId ?? assignment.timeSlotId);
    const effectiveRoomIds = groupedAssignments.map((assignment) => roomId ?? assignment.roomId);

    const uniqueProctorIds = [...new Set(nextProctorIds)];
    const uniqueRoomIds = [...new Set(effectiveRoomIds)];
    const uniqueTimeSlotIds = [...new Set(effectiveTimeSlotIds)];

    await Promise.all([
      ...uniqueRoomIds.map((id) => ensureRoomExists(id)),
      ...uniqueProctorIds.map((id) => ensureProctorExists(id)),
      ...uniqueTimeSlotIds.map((id) => ensureTimeSlotExists(id)),
    ]);

    const roomEntries = await Promise.all(uniqueRoomIds.map(async (id) => [id, await validateRoomStatus(id)]));
    const proctorEntries = await Promise.all(uniqueProctorIds.map(async (id) => [id, await loadProctorForConstraintCheck(id)]));
    const timeSlotEntries = await Promise.all(uniqueTimeSlotIds.map(async (id) => [id, await loadTimeSlotForConstraintCheck(id)]));
    const roomMap = new Map(roomEntries);
    const proctorMap = new Map(proctorEntries);
    const timeSlotMap = new Map(timeSlotEntries);

    for (let index = 0; index < groupedAssignments.length; index += 1) {
      await assertProctorAvailableForTimeSlot({
        proctorId: nextProctorIds[index],
        timeSlotId: effectiveTimeSlotIds[index],
      });
    }

    const candidateAssignments = buildCandidateAssignmentsForValidation({
      existingAssignments: groupedAssignments,
      nextRoomId: roomId,
      roomMap,
      nextTimeSlotId: timeSlotId,
      timeSlotMap,
      nextProctorIds,
      proctorMap,
      duration: effectiveExamDuration,
    });

    const semester = existing.exam?.courseOffering?.semester;
    if (!semester) {
      throw new AppError('Exam semester could not be resolved for assignment validation.', 400);
    }
    for (const candidate of candidateAssignments) {
      validateSlotWindow(candidate.timeSlot, semester, effectiveExamDuration);
    }

    const otherAssignments = await loadOtherScheduleAssignmentsForValidation(scheduleId, groupedAssignmentIds);
    assertCandidateGroupAgainstFullSchedule({ candidates: candidateAssignments, otherAssignments });
    const candidateQuality = calculateCandidateGroupScheduleQuality({ candidates: candidateAssignments, otherAssignments });

    await prisma.$transaction(async (tx) => {
      const beforeCounts = await getScheduleAssignmentCounts(scheduleId, tx);

      for (let index = 0; index < groupedAssignments.length; index += 1) {
        const assignment = groupedAssignments[index];
        const assignmentData = {};
        if (roomId !== undefined && roomId !== assignment.roomId) assignmentData.roomId = roomId;
        if (timeSlotId !== undefined && timeSlotId !== assignment.timeSlotId) assignmentData.timeSlotId = timeSlotId;
        if (nextProctorIds[index] !== assignment.proctorId) assignmentData.proctorId = nextProctorIds[index];

        if (Object.keys(assignmentData).length > 0) {
          await tx.examAssignment.update({
            where: { id: assignment.id },
            data: assignmentData,
          });
        }
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

      const afterCounts = await getScheduleAssignmentCounts(scheduleId, tx);
      if (beforeCounts.raw !== afterCounts.raw || beforeCounts.logical !== afterCounts.logical) {
        throw new AppError(
          'Assignment update would change the schedule assignment count. Edit the whole assignment group or choose values that preserve the existing assignment identity.',
          400,
        );
      }

      await synchronizeSchedules([scheduleId], tx);
    });

    const updatedAssignment = await prisma.examAssignment.findUnique({
      where: { id: assignmentId },
      select: assignmentSelect,
    });

    return updatedAssignment
      ? {
          ...updatedAssignment,
          validation: {
            hardConstraints: 'satisfied',
            softConstraints: candidateQuality,
          },
        }
      : updatedAssignment;
  }

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
  await validateRoomCapacity({ scheduleId, assignmentId, room, examId: effective.examId, timeSlotId: effective.timeSlotId });
  validateSlotWindow(timeSlot, semester, effectiveExamDuration);
  await validateRoomAvailability({
    scheduleId,
    roomId: effective.roomId,
    timeSlotId: effective.timeSlotId,
    assignmentId,
    examId: effective.examId,
  });
  await validateRoomTemporalAvailability({ scheduleId, roomId: effective.roomId, timeSlot, assignmentId, examId: effective.examId });
  await validateProctorAvailability({
    scheduleId,
    proctorId: effective.proctorId,
    timeSlotId: effective.timeSlotId,
    assignmentId,
  });
  await validateProctorTemporalAvailability({ scheduleId, proctorId: effective.proctorId, timeSlot, assignmentId });
  await validateProctorDailyLoad({ scheduleId, proctor, timeSlot, assignmentId });
  await validateRequiredProctorCount({
    scheduleId,
    assignmentId,
    examId: effective.examId,
    timeSlotId: effective.timeSlotId,
    proctorId: effective.proctorId,
  });
  await validateStudentOverlap({
    scheduleId,
    examId: effective.examId,
    timeSlotId: effective.timeSlotId,
    assignmentId,
  });
  await validateStudentTemporalOverlap({ scheduleId, studentIds, timeSlot, assignmentId, examId: effective.examId });
  await validateStudentDailyLoad({ scheduleId, studentIds, timeSlot, assignmentId });

  const otherAssignments = await loadOtherScheduleAssignmentsForValidation(scheduleId, assignmentId);
  const candidateAssignment = buildCandidateAssignmentForValidation({
    existing,
    room,
    proctor,
    timeSlot,
    duration: effectiveExamDuration,
  });
  assertCandidateAgainstFullSchedule({ candidate: candidateAssignment, otherAssignments });
  const candidateQuality = calculateCandidateScheduleQuality({ candidate: candidateAssignment, otherAssignments });

  await prisma.$transaction(async (tx) => {
    const beforeCounts = await getScheduleAssignmentCounts(scheduleId, tx);

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

    const afterCounts = await getScheduleAssignmentCounts(scheduleId, tx);
    if (beforeCounts.raw !== afterCounts.raw || beforeCounts.logical !== afterCounts.logical) {
      throw new AppError(
        'Assignment update would change the schedule assignment count. Edit the whole assignment group or choose values that preserve the existing assignment identity.',
        400,
      );
    }

    await synchronizeSchedules([scheduleId], tx);
  });

  const updatedAssignment = await prisma.examAssignment.findUnique({
    where: { id: assignmentId },
    select: assignmentSelect,
  });

  return updatedAssignment
    ? {
        ...updatedAssignment,
        validation: {
          hardConstraints: 'satisfied',
          softConstraints: candidateQuality,
        },
      }
    : updatedAssignment;
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

  await prisma.$transaction(async (tx) => {
    if (options.deleteGroup) {
      await tx.examAssignment.deleteMany({
        where: {
          scheduleId,
          examId: existing.examId,
          timeSlotId: existing.timeSlotId,
        },
      });
      await synchronizeSchedules([scheduleId], tx);
      return;
    }

    // Delete only the join row — related Exam/Course/Room/Proctor/TimeSlot
    // entities are intentionally left intact.
    await tx.examAssignment.delete({ where: { id: assignmentId } });
    await synchronizeSchedules([scheduleId], tx);
  });
};
