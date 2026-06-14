import prisma, { truncateAll, disconnectPrisma } from '../utils/db.js';
import { loadFullSchedule } from '../utils/assertions.js';
import { generateSchedule, getScheduleAnalysis } from '../../src/modules/scheduling/schedulingService.js';

const makeDate = (iso) => new Date(`${iso}Z`);

const createStudentCohort = async ({ namespace, count, programId, createdBy }) => {
  const students = [];
  for (let index = 0; index < count; index += 1) {
    const user = await prisma.user.create({
      data: {
        name: `${namespace} Student ${index + 1}`,
        email: `${namespace.toLowerCase()}.student${String(index + 1).padStart(3, '0')}@uni.test`,
        password: 'Test12345!',
        role: 'STUDENT',
      },
    });

    const student = await prisma.student.create({
      data: {
        userId: user.id,
        universityId: `${namespace}-STU-${String(index + 1).padStart(3, '0')}`,
        programId,
        createdBy,
      },
    });
    students.push(student);
  }
  return students;
};

const seedRoomUtilizationScenario = async (namespace) => {
  const createdBy = `test:${namespace}`;
  const semester = await prisma.semester.create({
    data: {
      name: `${namespace} Semester`,
      startDate: makeDate('2026-06-08T00:00:00.000'),
      endDate: makeDate('2026-06-08T23:59:59.000'),
      academicYear: '2025-2026',
      isActive: true,
      createdBy,
    },
  });

  const department = await prisma.department.create({
    data: {
      name: `${namespace} Department`,
      code: `${namespace}-DEPT`,
    },
  });

  const program = await prisma.program.create({
    data: {
      name: `${namespace} Program`,
      code: `${namespace}-PROG`,
      departmentId: department.id,
      createdBy,
      isActive: true,
    },
  });

  const center = await prisma.center.create({
    data: {
      name: `${namespace} Center`,
      code: `${namespace}-CENTER`,
      isActive: true,
      createdBy,
    },
  });

  const [smallRoom, largeRoom] = await Promise.all([
    prisma.room.create({
      data: {
        name: `${namespace} Room Small`,
        capacity: 30,
        status: 'AVAILABLE',
        centerId: center.id,
        createdBy,
      },
    }),
    prisma.room.create({
      data: {
        name: `${namespace} Room Large`,
        capacity: 100,
        status: 'AVAILABLE',
        centerId: center.id,
        createdBy,
      },
    }),
  ]);

  const slot = await prisma.timeSlot.create({
    data: {
      startTime: makeDate('2026-06-08T09:00:00.000'),
      endTime: makeDate('2026-06-08T11:00:00.000'),
      date: makeDate('2026-06-08T00:00:00.000'),
      duration: 120,
      createdBy,
    },
  });

  const proctors = [];
  for (let index = 0; index < 2; index += 1) {
    const proctorUser = await prisma.user.create({
      data: {
        name: `${namespace} Proctor ${index + 1}`,
        email: `${namespace.toLowerCase()}.proctor${index + 1}@uni.test`,
        password: 'Test12345!',
        role: 'PROCTOR',
      },
    });

    const proctor = await prisma.proctor.create({
      data: {
        userId: proctorUser.id,
        department: 'Exam Operations',
        maxExamsPerDay: 2,
        createdBy,
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

  const students = await createStudentCohort({
    namespace,
    count: 25,
    programId: program.id,
    createdBy,
  });

  const course = await prisma.course.create({
    data: {
      code: `${namespace}-COURSE`,
      title: `${namespace} Course`,
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
      expectedStudents: students.length,
      capacity: 40,
      instructor: `${namespace} Instructor`,
      status: 'ACTIVE',
      courseType: 'COURSE',
      hasExam: true,
      priority: 90,
      difficulty: 5,
      createdBy,
    },
  });

  const exam = await prisma.exam.create({
    data: {
      courseOfferingId: offering.id,
      status: 'DRAFT',
      duration: 120,
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

  return {
    semester,
    roomSmall: smallRoom,
    roomLarge: largeRoom,
    slot,
    proctors,
    exam,
    offering,
  };
};

const seedBalancedProctorScenario = async (namespace) => {
  const createdBy = `test:${namespace}`;
  const semester = await prisma.semester.create({
    data: {
      name: `${namespace} Semester`,
      startDate: makeDate('2026-06-09T00:00:00.000'),
      endDate: makeDate('2026-06-09T23:59:59.000'),
      academicYear: '2025-2026',
      isActive: true,
      createdBy,
    },
  });

  const department = await prisma.department.create({
    data: {
      name: `${namespace} Department`,
      code: `${namespace}-DEPT`,
    },
  });

  const program = await prisma.program.create({
    data: {
      name: `${namespace} Program`,
      code: `${namespace}-PROG`,
      departmentId: department.id,
      createdBy,
      isActive: true,
    },
  });

  const center = await prisma.center.create({
    data: {
      name: `${namespace} Center`,
      code: `${namespace}-CENTER`,
      isActive: true,
      createdBy,
    },
  });

  const [roomA, roomB] = await Promise.all([
    prisma.room.create({
      data: {
        name: `${namespace} Room A`,
        capacity: 35,
        status: 'AVAILABLE',
        centerId: center.id,
        createdBy,
      },
    }),
    prisma.room.create({
      data: {
        name: `${namespace} Room B`,
        capacity: 35,
        status: 'AVAILABLE',
        centerId: center.id,
        createdBy,
      },
    }),
  ]);

  const slotMorning = await prisma.timeSlot.create({
    data: {
      startTime: makeDate('2026-06-09T09:00:00.000'),
      endTime: makeDate('2026-06-09T11:00:00.000'),
      date: makeDate('2026-06-09T00:00:00.000'),
      duration: 120,
      createdBy,
    },
  });

  const slotAfternoon = await prisma.timeSlot.create({
    data: {
      startTime: makeDate('2026-06-09T13:00:00.000'),
      endTime: makeDate('2026-06-09T15:00:00.000'),
      date: makeDate('2026-06-09T00:00:00.000'),
      duration: 120,
      createdBy,
    },
  });

  const proctors = [];
  for (let index = 0; index < 4; index += 1) {
    const user = await prisma.user.create({
      data: {
        name: `${namespace} Proctor ${index + 1}`,
        email: `${namespace.toLowerCase()}.proctor${String(index + 1).padStart(2, '0')}@uni.test`,
        password: 'Test12345!',
        role: 'PROCTOR',
      },
    });

    const proctor = await prisma.proctor.create({
      data: {
        userId: user.id,
        department: 'Exam Operations',
        maxExamsPerDay: 1,
        createdBy,
        updatedBy: createdBy,
      },
    });

    await prisma.proctorAvailability.createMany({
      data: [
        { proctorId: proctor.id, timeSlotId: slotMorning.id },
        { proctorId: proctor.id, timeSlotId: slotAfternoon.id },
      ],
      skipDuplicates: true,
    });

    proctors.push(proctor);
  }

  const offerings = [];
  for (let index = 0; index < 4; index += 1) {
    const students = await createStudentCohort({
      namespace: `${namespace}-C${index + 1}`,
      count: 10,
      programId: program.id,
      createdBy,
    });

    const course = await prisma.course.create({
      data: {
        code: `${namespace}-COURSE-${index + 1}`,
        title: `${namespace} Course ${index + 1}`,
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
        expectedStudents: students.length,
        capacity: 20,
        instructor: `${namespace} Instructor ${index + 1}`,
        status: 'ACTIVE',
        courseType: 'COURSE',
        hasExam: true,
        priority: 80,
        difficulty: 5,
        createdBy,
      },
    });

    await prisma.exam.create({
      data: {
        courseOfferingId: offering.id,
        status: 'DRAFT',
        duration: 120,
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

    offerings.push(offering);
  }

  return {
    semester,
    rooms: [roomA, roomB],
    slots: [slotMorning, slotAfternoon],
    proctors,
    offerings,
  };
};

describe('Hybrid Scheduler - analytics results', () => {
  afterAll(async () => {
    await disconnectPrisma();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('respects room capacity and scores efficient room assignments higher than inefficient ones', async () => {
    const scenario = await seedRoomUtilizationScenario('ANALYTICS-ROOMS');

    const efficientSchedule = await prisma.schedule.create({
      data: {
        name: 'Room Utilization Efficient',
        isFinal: true,
        createdBy: `test:ANALYTICS-ROOMS`,
      },
    });
    await prisma.examAssignment.createMany({
      data: scenario.proctors.map((proctor) => ({
        scheduleId: efficientSchedule.id,
        examId: scenario.exam.id,
        roomId: scenario.roomSmall.id,
        proctorId: proctor.id,
        timeSlotId: scenario.slot.id,
      })),
      skipDuplicates: true,
    });
    const efficientAnalysis = await getScheduleAnalysis(efficientSchedule.id);

    const inefficientSchedule = await prisma.schedule.create({
      data: {
        name: 'Room Utilization Inefficient',
        isFinal: true,
        createdBy: `test:ANALYTICS-ROOMS`,
      },
    });
    await prisma.examAssignment.createMany({
      data: scenario.proctors.map((proctor) => ({
        scheduleId: inefficientSchedule.id,
        examId: scenario.exam.id,
        roomId: scenario.roomLarge.id,
        proctorId: proctor.id,
        timeSlotId: scenario.slot.id,
      })),
      skipDuplicates: true,
    });

    const inefficientAnalysis = await getScheduleAnalysis(inefficientSchedule.id);

    expect(efficientAnalysis.metrics.totalConflicts).toBe(0);
    expect(efficientAnalysis.conflicts.derived.roomCapacityViolations).toHaveLength(0);
    expect(efficientAnalysis.metrics.averageRoomUtilization).toBeCloseTo(25 / 30, 3);
    expect(inefficientAnalysis.metrics.totalConflicts).toBe(0);
    expect(inefficientAnalysis.conflicts.derived.roomCapacityViolations).toHaveLength(0);
    expect(inefficientAnalysis.metrics.averageRoomUtilization).toBeCloseTo(25 / 100, 3);
    expect(efficientAnalysis.metrics.averageRoomUtilization).toBeGreaterThan(inefficientAnalysis.metrics.averageRoomUtilization);
  });

  it('keeps proctor assignments balanced, within daily limits, and conflict-free', async () => {
    const scenario = await seedBalancedProctorScenario('ANALYTICS-PROCTORS');

    const generated = await generateSchedule({
      semesterId: scenario.semester.id,
      scheduleName: 'Balanced Proctor Distribution',
    });
    const analysis = await getScheduleAnalysis(generated.scheduleId);

    const loadedSchedule = await loadFullSchedule(generated.scheduleId);
    const loadByProctor = new Map();
    const dailyLoadByProctor = new Map();
    const sessionPairs = new Set();
    const proctorSlotRooms = new Map();

    for (const assignment of loadedSchedule.assignments ?? []) {
      const proctorId = assignment.proctorId;
      const sessionKey = `${proctorId}:${assignment.timeSlotId}:${assignment.roomId}`;
      if (!sessionPairs.has(sessionKey)) {
        sessionPairs.add(sessionKey);
        loadByProctor.set(proctorId, (loadByProctor.get(proctorId) ?? 0) + 1);

        const day = assignment.timeSlot.date.toISOString().slice(0, 10);
        const dayKey = `${proctorId}:${day}`;
        dailyLoadByProctor.set(dayKey, (dailyLoadByProctor.get(dayKey) ?? 0) + 1);
      }

      const slotKey = `${proctorId}:${assignment.timeSlotId}`;
      if (!proctorSlotRooms.has(slotKey)) proctorSlotRooms.set(slotKey, new Set());
      proctorSlotRooms.get(slotKey).add(assignment.roomId);
    }

    const loads = [...loadByProctor.values()];
    const maxLoad = Math.max(...loads);
    const minLoad = Math.min(...loads);

    expect(analysis.metrics.totalConflicts).toBe(0);
    expect(analysis.conflicts.derived.proctorConflicts).toHaveLength(0);
    expect(analysis.conflicts.derived.proctorDailyLoadViolations).toHaveLength(0);
    expect([...proctorSlotRooms.values()].every((rooms) => rooms.size === 1)).toBe(true);
    expect(maxLoad - minLoad).toBeLessThanOrEqual(1);
    expect([...dailyLoadByProctor.values()].every((count) => count <= 1)).toBe(true);
    expect(generated.algorithm.qualityMetrics.proctorWorkloadBalance).toBeDefined();
  });
});
