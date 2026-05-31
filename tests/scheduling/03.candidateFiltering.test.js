// Category 3 — Candidate Filtering
// Validates the candidate-selection invariants of the hybrid algorithm by
// inspecting the resulting assignments on the realistic FEIT scenario:
//   * every chosen (room, time) candidate respects student/room/proctor non-overlap
//   * every chosen time slot duration is large enough for the exam duration
//   * every chosen time slot lies inside the semester window
//   * every chosen proctor is in their availability set for the assigned slot
//   * candidate rooms total capacity always >= required seats for the exam

import { generateSchedule, getScheduleAnalysis } from '../../src/modules/scheduling/schedulingService.js';
import prisma, { truncateAll, disconnectPrisma } from '../utils/db.js';
import { seedFeitScenario } from '../utils/feitSeed.js';
import {
  loadFullSchedule,
  expectNoRoomDoubleBooking,
  expectNoProctorDoubleBooking,
  expectNoStudentOverlap,
  expectDurationsFit,
  expectCapacityRespected,
} from '../utils/assertions.js';

describe('Hybrid Scheduler — Candidate Filtering (FEIT Spring 2026)', () => {
  let scenario;
  let generated;
  let schedule;

  beforeAll(async () => {
    await truncateAll();
    scenario = await seedFeitScenario({ namespace: 'FEIT-S3' });
    generated = await generateSchedule({
      semesterId: scenario.semester.id,
      scheduleName: 'FEIT S3 Candidate Filtering',
    });
    schedule = await loadFullSchedule(generated.scheduleId);
  });

  it('every assignment satisfies all hard-constraint candidate filters', () => {
    expectNoRoomDoubleBooking(schedule);
    expectNoProctorDoubleBooking(schedule);
    expectNoStudentOverlap(schedule);
    expectDurationsFit(schedule);
    expectCapacityRespected(schedule);
  });

  it('every chosen time slot lies inside the semester start/end window', () => {
    const start = scenario.semester.startDate.getTime();
    const end = scenario.semester.endDate.getTime();
    for (const a of schedule.assignments) {
      expect(a.timeSlot.startTime.getTime()).toBeGreaterThanOrEqual(start);
      expect(a.timeSlot.endTime.getTime()).toBeLessThanOrEqual(end);
    }
  });

  it('every chosen proctor is in their availability set for the assigned time slot', async () => {
    const availabilityKeys = new Set(
      (await prisma.proctorAvailability.findMany({ select: { proctorId: true, timeSlotId: true } }))
        .map((row) => `${row.proctorId}:${row.timeSlotId}`),
    );
    for (const a of schedule.assignments) {
      expect(availabilityKeys.has(`${a.proctorId}:${a.timeSlotId}`)).toBe(true);
    }
  });

  it('every chosen room actually belongs to its center (no fabricated rooms)', async () => {
    const validRoomIds = new Set((await prisma.room.findMany({ select: { id: true } })).map((r) => r.id));
    for (const a of schedule.assignments) {
      expect(validRoomIds.has(a.roomId)).toBe(true);
    }
  });

  it('candidate filter excludes PROJECT/LAB offerings (no exam rows created)', async () => {
    const nonExamOfferingIds = scenario.offerings
      .filter(({ plan }) => !plan.hasExam)
      .map(({ offering }) => offering.id);

    const exams = await prisma.exam.findMany({
      where: { courseOfferingId: { in: nonExamOfferingIds } },
    });
    expect(exams).toHaveLength(0);

    const assignments = await prisma.examAssignment.findMany({
      where: { exam: { courseOfferingId: { in: nonExamOfferingIds } } },
    });
    expect(assignments).toHaveLength(0);
  });
});

describe('Hybrid Scheduler — Multi-room candidate allocation', () => {
  let generated;
  let schedule;

  beforeAll(async () => {
    await truncateAll();
    const scenario = await seedFeitScenario({
      namespace: 'FEIT-MR',
      studentCount: 60,
      proctorCount: 12,
      roomFilter: (room) => room.centerCode === 'FEIT-C' && room.name.startsWith('Computing Lab'),
    });
    generated = await generateSchedule({
      semesterId: scenario.semester.id,
      scheduleName: 'FEIT Multi-room Candidate Allocation',
    });
    schedule = await loadFullSchedule(generated.scheduleId);
  });

  it('splits an exam across multiple rooms in one time slot when no single room fits', async () => {
    const groups = new Map();
    for (const assignment of schedule.assignments) {
      const key = `${assignment.examId}:${assignment.timeSlotId}`;
      const group = groups.get(key) ?? [];
      group.push(assignment);
      groups.set(key, group);
    }

    const splitGroup = [...groups.values()].find((group) => {
      const roomIds = new Set(group.map((assignment) => assignment.roomId));
      const requiredSeats = assignmentStudentCount(group[0]);
      const maxRoomCapacity = Math.max(...group.map((assignment) => assignment.room?.capacity ?? 0));
      return roomIds.size > 1 && requiredSeats > maxRoomCapacity;
    });

    expect(splitGroup).toBeDefined();
    const roomIds = new Set(splitGroup.map((assignment) => assignment.roomId));
    const proctorIds = new Set(splitGroup.map((assignment) => assignment.proctorId));
    const totalCapacity = [...new Map(splitGroup.map((assignment) => [assignment.roomId, assignment.room])).values()]
      .reduce((sum, room) => sum + (room?.capacity ?? 0), 0);

    expect(roomIds.size).toBeGreaterThan(1);
    expect(proctorIds.size).toBeGreaterThanOrEqual(roomIds.size);
    expect(totalCapacity).toBeGreaterThanOrEqual(assignmentStudentCount(splitGroup[0]));

    expectNoRoomDoubleBooking(schedule);
    expectNoProctorDoubleBooking(schedule);
    expectNoStudentOverlap(schedule);
    expectCapacityRespected(schedule);

    const analysis = await getScheduleAnalysis(generated.scheduleId);
    expect(analysis.metrics.totalConflicts).toBe(0);
  });
});

const assignmentStudentCount = (assignment) => (
  assignment.exam?.courseOffering?.registrations?.length
  ?? assignment.exam?.courseOffering?.expectedStudents
  ?? 0
);

afterAll(async () => {
  await disconnectPrisma();
});
