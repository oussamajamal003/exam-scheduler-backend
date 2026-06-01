import { randomUUID } from 'crypto';
import prisma from '../../config/prisma.js';
import { AppError } from '../../utils/AppError.js';

export const NOTIFICATION_TYPES = {
  SCHEDULE_PUBLISHED: 'SCHEDULE_PUBLISHED',
  SCHEDULE_UNPUBLISHED: 'SCHEDULE_UNPUBLISHED',
  SCHEDULE_REPUBLISHED: 'SCHEDULE_REPUBLISHED',
  SCHEDULE_UPDATED: 'SCHEDULE_UPDATED',
  ROOM_TIME_CHANGE: 'ROOM_TIME_CHANGE',
  ANNOUNCEMENT: 'ANNOUNCEMENT',
  NEW_DUTY_ASSIGNED: 'NEW_DUTY_ASSIGNED',
  SCHEDULE_EXAM_CANCELLED: 'SCHEDULE_EXAM_CANCELLED',
  SCHEDULE_EXAM_COMPLETED: 'SCHEDULE_EXAM_COMPLETED',
};

const SCHEDULE_VISIBILITY_TYPES = [
  NOTIFICATION_TYPES.SCHEDULE_PUBLISHED,
  NOTIFICATION_TYPES.SCHEDULE_UNPUBLISHED,
  NOTIFICATION_TYPES.SCHEDULE_REPUBLISHED,
  NOTIFICATION_TYPES.SCHEDULE_UPDATED,
  NOTIFICATION_TYPES.ROOM_TIME_CHANGE,
  NOTIFICATION_TYPES.NEW_DUTY_ASSIGNED,
  NOTIFICATION_TYPES.SCHEDULE_EXAM_CANCELLED,
  NOTIFICATION_TYPES.SCHEDULE_EXAM_COMPLETED,
];

const normalizeLimit = (value, fallback = 20) => {
  const limit = Number(value);
  if (!Number.isFinite(limit)) return fallback;
  return Math.min(Math.max(Math.trunc(limit), 1), 100);
};

const getScheduleFromMetadata = (metadata) => {
  const schedule = metadata?.schedule;
  if (!schedule || typeof schedule !== 'object') return null;

  return {
    id: schedule.id ?? metadata?.scheduleId ?? '',
    name: schedule.name ?? metadata?.scheduleName ?? null,
    examPeriod: schedule.examPeriod ?? metadata?.examPeriod ?? null,
    isFinal: schedule.isFinal ?? true,
  };
};

const mapNotification = (row) => {
  const metadata = row.metadata ?? null;
  const schedule = getScheduleFromMetadata(metadata);

  return {
    id: row.id,
    userId: row.userId,
    type: row.type,
    title: row.title,
    message: row.message,
    metadata,
    readAt: row.readAt,
    createdAt: row.createdAt,
    updatedAt: row.readAt ?? row.createdAt,
    scheduleId: metadata?.scheduleId ?? schedule?.id ?? null,
    schedule,
  };
};

export const listForUser = async (user, query = {}) => {
  if (!user?.id) throw new AppError('Authenticated user not found.', 401);

  const limit = normalizeLimit(query.limit);
  const unreadOnly = query.unreadOnly === 'true' || query.unreadOnly === true;
  const where = await buildVisibleNotificationWhere(user, {
    userId: user.id,
    ...(unreadOnly ? { readAt: null } : {}),
  });

  const [rows, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    }),
    prisma.notification.count({
      where: await buildVisibleNotificationWhere(user, { userId: user.id, readAt: null }),
    }),
  ]);

  return {
    notifications: rows.map(mapNotification),
    unreadCount,
  };
};

