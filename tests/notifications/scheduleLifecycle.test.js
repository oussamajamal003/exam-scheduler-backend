// Schedule publish lifecycle — notifications.
//
// Verifies the publish/unpublish flow emits exactly the right notification
// type per recipient per round, with zero duplicates across retries:
//   - Draft -> Published  : exactly ONE SCHEDULE_PUBLISHED per affected user
//   - Published -> Unpublished : exactly ONE SCHEDULE_UNPUBLISHED, no publish
//   - Unpublished -> Published : exactly ONE SCHEDULE_REPUBLISHED, no PUBLISHED
//   - Published -> Published : no-op, no new notifications
//   - The (userId, type, scheduleId, scheduleVersion) unique constraint
//     prevents duplicate inserts even when the helper is called twice.

import { generateSchedule, publishSchedule } from '../../src/modules/scheduling/schedulingService.js';
import { unpublish } from '../../src/modules/schedules/schedulesService.js';
import { update as updateAssignment } from '../../src/modules/assignments/assignmentsService.js';
import {
  NOTIFICATION_TYPES,
  createSchedulePublicationNotifications,
  listForUser,
} from '../../src/modules/notifications/notificationsService.js';
import prisma, { truncateAll, disconnectPrisma } from '../utils/db.js';
import { seedFeitScenario } from '../utils/feitSeed.js';

const SCHEDULE_LIFECYCLE_TYPES = [
  NOTIFICATION_TYPES.SCHEDULE_PUBLISHED,
  NOTIFICATION_TYPES.SCHEDULE_UNPUBLISHED,
  NOTIFICATION_TYPES.SCHEDULE_REPUBLISHED,
];

const countNotifications = (scheduleId, type) =>
  prisma.notification.count({ where: { scheduleId, type } });

const countByType = async (scheduleId) => {
  const rows = await prisma.notification.groupBy({
    by: ['type', 'scheduleVersion'],
    where: { scheduleId, type: { in: SCHEDULE_LIFECYCLE_TYPES } },
    _count: { _all: true },
  });
  return rows;
};

const EXAM_STATUS_NOTIFICATION_TYPES = [
  NOTIFICATION_TYPES.SCHEDULE_EXAM_COMPLETED,
  NOTIFICATION_TYPES.SCHEDULE_EXAM_CANCELLED,
];

const getAssignmentStatusNotifications = (assignmentId, userId) =>
  prisma.notification.findMany({
    where: {
      assignmentId,
      userId,
      type: { in: EXAM_STATUS_NOTIFICATION_TYPES },
    },
    orderBy: { createdAt: 'desc' },
  });

const getAssignedPortalUsers = async (scheduleId) => {
  const assignment = await prisma.examAssignment.findFirst({
    where: { scheduleId },
    select: {
      proctor: { select: { id: true, userId: true } },
      exam: {
        select: {
          courseOffering: {
            select: {
              registrations: {
                where: { status: { not: 'INACTIVE' } },
                take: 1,
                select: { student: { select: { id: true, userId: true } } },
              },
            },
          },
        },
      },
    },
  });

  const student = assignment?.exam?.courseOffering?.registrations?.[0]?.student;
  const proctor = assignment?.proctor;

  return {
    studentUser: student ? { id: student.userId, studentId: student.id } : null,
    proctorUser: proctor ? { id: proctor.userId, proctorId: proctor.id } : null,
  };
};

const getAssignableNotificationTargets = async (scheduleId) => {
  const assignment = await prisma.examAssignment.findFirst({
    where: {
      scheduleId,
      exam: {
        courseOffering: {
          registrations: {
            some: {
              status: { not: 'INACTIVE' },
            },
          },
        },
      },
    },
    select: {
      id: true,
      proctor: { select: { id: true, userId: true } },
      exam: {
        select: {
          courseOffering: {
            select: {
              registrations: {
                where: { status: { not: 'INACTIVE' } },
                take: 1,
                select: { student: { select: { id: true, userId: true } } },
              },
            },
          },
        },
      },
    },
    orderBy: { id: 'asc' },
  });

  const student = assignment?.exam?.courseOffering?.registrations?.[0]?.student;
  const proctor = assignment?.proctor;

  return {
    assignmentId: assignment?.id ?? null,
    studentUser: student ? { id: student.userId, studentId: student.id } : null,
    proctorUser: proctor ? { id: proctor.userId, proctorId: proctor.id } : null,
  };
};

