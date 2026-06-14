import { generateSchedule, getScheduleAnalysis, getSchedulingOrderPreview, LIGHTWEIGHT_REFINEMENT_TEST_LIMITS } from '../../src/modules/scheduling/schedulingService.js';
import prisma, { truncateAll, disconnectPrisma } from '../utils/db.js';
import { seedFeitScenario } from '../utils/feitSeed.js';
import { loadFullSchedule, expectNoRoomDoubleBooking, expectNoProctorDoubleBooking, expectNoStudentOverlap, expectCapacityRespected, expectDurationsFit } from '../utils/assertions.js';

const NO_VALID_MESSAGE = 'No conflict-free schedule exists for current resources/data.';
const CANDIDATE_MESSAGE = 'Exam cannot be assigned.\nNo valid candidate exists.\nGeneration stopped.';
const PIPELINE_STAGE_LABELS = [
  'Loading Resources',
  'Validation',
  'Exam Sorting',
  'Candidate Filtering',
  'Choose Best Valid Candidate',
  'Reserve Candidate',
  'Lightweight Refinement Pass',
  'Final Validation',
  'Save Schedule',
];
const ALLOWED_REFINEMENT_MOVE_TYPES = new Set(['ROOM_DOWNGRADE', 'TIMESLOT_MOVE', 'PROCTOR_REBALANCE', 'DISTRIBUTION_FIX', 'SPACING_FIX']);

const buildScheduleSignature = (schedule) => ({
  generationStage: schedule.generationStage,
  qualityScore: schedule.qualityScore,
  hardConstraintScore: schedule.hardConstraintScore,
  softConstraintScore: schedule.softConstraintScore,
  assignmentKeys: schedule.assignments
    .map((assignment) => [
      assignment.exam.courseOffering.course.code,
      assignment.timeSlot.startTime.toISOString(),
      assignment.room.name,
      assignment.proctor.user?.email ?? assignment.proctorId,
    ].join(':'))
    .sort(),
});

const expectHardConstraints = (schedule, semester) => {
  expectNoRoomDoubleBooking(schedule);
  expectNoProctorDoubleBooking(schedule);
  expectNoStudentOverlap(schedule);
  expectCapacityRespected(schedule);
  expectDurationsFit(schedule);

  for (const assignment of schedule.assignments) {
    const semesterStart = semester.startDate.getTime();
    const semesterEnd = semester.endDate.getTime();
    expect(assignment.timeSlot.startTime.getTime()).toBeGreaterThanOrEqual(semesterStart);
    expect(assignment.timeSlot.endTime.getTime()).toBeLessThanOrEqual(semesterEnd);
    expect(assignment.proctor.maxExamsPerDay ?? 2).toBeGreaterThanOrEqual(1);
  }
};