const getPublishedAssignedScheduleIds = async (user) => {
  const roleFilters = [];

  if (user?.studentId) {
    roleFilters.push({
      exam: {
        courseOffering: {
          registrations: {
            some: {
              studentId: user.studentId,
              status: { not: 'INACTIVE' },
            },
          },
        },
      },
    });
  }

  if (user?.proctorId) {
    roleFilters.push({ proctorId: user.proctorId });
  }

  if (roleFilters.length === 0) return null;

  const assignments = await prisma.examAssignment.findMany({
    where: {
      schedule: { isFinal: true },
      OR: roleFilters,
    },
    select: { scheduleId: true },
    distinct: ['scheduleId'],
  });

  return assignments.map((assignment) => assignment.scheduleId).filter(Boolean);
};

const buildVisibleNotificationWhere = async (user, baseWhere) => {
  const publishedScheduleIds = await getPublishedAssignedScheduleIds(user);
  if (!publishedScheduleIds) return baseWhere;

  return {
    AND: [
      baseWhere,
      {
        OR: [
          { type: { notIn: SCHEDULE_VISIBILITY_TYPES } },
          { scheduleId: { in: publishedScheduleIds } },
        ],
      },
    ],
  };
};

export const markReadForUser = async (user, notificationId) => {
  if (!user?.id) throw new AppError('Authenticated user not found.', 401);

  const existing = await prisma.notification.findFirst({
    where: await buildVisibleNotificationWhere(user, { id: notificationId, userId: user.id }),
  });

  if (!existing) throw new AppError('Notification not found', 404);

  const updated = existing.readAt
    ? existing
    : await prisma.notification.update({
        where: { id: notificationId },
        data: { readAt: new Date() },
      });

  return mapNotification(updated);
};

export const markAllReadForUser = async (user) => {
  if (!user?.id) throw new AppError('Authenticated user not found.', 401);

  const result = await prisma.notification.updateMany({
    where: await buildVisibleNotificationWhere(user, { userId: user.id, readAt: null }),
    data: { readAt: new Date() },
  });

  return { updatedCount: result.count };
};

const buildScheduleMetadata = (schedule, role, entries, { isFinal = true, scheduleVersion = null } = {}) => ({
  recipientRole: role,
  scheduleId: schedule.id,
  scheduleName: schedule.name,
  examPeriod: schedule.examPeriod,
  scheduleVersion,
  schedule: {
    id: schedule.id,
    name: schedule.name,
    examPeriod: schedule.examPeriod,
    isFinal,
  },
  assignmentCount: entries.length,
  assignments: entries,
});

const getScheduleUpdateChangeSummary = (schedule) => schedule?.algorithmMetadata?.scheduleSync?.changeSummary ?? null;

