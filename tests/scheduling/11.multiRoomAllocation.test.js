import { generateSchedule } from '../../src/modules/scheduling/schedulingService.js';
import prisma, { truncateAll, disconnectPrisma } from '../utils/db.js';
import { loadFullSchedule, expectNoRoomDoubleBooking, expectNoProctorDoubleBooking, expectNoStudentOverlap, expectCapacityRespected, expectDurationsFit } from '../utils/assertions.js';

const seedMultiRoomScenario = async (namespace) => {
  const createdBy = `test:${namespace}`;
  const semester = await prisma.semester.create({
    data: {
      name: `Multi-room Scenario ${namespace}`,
      startDate: new Date('2026-06-08T00:00:00.000Z'),
      endDate: new Date('2026-06-08T23:59:59.000Z'),
      academicYear: '2025-2026',
      isActive: true,
      createdBy,
    },
  });

  const department = await prisma.department.create({
    data: {
      name: `Multi-room Department ${namespace}`,
      code: `${namespace}-DEPT`,
    },
  });

  const program = await prisma.program.create({
    data: {
      name: `Multi-room Program ${namespace}`,
      code: `${namespace}-PROG`,
      departmentId: department.id,
      createdBy,
      isActive: true,
    },
  });

  const center = await prisma.center.create({
    data: {
      name: `Multi-room Center ${namespace}`,
      code: `${namespace}-CENTER`,
      isActive: true,
      createdBy,
    },
  });

  const rooms = await Promise.all([
    prisma.room.create({
      data: {
        name: `Multi-room Hall ${namespace} A`,
        capacity: 40,
        status: 'AVAILABLE',
        centerId: center.id,
        createdBy,
      },
    }),
    prisma.room.create({
      data: {
        name: `Multi-room Hall ${namespace} B`,
        capacity: 45,
        status: 'AVAILABLE',
        centerId: center.id,
        createdBy,
      },
    }),
  ]);

  const slot = await prisma.timeSlot.create({
    data: {
      startTime: new Date('2026-06-08T09:00:00.000Z'),
      endTime: new Date('2026-06-08T11:00:00.000Z'),
      date: new Date('2026-06-08T00:00:00.000Z'),
      duration: 120,
      createdBy,
    },
  });

  for (let index = 0; index < 5; index += 1) {
    const user = await prisma.user.create({
      data: {
        name: `Multi-room Proctor ${namespace} ${index + 1}`,
        email: `${namespace.toLowerCase()}.multi.proctor${String(index + 1).padStart(2, '0')}@uni.test`,
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
      data: {
        proctorId: proctor.id,
        timeSlotId: slot.id,
      },
    });
  }

  const students = [];
  for (let index = 0; index < 75; index += 1) {
    const user = await prisma.user.create({
      data: {
        name: `Multi-room Student ${namespace} ${index + 1}`,
        email: `${namespace.toLowerCase()}.multi.student${String(index + 1).padStart(3, '0')}@uni.test`,
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
      title: `Multi-room Course ${namespace}`,
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
      instructor: `Multi-room Instructor ${namespace}`,
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

  return { semester, offering, rooms, slot };
};

describe('Hybrid Scheduler — Multi-room candidate allocation', () => {
  afterAll(async () => {
    await disconnectPrisma();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('splits one exam across multiple rooms when no single room fits', async () => {
    const scenario = await seedMultiRoomScenario('MULTI-ROOM-SPLIT');

    const generated = await generateSchedule({
      semesterId: scenario.semester.id,
      scheduleName: 'Multi-room split regression',
    });

    const schedule = await loadFullSchedule(generated.scheduleId);
    const targetAssignments = schedule.assignments.filter(
      (assignment) => assignment.exam.courseOfferingId === scenario.offering.id,
    );

    expect(targetAssignments).toHaveLength(5);
    expect(new Set(targetAssignments.map((assignment) => assignment.roomId)).size).toBe(2);
    expect(new Set(targetAssignments.map((assignment) => assignment.timeSlotId)).size).toBe(1);
    expectNoRoomDoubleBooking(schedule);
    expectNoProctorDoubleBooking(schedule);
    expectNoStudentOverlap(schedule);
    expectCapacityRespected(schedule);
    expectDurationsFit(schedule);
  });
});
