// Category 6 — Publishing Rules
// Verifies the publish flow enforces:
//   - examPeriod required
//   - unique examPeriod per semester
//   - at most 2 published schedules per semester
//   - zero hard-constraint conflicts before publish
//   - no cross-published conflicts in the same semester

import {
  generateSchedule,
  publishSchedule,
} from '../../src/modules/scheduling/schedulingService.js';
import prisma, { truncateAll, disconnectPrisma } from '../utils/db.js';
import { seedFeitScenario } from '../utils/feitSeed.js';

const moveScheduleToFutureWindow = async (scheduleId, dayOffset) => {
  const schedule = await prisma.schedule.findUnique({
    where: { id: scheduleId },
    include: {
      assignments: {
        include: {
          timeSlot: true,
        },
      },
    },
  });

  const slotByOriginalId = new Map();
  for (const assignment of schedule.assignments) {
    slotByOriginalId.set(assignment.timeSlot.id, assignment.timeSlot);
  }

  const remappedSlotIds = new Map();
  for (const slot of slotByOriginalId.values()) {
    const startTime = new Date(slot.startTime);
    const endTime = new Date(slot.endTime);
    const date = new Date(slot.date ?? slot.startTime);
    startTime.setUTCDate(startTime.getUTCDate() + dayOffset);
    endTime.setUTCDate(endTime.getUTCDate() + dayOffset);
    date.setUTCDate(date.getUTCDate() + dayOffset);

    const created = await prisma.timeSlot.create({
      data: {
        startTime,
        endTime,
        date,
        duration: slot.duration,
      },
    });
    remappedSlotIds.set(slot.id, created.id);
  }

  for (const assignment of schedule.assignments) {
    await prisma.examAssignment.update({
      where: { id: assignment.id },
      data: { timeSlotId: remappedSlotIds.get(assignment.timeSlotId) },
    });
  }
};

describe('Hybrid Scheduler — Publishing Rules (FEIT Spring 2026)', () => {
  let scenario;
  let firstSchedule;
  let secondSchedule;
  let thirdSchedule;
  let overlappingDraftSchedule;

  beforeAll(async () => {
    await truncateAll();
    scenario = await seedFeitScenario({ namespace: 'FEIT-S6' });
    firstSchedule = await generateSchedule({
      semesterId: scenario.semester.id,
      scheduleName: 'Midterm Plan A',
    });
    secondSchedule = await generateSchedule({
      semesterId: scenario.semester.id,
      scheduleName: 'Final Plan A',
    });
    thirdSchedule = await generateSchedule({
      semesterId: scenario.semester.id,
      scheduleName: 'Extra Plan',
    });

    // Publish validation blocks any overlapping published schedules in the same
    // semester, so remap later schedules onto disjoint future windows to reach
    // the distinct-period and max-2-published rule paths.
    await moveScheduleToFutureWindow(secondSchedule.scheduleId, 30);
    await moveScheduleToFutureWindow(thirdSchedule.scheduleId, 60);
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it('rejects publish when examPeriod is missing', async () => {
    await expect(
      publishSchedule(firstSchedule.scheduleId, { examPeriod: '' }),
    ).rejects.toThrow(/exam period is required/i);
  });

  it('publishes the first schedule as Midterm successfully', async () => {
    const result = await publishSchedule(firstSchedule.scheduleId, { examPeriod: 'Midterm' });
    expect(result.schedule.isFinal).toBe(true);
    expect(result.schedule.examPeriod).toBe('Midterm');
  });

  it('allows generating another draft after a schedule is already published in the same semester', async () => {
    overlappingDraftSchedule = await generateSchedule({
      semesterId: scenario.semester.id,
      scheduleName: 'Overlap Draft After Publish',
    });

    expect(overlappingDraftSchedule.scheduleId).toBeTruthy();
    expect(overlappingDraftSchedule.assignmentsCount).toBeGreaterThan(0);
    expect(overlappingDraftSchedule.schedule.isFinal).toBe(false);
  });

  it('rejects publish when a draft conflicts with an existing published schedule', async () => {
    await expect(
      publishSchedule(overlappingDraftSchedule.scheduleId, { examPeriod: 'Final' }),
    ).rejects.toThrow(/conflicts with an existing published schedule/i);
  });

  it('rejects a duplicate Midterm publish in the same semester (case-insensitive)', async () => {
    await expect(
      publishSchedule(secondSchedule.scheduleId, { examPeriod: 'midterm' }),
    ).rejects.toThrow(/already exists/i);
  });

  it('publishes a second schedule with a different Final period', async () => {
    const result = await publishSchedule(secondSchedule.scheduleId, { examPeriod: 'Final' });
    expect(result.schedule.isFinal).toBe(true);
    expect(result.schedule.examPeriod).toBe('Final');
  });

  it('rejects a third publish in the same semester (cap = 2)', async () => {
    await expect(
      publishSchedule(thirdSchedule.scheduleId, { examPeriod: 'Makeup' }),
    ).rejects.toThrow(/more than 2/i);
  });

  it('rejects publish when the schedule has hard-constraint conflicts', async () => {
    // Pick the unpublished schedule and corrupt it by inserting a duplicate
    // proctor+timeslot assignment so getScheduleAnalysis reports a conflict.
    const goodAssignment = await prisma.examAssignment.findFirst({
      where: { scheduleId: thirdSchedule.scheduleId },
    });
    // Force a second assignment for the same proctor+slot on a different exam.
    const otherAssignment = await prisma.examAssignment.findFirst({
      where: {
        scheduleId: thirdSchedule.scheduleId,
        NOT: { examId: goodAssignment.examId },
      },
    });
    await prisma.examAssignment.update({
      where: { id: otherAssignment.id },
      data: {
        proctorId: goodAssignment.proctorId,
        timeSlotId: goodAssignment.timeSlotId,
      },
    });
    // First, unpublish all other schedules so the cap doesn't trigger first.
    await prisma.schedule.updateMany({
      where: { isFinal: true },
      data: { isFinal: false, examPeriod: null },
    });
    await expect(
      publishSchedule(thirdSchedule.scheduleId, { examPeriod: 'Midterm' }),
    ).rejects.toThrow(/hard-constraint issues/i);
  });
});
