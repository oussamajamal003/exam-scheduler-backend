import { getAll, remove } from '../../src/modules/semesters/semestersService.js';
import prisma, { truncateAll, disconnectPrisma } from '../utils/db.js';

const createDate = (date, time) => new Date(`${date}T${time}:00.000Z`);

describe('semesters service', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it('collapses duplicate demo dataset semesters in the semester list', async () => {
    const createdBy = '7be7fab7-81af-4676-b735-fdd6c9c28693';
    const duplicate = await prisma.semester.create({
      data: {
        name: 'Demo Dataset A - Balanced Fall 2026',
        startDate: createDate('2026-12-07', '00:00'),
        endDate: createDate('2026-12-17', '23:59'),
        academicYear: '2026-2027',
        createdBy,
      },
    });

    const canonical = await prisma.semester.create({
      data: {
        name: 'Demo Dataset A - Balanced Fall 2026',
        startDate: createDate('2026-12-07', '00:00'),
        endDate: createDate('2026-12-17', '23:59'),
        academicYear: '2026-2027',
        createdBy,
      },
    });

    const department = await prisma.department.create({ data: { name: 'Dept A', code: 'DEMO-A-DEPT-CS' } });
    const program = await prisma.program.create({
      data: {
        name: 'Program A',
        code: 'DEMO-A-PROG-CS',
        departmentId: department.id,
        createdBy,
      },
    });
    const course = await prisma.course.create({
      data: {
        code: 'DEMO-A-CS101',
        title: 'Demo A Course Title',
        programId: program.id,
        semesterId: canonical.id,
        createdBy,
      },
    });
    await prisma.courseOffering.create({
      data: {
        courseId: course.id,
        semesterId: canonical.id,
        section: 'A',
        instructor: 'Fixture Instructor',
        expectedStudents: 20,
        capacity: 30,
        status: 'ACTIVE',
        courseType: 'COURSE',
        hasExam: true,
        createdBy,
      },
    });

    const result = await getAll({ page: 1, limit: 50 });

    expect(result.meta.total).toBe(1);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe(canonical.id);
    expect(result.data[0].courseOfferings).toHaveLength(1);
    expect(result.data[0].id).not.toBe(duplicate.id);
  });

  it('deletes the whole demo dataset when deleting its semester after schedules are gone', async () => {
    const createdBy = 'demo-data:A';
    const department = await prisma.department.create({ data: { name: 'Dept A', code: 'DEMO-A-DEPT-CS' } });
    const program = await prisma.program.create({
      data: {
        name: 'Program A',
        code: 'DEMO-A-PROG-CS',
        departmentId: department.id,
        createdBy,
      },
    });
    const semester = await prisma.semester.create({
      data: {
        name: 'Demo Dataset A - Balanced Fall 2026',
        startDate: createDate('2026-12-07', '00:00'),
        endDate: createDate('2026-12-17', '23:59'),
        academicYear: '2026-2027',
        createdBy,
      },
    });
    const course = await prisma.course.create({
      data: {
        code: 'DEMO-A-CS101',
        title: 'Demo A Course Title',
        programId: program.id,
        semesterId: semester.id,
        createdBy,
      },
    });
    const offering = await prisma.courseOffering.create({
      data: {
        courseId: course.id,
        semesterId: semester.id,
        section: 'A',
        instructor: 'Fixture Instructor',
        expectedStudents: 20,
        capacity: 30,
        status: 'ACTIVE',
        courseType: 'COURSE',
        hasExam: true,
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
    const center = await prisma.center.create({
      data: {
        name: 'Fixture Center A',
        code: 'DEMO-A-CENTER-01',
        createdBy,
      },
    });
    await prisma.room.create({
      data: {
        centerId: center.id,
        name: 'Fixture Room A',
        capacity: 30,
        createdBy,
      },
    });
    const proctorUser = await prisma.user.create({
      data: {
        name: 'Demo Proctor A',
        email: 'demo.a.proctor001@uni.edu',
        password: 'hashed',
        role: 'PROCTOR',
      },
    });
    await prisma.proctor.create({
      data: {
        userId: proctorUser.id,
        department: 'Exam Operations',
        createdBy,
        updatedBy: createdBy,
      },
    });
    await prisma.timeSlot.create({
      data: {
        startTime: createDate('2026-12-07', '09:00'),
        endTime: createDate('2026-12-07', '12:00'),
        date: createDate('2026-12-07', '00:00'),
        duration: 180,
        createdBy,
      },
    });

    await remove(semester.id);

    await expect(prisma.semester.count({ where: { createdBy } })).resolves.toBe(0);
    await expect(prisma.course.count({ where: { code: { startsWith: 'DEMO-A' } } })).resolves.toBe(0);
    await expect(prisma.courseOffering.count({ where: { createdBy } })).resolves.toBe(0);
    await expect(prisma.exam.count({ where: { createdBy } })).resolves.toBe(0);
    await expect(prisma.center.count({ where: { code: { startsWith: 'DEMO-A-CENTER-' } } })).resolves.toBe(0);
    await expect(prisma.room.count({ where: { createdBy } })).resolves.toBe(0);
    await expect(prisma.proctor.count({ where: { createdBy } })).resolves.toBe(0);
    await expect(prisma.timeSlot.count({ where: { createdBy } })).resolves.toBe(0);
    await expect(prisma.program.count({ where: { code: { startsWith: 'DEMO-A-PROG-' } } })).resolves.toBe(0);
    await expect(prisma.department.count({ where: { code: { startsWith: 'DEMO-A-DEPT-' } } })).resolves.toBe(0);
    await expect(prisma.user.count({ where: { email: { startsWith: 'demo.a.' } } })).resolves.toBe(0);
  });

  it('does not delete the demo dataset when deleting its semester while schedules still exist', async () => {
    const createdBy = 'demo-data:B';
    const department = await prisma.department.create({ data: { name: 'Dept B', code: 'DEMO-B-DEPT-CS' } });
    const program = await prisma.program.create({
      data: {
        name: 'Program B',
        code: 'DEMO-B-PROG-CS',
        departmentId: department.id,
        createdBy,
      },
    });
    const semester = await prisma.semester.create({
      data: {
        name: 'Demo Dataset B - Expanded Spring 2027',
        startDate: createDate('2027-05-10', '00:00'),
        endDate: createDate('2027-05-25', '23:59'),
        academicYear: '2026-2027',
        createdBy,
      },
    });
    const course = await prisma.course.create({
      data: {
        code: 'DEMO-B-CS101',
        title: 'Demo B Course Title',
        programId: program.id,
        semesterId: semester.id,
        createdBy,
      },
    });
    const offering = await prisma.courseOffering.create({
      data: {
        courseId: course.id,
        semesterId: semester.id,
        section: 'A',
        instructor: 'Fixture Instructor',
        expectedStudents: 20,
        capacity: 30,
        status: 'ACTIVE',
        courseType: 'COURSE',
        hasExam: true,
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
    const center = await prisma.center.create({
      data: {
        name: 'Fixture Center B',
        code: 'DEMO-B-CENTER-01',
        createdBy,
      },
    });
    const room = await prisma.room.create({
      data: {
        centerId: center.id,
        name: 'Fixture Room B',
        capacity: 30,
        createdBy,
      },
    });
    const proctorUser = await prisma.user.create({
      data: {
        name: 'Demo Proctor B',
        email: 'demo.b.proctor001@uni.edu',
        password: 'hashed',
        role: 'PROCTOR',
      },
    });
    const proctor = await prisma.proctor.create({
      data: {
        userId: proctorUser.id,
        department: 'Exam Operations',
        createdBy,
        updatedBy: createdBy,
      },
    });
    const timeSlot = await prisma.timeSlot.create({
      data: {
        startTime: createDate('2027-05-10', '09:00'),
        endTime: createDate('2027-05-10', '12:00'),
        date: createDate('2027-05-10', '00:00'),
        duration: 180,
        createdBy,
      },
    });
    const schedule = await prisma.schedule.create({
      data: {
        name: 'Demo B schedule',
        createdBy: 'manual:test',
      },
    });

    await prisma.examAssignment.create({
      data: {
        scheduleId: schedule.id,
        examId: exam.id,
        roomId: room.id,
        proctorId: proctor.id,
        timeSlotId: timeSlot.id,
      },
    });

    await expect(remove(semester.id)).rejects.toThrow();

    await expect(prisma.semester.count({ where: { id: semester.id } })).resolves.toBe(1);
    await expect(prisma.course.count({ where: { code: { startsWith: 'DEMO-B' } } })).resolves.toBe(1);
    await expect(prisma.examAssignment.count({ where: { scheduleId: schedule.id } })).resolves.toBe(1);
  });
});