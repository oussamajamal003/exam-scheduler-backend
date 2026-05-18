import prisma from '../../config/prisma.js';
import * as roleDashboardService from '../roleDashboards/roleDashboardsService.js';
import { normalizeRole } from '../../guards/roleGuard.js';

/**
 * Global search across the scheduling system.
 *
 * Performs parallel Prisma queries against the most-searched entities and
 * returns a normalized, grouped result set ready for the command palette UI.
 *
 * Result shape:
 * {
 *   id, type, title, subtitle, badge, icon, href, metadata
 * }
 */

const containsInsensitive = (q) => ({ contains: q, mode: 'insensitive' });

const safeLimit = (raw, fallback = 5, max = 15) => {
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n) || n <= 0) return fallback;
  return Math.min(n, max);
};

const formatSemester = (s) => ({
  id: s.id,
  type: 'semester',
  title: s.name,
  subtitle: s.academicYear ? `${s.academicYear}` : 'Semester',
  badge: 'Semester',
  icon: 'calendar',
  href: '/semesters',
  metadata: { academicYear: s.academicYear ?? null },
});

const formatCourse = (c) => ({
  id: c.id,
  type: 'course',
  title: `${c.code} — ${c.title}`,
  subtitle: c.program?.name ? `${c.program.name}` : 'Course',
  badge: 'Course',
  icon: 'book-open',
  href: '/courses',
  metadata: { code: c.code, programId: c.programId },
});

const formatCourseOffering = (co) => ({
  id: co.id,
  type: 'course-offering',
  title: `${co.course?.code ?? 'Offering'} ${co.section ? `· ${co.section}` : ''}`.trim(),
  subtitle: [co.course?.title, co.semester?.name].filter(Boolean).join(' • '),
  badge: co.status ?? 'Offering',
  icon: 'layers',
  href: `/course-offerings/${co.id}`,
  metadata: { semesterId: co.semesterId, status: co.status },
});

const formatExam = (e) => ({
  id: e.id,
  type: 'exam',
  title: e.courseOffering?.course
    ? `${e.courseOffering.course.code} — ${e.courseOffering.course.title}`
    : 'Exam',
  subtitle: [
    e.courseOffering?.semester?.name,
    e.duration ? `${e.duration} min` : null,
  ]
    .filter(Boolean)
    .join(' • '),
  badge: e.status ?? 'Exam',
  icon: 'clipboard-check',
  href: '/scheduling',
  metadata: { status: e.status, courseOfferingId: e.courseOfferingId },
});

const formatStudent = (s) => ({
  id: s.id,
  type: 'student',
  title: s.user?.name ?? 'Student',
  subtitle: [s.universityId, s.user?.email, s.program?.name].filter(Boolean).join(' • '),
  badge: 'Student',
  icon: 'graduation-cap',
  href: '/students',
  metadata: { universityId: s.universityId, programId: s.programId },
});

const formatProctor = (p) => ({
  id: p.id,
  type: 'proctor',
  title: p.user?.name ?? 'Proctor',
  subtitle: [p.user?.email, p.center?.name, p.department].filter(Boolean).join(' • '),
  badge: 'Proctor',
  icon: 'user-cog',
  href: '/proctors',
  metadata: { centerId: p.centerId },
});

const formatAdmin = (u) => ({
  id: u.id,
  type: 'admin',
  title: u.name,
  subtitle: u.email,
  badge: 'Admin',
  icon: 'shield',
  href: '/settings',
  metadata: { email: u.email },
});

const formatProgram = (p) => ({
  id: p.id,
  type: 'program',
  title: `${p.code} — ${p.name}`,
  subtitle: p.department?.name ?? 'Program',
  badge: 'Program',
  icon: 'graduation-cap',
  href: '/departments',
  metadata: { code: p.code, departmentId: p.departmentId },
});

const formatDepartment = (d) => ({
  id: d.id,
  type: 'department',
  title: `${d.code} — ${d.name}`,
  subtitle: 'Department',
  badge: 'Department',
  icon: 'building',
  href: '/departments',
  metadata: { code: d.code },
});

