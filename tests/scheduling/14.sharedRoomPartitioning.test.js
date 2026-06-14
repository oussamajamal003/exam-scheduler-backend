import { generateSchedule, getScheduleAnalysis } from '../../src/modules/scheduling/schedulingService.js';
import prisma, { truncateAll, disconnectPrisma } from '../utils/db.js';
import { loadFullSchedule, expectNoStudentOverlap, expectNoRoomDoubleBooking, expectNoProctorDoubleBooking, expectCapacityRespected, expectDurationsFit } from '../utils/assertions.js';

const seedSharedRoomScenario = async (namespace) => {
  const createdBy = `test:${namespace}`;
  const semester = await prisma.semester.create({
    data: {
      name: `Shared-room Scenario ${namespace}`,
      startDate: new Date('2026-06-10T00:00:00.000Z'),
      endDate: new Date('2026-06-10T23:59:59.000Z'),
      academicYear: '2025-2026',
      isActive: true,
      createdBy,
    },
  });

  const department = await prisma.department.create({
    data: { name: `Shared-room Department ${namespace}`, code: `${namespace}-DEPT` },
  });

  const program = await prisma.program.create({
    data: {
      name: `Shared-room Program ${namespace}`,
      code: `${namespace}-PROG`,
      departmentId: department.id,
      createdBy,
      isActive: true,
    },
  });

  const center = await prisma.center.create({
    data: {
      name: `Shared-room Center ${namespace}`,
      code: `${namespace}-CENTER`,
      isActive: true,
      createdBy,
    },
  });

  const room = await prisma.room.create({
    data: {
      name: `Shared-room Hall ${namespace}`,
      capacity: 300,
      status: 'AVAILABLE',
      centerId: center.id,
      createdBy,
    },
  });

  const slot = await prisma.timeSlot.create({
    data: {
      startTime: new Date('2026-06-10T09:00:00.000Z'),
      endTime: new Date('2026-06-10T11:00:00.000Z'),
      date: new Date('2026-06-10T00:00:00.000Z'),
      duration: 120,
      createdBy,
    },
  });

  // 9 proctors available for the single slot.
  const proctors = [];
  for (let index = 0; index < 9; index += 1) {
    const user = await prisma.user.create({
      data: {
        name: `Shared-room Proctor ${namespace} ${index + 1}`,
        email: `${namespace.toLowerCase()}.shared.proctor${String(index + 1).padStart(2, '0')}@uni.test`,
        password: 'Test12345!',
        role: 'PROCTOR',
      },
    });

    const proctor = await prisma.proctor.create({
      data: {
        userId: user.id,
        department: 'Exam Operations',
        maxExamsPerDay: 2,
        createdBy,
        updatedBy: createdBy,
      },
    });
    await prisma.proctorAvailability.create({
      data: { proctorId: proctor.id, timeSlotId: slot.id },
    });
    proctors.push(proctor);
  }

  const makeStudents = async (prefix, count) => {
    const rows = [];
    for (let index = 0; index < count; index += 1) {
      const user = await prisma.user.create({
        data: {
          name: `Shared-room Student ${prefix} ${index + 1}`,
          email: `${namespace.toLowerCase()}.shared.${prefix}.student${String(index + 1).padStart(3, '0')}@uni.test`,
          password: 'Test12345!',
          role: 'STUDENT',
        },
      });
      const student = await prisma.student.create({
        data: {
          userId: user.id,
          universityId: `${namespace}-${prefix}-STU-${String(index + 1).padStart(3, '0')}`,
          programId: program.id,
          createdBy,
        },
      });
      rows.push(student);
    }
    return rows;
  };

  const studentsA = await makeStudents('A', 100);
  const studentsB = await makeStudents('B', 80);

  const mkOffering = async (code, title) => {
    const course = await prisma.course.create({
      data: {
        code,
        title,
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
        expectedStudents: 0,
        capacity: 400,
        instructor: `Shared-room Instructor ${namespace}`,
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
    return { course, offering, exam };
  };

  const examA = await mkOffering(`${namespace}-EXA`, `Shared-room Exam A ${namespace}`);
  const examB = await mkOffering(`${namespace}-EXB`, `Shared-room Exam B ${namespace}`);

  await prisma.registration.createMany({
    data: studentsA.map((student) => ({
      studentId: student.id,
      courseOfferingId: examA.offering.id,
      status: 'ACTIVE',
    })),
    skipDuplicates: true,
  });
  await prisma.registration.createMany({
    data: studentsB.map((student) => ({
      studentId: student.id,
      courseOfferingId: examB.offering.id,
      status: 'ACTIVE',
    })),
    skipDuplicates: true,
  });

  return {
    semester,
    room,
    slot,
    proctors,
    offerings: [examA.offering, examB.offering],
  };
};

describe('Hybrid Scheduler — Shared-room scheduling (room partitioning)', () => {
  afterAll(async () => {
    await disconnectPrisma();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('allows multiple exams to share the same room+timeslot when capacity allows and shares the proctor group', async () => {
    const scenario = await seedSharedRoomScenario('SHARED-ROOM');
    const generated = await generateSchedule({
      semesterId: scenario.semester.id,
      scheduleName: 'Shared Room Partitioning',
    });

    const schedule = await loadFullSchedule(generated.scheduleId);
    expectNoStudentOverlap(schedule);
    expectNoRoomDoubleBooking(schedule);
    expectNoProctorDoubleBooking(schedule);
    expectCapacityRespected(schedule);
    expectDurationsFit(schedule);

    const examsInSchedule = new Set(schedule.assignments.map((a) => a.examId));
    expect(examsInSchedule.size).toBe(2);

    const roomIds = new Set(schedule.assignments.map((a) => a.roomId));
    const slotIds = new Set(schedule.assignments.map((a) => a.timeSlotId));
    expect(roomIds.size).toBe(1);
    expect(slotIds.size).toBe(1);

    const proctorIds = new Set(schedule.assignments.map((a) => a.proctorId));
    // Total students = 100 + 80 = 180 -> required proctors = ceil(180/20) = 9.
    expect(proctorIds.size).toBe(9);

    const analysis = await getScheduleAnalysis(generated.scheduleId);
    expect(analysis.metrics.totalConflicts).toBe(0);
    expect(analysis.conflicts.derived.roomCapacityViolations).toHaveLength(0);
    expect(analysis.conflicts.derived.proctorConflicts).toHaveLength(0);
    expect(analysis.conflicts.derived.proctorDailyLoadViolations).toHaveLength(0);
    expect(analysis.metrics.averageRoomUtilization).toBeCloseTo(180 / 300, 3);
  });
});