const getScheduleUpdateCopy = (schedule, role, count) => {
  const changeSummary = getScheduleUpdateChangeSummary(schedule);
  const categories = new Set(changeSummary?.categories ?? []);
  const hasRoomTimeChange = categories.has('roomTime');
  const hasProctorChange = categories.has('proctor');
  const hasExamChange = categories.has('exam');

  if (role === 'STUDENT') {
    if (hasRoomTimeChange && hasProctorChange) {
      return {
        title: 'Exam schedule updated',
        message: `${schedule.name} updated room, time, and proctor details for ${count} ${count === 1 ? 'exam' : 'exams'} in your registered courses.`,
      };
    }

    if (hasRoomTimeChange) {
      return {
        title: 'Room or time updated',
        message: `${schedule.name} updated room or time details for ${count} ${count === 1 ? 'exam' : 'exams'} in your registered courses.`,
      };
    }

    if (hasProctorChange) {
      return {
        title: 'Exam proctor updated',
        message: `${schedule.name} updated proctor details for ${count} ${count === 1 ? 'exam' : 'exams'} in your registered courses.`,
      };
    }

    if (hasExamChange) {
      return {
        title: 'Exam details updated',
        message: `${schedule.name} updated exam details for ${count} ${count === 1 ? 'exam' : 'exams'} in your registered courses.`,
      };
    }

    return {
      title: 'Exam schedule updated',
      message: `${schedule.name} has updated details for ${count} ${count === 1 ? 'exam' : 'exams'} in your registered courses. Please review the latest schedule.`,
    };
  }

  if (hasRoomTimeChange && hasProctorChange) {
    return {
      title: 'Proctor duties updated',
      message: `${schedule.name} updated room, time, and proctor details for ${count} ${count === 1 ? 'assigned duty' : 'assigned duties'} in your published roster.`,
    };
  }

  if (hasRoomTimeChange) {
    return {
      title: 'Room or time updated',
      message: `${schedule.name} updated room or time details for ${count} ${count === 1 ? 'assigned duty' : 'assigned duties'} in your published roster.`,
    };
  }

  if (hasProctorChange) {
    return {
      title: 'Proctor assignment updated',
      message: `${schedule.name} updated proctor details for ${count} ${count === 1 ? 'assigned duty' : 'assigned duties'} in your published roster.`,
    };
  }

  if (hasExamChange) {
    return {
      title: 'Proctor duties updated',
      message: `${schedule.name} updated assignment details for ${count} ${count === 1 ? 'assigned duty' : 'assigned duties'} in your published roster.`,
    };
  }

  return {
    title: 'Proctor duties updated',
    message: `${schedule.name} updated ${count} ${count === 1 ? 'assigned duty' : 'assigned duties'} in your published roster.`,
  };
};

const buildStudentEntries = (schedule) => {
  const recipients = new Map();

  for (const assignment of schedule.assignments) {
    const offering = assignment.exam?.courseOffering;
    for (const registration of offering?.registrations ?? []) {
      const userId = registration.student?.user?.id;
      if (!userId) continue;
      const items = recipients.get(userId) ?? [];
      items.push({
        assignmentId: assignment.id,
        studentId: registration.student?.id ?? registration.studentId ?? null,
        courseCode: offering?.course?.code ?? null,
        courseTitle: offering?.course?.title ?? null,
        roomName: assignment.room?.name ?? null,
        centerName: assignment.room?.center?.name ?? null,
        startsAt: assignment.timeSlot?.startTime ?? null,
        endsAt: assignment.timeSlot?.endTime ?? null,
      });
      recipients.set(userId, items);
    }
  }

  return recipients;
};

const buildProctorEntries = (schedule) => {
  const recipients = new Map();

  for (const assignment of schedule.assignments) {
    const userId = assignment.proctor?.user?.id;
    if (!userId) continue;

    const items = recipients.get(userId) ?? [];
    items.push({
      assignmentId: assignment.id,
      proctorId: assignment.proctor?.id ?? null,
      courseCode: assignment.exam?.courseOffering?.course?.code ?? null,
      courseTitle: assignment.exam?.courseOffering?.course?.title ?? null,
      roomName: assignment.room?.name ?? null,
      centerName: assignment.room?.center?.name ?? null,
      startsAt: assignment.timeSlot?.startTime ?? null,
      endsAt: assignment.timeSlot?.endTime ?? null,
      studentCount: assignment.exam?.courseOffering?.registrations?.length ?? assignment.exam?.courseOffering?.expectedStudents ?? 0,
    });
    recipients.set(userId, items);
  }

  return recipients;
};

const createNotifications = async (rows, client = prisma) => {
  if (rows.length === 0) return { count: 0 };
  // skipDuplicates relies on the (userId, type, scheduleId, scheduleVersion)
  // unique constraint so a retried publish/unpublish cannot insert duplicates.
  const result = await client.notification.createMany({ data: rows, skipDuplicates: true });
  return { count: result.count };
};

