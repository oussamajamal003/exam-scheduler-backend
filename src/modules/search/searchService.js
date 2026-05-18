import prisma from '../../config/prisma.js';

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

export const globalSearch = async ({ q, limit }) => {
  const query = (q ?? '').trim();
  if (!query) {
    return { groups: [], total: 0, query: '' };
  }

  const perGroup = safeLimit(limit, 5, 10);
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
