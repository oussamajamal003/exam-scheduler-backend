import prisma from '../../config/prisma.js';
import { AppError } from '../../utils/AppError.js';

const assignmentSelect = {
  id: true,
  scheduleId: true,
  examId: true,
  roomId: true,
  proctorId: true,
  timeSlotId: true,
  schedule: { select: { id: true, name: true, examPeriod: true, isFinal: true, createdAt: true, updatedAt: true } },
  exam: {
    select: {
      id: true,
      status: true,
      duration: true,
      courseOffering: {
        select: {
          id: true,
          section: true,
          instructor: true,
          expectedStudents: true,
          course: { select: { id: true, code: true, title: true, credits: true } },
          semester: { select: { id: true, name: true, startDate: true, endDate: true } },
          registrations: {
            select: {
              id: true,
              studentId: true,
              status: true,
              student: {
                select: {
                  id: true,
                  universityId: true,
                  user: { select: { id: true, name: true, email: true } },
                  program: { select: { id: true, name: true, code: true } },
                },
              },
            },
          },
        },
      },
    },
  },
  room: {
    select: {
      id: true,
      name: true,
      capacity: true,
      status: true,
      center: { select: { id: true, name: true, location: true } },
    },
  },
  proctor: {
    select: {
      id: true,
      department: true,
      user: { select: { id: true, name: true, email: true } },
      center: { select: { id: true, name: true, location: true } },
    },
  },
  timeSlot: { select: { id: true, date: true, startTime: true, endTime: true, duration: true } },
};

const publishedScheduleSelect = {
  id: true,
  name: true,
  examPeriod: true,
  isFinal: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { assignments: true } },
  assignments: {
    select: assignmentSelect,
  },
};

const getDateValue = (assignment) => {
  const value = assignment?.timeSlot?.startTime ?? assignment?.timeSlot?.date;
  const time = value ? new Date(value).getTime() : Number.POSITIVE_INFINITY;
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
};

const sortAssignments = (assignments) => [...assignments].sort((a, b) => getDateValue(a) - getDateValue(b));

