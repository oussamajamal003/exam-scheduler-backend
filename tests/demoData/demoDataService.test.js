import { clearDemoData, generateDemoData } from '../../src/modules/demoData/demoDataService.js';
import { generateSchedule, validateInput } from '../../src/modules/scheduling/schedulingService.js';
import { auditContext } from '../../src/middlewares/auditContext.js';
import { remove as removeSchedule } from '../../src/modules/schedules/schedulesService.js';
import prisma, { truncateAll, disconnectPrisma } from '../utils/db.js';

const createDate = (date, time) => new Date(`${date}T${time}:00.000Z`);

describe('demo data service', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it('only clears a dataset after its related schedule has been deleted by admin', async () => {
    const createdBy = 'demo-data:B';

    const duplicateSemester = await prisma.semester.create({
      data: {
        name: 'Demo Dataset B - Expanded Spring 2027',
        startDate: createDate('2027-05-10', '00:00'),
        endDate: createDate('2027-05-25', '23:59'),
        academicYear: '2026-2027',
        createdBy,
      },
    });

    const department = await prisma.department.create({
      data: { name: 'Demo Dept B', code: 'DEMO-B-DEPT-CS' },
    });
    const program = await prisma.program.create({
      data: {
        name: 'Demo Program B',
        code: 'DEMO-B-PROG-CS',
        departmentId: department.id,
        createdBy,
      },
    });
    const semester = await prisma.semester.create({
      data: {
        name: 'Demo Dataset B - Test Semester',
        startDate: createDate('2027-05-10', '00:00'),
        endDate: createDate('2027-05-25', '23:59'),
        academicYear: '2026-2027',
        createdBy,
      },
    });
    const course = await prisma.course.create({
      data: {
        code: 'DEMO-B-CS101',
        title: 'Demo Course B Title',
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
        expectedStudents: 10,
        capacity: 20,
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
    const timeSlot = await prisma.timeSlot.create({
      data: {
        startTime: createDate('2027-05-10', '09:00'),
        endTime: createDate('2027-05-10', '12:00'),
        date: createDate('2027-05-10', '00:00'),
        duration: 180,
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
    const schedule = await prisma.schedule.create({
      data: {
        name: 'Foreign schedule using demo resource',
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

    await expect(clearDemoData({ dataset: 'B' })).rejects.toThrow(
      'Cannot delete demo dataset. Delete related schedules first from Schedule Versions.',
    );

    await expect(prisma.semester.count({ where: { createdBy } })).resolves.toBeGreaterThan(0);
    await expect(prisma.schedule.count({ where: { id: schedule.id } })).resolves.toBe(1);
    await expect(prisma.examAssignment.count()).resolves.toBe(1);

    await removeSchedule(schedule.id);

    await expect(clearDemoData({ dataset: 'B' })).resolves.toMatchObject({
      dataset: 'B',
      summary: expect.objectContaining({
        schedules: 0,
        semesters: 0,
        courseOfferings: 0,
      }),
    });

    await expect(prisma.semester.count({ where: { createdBy } })).resolves.toBe(0);
    await expect(prisma.semester.count({ where: { id: duplicateSemester.id } })).resolves.toBe(0);
    await expect(prisma.schedule.count({ where: { id: schedule.id } })).resolves.toBe(0);
    await expect(prisma.examAssignment.count()).resolves.toBe(0);
    await expect(prisma.room.count({ where: { id: room.id } })).resolves.toBe(0);
    await expect(prisma.center.count({ where: { id: center.id } })).resolves.toBe(0);
    await expect(prisma.exam.count({ where: { id: exam.id } })).resolves.toBe(0);
  });

  it('generates multiple demo datasets without unique-field collisions', async () => {
    const first = await generateDemoData({ dataset: 'A' });
    const second = await generateDemoData({ dataset: 'B' });

    expect(first.dataset).toBe('A');
    expect(second.dataset).toBe('B');
    expect(second.summary.courseOfferings).toBeGreaterThan(0);
    expect(second.summary.rooms).toBeGreaterThan(0);
  });

  it('generates the FEIT Spring 2027 optimization showcase dataset', async () => {
    const generated = await generateDemoData({ dataset: 'FEIT2027' });

    expect(generated).toMatchObject({
      dataset: 'FEIT2027',
      datasetLabel: 'FEIT Spring 2027',
    });
    expect(generated.summary.departments).toBe(5);
    expect(generated.summary.programs).toBe(8);
    expect(generated.summary.semesters).toBe(1);
    expect(generated.summary.courseOfferings).toBe(52);
    expect(generated.summary.students).toBe(1080);
    expect(generated.summary.rooms).toBe(58);
    expect(generated.summary.proctors).toBe(88);
    expect(generated.summary.timeSlots).toBe(28);
    expect(generated.expectedTestCases?.expectedResult).toMatch(/visible optimization gain/i);
  });

  it('generates the FAIL demo dataset as a deterministic validation failure fixture', async () => {
    const generated = await generateDemoData({ dataset: 'FAIL' });

    expect(generated).toMatchObject({
      dataset: 'FAIL',
      datasetLabel: 'Fail Demo Dataset',
    });
    expect(generated.summary.rooms).toBe(4);
    expect(generated.summary.proctors).toBe(10);
    expect(generated.summary.timeSlots).toBe(0);
    expect(generated.expectedTestCases?.expectedResult).toContain('No conflict-free schedule exists for current resources/data.');

    const failSemester = await prisma.semester.findFirst({
      where: { createdBy: 'demo-data:FAIL' },
      select: { id: true },
    });
    expect(failSemester).toBeTruthy();

    await expect(
      generateSchedule({
        semesterId: failSemester.id,
        scheduleName: 'FAIL demo should never generate',
      }),
    ).rejects.toThrow('No conflict-free schedule exists for current resources/data.');

    expect(await prisma.schedule.count()).toBe(0);
  });

  it('generates the FAIL2 demo dataset as the constrained 6-slot failure variant', async () => {
    const generated = await generateDemoData({ dataset: 'FAIL2' });

    expect(generated).toMatchObject({
      dataset: 'FAIL2',
      datasetLabel: 'Fail Demo Dataset 2',
    });
    expect(generated.summary.rooms).toBe(4);
    expect(generated.summary.proctors).toBe(20);
    expect(generated.summary.timeSlots).toBe(6);
    expect(generated.expectedTestCases?.expectedResult).toContain('No conflict-free schedule exists for current resources/data.');

    const failSemester = await prisma.semester.findFirst({
      where: { createdBy: 'demo-data:FAIL2' },
      select: { id: true },
    });
    expect(failSemester).toBeTruthy();

    const validation = await validateInput({ semesterId: failSemester.id });
    expect(validation.errors.roomCapacity).toEqual(['No conflict-free schedule exists for current resources/data.']);
    expect(validation.groups.roomCapacity.issues).toEqual(['No conflict-free schedule exists for current resources/data.']);

    await expect(
      generateSchedule({
        semesterId: failSemester.id,
        scheduleName: 'FAIL2 demo should never generate',
      }),
    ).rejects.toThrow('No conflict-free schedule exists for current resources/data.');

    expect(await prisma.schedule.count()).toBe(0);
  });

  it('generates the FAIL3 demo dataset as a validation-pass candidate-filtering failure fixture', async () => {
    const generated = await generateDemoData({ dataset: 'FAIL3' });

    expect(generated).toMatchObject({
      dataset: 'FAIL3',
      datasetLabel: 'Fail Demo Dataset 3',
    });
    expect(generated.summary.exams).toBe(30);
    expect(generated.summary.rooms).toBe(20);
    expect(generated.summary.proctors).toBe(80);
    expect(generated.summary.timeSlots).toBe(25);

    const failSemester = await prisma.semester.findFirst({
      where: { createdBy: 'demo-data:FAIL3' },
      select: { id: true },
    });
    expect(failSemester).toBeTruthy();

    const validation = await validateInput({ semesterId: failSemester.id });
    expect(validation.isValid).toBe(true);
    expect(validation.ready).toBe(true);

    await expect(
      generateSchedule({
        semesterId: failSemester.id,
        scheduleName: 'FAIL3 demo should stop in candidate filtering',
      }),
    ).rejects.toThrow('Exam cannot be assigned.\nNo valid candidate exists.\nGeneration stopped.');

    expect(await prisma.schedule.count()).toBe(0);
  });

  it('still clears a dataset that has no schedules', async () => {
    const generated = await generateDemoData({ dataset: 'A' });

    expect(generated.summary.courseOfferings).toBeGreaterThan(0);

    const cleared = await clearDemoData({ dataset: 'A' });

    expect(cleared).toMatchObject({
      dataset: 'A',
      summary: expect.objectContaining({
        schedules: 0,
        courseOfferings: 0,
        rooms: 0,
      }),
    });
  });

  it('preserves a single semester row when regeneration is skipped for a scheduled dataset', async () => {
    const generated = await generateDemoData({ dataset: 'A' });
    const createdBy = 'demo-data:A';

    expect(generated.summary.courseOfferings).toBeGreaterThan(0);

    await prisma.semester.create({
      data: {
        name: 'Demo Dataset A - Balanced Fall 2026',
        startDate: createDate('2026-12-07', '00:00'),
        endDate: createDate('2026-12-17', '23:59'),
        academicYear: '2026-2027',
        createdBy,
      },
    });

    const semester = await prisma.semester.findFirst({
      where: { createdBy, courseOfferings: { some: {} } },
    });
    const exam = await prisma.exam.findFirst({
      where: { courseOffering: { semesterId: semester.id } },
      select: { id: true },
    });
    const room = await prisma.room.findFirst({ where: { createdBy }, select: { id: true } });
    const timeSlot = await prisma.timeSlot.findFirst({ where: { createdBy }, select: { id: true } });
    const proctor = await prisma.proctor.findFirst({ where: { createdBy }, select: { id: true } });
    const schedule = await prisma.schedule.create({ data: { name: 'Dataset A preserved schedule', createdBy: 'manual:test' } });

    await prisma.examAssignment.create({
      data: {
        scheduleId: schedule.id,
        examId: exam.id,
        roomId: room.id,
        proctorId: proctor.id,
        timeSlotId: timeSlot.id,
      },
    });

    const regenerated = await generateDemoData({ dataset: 'A' });

    expect(regenerated.preservedSchedules).toBe(1);
    await expect(prisma.semester.count({ where: { createdBy } })).resolves.toBe(1);
    await expect(prisma.schedule.count({ where: { id: schedule.id } })).resolves.toBe(1);
    await expect(prisma.examAssignment.count({ where: { scheduleId: schedule.id } })).resolves.toBe(1);
  });

  it('does not create an orphan demo semester when regenerating under an authenticated audit context', async () => {
    await auditContext.run({ userId: 'user-123' }, async () => {
      await generateDemoData({ dataset: 'B' });
      await generateDemoData({ dataset: 'B' });
    });

    const semesters = await prisma.semester.findMany({
      where: { name: 'Demo Dataset B - Expanded Spring 2027' },
      include: { _count: { select: { courseOfferings: true } } },
      orderBy: [{ createdAt: 'asc' }],
    });

    expect(semesters).toHaveLength(1);
    expect(semesters[0].createdBy).toBe('demo-data:B');
    expect(semesters[0]._count.courseOfferings).toBeGreaterThan(0);
  });
});