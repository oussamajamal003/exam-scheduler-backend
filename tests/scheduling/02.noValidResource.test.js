// Category 2 — No Valid Resource Scenario
// Verifies the engine refuses to generate when constraints are unsatisfiable
// and surfaces the canonical NO_VALID_SCHEDULE_MESSAGE without writing any
// Schedule/ExamAssignment rows.

import { generateSchedule } from '../../src/modules/scheduling/schedulingService.js';
import prisma, { truncateAll, disconnectPrisma } from '../utils/db.js';
import { seedFeitScenario } from '../utils/feitSeed.js';

const NO_VALID_SCHEDULE = 'No conflict-free schedule exists for current resources/data.';
const NO_VALID_CANDIDATE = 'Exam cannot be assigned.\nNo valid candidate exists.\nGeneration stopped.';

const expectGenerationRejected = async (semesterId, expectedMessage) => {
  const before = {
    schedules: await prisma.schedule.count(),
    assignments: await prisma.examAssignment.count(),
  };
  await expect(
    generateSchedule({ semesterId, scheduleName: 'should not persist' }),
  ).rejects.toThrow(expectedMessage);
  const after = {
    schedules: await prisma.schedule.count(),
    assignments: await prisma.examAssignment.count(),
  };
  expect(after).toEqual(before);
};

describe('Hybrid Scheduler — No Valid Resource Scenario', () => {
  afterAll(async () => {
    await disconnectPrisma();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('rejects generation when there are no proctors at all', async () => {
    const scenario = await seedFeitScenario({
      namespace: 'FEIT-S2A',
      proctorCount: 0,
    });
    await expectGenerationRejected(scenario.semester.id, NO_VALID_SCHEDULE);
  });

  it('rejects generation when there are no time slots in the window', async () => {
    const scenario = await seedFeitScenario({
      namespace: 'FEIT-S2B',
      dayCount: 0,
      sessions: [],
    });
    await expectGenerationRejected(scenario.semester.id, NO_VALID_SCHEDULE);
  });

  it('rejects generation when proctors exist but have zero availability', async () => {
    const scenario = await seedFeitScenario({
      namespace: 'FEIT-S2C',
      proctorAvailabilityFilter: () => [], // no slots marked available
    });
    await expectGenerationRejected(scenario.semester.id, NO_VALID_CANDIDATE);
  });

  it('rejects generation when rooms are starved below required seating', async () => {
    // Keep exactly one real FEIT room (45 seats). This makes the shared
    // 60-80 student exams impossible even if the algorithm splits by room.
    const scenario = await seedFeitScenario({
      namespace: 'FEIT-S2D',
      roomFilter: (room) => room.name === 'Computing Lab C101',
    });
    await expectGenerationRejected(scenario.semester.id, NO_VALID_CANDIDATE);
  });
});