const groupCount = (items, getKey) => {
  const counts = new Map();
  for (const item of items) {
    const key = getKey(item);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts, ([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
};

const uniqueBy = (items, getKey) => {
  const map = new Map();
  for (const item of items) {
    const key = getKey(item);
    if (!key || map.has(key)) continue;
    map.set(key, item);
  }
  return Array.from(map.values());
};

const isUpcoming = (assignment) => {
  const time = getDateValue(assignment);
  return Number.isFinite(time) && time >= Date.now();
};

const assertStudentContext = (user) => {
  if (!user?.studentId) throw new AppError('Student profile is not linked to this account.', 404);
  return user.studentId;
};

const assertProctorContext = (user) => {
  if (!user?.proctorId) throw new AppError('Proctor profile is not linked to this account.', 404);
  return user.proctorId;
};

export const getStudentDashboard = async (user) => {
  const studentId = assertStudentContext(user);

  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: {
      id: true,
      universityId: true,
      user: { select: { id: true, name: true, email: true } },
      program: { select: { id: true, name: true, code: true, department: { select: { id: true, name: true, code: true } } } },
      registrations: {
        where: { OR: [{ status: null }, { status: 'ACTIVE' }] },
        select: {
          id: true,
          status: true,
          courseOffering: {
            select: {
              id: true,
              section: true,
              instructor: true,
              expectedStudents: true,
              hasExam: true,
              courseType: true,
              course: { select: { id: true, code: true, title: true, credits: true } },
              semester: { select: { id: true, name: true, startDate: true, endDate: true } },
              exams: {
                select: {
                  id: true,
                  status: true,
                  duration: true,
                  assignments: {
                    where: { schedule: { isFinal: true } },
                    select: assignmentSelect,
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!student) throw new AppError('Student not found', 404);

  const courses = student.registrations.map((registration) => ({
    registrationId: registration.id,
    status: registration.status,
    ...registration.courseOffering,
  }));

  const exams = courses.flatMap((courseOffering) =>
    courseOffering.exams.map((exam) => ({
      ...exam,
      courseOffering: {
        id: courseOffering.id,
        section: courseOffering.section,
        instructor: courseOffering.instructor,
        expectedStudents: courseOffering.expectedStudents,
        course: courseOffering.course,
        semester: courseOffering.semester,
      },
      assignments: sortAssignments(exam.assignments),
    }))
  );

  const scheduledExams = exams.filter((exam) => exam.assignments.length > 0);
  const assignments = sortAssignments(exams.flatMap((exam) => exam.assignments));
  const upcomingAssignments = assignments.filter(isUpcoming);
  const nextAssignment = upcomingAssignments[0] ?? null;
  const activeSemesters = uniqueBy(courses.map((course) => course.semester).filter(Boolean), (semester) => semester.id);

  return {
    profile: {
      id: student.id,
      universityId: student.universityId,
      user: student.user,
      program: student.program,
    },
    summary: {
      registeredCourses: courses.length,
      examCourses: courses.filter((course) => course.hasExam).length,
      scheduledExams: scheduledExams.length,
      upcomingExams: uniqueBy(upcomingAssignments, (assignment) => assignment.examId).length,
      activeSemesters: activeSemesters.length,
      nextExamAt: nextAssignment?.timeSlot?.startTime ?? nextAssignment?.timeSlot?.date ?? null,
    },
    courses,
    exams,
    assignments,
    charts: {
      examsBySemester: groupCount(courses, (course) => course.semester?.name),
      examsByStatus: groupCount(exams, (exam) => exam.status),
      examsByCenter: groupCount(assignments, (assignment) => assignment.room?.center?.name),
    },
    nextAssignment,
  };
};

export const getProctorDashboard = async (user) => {
  const proctorId = assertProctorContext(user);

  const proctor = await prisma.proctor.findUnique({
    where: { id: proctorId },
    select: {
      id: true,
      department: true,
      maxExamsPerDay: true,
      user: { select: { id: true, name: true, email: true } },
      center: { select: { id: true, name: true, location: true } },
      assignments: {
        where: { schedule: { isFinal: true } },
        select: assignmentSelect,
      },
    },
  });

  if (!proctor) throw new AppError('Proctor not found', 404);

  const assignments = sortAssignments(proctor.assignments);
  const upcomingAssignments = assignments.filter(isUpcoming);
  const nextAssignment = upcomingAssignments[0] ?? null;
  const courses = uniqueBy(
    assignments.map((assignment) => assignment.exam?.courseOffering?.course).filter(Boolean),
    (course) => course.id
  );
  const relatedStudents = uniqueBy(
    assignments.flatMap((assignment) => assignment.exam?.courseOffering?.registrations ?? [])
      .map((registration) => registration.student)
      .filter(Boolean),
    (student) => student.id
  );
  const centers = uniqueBy(assignments.map((assignment) => assignment.room?.center).filter(Boolean), (center) => center.id);

  return {
    profile: {
      id: proctor.id,
      department: proctor.department,
      maxExamsPerDay: proctor.maxExamsPerDay,
      user: proctor.user,
      center: proctor.center,
    },
    summary: {
      assignedDuties: assignments.length,
      upcomingDuties: upcomingAssignments.length,
      relatedStudents: relatedStudents.length,
      assignedCourses: courses.length,
      centers: centers.length,
      nextDutyAt: nextAssignment?.timeSlot?.startTime ?? nextAssignment?.timeSlot?.date ?? null,
    },
    assignments,
    relatedStudents,
    charts: {
      dutiesByDay: groupCount(assignments, (assignment) => {
        const value = assignment.timeSlot?.date ?? assignment.timeSlot?.startTime;
        if (!value) return null;
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
      }),
      dutiesByCenter: groupCount(assignments, (assignment) => assignment.room?.center?.name),
      dutiesByCourse: groupCount(assignments, (assignment) => assignment.exam?.courseOffering?.course?.code),
    },
    nextAssignment,
  };
};

export const getPublishedSchedulesForRole = async () => {
  return prisma.schedule.findMany({
    where: { isFinal: true },
    orderBy: { createdAt: 'desc' },
    select: publishedScheduleSelect,
  });
};