const formatRoom = (r) => ({
  id: r.id,
  type: 'room',
  title: r.name,
  subtitle: [r.center?.name, `Capacity ${r.capacity}`].filter(Boolean).join(' • '),
  badge: r.status ?? 'Room',
  icon: 'building-2',
  href: '/rooms',
  metadata: { capacity: r.capacity, centerId: r.centerId },
});

const formatCenter = (c) => ({
  id: c.id,
  type: 'center',
  title: c.name,
  subtitle: [c.code, c.location].filter(Boolean).join(' • ') || 'Center',
  badge: 'Center',
  icon: 'building',
  href: '/centers',
  metadata: { code: c.code, location: c.location },
});

const formatSchedule = (s) => ({
  id: s.id,
  type: 'schedule',
  title: s.name,
  subtitle: [
    s.isFinal ? 'Published' : 'Draft',
    typeof s._count?.assignments === 'number' ? `${s._count.assignments} assignments` : null,
    s.examPeriod,
  ]
    .filter(Boolean)
    .join(' • '),
  badge: s.isFinal ? 'Published' : 'Draft',
  icon: 'calendar-clock',
  href: '/scheduling',
  metadata: { isFinal: !!s.isFinal, stage: s.generationStage, quality: s.qualityScore },
});

const includesQuery = (query, ...values) => {
  const normalized = query.toLowerCase();
  return values.some((value) => typeof value === 'string' && value.toLowerCase().includes(normalized));
};

const limitItems = (items, limit) => items.slice(0, limit);

