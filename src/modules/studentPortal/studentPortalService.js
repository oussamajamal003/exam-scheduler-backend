import * as roleDashboardService from '../roleDashboards/roleDashboardsService.js';
import * as notificationsService from '../notifications/notificationsService.js';

export const getDashboard = async (user) => roleDashboardService.getStudentDashboard(user);

export const getCourses = async (user) => {
  const dashboard = await roleDashboardService.getStudentDashboard(user);
  return {
    profile: dashboard.profile,
    summary: dashboard.summary,
    courses: dashboard.courses,
  };
};

export const getExams = async (user) => {
  const dashboard = await roleDashboardService.getStudentDashboard(user);
  return {
    profile: dashboard.profile,
    summary: dashboard.summary,
    exams: dashboard.exams,
    assignments: dashboard.assignments,
    nextAssignment: dashboard.nextAssignment,
  };
};

export const getNotifications = async (user, query) => notificationsService.listForUser(user, query);

export const getPublishedSchedules = async () => roleDashboardService.getPublishedSchedulesForRole();
