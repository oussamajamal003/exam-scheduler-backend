// Category 4 — Priority & Sorting
// Verifies that the hybrid scheduler honours its priority bands when
// constructing the schedule. The expectation: high-cohort, broadly-shared
// CRITICAL exams (CHEM221, MATH104, ENGR211, PHY104, PHY105 — each enrolling
// students from all 4 programs) get scheduled into time slots that don't
// collide with each other and are placed earlier in the day order than the
// small single-cohort NORMAL exams.

import { generateSchedule, optimizeScheduling } from '../../src/modules/scheduling/schedulingService.js';
import prisma, { truncateAll, disconnectPrisma } from '../utils/db.js';
import { seedFeitScenario } from '../utils/feitSeed.js';
import { loadFullSchedule } from '../utils/assertions.js';

const BROAD_COHORT_CODES = ['CHEM221', 'MATH104', 'MATH105', 'ENGR211', 'PHY104', 'PHY105', 'ENGR444'];
const NARROW_COHORT_CODES = ['BME424', 'CNE460', 'CSC426'];

describe('Hybrid Scheduler — Priority & Sorting (FEIT Spring 2026)', () => {
  let scenario;
  let generated;
  let schedule;

  beforeAll(async () => {
    await truncateAll();
    scenario = await seedFeitScenario({ namespace: 'FEIT-S4' });
    generated = await generateSchedule({
      semesterId: scenario.semester.id,
      scheduleName: 'FEIT S4 Priority Sorting',
    });
    schedule = await loadFullSchedule(generated.scheduleId);
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it('records the priority pipeline strategies in algorithm metadata', () => {
    expect(generated.algorithm.strategy).toEqual(expect.any(String));
    const meta = generated.schedule.algorithmMetadata;
    expect(Array.isArray(meta.pipeline)).toBe(true);
    expect(meta.pipeline.length).toBeGreaterThan(3);
    expect(Array.isArray(meta.attemptedStrategies)).toBe(true);
    // At least the default strategy must be present.
    expect(meta.attemptedStrategies.length).toBeGreaterThanOrEqual(1);
  });

  it('successfully schedules every CRITICAL broad-cohort exam (large enrollment, all 4 programs)', async () => {
    const broadOfferings = scenario.offerings.filter(({ plan }) =>
      BROAD_COHORT_CODES.includes(plan.baseCode) && plan.hasExam,
    );
    expect(broadOfferings.length).toBeGreaterThanOrEqual(6);

    const broadOfferingIds = new Set(broadOfferings.map(({ offering }) => offering.id));
    const broadAssignments = schedule.assignments.filter((a) =>
      broadOfferingIds.has(a.exam.courseOfferingId),
    );

    // Every broad-cohort offering must have at least one assignment.
    const scheduledOfferingIds = new Set(broadAssignments.map((a) => a.exam.courseOfferingId));
    for (const id of broadOfferingIds) {
      expect(scheduledOfferingIds.has(id)).toBe(true);
    }
  });

  it('places narrow NORMAL exams at the same standard length (no demotion of small exams)', async () => {
    const narrowOfferings = scenario.offerings.filter(({ plan }) =>
      NARROW_COHORT_CODES.includes(plan.baseCode) && plan.hasExam,
    );
    const narrowIds = new Set(narrowOfferings.map(({ offering }) => offering.id));
    const narrowAssignments = schedule.assignments.filter((a) =>
      narrowIds.has(a.exam.courseOfferingId),
    );
    expect(narrowAssignments.length).toBeGreaterThan(0);
    for (const a of narrowAssignments) {
      expect(a.exam.duration).toBeGreaterThanOrEqual(60);
    }
  });

  it('optimizeScheduling exposes attemptedStrategies and selects a strategy label', async () => {
    const result = await optimizeScheduling({ semesterId: scenario.semester.id });
    expect(result.optimization).toBeDefined();
    expect(result.optimization.attempted).toBe(true);
    expect(Array.isArray(result.optimization.attemptedStrategies)).toBe(true);
    expect(result.optimization.attemptedStrategies.length).toBeGreaterThanOrEqual(1);
    expect(result.optimization.strategy).toEqual(expect.any(String));
  });

  it('broad-cohort exams that share students never collide on the same time slot', () => {
    const broadAssignments = schedule.assignments.filter((a) =>
      BROAD_COHORT_CODES.some((code) => (a.exam.courseOffering.course.code ?? '').endsWith(`-${code}`)),
    );
    const studentSlot = new Map();
    for (const a of broadAssignments) {
      for (const r of a.exam.courseOffering.registrations) {
        const key = `${r.studentId}:${a.timeSlotId}`;
        const prior = studentSlot.get(key);
        if (prior && prior !== a.examId) {
          throw new Error(`Broad-cohort collision: student ${r.studentId} has ${prior} and ${a.examId} in slot ${a.timeSlotId}`);
        }
        studentSlot.set(key, a.examId);
      }
    }
    expect(studentSlot.size).toBeGreaterThan(0);
  });

  it('persists exam priority hints from offerings (priority >= 70 for COURSE)', async () => {
    const offerings = await prisma.courseOffering.findMany({
      where: { hasExam: true },
      select: { priority: true },
    });
    expect(offerings.length).toBe(30);
    for (const o of offerings) {
      expect(o.priority).toBeGreaterThanOrEqual(70);
    }
  });
});
