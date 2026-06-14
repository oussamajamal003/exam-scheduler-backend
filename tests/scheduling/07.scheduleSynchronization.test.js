import { generateSchedule } from '../../src/modules/scheduling/schedulingService.js';
import { remove as removeAssignment } from '../../src/modules/assignments/assignmentsService.js';
import { remove as removeRoom } from '../../src/modules/rooms/roomsService.js';
import prisma, { truncateAll, disconnectPrisma } from '../utils/db.js';
import { seedFeitScenario } from '../utils/feitSeed.js';

const pickSingleRoomAssignment = async (scheduleId) => {
  const assignments = await prisma.examAssignment.findMany({
    where: { scheduleId },
    select: {
      id: true,
      examId: true,
      roomId: true,
      timeSlotId: true,
    },
    orderBy: [{ examId: 'asc' }, { id: 'asc' }],
  });

  const groups = new Map();
  for (const assignment of assignments) {
    const key = `${assignment.examId}:${assignment.timeSlotId}`;
    const group = groups.get(key) ?? { roomIds: new Set(), assignments: [] };
    group.roomIds.add(assignment.roomId);
    group.assignments.push(assignment);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    if (group.roomIds.size === 1 && group.assignments.length >= 1) {
      return group.assignments[0];
    }
  }

  throw new Error('Expected at least one exam assignment group backed by a single room.');
};

describe('Schedule synchronization', () => {
  afterAll(async () => {
    await disconnectPrisma();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('blocks deleting a room referenced by schedule assignments', async () => {
    const scenario = await seedFeitScenario({ namespace: 'FEIT-SYNC-ROOM' });
    const generated = await generateSchedule({
      semesterId: scenario.semester.id,
      scheduleName: 'Sync Room Deletion',
    });

    const targetAssignment = await pickSingleRoomAssignment(generated.scheduleId);

    await expect(removeRoom(targetAssignment.roomId)).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining('Cannot delete Room'),
    });

    const room = await prisma.room.findUnique({ where: { id: targetAssignment.roomId } });
    const remainingAssignment = await prisma.examAssignment.findUnique({ where: { id: targetAssignment.id } });

    expect(room).not.toBeNull();
    expect(remainingAssignment).not.toBeNull();
  });

  it('refreshes the impacted schedule when an assignment is deleted directly', async () => {
    const scenario = await seedFeitScenario({ namespace: 'FEIT-SYNC-ASSIGNMENT' });
    const generated = await generateSchedule({
      semesterId: scenario.semester.id,
      scheduleName: 'Sync Assignment Deletion',
    });

    const unrelatedSchedule = await prisma.schedule.create({
      data: {
        name: 'Unrelated Assignment Sync Schedule',
        generationStage: 'GENERATED',
        qualityScore: 81,
        hardConstraintScore: 0,
        softConstraintScore: 0,
      },
    });

    const targetAssignment = await pickSingleRoomAssignment(generated.scheduleId);
    const impactedScheduleBefore = await prisma.schedule.findUnique({
      where: { id: generated.scheduleId },
      select: { id: true, updatedAt: true, hardConstraintScore: true, generationStage: true },
    });
    const unrelatedBefore = await prisma.schedule.findUnique({
      where: { id: unrelatedSchedule.id },
      select: { id: true, updatedAt: true },
    });

    await removeAssignment(generated.scheduleId, targetAssignment.id);

    const remainingAssignment = await prisma.examAssignment.findUnique({ where: { id: targetAssignment.id } });
    const impactedScheduleAfter = await prisma.schedule.findUnique({
      where: { id: generated.scheduleId },
      select: {
        id: true,
        updatedAt: true,
        hardConstraintScore: true,
        generationStage: true,
        algorithmMetadata: true,
      },
    });
    const unrelatedAfter = await prisma.schedule.findUnique({
      where: { id: unrelatedSchedule.id },
      select: { id: true, updatedAt: true, hardConstraintScore: true, generationStage: true },
    });

    expect(remainingAssignment).toBeNull();
    expect(impactedScheduleAfter.updatedAt.getTime()).toBeGreaterThan(impactedScheduleBefore.updatedAt.getTime());
    expect(impactedScheduleAfter.generationStage).toBe('BLOCKED');
    expect(impactedScheduleAfter.hardConstraintScore).toBeGreaterThan(0);
    expect(
      (impactedScheduleAfter.algorithmMetadata?.scheduleSync?.issues?.requiredProctorShortage ?? 0)
      + (impactedScheduleAfter.algorithmMetadata?.scheduleSync?.issues?.derivedConflicts ?? 0),
    ).toBeGreaterThan(0);

    expect(unrelatedAfter.updatedAt.getTime()).toBe(unrelatedBefore.updatedAt.getTime());
    expect(unrelatedAfter.generationStage).toBe('GENERATED');
    expect(unrelatedAfter.hardConstraintScore).toBe(0);
  });

});
