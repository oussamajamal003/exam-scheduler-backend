import prisma from '../../config/prisma.js';
import { AppError } from '../../utils/AppError.js';
import { getScheduleAnalysis } from '../scheduling/schedulingService.js';
import {
  NOTIFICATION_TYPES,
  createSchedulePublicationNotifications,
} from '../notifications/notificationsService.js';

const GENERATED_STAGE = 'GENERATED';
const BLOCKED_STAGE = 'BLOCKED';
const AVAILABLE_ROOM_STATUS = 'AVAILABLE';
const PROCTOR_RATIO = 20;

const ACTIVE_REGISTRATION_STATUSES = new Set(['ACTIVE']);

const isActiveRegistration = (registration) => {
  if (!registration) return false;
  if (registration.status == null) return true;
  return ACTIVE_REGISTRATION_STATUSES.has(String(registration.status).toUpperCase());
};

const toDateKey = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
};

const timeRangesOverlap = (startA, endA, startB, endB) => {
  const leftStart = new Date(startA).getTime();
  const leftEnd = new Date(endA).getTime();
  const rightStart = new Date(startB).getTime();
  const rightEnd = new Date(endB).getTime();

  if ([leftStart, leftEnd, rightStart, rightEnd].some(Number.isNaN)) return false;
  return leftStart < rightEnd && rightStart < leftEnd;
};

const getRequiredSeatsForExam = (exam) => {
  const registrations = exam?.courseOffering?.registrations ?? [];
  return registrations.filter(isActiveRegistration).length;
};

const getRequiredProctorCount = (exam) => {
  const enrolledCount = getRequiredSeatsForExam(exam);
  return Math.max(1, Math.ceil(enrolledCount / PROCTOR_RATIO));
};

const mergeMetadata = (schedule, syncMetadata) => ({
  ...(schedule.algorithmMetadata && typeof schedule.algorithmMetadata === 'object' ? schedule.algorithmMetadata : {}),
  scheduleSync: syncMetadata,
});

const buildImpactedSchedulesWhere = (dependency, ids) => {
  switch (dependency) {
    case 'room':
      return { roomId: { in: ids } };
    case 'proctor':
      return { proctorId: { in: ids } };
    case 'timeSlot':
      return { timeSlotId: { in: ids } };
    case 'center':
      return { room: { centerId: { in: ids } } };
    case 'course':
      return { exam: { courseOffering: { courseId: { in: ids } } } };
    case 'courseOffering':
      return { exam: { courseOfferingId: { in: ids } } };
    case 'semester':
      return { exam: { courseOffering: { semesterId: { in: ids } } } };
    case 'student':
      return { exam: { courseOffering: { registrations: { some: { studentId: { in: ids } } } } } };
    case 'program':
      return {
        OR: [
          { exam: { courseOffering: { course: { programId: { in: ids } } } } },
          { exam: { courseOffering: { registrations: { some: { student: { programId: { in: ids } } } } } } },
        ],
      };
    case 'department':
      return {
        OR: [
          { exam: { courseOffering: { course: { program: { departmentId: { in: ids } } } } } },
          { exam: { courseOffering: { registrations: { some: { student: { program: { departmentId: { in: ids } } } } } } } },
        ],
      };
    default:
      throw new Error(`Unsupported schedule dependency: ${dependency}`);
  }
};

const buildCleanupWhere = (dependency, ids) => {
  switch (dependency) {
    case 'room':
      return { roomId: { in: ids } };
    case 'proctor':
      return { proctorId: { in: ids } };
    case 'timeSlot':
      return { timeSlotId: { in: ids } };
    case 'center':
      return { room: { centerId: { in: ids } } };
    default:
      return null;
  }
};

const scheduleSyncInclude = {
  assignments: {
    include: {
      room: {
        select: {
          id: true,
          capacity: true,
          status: true,
        },
      },
      proctor: {
        select: {
          id: true,
          maxExamsPerDay: true,
          availableTimeSlots: {
            select: {
              timeSlotId: true,
            },
          },
        },
      },
      timeSlot: {
        select: {
          id: true,
          startTime: true,
          endTime: true,
          date: true,
          duration: true,
        },
      },
      exam: {
        select: {
          id: true,
          duration: true,
          courseOffering: {
            select: {
              id: true,
              semesterId: true,
              semester: {
                select: {
                  id: true,
                  startDate: true,
                  endDate: true,
                },
              },
              registrations: {
                select: {
                  studentId: true,
                  status: true,
                },
              },
            },
          },
        },
      },
    },
  },
};

