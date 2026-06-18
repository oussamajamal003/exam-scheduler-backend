import { AppError } from '../../utils/AppError.js';
import { streamScheduleReport } from '../../utils/pdf/scheduleReport.js';
import * as schedulesService from '../schedules/schedulesService.js';
import * as roleDashboardService from '../roleDashboards/roleDashboardsService.js';

// -------------------- helpers --------------------

const sortByDate = (assignments) =>
  [...assignments].sort((a, b) => {
    const ta = new Date(a.timeSlot?.startTime ?? a.timeSlot?.date ?? 0).getTime();
    const tb = new Date(b.timeSlot?.startTime ?? b.timeSlot?.date ?? 0).getTime();
    return (Number.isFinite(ta) ? ta : Infinity) - (Number.isFinite(tb) ? tb : Infinity);
  });

export const groupAssignmentsByExamSlot = (assignments) => {
  const groups = new Map();

  for (const assignment of assignments) {
    const key = `${assignment.examId}:${assignment.timeSlotId}`;
    const group = groups.get(key) ?? [];
    group.push(assignment);
    groups.set(key, group);
  }

  return Array.from(groups.values()).map((group) => {
    const primary = group[0];
    const roomIds = [...new Set(group.map((assignment) => assignment.roomId).filter(Boolean))];
    const proctorIds = [...new Set(group.map((assignment) => assignment.proctorId).filter(Boolean))];
    const roomNames = [...new Set(group.map((assignment) => assignment.room?.name).filter(Boolean))];
    const centerNames = [...new Set(group.map((assignment) => assignment.room?.center?.name).filter(Boolean))];
    const proctorNames = [...new Set(group.map((assignment) => assignment.proctor?.user?.name).filter(Boolean))];

    return {
      ...primary,
      roomIds,
      proctorIds,
      roomDisplayName: roomNames.length > 1 ? `${roomNames.length} rooms assigned` : roomNames[0] ?? '',
      centerDisplayName: centerNames.length > 1 ? `${centerNames.length} centers assigned` : centerNames[0] ?? '',
      proctorDisplayName: proctorNames.length > 1 ? `${proctorNames.length} proctors assigned` : proctorNames[0] ?? '',
      assignmentRowCount: group.length,
    };
  });
};

const getGroupedAssignments = (assignments) => sortByDate(groupAssignmentsByExamSlot(assignments ?? []));

const isUpcomingAssignment = (assignment) => {
  const value = assignment.timeSlot?.startTime ?? assignment.timeSlot?.date;
  if (!value) return false;
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time >= Date.now();
};

const formatDate = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' });
};

const formatTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
};

const timeRange = (assignment) => {
  const start = formatTime(assignment.timeSlot?.startTime);
  const end = formatTime(assignment.timeSlot?.endTime);
  if (start && end) return `${start} – ${end}`;
  return start || end || '';
};

const courseText = (a) => {
  const code = a.exam?.courseOffering?.course?.code ?? '';
  const title = a.exam?.courseOffering?.course?.title ?? 'Exam';
  return code ? `${code} — ${title}` : title;
};

const durationText = (a) => {
  const minutes = a.exam?.duration ?? a.timeSlot?.duration;
  return minutes ? `${minutes} min` : '';
};

const inferSemester = (assignments) => {
  for (const a of assignments) {
    const name = a.exam?.courseOffering?.semester?.name;
    if (name) return name;
  }
  return null;
};

const assertPublished = (schedule) => {
  if (!schedule?.isFinal) {
    throw new AppError('PDF generation is only allowed for published schedules.', 400);
  }
};

// -------------------- row builders --------------------

const adminColumns = [
  { key: 'course', label: 'Course', width: 26 },
  { key: 'date', label: 'Date', width: 11 },
  { key: 'time', label: 'Time', width: 13 },
  { key: 'room', label: 'Room', width: 11 },
  { key: 'center', label: 'Center', width: 13 },
  { key: 'proctor', label: 'Proctor', width: 14 },
  { key: 'students', label: 'Students', width: 6, align: 'right' },
  { key: 'duration', label: 'Duration', width: 6, align: 'right' },
];