describe('Schedule publish notification lifecycle', () => {
  let scenario;
  let scheduleId;

  beforeAll(async () => {
    await truncateAll();
    scenario = await seedFeitScenario({ namespace: 'FEIT-NOTIF' });
    const generated = await generateSchedule({
      semesterId: scenario.semester.id,
      scheduleName: 'Lifecycle Plan',
    });
    scheduleId = generated.scheduleId;
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it('first publish emits exactly one SCHEDULE_PUBLISHED per affected user', async () => {
    const result = await publishSchedule(scheduleId, { examPeriod: 'Midterm' });

    expect(result.schedule.isFinal).toBe(true);
    expect(result.schedule.publishedVersion).toBe(1);
    expect(result.eventType).toBe(NOTIFICATION_TYPES.SCHEDULE_PUBLISHED);

    const publishedCount = await countNotifications(scheduleId, NOTIFICATION_TYPES.SCHEDULE_PUBLISHED);
    const republishedCount = await countNotifications(scheduleId, NOTIFICATION_TYPES.SCHEDULE_REPUBLISHED);
    const unpublishedCount = await countNotifications(scheduleId, NOTIFICATION_TYPES.SCHEDULE_UNPUBLISHED);

    expect(publishedCount).toBeGreaterThan(0);
    expect(republishedCount).toBe(0);
    expect(unpublishedCount).toBe(0);

    // No duplicate rows per recipient at version 1.
    const dupes = await prisma.notification.groupBy({
      by: ['userId'],
      where: { scheduleId, type: NOTIFICATION_TYPES.SCHEDULE_PUBLISHED, scheduleVersion: 1 },
      _count: { _all: true },
      having: { userId: { _count: { gt: 1 } } },
    });
    expect(dupes).toHaveLength(0);
  });

  it('republishing the same already-final schedule is a no-op and inserts no new rows', async () => {
    const before = await countNotifications(scheduleId, NOTIFICATION_TYPES.SCHEDULE_PUBLISHED);
    const result = await publishSchedule(scheduleId, { examPeriod: 'Midterm' });
    expect(result.message).toMatch(/already published/i);
    const after = await countNotifications(scheduleId, NOTIFICATION_TYPES.SCHEDULE_PUBLISHED);
    expect(after).toBe(before);
  });

  it('retrying the publication helper with same version is idempotent (dedup constraint)', async () => {
    const before = await countNotifications(scheduleId, NOTIFICATION_TYPES.SCHEDULE_PUBLISHED);
    await createSchedulePublicationNotifications({
      scheduleId,
      eventType: NOTIFICATION_TYPES.SCHEDULE_PUBLISHED,
      scheduleVersion: 1,
    });
    const after = await countNotifications(scheduleId, NOTIFICATION_TYPES.SCHEDULE_PUBLISHED);
    expect(after).toBe(before);
  });

  it('unpublish emits exactly one SCHEDULE_UNPUBLISHED per affected user, no publish row', async () => {
    const publishedBefore = await countNotifications(scheduleId, NOTIFICATION_TYPES.SCHEDULE_PUBLISHED);

    const schedule = await unpublish(scheduleId);
    expect(schedule.isFinal).toBe(false);
    expect(schedule.publishedVersion).toBe(1); // preserved across unpublish

    const unpublishedCount = await countNotifications(scheduleId, NOTIFICATION_TYPES.SCHEDULE_UNPUBLISHED);
    const publishedAfter = await countNotifications(scheduleId, NOTIFICATION_TYPES.SCHEDULE_PUBLISHED);

    expect(unpublishedCount).toBeGreaterThan(0);
    expect(publishedAfter).toBe(publishedBefore); // no new publish rows during unpublish

    const dupes = await prisma.notification.groupBy({
      by: ['userId'],
      where: { scheduleId, type: NOTIFICATION_TYPES.SCHEDULE_UNPUBLISHED, scheduleVersion: 1 },
      _count: { _all: true },
      having: { userId: { _count: { gt: 1 } } },
    });
    expect(dupes).toHaveLength(0);

    const { studentUser, proctorUser } = await getAssignedPortalUsers(scheduleId);
    const [studentVisibleNotifications, proctorVisibleNotifications] = await Promise.all([
      studentUser ? listForUser(studentUser) : { notifications: [], unreadCount: 0 },
      proctorUser ? listForUser(proctorUser) : { notifications: [], unreadCount: 0 },
    ]);

    expect(studentVisibleNotifications.notifications).toHaveLength(0);
    expect(studentVisibleNotifications.unreadCount).toBe(0);
    expect(proctorVisibleNotifications.notifications).toHaveLength(0);
    expect(proctorVisibleNotifications.unreadCount).toBe(0);
  });

  it('republishing after an unpublish emits SCHEDULE_REPUBLISHED with a new version', async () => {
    const result = await publishSchedule(scheduleId, { examPeriod: 'Midterm' });
    expect(result.schedule.isFinal).toBe(true);
    expect(result.schedule.publishedVersion).toBe(2);
    expect(result.eventType).toBe(NOTIFICATION_TYPES.SCHEDULE_REPUBLISHED);

    const republishedCount = await countNotifications(scheduleId, NOTIFICATION_TYPES.SCHEDULE_REPUBLISHED);
    expect(republishedCount).toBeGreaterThan(0);

    // Original SCHEDULE_PUBLISHED rows from round 1 are still version=1 and
    // untouched. The republish must not create new SCHEDULE_PUBLISHED rows.
    const publishedV2 = await prisma.notification.count({
      where: { scheduleId, type: NOTIFICATION_TYPES.SCHEDULE_PUBLISHED, scheduleVersion: 2 },
    });
    expect(publishedV2).toBe(0);

    const dupes = await prisma.notification.groupBy({
      by: ['userId'],
      where: { scheduleId, type: NOTIFICATION_TYPES.SCHEDULE_REPUBLISHED, scheduleVersion: 2 },
      _count: { _all: true },
      having: { userId: { _count: { gt: 1 } } },
    });
    expect(dupes).toHaveLength(0);
  });

  it('published assignment status updates are visible immediately to student and proctor portals', async () => {
    const { assignmentId, studentUser, proctorUser } = await getAssignableNotificationTargets(scheduleId);
    expect(assignmentId).toBeTruthy();
    expect(studentUser).toBeTruthy();
    expect(proctorUser).toBeTruthy();

    await updateAssignment(scheduleId, assignmentId, { exam: { status: 'COMPLETED' } });

    const [studentAfterCompleted, proctorAfterCompleted] = await Promise.all([
      listForUser(studentUser),
      listForUser(proctorUser),
    ]);

    expect(studentAfterCompleted.notifications.some((row) => row.type === NOTIFICATION_TYPES.SCHEDULE_EXAM_COMPLETED)).toBe(true);
    expect(proctorAfterCompleted.notifications.some((row) => row.type === NOTIFICATION_TYPES.SCHEDULE_EXAM_COMPLETED)).toBe(true);

    expect(await getAssignmentStatusNotifications(assignmentId, studentUser.id)).toHaveLength(1);
    expect(await getAssignmentStatusNotifications(assignmentId, proctorUser.id)).toHaveLength(1);

    await updateAssignment(scheduleId, assignmentId, { exam: { status: 'CANCELLED' } });

    const [studentAfterCancelled, proctorAfterCancelled] = await Promise.all([
      listForUser(studentUser),
      listForUser(proctorUser),
    ]);

    expect(studentAfterCancelled.notifications.some((row) => row.type === NOTIFICATION_TYPES.SCHEDULE_EXAM_CANCELLED)).toBe(true);
    expect(proctorAfterCancelled.notifications.some((row) => row.type === NOTIFICATION_TYPES.SCHEDULE_EXAM_CANCELLED)).toBe(true);

    const [studentCancelledRows, proctorCancelledRows] = await Promise.all([
      getAssignmentStatusNotifications(assignmentId, studentUser.id),
      getAssignmentStatusNotifications(assignmentId, proctorUser.id),
    ]);
    expect(studentCancelledRows).toHaveLength(1);
    expect(proctorCancelledRows).toHaveLength(1);
    expect(studentCancelledRows[0].type).toBe(NOTIFICATION_TYPES.SCHEDULE_EXAM_CANCELLED);
    expect(proctorCancelledRows[0].type).toBe(NOTIFICATION_TYPES.SCHEDULE_EXAM_CANCELLED);

    await updateAssignment(scheduleId, assignmentId, { exam: { status: 'SCHEDULED' } });
    expect(await getAssignmentStatusNotifications(assignmentId, studentUser.id)).toHaveLength(0);
    expect(await getAssignmentStatusNotifications(assignmentId, proctorUser.id)).toHaveLength(0);

    await updateAssignment(scheduleId, assignmentId, { exam: { status: 'COMPLETED' } });
    await updateAssignment(scheduleId, assignmentId, { exam: { status: 'COMPLETED' } });

    const [studentCompletedRows, proctorCompletedRows] = await Promise.all([
      getAssignmentStatusNotifications(assignmentId, studentUser.id),
      getAssignmentStatusNotifications(assignmentId, proctorUser.id),
    ]);
    expect(studentCompletedRows).toHaveLength(1);
    expect(proctorCompletedRows).toHaveLength(1);
    expect(studentCompletedRows[0].type).toBe(NOTIFICATION_TYPES.SCHEDULE_EXAM_COMPLETED);
    expect(proctorCompletedRows[0].type).toBe(NOTIFICATION_TYPES.SCHEDULE_EXAM_COMPLETED);
  });

  it('round summary has distinct (type, version) groupings without duplicates', async () => {
    const rows = await countByType(scheduleId);
    // Expect: PUBLISHED@v1, UNPUBLISHED@v1, REPUBLISHED@v2 — each row count
    // matches the number of affected recipients of that role, and no two
    // rows share the same (type, version) bucket.
    const keys = rows.map((row) => `${row.type}:${row.scheduleVersion}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(
      expect.arrayContaining([
        `${NOTIFICATION_TYPES.SCHEDULE_PUBLISHED}:1`,
        `${NOTIFICATION_TYPES.SCHEDULE_UNPUBLISHED}:1`,
        `${NOTIFICATION_TYPES.SCHEDULE_REPUBLISHED}:2`,
      ]),
    );
  });
});