const uniqueResults = (items, getKey) => {
  const seen = new Set();
  return items.filter((item) => {
    const key = getKey(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const formatRoleCourse = (course, href, subtitle) => ({
  id: course.id,
  type: 'course',
  title: `${course.code} — ${course.title}`,
  subtitle,
  badge: 'Course',
  icon: 'book-open',
  href,
  metadata: { code: course.code },
});

const formatRoleExam = ({ id, title, subtitle, href, badge = 'Exam' }) => ({
  id,
  type: 'exam',
  title,
  subtitle,
  badge,
  icon: 'clipboard-check',
  href,
});

const formatRoleStudent = (student, href) => ({
  id: student.id,
  type: 'student',
  title: student.user?.name ?? 'Student',
  subtitle: [student.universityId, student.user?.email, student.program?.name].filter(Boolean).join(' • '),
  badge: 'Student',
  icon: 'graduation-cap',
  href,
  metadata: { universityId: student.universityId },
});

const formatRoleRoom = ({ id, name, center, capacity, status, href }) => ({
  id,
  type: 'room',
  title: name,
  subtitle: [center?.name, typeof capacity === 'number' ? `Capacity ${capacity}` : null].filter(Boolean).join(' • '),
  badge: status ?? 'Room',
  icon: 'building-2',
  href,
});

const formatRoleCenter = ({ id, name, location, href }) => ({
  id,
  type: 'center',
  title: name,
  subtitle: location ?? 'Center',
  badge: 'Center',
  icon: 'building',
  href,
});

const formatRoleSchedule = ({ id, name, examPeriod, assignmentCount, href }) => ({
  id,
  type: 'schedule',
  title: name,
  subtitle: ['Published', typeof assignmentCount === 'number' ? `${assignmentCount} assignments` : null, examPeriod].filter(Boolean).join(' • '),
  badge: 'Published',
  icon: 'calendar-clock',
  href,
});

const buildStudentSearch = async ({ user, query, perGroup }) => {
  const dashboard = await roleDashboardService.getStudentDashboard(user);
  const courseResults = limitItems(
    dashboard.courses
      .filter((courseOffering) => includesQuery(
        query,
        courseOffering.course?.code,
        courseOffering.course?.title,
        courseOffering.semester?.name,
        courseOffering.instructor,
        courseOffering.section,
      ))
      .map((courseOffering) => formatRoleCourse(
        courseOffering.course,
        '/student/courses',
        [courseOffering.semester?.name, courseOffering.section ? `Section ${courseOffering.section}` : null].filter(Boolean).join(' • '),
      )),
    perGroup
  );

  const examResults = limitItems(
    dashboard.exams
      .filter((exam) => includesQuery(
        query,
        exam.courseOffering?.course?.code,
        exam.courseOffering?.course?.title,
        exam.courseOffering?.semester?.name,
        exam.assignments[0]?.room?.name,
        exam.assignments[0]?.room?.center?.name,
      ))
      .map((exam) => formatRoleExam({
        id: exam.id,
        title: exam.courseOffering?.course
          ? `${exam.courseOffering.course.code} — ${exam.courseOffering.course.title}`
          : 'Exam',
        subtitle: [
          exam.courseOffering?.semester?.name,
          exam.assignments[0]?.room?.name,
          exam.assignments[0]?.room?.center?.name,
        ].filter(Boolean).join(' • '),
        href: '/student/schedule',
        badge: exam.status ?? 'Exam',
      })),
    perGroup
  );

  const scheduleResults = limitItems(
    uniqueResults(
      dashboard.assignments
        .filter((assignment) => includesQuery(
          query,
          assignment.schedule?.name,
          assignment.schedule?.examPeriod,
          assignment.exam?.courseOffering?.course?.code,
          assignment.room?.name,
          assignment.room?.center?.name,
        ))
        .map((assignment) => ({
          id: assignment.schedule?.id,
          name: assignment.schedule?.name,
          examPeriod: assignment.schedule?.examPeriod,
          assignmentCount: 1,
          href: '/student/schedule',
        }))
        .filter((schedule) => schedule.id),
      (schedule) => schedule.id
    ).map(formatRoleSchedule),
    perGroup
  );

  const roomResults = limitItems(
    uniqueResults(
      dashboard.assignments
        .filter((assignment) => includesQuery(query, assignment.room?.name, assignment.room?.center?.name))
        .map((assignment) => ({
          id: assignment.room?.id,
          name: assignment.room?.name,
          center: assignment.room?.center,
          capacity: assignment.room?.capacity,
          status: assignment.room?.status,
          href: '/student/schedule',
        }))
        .filter((room) => room.id),
      (room) => room.id
    ).map(formatRoleRoom),
    perGroup
  );

  const centerResults = limitItems(
    uniqueResults(
      dashboard.assignments
        .filter((assignment) => includesQuery(query, assignment.room?.center?.name, assignment.room?.center?.location))
        .map((assignment) => ({
          id: assignment.room?.center?.id,
          name: assignment.room?.center?.name,
          location: assignment.room?.center?.location,
          href: '/student/schedule',
        }))
        .filter((center) => center.id),
      (center) => center.id
    ).map(formatRoleCenter),
    perGroup
  );

  return [
    { key: 'academic', label: 'Academic', items: [...courseResults, ...examResults] },
    { key: 'scheduling', label: 'Scheduling', items: scheduleResults },
    { key: 'resources', label: 'Resources', items: [...roomResults, ...centerResults] },
  ].filter((group) => group.items.length > 0);
};

const buildProctorSearch = async ({ user, query, perGroup }) => {
  const dashboard = await roleDashboardService.getProctorDashboard(user);
  const courseResults = limitItems(
    uniqueResults(
      dashboard.assignments
        .filter((assignment) => includesQuery(
          query,
          assignment.exam?.courseOffering?.course?.code,
          assignment.exam?.courseOffering?.course?.title,
          assignment.exam?.courseOffering?.semester?.name,
        ))
        .map((assignment) => assignment.exam?.courseOffering?.course)
        .filter(Boolean),
      (course) => course.id
    ).map((course) => formatRoleCourse(course, '/proctor/schedule', 'Assigned duty course')),
    perGroup
  );

  const dutyResults = limitItems(
    dashboard.assignments
      .filter((assignment) => includesQuery(
        query,
        assignment.exam?.courseOffering?.course?.code,
        assignment.exam?.courseOffering?.course?.title,
        assignment.room?.name,
        assignment.room?.center?.name,
        assignment.schedule?.name,
      ))
      .map((assignment) => formatRoleExam({
        id: assignment.id,
        title: assignment.exam?.courseOffering?.course
          ? `${assignment.exam.courseOffering.course.code} — ${assignment.exam.courseOffering.course.title}`
          : 'Assigned duty',
        subtitle: [assignment.room?.name, assignment.room?.center?.name, assignment.schedule?.name].filter(Boolean).join(' • '),
        href: '/proctor/schedule',
        badge: 'Duty',
      })),
    perGroup
  );

  const studentResults = limitItems(
    dashboard.relatedStudents
      .filter((student) => includesQuery(query, student.user?.name, student.user?.email, student.universityId, student.program?.name))
      .map((student) => formatRoleStudent(student, '/proctor/students')),
    perGroup
  );

  const scheduleResults = limitItems(
    uniqueResults(
      dashboard.assignments
        .filter((assignment) => includesQuery(query, assignment.schedule?.name, assignment.schedule?.examPeriod))
        .map((assignment) => ({
          id: assignment.schedule?.id,
          name: assignment.schedule?.name,
          examPeriod: assignment.schedule?.examPeriod,
          assignmentCount: 1,
          href: '/proctor/schedule',
        }))
        .filter((schedule) => schedule.id),
      (schedule) => schedule.id
    ).map(formatRoleSchedule),
    perGroup
  );

  const roomResults = limitItems(
    uniqueResults(
      dashboard.assignments
        .filter((assignment) => includesQuery(query, assignment.room?.name, assignment.room?.center?.name))
        .map((assignment) => ({
          id: assignment.room?.id,
          name: assignment.room?.name,
          center: assignment.room?.center,
          capacity: assignment.room?.capacity,
          status: assignment.room?.status,
          href: '/proctor/schedule',
        }))
        .filter((room) => room.id),
      (room) => room.id
    ).map(formatRoleRoom),
    perGroup
  );

  const centerResults = limitItems(
    uniqueResults(
      dashboard.assignments
        .filter((assignment) => includesQuery(query, assignment.room?.center?.name, assignment.room?.center?.location))
        .map((assignment) => ({
          id: assignment.room?.center?.id,
          name: assignment.room?.center?.name,
          location: assignment.room?.center?.location,
          href: '/proctor/schedule',
        }))
        .filter((center) => center.id),
      (center) => center.id
    ).map(formatRoleCenter),
    perGroup
  );

  return [
    { key: 'academic', label: 'Academic', items: [...courseResults, ...dutyResults] },
    { key: 'users', label: 'Users', items: studentResults },
    { key: 'scheduling', label: 'Scheduling', items: scheduleResults },
    { key: 'resources', label: 'Resources', items: [...roomResults, ...centerResults] },
  ].filter((group) => group.items.length > 0);
};

export const globalSearch = async ({ q, limit, user }) => {
  const query = (q ?? '').trim();
  if (!query) {
    return { groups: [], total: 0, query: '' };
  }

  const perGroup = safeLimit(limit, 5, 10);
  const role = normalizeRole(user?.role);

  if (role === 'STUDENT') {
    const groups = await buildStudentSearch({ user, query, perGroup });
    const total = groups.reduce((acc, group) => acc + group.items.length, 0);
    return { groups, total, query };
  }

  if (role === 'PROCTOR') {
    const groups = await buildProctorSearch({ user, query, perGroup });
    const total = groups.reduce((acc, group) => acc + group.items.length, 0);
    return { groups, total, query };
  }

  const contains = containsInsensitive(query);

  const [
    semesters,
    courses,
    offerings,
    exams,
    students,
    proctors,
    admins,
    programs,
    departments,
    rooms,
    centers,
    schedules,
  ] = await Promise.all([
    prisma.semester.findMany({
      where: { OR: [{ name: contains }, { academicYear: contains }] },
      take: perGroup,
      orderBy: [{ startDate: 'desc' }],
    }),
    prisma.course.findMany({
      where: { OR: [{ code: contains }, { title: contains }] },
      take: perGroup,
      include: { program: { select: { id: true, name: true } } },
      orderBy: [{ code: 'asc' }],
    }),
    prisma.courseOffering.findMany({
      where: {
        OR: [
          { section: contains },
          { instructor: contains },
          { course: { is: { OR: [{ code: contains }, { title: contains }] } } },
        ],
      },
      take: perGroup,
      include: {
        course: { select: { code: true, title: true } },
        semester: { select: { id: true, name: true } },
      },
    }),
    prisma.exam.findMany({
      where: {
        courseOffering: {
          is: {
            course: { is: { OR: [{ code: contains }, { title: contains }] } },
          },
        },
      },
      take: perGroup,
      include: {
        courseOffering: {
          include: {
            course: { select: { code: true, title: true } },
            semester: { select: { name: true } },
          },
        },
      },
    }),
    prisma.student.findMany({
      where: {
        OR: [
          { universityId: contains },
          { user: { is: { OR: [{ name: contains }, { email: contains }] } } },
        ],
      },
      take: perGroup,
      include: {
        user: { select: { id: true, name: true, email: true } },
        program: { select: { id: true, name: true } },
      },
    }),
    prisma.proctor.findMany({
      where: {
        OR: [
          { department: contains },
          { user: { is: { OR: [{ name: contains }, { email: contains }] } } },
          { center: { is: { name: contains } } },
        ],
      },
      take: perGroup,
      include: {
        user: { select: { id: true, name: true, email: true } },
        center: { select: { id: true, name: true } },
      },
    }),
    prisma.user.findMany({
      where: {
        role: 'ADMIN',
        OR: [{ name: contains }, { email: contains }],
      },
      take: perGroup,
      select: { id: true, name: true, email: true },
    }),
    prisma.program.findMany({
      where: { OR: [{ name: contains }, { code: contains }] },
      take: perGroup,
      include: { department: { select: { id: true, name: true } } },
    }),
    prisma.department.findMany({
      where: { OR: [{ name: contains }, { code: contains }] },
      take: perGroup,
    }),
    prisma.room.findMany({
      where: {
        OR: [
          { name: contains },
          { center: { is: { OR: [{ name: contains }, { code: contains }] } } },
        ],
      },
      take: perGroup,
      include: { center: { select: { id: true, name: true } } },
    }),
    prisma.center.findMany({
      where: {
        OR: [
          { name: contains },
          { code: contains },
          { location: contains },
        ],
      },
      take: perGroup,
    }),
    prisma.schedule.findMany({
      where: {
        OR: [{ name: contains }, { examPeriod: contains }],
      },
      take: perGroup,
      include: { _count: { select: { assignments: true } } },
      orderBy: [{ updatedAt: 'desc' }],
    }),
  ]);

  const groups = [
    { key: 'academic', label: 'Academic', items: [
      ...courses.map(formatCourse),
      ...offerings.map(formatCourseOffering),
      ...exams.map(formatExam),
      ...semesters.map(formatSemester),
      ...programs.map(formatProgram),
      ...departments.map(formatDepartment),
    ]},
    { key: 'users', label: 'Users', items: [
      ...students.map(formatStudent),
      ...proctors.map(formatProctor),
      ...admins.map(formatAdmin),
    ]},
    { key: 'scheduling', label: 'Scheduling', items: [
      ...schedules.map(formatSchedule),
    ]},
    { key: 'resources', label: 'Resources', items: [
      ...rooms.map(formatRoom),
      ...centers.map(formatCenter),
    ]},
  ].filter((g) => g.items.length > 0);

  const total = groups.reduce((acc, g) => acc + g.items.length, 0);

  return { groups, total, query };
};