const studentColumns = [
  { key: 'course', label: 'Course', width: 28 },
  { key: 'date', label: 'Date', width: 12 },
  { key: 'time', label: 'Time', width: 14 },
  { key: 'room', label: 'Room', width: 12 },
  { key: 'center', label: 'Center', width: 16 },
  { key: 'proctor', label: 'Proctor', width: 14 },
  { key: 'duration', label: 'Duration', width: 8, align: 'right' },
];

const proctorColumns = [
  { key: 'course', label: 'Course', width: 28 },
  { key: 'date', label: 'Date', width: 12 },
  { key: 'time', label: 'Time', width: 14 },
  { key: 'room', label: 'Room', width: 12 },
  { key: 'center', label: 'Center', width: 16 },
  { key: 'students', label: 'Students', width: 8, align: 'right' },
  { key: 'duration', label: 'Duration', width: 8, align: 'right' },
];

const buildAdminRow = (a) => ({
  course: courseText(a),
  date: formatDate(a.timeSlot?.date ?? a.timeSlot?.startTime),
  time: timeRange(a),
  room: a.roomDisplayName ?? a.room?.name ?? '',
  center: a.centerDisplayName ?? a.room?.center?.name ?? '',
  proctor: a.proctorDisplayName ?? a.proctor?.user?.name ?? '',
  students:
    a.exam?.courseOffering?.registrations?.length ??
    a.exam?.courseOffering?.expectedStudents ??
    0,
  duration: durationText(a),
});

const buildStudentRow = (a) => ({
  course: courseText(a),
  date: formatDate(a.timeSlot?.date ?? a.timeSlot?.startTime),
  time: timeRange(a),
  room: a.roomDisplayName ?? a.room?.name ?? '',
  center: a.centerDisplayName ?? a.room?.center?.name ?? '',
  proctor: a.proctorDisplayName ?? a.proctor?.user?.name ?? '',
  duration: durationText(a),
});

const buildProctorRow = (a) => ({
  course: courseText(a),
  date: formatDate(a.timeSlot?.date ?? a.timeSlot?.startTime),
  time: timeRange(a),
  room: a.roomDisplayName ?? a.room?.name ?? '',
  center: a.centerDisplayName ?? a.room?.center?.name ?? '',
  students:
    a.exam?.courseOffering?.registrations?.length ??
    a.exam?.courseOffering?.expectedStudents ??
    0,
  duration: durationText(a),
});

const slugify = (value) =>
  String(value ?? 'schedule')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'schedule';

// -------------------- public stream functions --------------------

export const streamAdminSchedulePdf = async (res, scheduleId) => {
  const schedule = await schedulesService.getById(scheduleId);
  assertPublished(schedule);

  const assignments = getGroupedAssignments(schedule.assignments ?? []);
  const uniqueExams = new Set(assignments.map((a) => a.examId));
  const uniqueRooms = new Set(assignments.flatMap((a) => a.roomIds ?? [a.roomId]).filter(Boolean));
  const uniqueProctors = new Set(assignments.flatMap((a) => a.proctorIds ?? [a.proctorId]).filter(Boolean));

  streamScheduleReport(res, {
    fileName: `schedule-${slugify(schedule.name)}.pdf`,
    title: schedule.name || 'Published Schedule',
    subtitle: 'Complete published exam schedule (all centers, courses and proctors).',
    semester: inferSemester(assignments),
    examPeriod: schedule.examPeriod,
    scopeLabel: 'Admin / Full Published Schedule',
    summary: [
      { label: 'Assignments', value: assignments.length },
      { label: 'Distinct Exams', value: uniqueExams.size },
      { label: 'Rooms Used', value: uniqueRooms.size },
      { label: 'Proctors', value: uniqueProctors.size },
    ],
    columns: adminColumns,
    rows: assignments.map(buildAdminRow),
  });
};

