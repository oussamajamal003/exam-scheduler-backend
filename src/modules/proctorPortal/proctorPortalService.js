import * as roleDashboardService from '../roleDashboards/roleDashboardsService.js';
import * as notificationsService from '../notifications/notificationsService.js';

const formatDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
};

const formatTime = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const getCourseTitle = (assignment) => assignment.exam?.courseOffering?.course?.title ?? 'Exam';
const getCourseCode = (assignment) => assignment.exam?.courseOffering?.course?.code ?? 'Course TBD';
const getRoomName = (assignment) => assignment.room?.name ?? 'Room TBD';
const getCenterName = (assignment) => assignment.room?.center?.name ?? 'Center TBD';

const buildAssignedStudents = (assignments) => {
  const groups = assignments.map((assignment) => {
    const registrations = assignment.exam?.courseOffering?.registrations ?? [];

    return {
      assignmentId: assignment.id,
      examId: assignment.examId,
      course: getCourseTitle(assignment),
      courseCode: getCourseCode(assignment),
      date: formatDate(assignment.timeSlot?.date ?? assignment.timeSlot?.startTime),
      startsAt: formatTime(assignment.timeSlot?.startTime),
      endsAt: formatTime(assignment.timeSlot?.endTime),
      room: getRoomName(assignment),
      center: getCenterName(assignment),
      students: registrations.map((registration) => ({
        registrationId: registration.id ?? `${assignment.id}:${registration.studentId}`,
        studentId: registration.student?.id ?? registration.studentId,
        studentName: registration.student?.user?.name ?? 'Student',
        studentEmail: registration.student?.user?.email ?? null,
        studentIdentifier: registration.student?.universityId ?? registration.studentId,
        course: getCourseTitle(assignment),
        courseCode: getCourseCode(assignment),
        room: getRoomName(assignment),
        center: getCenterName(assignment),
        startsAt: formatTime(assignment.timeSlot?.startTime),
        endsAt: formatTime(assignment.timeSlot?.endTime),
        status: 'Present / Absent later',
      })),
    };
  });

  return {
    groups,
    filters: {
      courses: [...new Set(groups.map((group) => group.courseCode).filter(Boolean))].sort(),
      dates: [...new Set(groups.map((group) => group.date).filter(Boolean))].sort(),
      rooms: [...new Set(groups.map((group) => group.room).filter(Boolean))].sort(),
    },
  };
};

export const getDashboard = async (user) => roleDashboardService.getProctorDashboard(user);

export const getAssignments = async (user) => {
  const dashboard = await roleDashboardService.getProctorDashboard(user);
  return {
    profile: dashboard.profile,
    summary: dashboard.summary,
    assignments: dashboard.assignments,
    nextAssignment: dashboard.nextAssignment,
  };
};

export const getAssignedStudents = async (user) => {
  const dashboard = await roleDashboardService.getProctorDashboard(user);
  return buildAssignedStudents(dashboard.assignments);
};

export const getNotifications = async (user, query) => notificationsService.listForUser(user, query);
export const markNotificationRead = async (user, notificationId) => notificationsService.markReadForUser(user, notificationId);
export const markAllNotificationsRead = async (user) => notificationsService.markAllReadForUser(user);

export const getPublishedSchedules = async () => roleDashboardService.getPublishedSchedulesForRole();