const preferenceKeyByType = {
  [NOTIFICATION_TYPES.SCHEDULE_PUBLISHED]: 'schedulePublishedNotifications',
  [NOTIFICATION_TYPES.SCHEDULE_UNPUBLISHED]: 'schedulePublishedNotifications',
  [NOTIFICATION_TYPES.SCHEDULE_REPUBLISHED]: 'schedulePublishedNotifications',
  [NOTIFICATION_TYPES.SCHEDULE_UPDATED]: 'examAssignmentUpdates',
  [NOTIFICATION_TYPES.SCHEDULE_EXAM_CANCELLED]: 'examAssignmentUpdates',
  [NOTIFICATION_TYPES.SCHEDULE_EXAM_COMPLETED]: 'examAssignmentUpdates',
  [NOTIFICATION_TYPES.NEW_DUTY_ASSIGNED]: 'examAssignmentUpdates',
  [NOTIFICATION_TYPES.ROOM_TIME_CHANGE]: 'roomTimeChanges',
  [NOTIFICATION_TYPES.ANNOUNCEMENT]: 'announcementsMessages',
};

const filterRowsByPreferences = async (rows, type, client = prisma) => {
  const preferenceKey = preferenceKeyByType[type];
  if (!preferenceKey || rows.length === 0) return rows;

  const settings = await client.userSettings.findMany({
    where: { userId: { in: rows.map((row) => row.userId) } },
    select: { userId: true, [preferenceKey]: true },
  });

  const preferencesByUserId = new Map(settings.map((setting) => [setting.userId, setting[preferenceKey]]));
  return rows.filter((row) => preferencesByUserId.get(row.userId) !== false);
};

const SCHEDULE_LIFECYCLE_COPY = {
  [NOTIFICATION_TYPES.SCHEDULE_PUBLISHED]: {
    studentTitle: 'Schedule published',
    proctorTitle: 'New published exam duties',
    studentMessage: (schedule, count) =>
      `${schedule.name} is now published with ${count} ${count === 1 ? 'exam' : 'exams'} in your registered courses.`,
    proctorMessage: (schedule, count) =>
      `${schedule.name} is now published with ${count} ${count === 1 ? 'assigned duty' : 'assigned duties'} for you.`,
  },
  [NOTIFICATION_TYPES.SCHEDULE_REPUBLISHED]: {
    studentTitle: 'Schedule republished',
    proctorTitle: 'Schedule republished',
    studentMessage: (schedule, count) =>
      `${schedule.name} has been republished with ${count} ${count === 1 ? 'exam' : 'exams'} in your registered courses. Please review for any changes.`,
    proctorMessage: (schedule, count) =>
      `${schedule.name} has been republished with ${count} ${count === 1 ? 'assigned duty' : 'assigned duties'} for you. Please review for any changes.`,
  },
  [NOTIFICATION_TYPES.SCHEDULE_UNPUBLISHED]: {
    studentTitle: 'Schedule unpublished',
    proctorTitle: 'Schedule unpublished',
    studentMessage: (schedule, count) =>
      `${schedule.name} has been returned to draft. Your ${count} ${count === 1 ? 'previously scheduled exam' : 'previously scheduled exams'} are no longer final.`,
    proctorMessage: (schedule, count) =>
      `${schedule.name} has been returned to draft. Your ${count} ${count === 1 ? 'previously assigned duty is' : 'previously assigned duties are'} no longer final.`,
  },
  [NOTIFICATION_TYPES.SCHEDULE_UPDATED]: {
    studentTitle: 'Exam schedule updated',
    proctorTitle: 'Proctor duties updated',
    studentMessage: (schedule, count) =>
      `${schedule.name} has updated room or time details for ${count} ${count === 1 ? 'exam' : 'exams'} in your registered courses.`,
    proctorMessage: (schedule, count) =>
      `${schedule.name} updated ${count} assigned ${count === 1 ? 'duty' : 'duties'} in your published roster.`,
  },
  [NOTIFICATION_TYPES.ROOM_TIME_CHANGE]: {
    studentTitle: 'Exam schedule updated',
    proctorTitle: 'Proctor duties updated',
    studentMessage: (schedule, count) =>
      `${schedule.name} has updated room or time details for ${count} ${count === 1 ? 'exam' : 'exams'} in your registered courses.`,
    proctorMessage: (schedule, count) =>
      `${schedule.name} updated ${count} assigned ${count === 1 ? 'duty' : 'duties'} in your published roster.`,
  },
  [NOTIFICATION_TYPES.SCHEDULE_EXAM_CANCELLED]: {
    studentTitle: 'Exam Cancelled',
    proctorTitle: 'Exam Cancelled',
    studentMessage: (schedule, courseTitle) =>
      `${courseTitle ?? 'An exam'} in ${schedule.name ?? 'the published schedule'} has been cancelled.`,
    proctorMessage: (schedule, courseTitle) =>
      `Your proctoring duty for ${courseTitle ?? 'an exam'} in ${schedule.name ?? 'the published schedule'} has been cancelled.`,
  },
  [NOTIFICATION_TYPES.SCHEDULE_EXAM_COMPLETED]: {
    studentTitle: 'Exam Completed',
    proctorTitle: 'Exam Completed',
    studentMessage: (schedule, courseTitle) =>
      `${courseTitle ?? 'An exam'} in ${schedule.name ?? 'the published schedule'} has been marked as completed.`,
    proctorMessage: (schedule, courseTitle) =>
      `Your proctoring duty for ${courseTitle ?? 'an exam'} in ${schedule.name ?? 'the published schedule'} has been marked as completed.`,
  },
};

