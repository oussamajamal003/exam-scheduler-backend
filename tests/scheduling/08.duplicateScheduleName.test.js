import { generateSchedule } from '../../src/modules/scheduling/schedulingService.js';
import prisma, { truncateAll, disconnectPrisma } from '../utils/db.js';
import { seedFeitScenario } from '../utils/feitSeed.js';

const DUPLICATE_NAME_MESSAGE = 'A schedule with this name already exists. Choose a different name.';

describe('Hybrid Scheduler — Duplicate Schedule Name Guard', () => {
  let scenario;

  beforeEach(async () => {
    await truncateAll();
    scenario = await seedFeitScenario({ namespace: 'FEIT-S8' });
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it('rejects a duplicate generation attempt without creating partial schedules or assignments', async () => {
    const scheduleName = 'FEIT Duplicate Check';

    const firstResult = await generateSchedule({
      semesterId: scenario.semester.id,
      scheduleName,
    });

    const beforeRetry = {
      schedules: await prisma.schedule.count(),
      assignments: await prisma.examAssignment.count(),
      exams: await prisma.exam.count({ where: { status: 'SCHEDULED' } }),
    };

    await expect(
      generateSchedule({
        semesterId: scenario.semester.id,
        scheduleName: `  ${scheduleName}  `,
      }),
    ).rejects.toThrow(DUPLICATE_NAME_MESSAGE);

    const afterRetry = {
      schedules: await prisma.schedule.count(),
      assignments: await prisma.examAssignment.count(),
      exams: await prisma.exam.count({ where: { status: 'SCHEDULED' } }),
    };

    expect(afterRetry).toEqual(beforeRetry);

    const schedules = await prisma.schedule.findMany({
      where: { name: scheduleName },
      select: { id: true, name: true },
    });

    expect(schedules).toHaveLength(1);
    expect(schedules[0].id).toBe(firstResult.scheduleId);
  });
});