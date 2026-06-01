import { generateSchedule } from '../../src/modules/scheduling/schedulingService.js';
import prisma, { truncateAll, disconnectPrisma } from '../utils/db.js';
import { loadFullSchedule } from '../utils/assertions.js';

const seedFixedEngineScenario = async (namespace) => {
  const createdBy = `test:${namespace}`;
  const semester = await prisma.semester.create({
    data: {
      name: `Fixed Engine Scenario ${namespace}`,
      startDate: new Date('2026-06-08T00:00:00.000Z'),
      endDate: new Date('2026-06-08T23:59:59.000Z'),
      academicYear: '2025-2026',
      createdBy,
    },
  });

  const department = await prisma.department.create({
    data: {
      name: `Fixed Engine Department ${namespace}`,
      code: `${namespace}-DEPT`,
    },
  });

  const program = await prisma.program.create({
    data: {
      name: `Fixed Engine Program ${namespace}`,
      code: `${namespace}-PROG`,
      departmentId: department.id,
      description: 'Scheduler fixed-engine regression program',
      isActive: true,
      createdBy,
    },
  });

  const center = await prisma.center.create({
    data: {
      name: `Fixed Engine Center ${namespace}`,
      code: `${namespace}-CENTER`,
      location: 'Fixed Engine Test Campus',
      isActive: true,
      createdBy,
    },
  });

  const room = await prisma.room.create({
    data: {
      name: `Fixed Engine Hall ${namespace}`,
      capacity: 120,
      status: 'AVAILABLE',
      centerId: center.id,
      createdBy,
    },
  });

  const slot = await prisma.timeSlot.create({
    data: {
      startTime: new Date('2026-06-08T09:00:00.000Z'),
      endTime: new Date('2026-06-08T11:00:00.000Z'),
      date: new Date('2026-06-08T00:00:00.000Z'),
      duration: 120,
      createdBy,
    },
  });

  const proctors = [];
  for (let index = 0; index < 4; index += 1) {
    const proctorUser = await prisma.user.create({
      data: {
        name: `Fixed Engine Proctor ${namespace} ${index + 1}`,
        email: `${namespace.toLowerCase()}.fixed.proctor${String(index + 1).padStart(2, '0')}@uni.test`,
        password: 'Test12345!',
        role: 'PROCTOR',
      },
    });

    const proctor = await prisma.proctor.create({
      data: {
        userId: proctorUser.id,
        department: 'Exam Operations',
        maxExamsPerDay: 2,
        updatedBy: createdBy,
      },
    });

    await prisma.proctorAvailability.create({
      data: {
        proctorId: proctor.id,
        timeSlotId: slot.id,
      },
    });
    proctors.push(proctor);
  }

  const students = [];
  for (let index = 0; index < 75; index += 1) {
    const user = await prisma.user.create({
      data: {
        name: `Fixed Engine Student ${namespace} ${index + 1}`,
        email: `${namespace.toLowerCase()}.fixed.student${String(index + 1).padStart(3, '0')}@uni.test`,
        password: 'Test12345!',
        role: 'STUDENT',
      },
    });
    const student = await prisma.student.create({
      data: {
        userId: user.id,
        universityId: `${namespace}-STU-${String(index + 1).padStart(3, '0')}`,
        programId: program.id,
        createdBy,
      },
    });
    students.push(student);
  }

  const course = await prisma.course.create({
    data: {
      code: `${namespace}-COURSE`,
      title: `Fixed Engine Course ${namespace}`,
      programId: program.id,
      semesterId: semester.id,
      credits: 3,
      isActive: true,
      createdBy,
    },
  });

  const offering = await prisma.courseOffering.create({
    data: {
      courseId: course.id,
      semesterId: semester.id,
      section: 'A',
      expectedStudents: 75,
      capacity: 120,
      instructor: `Fixed Engine Instructor ${namespace}`,
      status: 'ACTIVE',
      courseType: 'COURSE',
      hasExam: true,
      priority: 90,
      difficulty: 5,
      createdBy,
    },
  });

  await prisma.exam.create({
    data: {
      courseOfferingId: offering.id,
      status: 'DRAFT',
      duration: null,
      createdBy,
    },
  });

  await prisma.registration.createMany({
    data: students.map((student) => ({
      studentId: student.id,
      courseOfferingId: offering.id,
      status: 'ACTIVE',
    })),
    skipDuplicates: true,
  });

  return { semester, offering, room, proctors, slot };
};

describe('Scheduling fixed engine behavior', () => {
  afterAll(async () => {
    await disconnectPrisma();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('uses the built-in internal defaults without scheduling settings', async () => {
    const scenario = await seedFixedEngineScenario('FIXED-ENGINE-DEFAULTS');

    const run = await generateSchedule({
      semesterId: scenario.semester.id,
      scheduleName: 'Fixed engine defaults',
    });

    const schedule = await loadFullSchedule(run.scheduleId);
    const targetAssignments = schedule.assignments.filter(
      (assignment) => assignment.exam.courseOfferingId === scenario.offering.id,
    );

    expect(run.assignmentsCount).toBeGreaterThan(0);
    expect(targetAssignments).toHaveLength(4);
    expect(new Set(targetAssignments.map((assignment) => assignment.proctorId)).size).toBe(4);
    expect(targetAssignments[0].timeSlot.startTime.getUTCHours()).toBe(9);
    expect(targetAssignments[0].exam.duration ?? 120).toBe(120);
  });

  it('applies the fixed 20-student proctor rule', async () => {
    const scenario = await seedFixedEngineScenario('FIXED-ENGINE-PROCTORS');

    const run = await generateSchedule({
      semesterId: scenario.semester.id,
      scheduleName: 'Fixed engine proctors',
    });

    const schedule = await loadFullSchedule(run.scheduleId);
    const targetAssignments = schedule.assignments.filter(
      (assignment) => assignment.exam.courseOfferingId === scenario.offering.id,
    );

    expect(run.assignmentsCount).toBeGreaterThan(0);
    expect(Math.max(1, Math.ceil(75 / 20))).toBe(4);
    expect(targetAssignments).toHaveLength(4);
    expect(new Set(targetAssignments.map((assignment) => assignment.proctorId)).size).toBe(4);
    expect(scenario.proctors).toHaveLength(4);
  });
});
