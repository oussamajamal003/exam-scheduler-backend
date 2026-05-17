// Category 1 — Successful Schedule Generation
// Verifies the Hybrid Constraint-Based engine produces a fully assigned,
// conflict-free schedule for the realistic FEIT Spring 2026 scenario.

import { generateSchedule } from '../../src/modules/scheduling/schedulingService.js';
import prisma, { truncateAll, disconnectPrisma } from '../utils/db.js';
import { seedFeitScenario } from '../utils/feitSeed.js';
import {
  loadFullSchedule,
  expectNoStudentOverlap,
  expectNoRoomDoubleBooking,
  expectNoProctorDoubleBooking,
  expectCapacityRespected,
  expectDurationsFit,
} from '../utils/assertions.js';

describe('Hybrid Scheduler — Successful Schedule Generation (FEIT Spring 2026)', () => {
  let scenario;
  let generated;

  beforeAll(async () => {
    await truncateAll();
    scenario = await seedFeitScenario({ namespace: 'FEIT-S1' });
    generated = await generateSchedule({
      semesterId: scenario.semester.id,
      scheduleName: 'FEIT S1 Hybrid Run',
    });
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it('seeds the full FEIT realistic dataset (30 examinable offerings, 6 non-exam)', () => {
    const examinable = scenario.offerings.filter(({ plan }) => plan.hasExam).length;
    const nonExam = scenario.offerings.filter(({ plan }) => !plan.hasExam).length;
    expect(examinable).toBe(30);
    expect(nonExam).toBe(6);
    expect(scenario.counts.timeSlots).toBeGreaterThanOrEqual(24);
    expect(scenario.counts.rooms).toBe(12);
    expect(scenario.counts.proctors).toBe(30);
    expect(scenario.counts.students).toBe(220);
  });

  it('returns a generated schedule whose metadata describes the hybrid pipeline', () => {
    expect(generated.scheduleId).toBeDefined();
    expect(generated.assignmentsCount).toBeGreaterThan(0);
    expect(generated.algorithm.type).toBe('HYBRID_CONSTRAINT_BASED');
    expect(Array.isArray(generated.algorithm.pipeline)).toBe(true);
    expect(generated.algorithm.pipeline.length).toBeGreaterThan(3);
    expect(generated.algorithm.strategy).toEqual(expect.any(String));
    expect(generated.schedule.generationStage).toBe('GENERATED');
    expect(generated.schedule.algorithmType).toBe('HYBRID_CONSTRAINT_BASED');
    expect(typeof generated.schedule.qualityScore).toBe('number');
  });

  it('schedules every COURSE offering exam exactly once and skips PROJECT/LAB offerings', async () => {
    const exams = await prisma.exam.findMany({
      include: { courseOffering: true, assignments: true },
    });
    // Only COURSE+hasExam should have Exam rows.
    expect(exams.length).toBe(30);
    for (const e of exams) {
      expect(e.courseOffering.courseType).toBe('COURSE');
      expect(e.courseOffering.hasExam).toBe(true);
      expect(e.status).toBe('SCHEDULED');
      expect(e.assignments.length).toBeGreaterThan(0); // at least one room assignment
    }

    // Verify there is no Exam row for any PROJECT/LAB offering.
    const nonExamOfferingIds = scenario.offerings
      .filter(({ plan }) => !plan.hasExam)
      .map(({ offering }) => offering.id);
    const strayExams = await prisma.exam.findMany({
      where: { courseOfferingId: { in: nonExamOfferingIds } },
    });
    expect(strayExams).toHaveLength(0);
  });

  it('produces no hard-constraint violations (rooms / proctors / students / capacity / duration)', async () => {
    const schedule = await loadFullSchedule(generated.scheduleId);
    expect(schedule.assignments.length).toBe(generated.assignmentsCount);
    expectNoRoomDoubleBooking(schedule);
    expectNoProctorDoubleBooking(schedule);
    expectNoStudentOverlap(schedule);
    expectCapacityRespected(schedule);
    expectDurationsFit(schedule);
  });
});