const buildScheduleIssueSummary = async (schedule, client) => {
  const semesterIds = new Set(
    schedule.assignments
      .map((assignment) => assignment.exam?.courseOffering?.semesterId)
      .filter(Boolean),
  );

  const examGroups = new Map();
  const invalidRoomAssignments = new Set();
  const invalidProctorAvailability = new Set();
  const invalidSlotWindowAssignments = new Set();
  const emptySchedule = schedule.assignments.length === 0 ? 1 : 0;
  const multiSemesterAssignments = semesterIds.size > 1 ? 1 : 0;

  for (const assignment of schedule.assignments) {
    const slot = assignment.timeSlot;
    const room = assignment.room;
    const proctor = assignment.proctor;
    const exam = assignment.exam;
    const semester = exam?.courseOffering?.semester;

    if (!room || room.status !== AVAILABLE_ROOM_STATUS) {
      invalidRoomAssignments.add(assignment.id);
    }

    const availableSlotIds = new Set((proctor?.availableTimeSlots ?? []).map((entry) => entry.timeSlotId));
    if (!slot || !proctor || !availableSlotIds.has(slot.id)) {
      invalidProctorAvailability.add(assignment.id);
    }

    const slotStart = new Date(slot?.startTime);
    const slotEnd = new Date(slot?.endTime);
    const semesterStart = new Date(semester?.startDate);
    const semesterEnd = new Date(semester?.endDate);
    const slotDuration = Math.round((slotEnd.getTime() - slotStart.getTime()) / 60000);
    const examDuration = exam?.duration ?? 120;

    const hasInvalidWindow = (
      Number.isNaN(slotStart.getTime())
      || Number.isNaN(slotEnd.getTime())
      || Number.isNaN(semesterStart.getTime())
      || Number.isNaN(semesterEnd.getTime())
      || slotStart < semesterStart
      || slotEnd > semesterEnd
      || slotDuration < examDuration
    );

    if (hasInvalidWindow) {
      invalidSlotWindowAssignments.add(assignment.id);
    }

    const groupKey = `${assignment.examId}:${assignment.timeSlotId}`;
    const group = examGroups.get(groupKey) ?? {
      exam: assignment.exam,
      proctorIds: new Set(),
    };
    group.proctorIds.add(assignment.proctorId);
    examGroups.set(groupKey, group);
  }

  let missingExamAssignments = 0;
  if (semesterIds.size === 1) {
    const [semesterId] = [...semesterIds];
    const [scheduledExamIds, semesterExamRows] = await Promise.all([
      client.examAssignment.findMany({
        where: { scheduleId: schedule.id },
        select: { examId: true },
        distinct: ['examId'],
      }),
      client.exam.findMany({
        where: { courseOffering: { semesterId } },
        select: { id: true },
      }),
    ]);

    const scheduledExamIdSet = new Set(scheduledExamIds.map((row) => row.examId));
    missingExamAssignments = semesterExamRows.filter((row) => !scheduledExamIdSet.has(row.id)).length;
  }

  let requiredProctorShortage = 0;
  for (const group of examGroups.values()) {
    const required = getRequiredProctorCount(group.exam);
    if (group.proctorIds.size < required) {
      requiredProctorShortage += required - group.proctorIds.size;
    }
  }

  const analysis = await getScheduleAnalysis(schedule.id, client);
  const hardConstraintScore =
    analysis.metrics.totalConflicts
    + invalidRoomAssignments.size
    + invalidProctorAvailability.size
    + invalidSlotWindowAssignments.size
    + missingExamAssignments
    + requiredProctorShortage
    + multiSemesterAssignments
    + emptySchedule;

  return {
    hardConstraintScore,
    qualityScore: hardConstraintScore === 0
      ? Number((analysis.metrics.averageRoomUtilization * 100).toFixed(2))
      : Math.max(0, Number((100 - hardConstraintScore * 10).toFixed(2))),
    generationStage: hardConstraintScore === 0 ? GENERATED_STAGE : BLOCKED_STAGE,
    syncMetadata: {
      syncedAt: new Date().toISOString(),
      assignmentCount: schedule.assignments.length,
      semesterIds: [...semesterIds],
      averageRoomUtilization: analysis.metrics.averageRoomUtilization,
      issues: {
        emptySchedule,
        multiSemesterAssignments,
        missingExamAssignments,
        invalidRoomAssignments: invalidRoomAssignments.size,
        invalidProctorAvailability: invalidProctorAvailability.size,
        invalidSlotWindowAssignments: invalidSlotWindowAssignments.size,
        requiredProctorShortage,
        derivedConflicts: analysis.metrics.totalConflicts,
      },
    },
  };
};

