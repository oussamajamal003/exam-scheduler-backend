import { randomUUID } from 'crypto';
import prisma from '../../config/prisma.js';
import { AppError } from '../../utils/AppError.js';

export const NOTIFICATION_TYPES = {
  SCHEDULE_PUBLISHED: 'SCHEDULE_PUBLISHED',
  SCHEDULE_UPDATED: 'SCHEDULE_UPDATED',
  ROOM_TIME_CHANGE: 'ROOM_TIME_CHANGE',
  ANNOUNCEMENT: 'ANNOUNCEMENT',
  NEW_DUTY_ASSIGNED: 'NEW_DUTY_ASSIGNED',
};

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
  const where = {
    userId: user.id,
    ...(unreadOnly ? { readAt: null } : {}),
  };

  const [rows, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    }),
    prisma.notification.count({
      where: { userId: user.id, readAt: null },
    }),
  ]);

  return {
    notifications: rows.map(mapNotification),
    unreadCount,
  };
};

export const markReadForUser = async (user, notificationId) => {
  if (!user?.id) throw new AppError('Authenticated user not found.', 401);

  const existing = await prisma.notification.findFirst({
    where: { id: notificationId, userId: user.id },
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
    where: { userId: user.id, readAt: null },
    data: { readAt: new Date() },
  });

  return { updatedCount: result.count };
};

const buildScheduleMetadata = (schedule, role, entries) => ({
  recipientRole: role,
  scheduleId: schedule.id,
  scheduleName: schedule.name,
  examPeriod: schedule.examPeriod,
  schedule: {
    id: schedule.id,
    name: schedule.name,
    examPeriod: schedule.examPeriod,
    isFinal: true,
  },
  assignmentCount: entries.length,
  assignments: entries,
});

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

const createNotifications = async (rows) => {
  if (rows.length === 0) return { count: 0 };
  const result = await prisma.notification.createMany({ data: rows });
  return { count: result.count };
};

const preferenceKeyByType = {
  [NOTIFICATION_TYPES.SCHEDULE_PUBLISHED]: 'schedulePublishedNotifications',
  [NOTIFICATION_TYPES.SCHEDULE_UPDATED]: 'examAssignmentUpdates',
  [NOTIFICATION_TYPES.NEW_DUTY_ASSIGNED]: 'examAssignmentUpdates',
  [NOTIFICATION_TYPES.ROOM_TIME_CHANGE]: 'roomTimeChanges',
  [NOTIFICATION_TYPES.ANNOUNCEMENT]: 'announcementsMessages',
};

const filterRowsByPreferences = async (rows, type) => {
  const preferenceKey = preferenceKeyByType[type];
  if (!preferenceKey || rows.length === 0) return rows;

  const settings = await prisma.userSettings.findMany({
    where: { userId: { in: rows.map((row) => row.userId) } },
    select: { userId: true, [preferenceKey]: true },
  });

  const preferencesByUserId = new Map(settings.map((setting) => [setting.userId, setting[preferenceKey]]));
  return rows.filter((row) => preferencesByUserId.get(row.userId) !== false);
};

export const createSchedulePublicationNotifications = async ({ scheduleId, notificationType }) => {
  const schedule = await prisma.schedule.findUnique({
    where: { id: scheduleId },
    select: {
      id: true,
      name: true,
      examPeriod: true,
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

  const type = notificationType ?? NOTIFICATION_TYPES.SCHEDULE_PUBLISHED;
  const isUpdate = type === NOTIFICATION_TYPES.SCHEDULE_UPDATED || type === NOTIFICATION_TYPES.ROOM_TIME_CHANGE;
  const studentRecipients = buildStudentEntries(schedule);
  const proctorRecipients = buildProctorEntries(schedule);

  const studentNotifications = Array.from(studentRecipients.entries()).map(([userId, entries]) => ({
    id: randomUUID(),
    userId,
    type,
    title: isUpdate ? 'Exam schedule updated' : 'Schedule published',
    message: isUpdate
      ? `${schedule.name} has updated room or time details for ${entries.length} ${entries.length === 1 ? 'exam' : 'exams'} in your registered courses.`
      : `${schedule.name} is now published with ${entries.length} ${entries.length === 1 ? 'exam' : 'exams'} in your registered courses.`,
    metadata: buildScheduleMetadata(schedule, 'STUDENT', entries),
  }));

  const proctorNotifications = Array.from(proctorRecipients.entries()).map(([userId, entries]) => ({
    id: randomUUID(),
    userId,
    type,
    title: isUpdate ? 'Proctor duties updated' : 'New published exam duties',
    message: isUpdate
      ? `${schedule.name} updated ${entries.length} assigned ${entries.length === 1 ? 'duty' : 'duties'} in your published roster.`
      : `${schedule.name} is now published with ${entries.length} ${entries.length === 1 ? 'assigned duty' : 'assigned duties'} for you.`,
    metadata: buildScheduleMetadata(schedule, 'PROCTOR', entries),
  }));

  const [filteredStudentNotifications, filteredProctorNotifications] = await Promise.all([
    filterRowsByPreferences(studentNotifications, type),
    filterRowsByPreferences(proctorNotifications, type),
  ]);

  const [studentResult, proctorResult] = await Promise.all([
    createNotifications(filteredStudentNotifications),
    createNotifications(filteredProctorNotifications),
  ]);

  return {
    affectedStudentCount: studentRecipients.size,
    affectedProctorCount: proctorRecipients.size,
    insertedStudentNotifications: studentResult.count,
    insertedProctorNotifications: proctorResult.count,
  };
};
