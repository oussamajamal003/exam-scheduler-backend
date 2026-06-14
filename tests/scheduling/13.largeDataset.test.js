import { performance } from 'node:perf_hooks';

import { generateSchedule } from '../../src/modules/scheduling/schedulingService.js';
import prisma, { truncateAll, disconnectPrisma } from '../utils/db.js';
import { seedLargeSchedulingScenario } from '../utils/largeDatasetSeed.js';
import {
  loadFullSchedule,
  expectNoStudentOverlap,
  expectNoRoomDoubleBooking,
  expectNoProctorDoubleBooking,
  expectCapacityRespected,
  expectDurationsFit,
} from '../utils/assertions.js';

const clamp0to100 = (value) => Math.max(0, Math.min(100, value));

describe('Hybrid Scheduler — Large Dataset (1,000 students / 100 exams)', () => {
  let scenario;
  let generated;
  let schedule;
  let generationTimeMs;

  beforeAll(async () => {
    await truncateAll();
    scenario = await seedLargeSchedulingScenario({
      namespace: 'LARGE-13',
      studentCount: 1000,
      courseOfferingCount: 100,
      examCount: 100,
      roomCount: 50,
      proctorCount: 80,
      timeSlotCount: 30,
    });

    const start = performance.now();
    generated = await generateSchedule({
      semesterId: scenario.semesterId,
      scheduleName: 'Large Dataset Run',
    });
    generationTimeMs = Math.round(performance.now() - start);

    schedule = await loadFullSchedule(generated.scheduleId);
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it('generates a valid schedule and returns success with sufficient resources', async () => {
    expect(generated.scheduleId).toBeTruthy();
    expect(generated.assignmentsCount).toBeGreaterThan(0);
    expect(generated.algorithm.type).toBe('HYBRID_CONSTRAINT_BASED');
    expect(generated.schedule.generationStage).toBe('GENERATED');

    const scheduledExamIds = new Set(schedule.assignments.map((a) => a.examId));
    const scheduledExamsCount = scheduledExamIds.size;
    const failedExamsCount = scenario.counts.exams - scheduledExamsCount;

    // Output (requested)
    // eslint-disable-next-line no-console
    console.log('[LargeDataset] Scheduled Exams Count:', scheduledExamsCount);
    // eslint-disable-next-line no-console
    console.log('[LargeDataset] Failed Exams Count:', failedExamsCount);

    expect(scheduledExamsCount).toBe(scenario.counts.exams);
    expect(failedExamsCount).toBe(0);

    const exams = await prisma.exam.findMany({
      where: { courseOffering: { semesterId: scenario.semesterId } },
      select: { id: true, status: true },
    });
    expect(exams).toHaveLength(scenario.counts.exams);
    expect(exams.every((e) => e.status === 'SCHEDULED')).toBe(true);
  });

  it('prevents student conflicts (no overlapping exams per student)', () => {
    expectNoStudentOverlap(schedule);
  });

  it('respects room capacities (assigned seats never exceed capacity)', () => {
    expectCapacityRespected(schedule);
  });

  it('prevents room double-booking in the same timeslot', () => {
    expectNoRoomDoubleBooking(schedule);
  });

  it('prevents proctor double-booking in the same timeslot', () => {
    expectNoProctorDoubleBooking(schedule);
  });

  it('respects proctor workload limits (max exams per day)', () => {
    const perProctorDay = new Map();
    for (const assignment of schedule.assignments) {
      const day = (assignment.timeSlot.date ?? assignment.timeSlot.startTime).toISOString().slice(0, 10);
      const key = `${assignment.proctorId}:${day}`;
      if (!perProctorDay.has(key)) perProctorDay.set(key, new Set());
      perProctorDay.get(key).add(assignment.examId);
    }

    for (const [key, examIds] of perProctorDay) {
      const proctorId = key.split(':')[0];
      const anyAssignment = schedule.assignments.find((a) => a.proctorId === proctorId);
      const maxPerDay = anyAssignment?.proctor?.maxExamsPerDay ?? 2;
      expect(examIds.size).toBeLessThanOrEqual(maxPerDay);
    }
  });

  it('assigns valid timeslots and durations for all scheduled exams', async () => {
    expectDurationsFit(schedule);
    const semester = await prisma.semester.findUnique({
      where: { id: scenario.semesterId },
      select: { startDate: true, endDate: true },
    });
    for (const assignment of schedule.assignments) {
      expect(assignment.timeSlotId).toBeTruthy();
      expect(assignment.timeSlot?.startTime).toBeInstanceOf(Date);
      expect(assignment.timeSlot?.endTime).toBeInstanceOf(Date);
      expect(assignment.timeSlot.startTime.getTime()).toBeGreaterThanOrEqual(semester.startDate.getTime());
      expect(assignment.timeSlot.endTime.getTime()).toBeLessThanOrEqual(semester.endDate.getTime());
    }
  });

  it('does not illegally reuse reserved/unavailable rooms or proctors', () => {
    const assignedRoomIds = new Set(schedule.assignments.map((a) => a.roomId));
    const assignedProctorIds = new Set(schedule.assignments.map((a) => a.proctorId));

    for (const roomId of scenario.maintenanceRoomIds) {
      expect(assignedRoomIds.has(roomId)).toBe(false);
    }
    for (const proctorId of scenario.proctorsWithoutAvailability) {
      expect(assignedProctorIds.has(proctorId)).toBe(false);
    }

    for (const assignment of schedule.assignments) {
      expect(assignment.room.status).toBe('AVAILABLE');
    }
  });

  it('computes quality metrics within bounds (0..100) and logs requested outputs', () => {
    const roomUtilizationScore = generated.algorithm.qualityMetrics?.roomUtilization;
    const proctorBalanceScore = generated.algorithm.qualityMetrics?.proctorWorkloadBalance;
    const studentSpacingScore = generated.algorithm.qualityMetrics?.studentSpacing;
    const distributionScore = generated.algorithm.qualityMetrics?.examDistribution;
    const overallQualityScore = generated.schedule?.qualityScore;

    const asNumber = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const scores = {
      roomUtilizationScore: asNumber(roomUtilizationScore),
      proctorBalanceScore: asNumber(proctorBalanceScore),
      studentSpacingScore: asNumber(studentSpacingScore),
      distributionScore: asNumber(distributionScore),
      overallQualityScore: asNumber(overallQualityScore),
    };

    for (const [key, value] of Object.entries(scores)) {
      expect(value).not.toBeNull();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
      // eslint-disable-next-line no-console
      console.log(`[LargeDataset] ${key}:`, clamp0to100(value));
    }
  });

  it('completes schedule generation within an acceptable performance threshold', () => {
    const maxMs = Number(process.env.LARGE_DATASET_MAX_MS ?? 110000);
    // eslint-disable-next-line no-console
    console.log('[LargeDataset] Generation Time (ms):', generationTimeMs);
    expect(generationTimeMs).toBeLessThanOrEqual(maxMs);
  });
});