export const findImpactedScheduleIds = async ({ dependency, ids }, client = prisma) => {
  const normalizedIds = [...new Set((ids ?? []).filter(Boolean))];
  if (normalizedIds.length === 0) return [];

  const rows = await client.examAssignment.findMany({
    where: buildImpactedSchedulesWhere(dependency, normalizedIds),
    select: { scheduleId: true },
    distinct: ['scheduleId'],
  });

  return rows.map((row) => row.scheduleId);
};

export const removeAssignmentsForDependencyDelete = async ({ dependency, ids }, client = prisma) => {
  const normalizedIds = [...new Set((ids ?? []).filter(Boolean))];
  if (normalizedIds.length === 0) return 0;

  const where = buildCleanupWhere(dependency, normalizedIds);
  if (!where) return 0;

  const result = await client.examAssignment.deleteMany({ where });
  return result.count ?? 0;
};

export const countScheduleAssignmentsForDependency = async ({ dependency, ids }, client = prisma) => {
  const normalizedIds = [...new Set((ids ?? []).filter(Boolean))];
  if (normalizedIds.length === 0) return 0;

  return client.examAssignment.count({
    where: buildImpactedSchedulesWhere(dependency, normalizedIds),
  });
};

export const assertNoScheduleAssignmentsForDependency = async ({ dependency, ids, entityLabel, message }, client = prisma) => {
  const count = await countScheduleAssignmentsForDependency({ dependency, ids }, client);
  if (count > 0) {
    if (message) {
      throw new AppError(message, 409);
    }

    const assignmentLabel = count === 1 ? 'schedule assignment' : 'schedule assignments';
    throw new AppError(`Cannot delete ${entityLabel} - referenced by ${count} ${assignmentLabel}.`, 409);
  }
};

export const synchronizeSchedules = async (scheduleIds, client = prisma) => {
  const normalizedScheduleIds = [...new Set((scheduleIds ?? []).filter(Boolean))];
  if (normalizedScheduleIds.length === 0) return [];

  const schedules = await client.schedule.findMany({
    where: { id: { in: normalizedScheduleIds } },
    include: scheduleSyncInclude,
  });

  const updated = [];
  for (const schedule of schedules) {
    const summary = await buildScheduleIssueSummary(schedule, client);
    const shouldAutoUnpublish = schedule.isFinal && summary.hardConstraintScore > 0;
    const syncMetadata = {
      ...summary.syncMetadata,
      autoUnpublished: shouldAutoUnpublish,
      publishedStateBeforeSync: !!schedule.isFinal,
    };

    const record = await client.schedule.update({
      where: { id: schedule.id },
      data: {
        ...(shouldAutoUnpublish ? { isFinal: false } : {}),
        generationStage: summary.generationStage,
        qualityScore: summary.qualityScore,
        hardConstraintScore: summary.hardConstraintScore,
        algorithmMetadata: mergeMetadata(schedule, syncMetadata),
      },
    });

    if (shouldAutoUnpublish) {
      await createSchedulePublicationNotifications({
        scheduleId: schedule.id,
        eventType: NOTIFICATION_TYPES.SCHEDULE_UNPUBLISHED,
        scheduleVersion: schedule.publishedVersion ?? 0,
        client,
      });
    }

    updated.push(record);
  }

  return updated;
};