describe('Hybrid Scheduler — End-to-End Pipeline', () => {
  afterAll(async () => {
    await disconnectPrisma();
  });

  describe('success path', () => {
    let scenario;
    let generated;
    let schedule;
    let analysis;
    let orderPreview;

    beforeAll(async () => {
      await truncateAll();
      scenario = await seedFeitScenario({ namespace: 'FEIT-E2E-SUCCESS' });
      orderPreview = await getSchedulingOrderPreview({ semesterId: scenario.semester.id });
      generated = await generateSchedule({
        semesterId: scenario.semester.id,
        scheduleName: 'FEIT E2E Success',
      });
      schedule = await loadFullSchedule(generated.scheduleId);
      analysis = await getScheduleAnalysis(generated.scheduleId);
    });

    it('completes the 9-stage pipeline metadata and saves a schedule', () => {
      expect(generated.scheduleId).toBeTruthy();
      expect(generated.schedule?.id).toBe(generated.scheduleId);
      expect(generated.schedule.generationStage).toBe('GENERATED');
      expect(generated.schedule.algorithmMetadata.pipeline).toEqual(PIPELINE_STAGE_LABELS);
      expect(generated.assignmentsCount).toBeGreaterThan(0);
      expect(generated.assignmentsCount).toBe(schedule.assignments.length);
      expect(generated.schedule._count.assignments).toBe(schedule.assignments.length);
    });

    it('assigns every exam and produces no hard-constraint violations', () => {
      const examIds = new Set(schedule.assignments.map((assignment) => assignment.examId));
      expect(examIds.size).toBe(scenario.counts.examsExpected);
      expect(schedule.assignments.length).toBeGreaterThan(0);
      expectHardConstraints(schedule, scenario.semester);
      expect(analysis.metrics.totalConflicts).toBe(0);
      expect(analysis.metrics.derivedConflicts).toBe(0);
      expect(generated.schedule.hardConstraintScore).toBe(0);
    });

    it('returns a finalized schedule that is deterministic for the same seeded dataset', async () => {
      await truncateAll();
      const repeatScenario = await seedFeitScenario({ namespace: 'FEIT-E2E-SUCCESS' });
      const repeated = await generateSchedule({
        semesterId: repeatScenario.semester.id,
        scheduleName: 'FEIT E2E Success Copy',
      });
      const repeatedSchedule = await loadFullSchedule(repeated.scheduleId);

      expect(buildScheduleSignature(repeatedSchedule)).toEqual(buildScheduleSignature(schedule));
      expect(repeated.assignmentsCount).toBe(generated.assignmentsCount);
    });

    it('records bounded refinement metadata and allowed move types', () => {
      const refinement = generated.schedule.algorithmMetadata.refinement;
      expect(refinement.applied).toBe(true);
      expect(refinement.passes).toBeLessThanOrEqual(LIGHTWEIGHT_REFINEMENT_TEST_LIMITS.maxRefinementPasses);
      expect(refinement.changedExams).toBeLessThanOrEqual(LIGHTWEIGHT_REFINEMENT_TEST_LIMITS.maxChangedExams);
      expect(refinement.elapsedMs).toBeLessThanOrEqual(LIGHTWEIGHT_REFINEMENT_TEST_LIMITS.timeBudgetMs + 1000);
      expect(refinement.limits).toEqual(LIGHTWEIGHT_REFINEMENT_TEST_LIMITS);
      for (const repair of refinement.repairs ?? []) {
        expect(ALLOWED_REFINEMENT_MOVE_TYPES.has(repair.repairType)).toBe(true);
      }
    });

    it('honors the current exam sorting order', () => {
      expect(orderPreview.length).toBeGreaterThan(0);
      const criticalPrefix = orderPreview.filter((item) => item.priorityBand === 'CRITICAL');
      const highPrefix = orderPreview.filter((item) => item.priorityBand === 'HIGH');
      const normalSuffix = orderPreview.filter((item) => item.priorityBand === 'NORMAL');
      expect(criticalPrefix.length).toBeGreaterThan(0);
      expect(highPrefix.length).toBeGreaterThan(0);
      expect(normalSuffix.length).toBeGreaterThan(0);

      const rankValues = orderPreview.map((item) => item.priorityBandRank);
      const firstHigh = rankValues.findIndex((rank) => rank === 2);
      const firstNormal = rankValues.findIndex((rank) => rank === 1);
      expect(firstHigh).toBeGreaterThan(-1);
      expect(firstNormal).toBeGreaterThan(-1);
      expect(rankValues.slice(0, firstHigh).every((rank) => rank === 3)).toBe(true);
      expect(rankValues.slice(firstHigh, firstNormal).every((rank) => rank === 2)).toBe(true);
      expect(rankValues.slice(firstNormal).every((rank) => rank === 1)).toBe(true);

      const firstBand = orderPreview.find((item) => item.priorityBand === 'CRITICAL');
      const secondBand = orderPreview.find((item) => item.priorityBand === 'CRITICAL' && item.examId !== firstBand.examId);
      if (firstBand && secondBand) {
        expect(firstBand.feasibleOptionCount).toBeLessThanOrEqual(secondBand.feasibleOptionCount);
      }
    });
  });

  describe('candidate filtering and safety', () => {
    let scenario;
    let generated;
    let schedule;

    beforeAll(async () => {
      await truncateAll();
      scenario = await seedFeitScenario({ namespace: 'FEIT-E2E-FILTERS' });
      generated = await generateSchedule({
        semesterId: scenario.semester.id,
        scheduleName: 'FEIT E2E Filters',
      });
      schedule = await loadFullSchedule(generated.scheduleId);
    });

    it('prevents invalid candidates from making it into the final schedule', () => {
      expectHardConstraints(schedule, scenario.semester);
      for (const assignment of schedule.assignments) {
        expect(assignment.room.status).toBe('AVAILABLE');
        expect(assignment.room.capacity).toBeGreaterThanOrEqual(assignment.exam.courseOffering.registrations.length);
        expect(assignment.proctor).toBeDefined();
        expect(assignment.timeSlot).toBeDefined();
      }
    });

    it('never assigns PROJECT/LAB-only offerings', async () => {
      const nonExamOfferings = scenario.offerings.filter(({ plan }) => !plan.hasExam).map(({ offering }) => offering.id);
      const strayExams = await prisma.exam.findMany({ where: { courseOfferingId: { in: nonExamOfferings } } });
      const strayAssignments = await prisma.examAssignment.findMany({ where: { exam: { courseOfferingId: { in: nonExamOfferings } } } });
      expect(strayExams).toHaveLength(0);
      expect(strayAssignments).toHaveLength(0);
    });
  });

  describe('abort on blocking', () => {
    let scenario;
    let beforeCounts;

    beforeEach(async () => {
      await truncateAll();
      scenario = await seedFeitScenario({
        namespace: 'FEIT-E2E-BLOCKED',
        proctorAvailabilityFilter: () => [],
      });
      beforeCounts = {
        schedules: await prisma.schedule.count(),
        assignments: await prisma.examAssignment.count(),
      };
    });

    it('aborts immediately when no valid candidate exists and saves nothing', async () => {
      await expect(
        generateSchedule({
          semesterId: scenario.semester.id,
          scheduleName: 'FEIT E2E Blocked',
        }),
      ).rejects.toThrow(CANDIDATE_MESSAGE);

      const afterCounts = {
        schedules: await prisma.schedule.count(),
        assignments: await prisma.examAssignment.count(),
      };
      expect(afterCounts).toEqual(beforeCounts);
    });

    it('returns the canonical no-feasible-schedule error for unsatisfiable data/resources', async () => {
      await truncateAll();
      const genericScenario = await seedFeitScenario({
        namespace: 'FEIT-E2E-EMPTY-SLOTS',
        dayCount: 0,
        sessions: [],
      });

      await expect(
        generateSchedule({
          semesterId: genericScenario.semester.id,
          scheduleName: 'FEIT E2E Generic Blocked',
        }),
      ).rejects.toThrow(NO_VALID_MESSAGE);
    });
  });
});