export const createSchedulePublicationNotifications = async ({
  scheduleId,
  eventType,
  notificationType,
  scheduleVersion = null,
  client = prisma,
}) => {
  const type = eventType ?? notificationType ?? NOTIFICATION_TYPES.SCHEDULE_PUBLISHED;
  const copy = SCHEDULE_LIFECYCLE_COPY[type];
  if (!copy) {
    throw new AppError(`Unsupported schedule notification type: ${type}`, 400);
  }

  const schedule = await client.schedule.findUnique({
    where: { id: scheduleId },
    select: {
      id: true,
      name: true,
      examPeriod: true,
      publishedVersion: true,
      algorithmMetadata: true,
      assignments: {
        select: {
          id: true,
          timeSlot: { select: { startTime: true, endTime: true } },
          room: { select: { name: true, center: { select: { name: true } } } },
          proctor: { select: { id: true, user: { select: { id: true, name: true } } } },
          exam: {
            select: {
              courseOffering: {
                select: {
                  id: true,
                  expectedStudents: true,
                  course: { select: { code: true, title: true } },
                  registrations: {
                    where: { status: { not: 'INACTIVE' } },
                    select: {
                      id: true,
                      studentId: true,
                      student: { select: { id: true, user: { select: { id: true, name: true } } } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!schedule) throw new AppError('Schedule not found', 404);

  const resolvedVersion = scheduleVersion ?? schedule.publishedVersion ?? null;
  const isFinalAfterEvent = type !== NOTIFICATION_TYPES.SCHEDULE_UNPUBLISHED;

  // Only users with an actual assignment in the published schedule receive a
  // notification. Students without assigned exams and proctors without duties
  // are intentionally excluded.
  const studentRecipients = buildStudentEntries(schedule);
  const proctorRecipients = buildProctorEntries(schedule);

  const metadataOptions = { isFinal: isFinalAfterEvent, scheduleVersion: resolvedVersion };
  const updateCopyForStudent = type === NOTIFICATION_TYPES.SCHEDULE_UPDATED || type === NOTIFICATION_TYPES.ROOM_TIME_CHANGE
    ? getScheduleUpdateCopy(schedule, 'STUDENT', 0)
    : null;
  const updateCopyForProctor = type === NOTIFICATION_TYPES.SCHEDULE_UPDATED || type === NOTIFICATION_TYPES.ROOM_TIME_CHANGE
    ? getScheduleUpdateCopy(schedule, 'PROCTOR', 0)
    : null;

  const studentNotifications = Array.from(studentRecipients.entries()).map(([userId, entries]) => ({
    id: randomUUID(),
    userId,
    type,
    title: updateCopyForStudent?.title ?? copy.studentTitle,
    message: updateCopyForStudent
      ? getScheduleUpdateCopy(schedule, 'STUDENT', entries.length).message
      : copy.studentMessage(schedule, entries.length),
    metadata: buildScheduleMetadata(schedule, 'STUDENT', entries, metadataOptions),
    scheduleId: schedule.id,
    scheduleVersion: resolvedVersion,
  }));

  const proctorNotifications = Array.from(proctorRecipients.entries()).map(([userId, entries]) => ({
    id: randomUUID(),
    userId,
    type,
    title: updateCopyForProctor?.title ?? copy.proctorTitle,
    message: updateCopyForProctor
      ? getScheduleUpdateCopy(schedule, 'PROCTOR', entries.length).message
      : copy.proctorMessage(schedule, entries.length),
    metadata: buildScheduleMetadata(schedule, 'PROCTOR', entries, metadataOptions),
    scheduleId: schedule.id,
    scheduleVersion: resolvedVersion,
  }));

  const [filteredStudentNotifications, filteredProctorNotifications] = await Promise.all([
    filterRowsByPreferences(studentNotifications, type, client),
    filterRowsByPreferences(proctorNotifications, type, client),
  ]);

  const [studentResult, proctorResult] = await Promise.all([
    createNotifications(filteredStudentNotifications, client),
    createNotifications(filteredProctorNotifications, client),
  ]);

  return {
    eventType: type,
    scheduleVersion: resolvedVersion,
    affectedStudentCount: studentRecipients.size,
    affectedProctorCount: proctorRecipients.size,
    insertedStudentNotifications: studentResult.count,
    insertedProctorNotifications: proctorResult.count,
  };
};

/**
 * Replaces targeted status notifications for the students and proctor of a
 * single exam assignment when its status changes within a published schedule.
 *
 * Only students with an ACTIVE registration in the exam's course offering
 * receive a notification. The proctor assigned to this specific assignment row
 * also receives one.
 *
 * @param {{ assignment: object, newStatus: 'SCHEDULED'|'COMPLETED'|'CANCELLED' }} params
 * @param {import('@prisma/client').PrismaClient} [client]
 */
export const createExamStatusChangeNotifications = async ({ assignment, newStatus }, client = prisma) => {
  const statusTypes = [
    NOTIFICATION_TYPES.SCHEDULE_EXAM_CANCELLED,
    NOTIFICATION_TYPES.SCHEDULE_EXAM_COMPLETED,
  ];
  const type =
    newStatus === 'CANCELLED'
      ? NOTIFICATION_TYPES.SCHEDULE_EXAM_CANCELLED
      : newStatus === 'COMPLETED'
        ? NOTIFICATION_TYPES.SCHEDULE_EXAM_COMPLETED
        : null;

  const copy = type ? SCHEDULE_LIFECYCLE_COPY[type] : null;
  if (type && !copy) throw new AppError(`Unsupported exam status notification type: ${type}`, 400);

  const scheduleRef = {
    id: assignment.scheduleId,
    name: assignment.schedule?.name ?? null,
    examPeriod: assignment.schedule?.examPeriod ?? null,
    isFinal: assignment.schedule?.isFinal ?? true,
  };

  const courseTitle = assignment.exam?.courseOffering?.course?.title ?? null;
  const courseCode = assignment.exam?.courseOffering?.course?.code ?? null;

  const metadataBase = {
    scheduleId: assignment.scheduleId,
    scheduleName: assignment.schedule?.name ?? null,
    examId: assignment.examId,
    assignmentId: assignment.id,
    courseTitle,
    courseCode,
    roomName: assignment.room?.name ?? null,
    centerName: assignment.room?.center?.name ?? null,
    startsAt: assignment.timeSlot?.startTime ?? null,
    endsAt: assignment.timeSlot?.endTime ?? null,
    schedule: scheduleRef,
  };

  const relatedAssignmentRows = await client.examAssignment.findMany({
    where: {
      scheduleId: assignment.scheduleId,
      examId: assignment.examId,
      timeSlotId: assignment.timeSlotId,
    },
    select: {
      id: true,
      proctor: { select: { id: true, user: { select: { id: true } } } },
    },
  });
  const relatedAssignmentIds = [...new Set([assignment.id, ...relatedAssignmentRows.map((row) => row.id)])];

  // One notification per enrolled student (skip INACTIVE registrations).
  const studentRows = [];
  const recipientUserIds = [];
  for (const reg of assignment.exam?.courseOffering?.registrations ?? []) {
    if (reg.status === 'INACTIVE') continue;
    const userId = reg.student?.user?.id;
    if (!userId) continue;
    recipientUserIds.push(userId);
    if (!type) continue;
    studentRows.push({
      id: randomUUID(),
      userId,
      type,
      title: copy.studentTitle,
      message: copy.studentMessage(scheduleRef, courseTitle),
      metadata: { ...metadataBase, recipientRole: 'STUDENT', studentId: reg.studentId },
      scheduleId: assignment.scheduleId,
      scheduleVersion: null,
      assignmentId: assignment.id,
    });
  }

  // One notification for each proctor attached to this logical assignment.
  const proctorRows = [];
  for (const relatedAssignment of relatedAssignmentRows) {
    const proctorUserId = relatedAssignment.proctor?.user?.id;
    if (!proctorUserId) continue;
    recipientUserIds.push(proctorUserId);
    if (!type) continue;
    proctorRows.push({
      id: randomUUID(),
      userId: proctorUserId,
      type,
      title: copy.proctorTitle,
      message: copy.proctorMessage(scheduleRef, courseTitle),
      metadata: {
        ...metadataBase,
        assignmentId: relatedAssignment.id,
        recipientRole: 'PROCTOR',
        proctorId: relatedAssignment.proctor?.id ?? null,
      },
      scheduleId: assignment.scheduleId,
      scheduleVersion: null,
      assignmentId: relatedAssignment.id,
    });
  }

  const targetUserIds = [...new Set(recipientUserIds)];
  if (targetUserIds.length === 0) {
    return {
      eventType: type,
      removedStatusNotifications: 0,
      insertedStudentNotifications: 0,
      insertedProctorNotifications: 0,
    };
  }

  const deleteResult = await client.notification.deleteMany({
    where: {
      userId: { in: targetUserIds },
      type: { in: statusTypes },
      OR: [
        { assignmentId: { in: relatedAssignmentIds } },
        ...relatedAssignmentIds.map((relatedAssignmentId) => ({
          scheduleId: assignment.scheduleId,
          metadata: {
            path: ['assignmentId'],
            equals: relatedAssignmentId,
          },
        })),
      ],
    },
  });

  if (!type) {
    return {
      eventType: null,
      removedStatusNotifications: deleteResult.count,
      insertedStudentNotifications: 0,
      insertedProctorNotifications: 0,
    };
  }

  const [filteredStudents, filteredProctors] = await Promise.all([
    filterRowsByPreferences(studentRows, type, client),
    filterRowsByPreferences(proctorRows, type, client),
  ]);

  const [studentResult, proctorResult] = await Promise.all([
    createNotifications(filteredStudents, client),
    createNotifications(filteredProctors, client),
  ]);

  return {
    eventType: type,
    removedStatusNotifications: deleteResult.count,
    insertedStudentNotifications: studentResult.count,
    insertedProctorNotifications: proctorResult.count,
  };
};
