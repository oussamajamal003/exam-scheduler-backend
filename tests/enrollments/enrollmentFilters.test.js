import { getAll, getFilterOptions } from '../../src/modules/enrollments/enrollmentsService.js';
import prisma, { truncateAll, disconnectPrisma } from '../utils/db.js';
import { seedFeitScenario } from '../utils/feitSeed.js';

describe('Enrollment advanced filters', () => {
  let scenario;
  let target;
  let unregisteredOffering;

  beforeAll(async () => {
    await truncateAll();
    scenario = await seedFeitScenario({ namespace: 'FEIT-ENROLL-FILTERS' });

    const rows = await prisma.registration.findMany({
      where: { courseOffering: { semesterId: scenario.semester.id } },
      take: 50,
      select: {
        studentId: true,
        courseOfferingId: true,
        student: { select: { universityId: true, user: { select: { name: true, email: true } } } },
        courseOffering: {
          select: {
            semesterId: true,
            course: { select: { program: { select: { departmentId: true } } } },
          },
        },
      },
    });

    target = rows.find((row) => row.courseOffering?.course?.program?.departmentId) ?? null;

    const course = await prisma.course.findFirst({
      where: { semesterId: scenario.semester.id },
      select: { id: true },
    });
    unregisteredOffering = await prisma.courseOffering.create({
      data: {
        courseId: course.id,
        semesterId: scenario.semester.id,
        section: 'NO-ENROLLMENTS',
        instructor: 'Filter Fixture',
        expectedStudents: 0,
        capacity: 40,
        status: 'ACTIVE',
        courseType: 'COURSE',
        hasExam: true,
        createdBy: 'test:FEIT-ENROLL-FILTERS',
      },
    });
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it('returns semester-scoped options and AND-filters enrollment rows', async () => {
    expect(target).toBeTruthy();
    const semesterId = scenario.semester.id;
    const departmentId = target.courseOffering.course.program.departmentId;

    const options = await getFilterOptions({ semesterId }, { role: 'ADMIN' });
    expect(options.students.some((student) => student.id === target.studentId)).toBe(true);
    expect(options.courseOfferings.some((offering) => offering.id === target.courseOfferingId)).toBe(true);
    expect(options.courseOfferings.some((offering) => offering.id === unregisteredOffering.id)).toBe(true);
    expect(options.departments.some((department) => department.id === departmentId)).toBe(true);

    const result = await getAll({
      page: 1,
      limit: 50,
      semesterId,
      departmentId,
      courseOfferingId: target.courseOfferingId,
      studentId: target.studentId,
      search: target.student.universityId,
    }, { role: 'ADMIN' });

    expect(result.data.length).toBeGreaterThan(0);
    expect(result.data.every((row) => row.semester?.id === semesterId)).toBe(true);
    expect(result.data.every((row) => row.student?.id === target.studentId)).toBe(true);
    expect(result.data.every((row) => row.courseOffering?.id === target.courseOfferingId)).toBe(true);
    expect(result.data.every((row) => row.courseOffering?.course?.program?.department?.id === departmentId)).toBe(true);
  });
});