export const streamStudentSchedulePdf = async (res, user) => {
  const dashboard = await roleDashboardService.getStudentDashboard(user);
  const assignments = getGroupedAssignments(dashboard.assignments ?? []);
  const profile = dashboard.profile;

  streamScheduleReport(res, {
    fileName: `my-exam-schedule-${slugify(profile?.user?.name ?? profile?.universityId ?? 'student')}.pdf`,
    title: 'My Exam Schedule',
    subtitle: 'Your personal published exam schedule based on your active registrations.',
    semester: inferSemester(assignments),
    examPeriod: assignments[0]?.schedule?.examPeriod ?? null,
    scopeLabel: 'Student',
    audienceLine: profile
      ? `Prepared for ${profile.user?.name ?? 'Student'}${profile.universityId ? ` (ID: ${profile.universityId})` : ''}${profile.program?.name ? ` — ${profile.program.name}` : ''}`
      : null,
    summary: [
      { label: 'Total Exams', value: assignments.length },
      { label: 'Upcoming', value: assignments.filter(isUpcomingAssignment).length },
      { label: 'Registered Courses', value: dashboard.summary?.registeredCourses ?? 0 },
    ],
    columns: studentColumns,
    rows: assignments.map(buildStudentRow),
  });
};

export const streamProctorSchedulePdf = async (res, user) => {
  const dashboard = await roleDashboardService.getProctorDashboard(user);
  const assignments = getGroupedAssignments(dashboard.assignments ?? []);
  const profile = dashboard.profile;

  streamScheduleReport(res, {
    fileName: `my-duties-${slugify(profile?.user?.name ?? 'proctor')}.pdf`,
    title: 'My Proctor Duties',
    subtitle: 'Your personal published invigilation assignments.',
    semester: inferSemester(assignments),
    examPeriod: assignments[0]?.schedule?.examPeriod ?? null,
    scopeLabel: 'Proctor',
    audienceLine: profile
      ? `Prepared for ${profile.user?.name ?? 'Proctor'}${profile.department ? ` — ${profile.department}` : ''}${profile.center?.name ? ` — ${profile.center.name}` : ''}`
      : null,
    summary: [
      { label: 'Assigned Duties', value: assignments.length },
      { label: 'Upcoming', value: assignments.filter(isUpcomingAssignment).length },
      { label: 'Related Students', value: dashboard.summary?.relatedStudents ?? 0 },
      { label: 'Centers', value: dashboard.summary?.centers ?? 0 },
    ],
    columns: proctorColumns,
    rows: assignments.map(buildProctorRow),
  });
};

const collectFullPublished = async (scheduleId) => {
  if (scheduleId) {
    const schedule = await schedulesService.getById(scheduleId);
    assertPublished(schedule);
    return [schedule];
  }
  const schedules = await roleDashboardService.getPublishedSchedulesForRole();
  if (!schedules.length) {
    throw new AppError('No published schedule is available yet.', 404);
  }
  return schedules;
};

export const streamFullPublishedSchedulePdf = async (res, { scheduleId, scopeLabel }) => {
  const schedules = await collectFullPublished(scheduleId);
  const flattened = getGroupedAssignments(
    schedules.flatMap((schedule) =>
      (schedule.assignments ?? []).map((assignment) => ({
        ...assignment,
        schedule: assignment.schedule ?? schedule,
      }))
    )
  );

  const firstSchedule = schedules[0];
  const uniqueExams = new Set(flattened.map((a) => a.examId));
  const uniqueRooms = new Set(flattened.flatMap((a) => a.roomIds ?? [a.roomId]).filter(Boolean));
  const uniqueProctors = new Set(flattened.flatMap((a) => a.proctorIds ?? [a.proctorId]).filter(Boolean));
  const uniqueSchedules = new Set(flattened.map((a) => a.schedule?.id).filter(Boolean));

  streamScheduleReport(res, {
    fileName: `full-published-schedule-${slugify(firstSchedule?.name ?? 'all')}.pdf`,
    title: schedules.length === 1
      ? (firstSchedule.name || 'Published Schedule')
      : 'Full Published Schedule',
    subtitle: 'Official read-only exam timetable across all published schedules.',
    semester: inferSemester(flattened),
    examPeriod: schedules.length === 1 ? firstSchedule.examPeriod : null,
    scopeLabel: scopeLabel || 'Full Published Schedule',
    summary: [
      { label: 'Published Schedules', value: uniqueSchedules.size || schedules.length },
      { label: 'Assignments', value: flattened.length },
      { label: 'Distinct Exams', value: uniqueExams.size },
      { label: 'Rooms', value: uniqueRooms.size },
      { label: 'Proctors', value: uniqueProctors.size },
    ],
    columns: adminColumns,
    rows: flattened.map(buildAdminRow),
  });
};
