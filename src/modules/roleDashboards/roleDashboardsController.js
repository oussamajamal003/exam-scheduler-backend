import { catchAsync } from '../../utils/catchAsync.js';
import { sendResponse } from '../../utils/response.js';
import * as service from './roleDashboardsService.js';
import prisma from '../../config/prisma.js';

export const getStudentDashboard = catchAsync(async (req, res) => {
  const result = await service.getStudentDashboard(req.user);
  sendResponse(res, 200, 'Student dashboard retrieved', result);
});

export const getProctorDashboard = catchAsync(async (req, res) => {
  const result = await service.getProctorDashboard(req.user);
  sendResponse(res, 200, 'Proctor dashboard retrieved', result);
});

export const getPublishedSchedulesForRole = catchAsync(async (_req, res) => {
  const result = await service.getPublishedSchedulesForRole();
  sendResponse(res, 200, 'Published schedules retrieved', result);
});

/**
 * Returns all admin dashboard entity counts in a single response so the
 * admin dashboard avoids firing 5+ separate HTTP requests on mount.
 */
export const getAdminDashboardCounts = catchAsync(async (_req, res) => {
  const [students, courses, rooms, proctors, exams, semesters, schedules, publishedAssignments] =
    await Promise.all([
      prisma.student.count(),
      prisma.course.count(),
      prisma.room.count(),
      prisma.proctor.count(),
      prisma.exam.count(),
      prisma.semester.count(),
      prisma.schedule.count(),
      prisma.examAssignment.count({ where: { schedule: { isFinal: true } } }),
    ]);

  sendResponse(res, 200, 'Dashboard counts retrieved', {
    students,
    courses,
    rooms,
    proctors,
    exams,
    semesters,
    schedules,
    publishedAssignments,
  });
});
