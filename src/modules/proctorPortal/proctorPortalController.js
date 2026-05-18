import { catchAsync } from '../../utils/catchAsync.js';
import { sendResponse } from '../../utils/response.js';
import * as service from './proctorPortalService.js';

export const getDashboard = catchAsync(async (req, res) => {
  const result = await service.getDashboard(req.user);
  sendResponse(res, 200, 'Proctor dashboard retrieved', result);
});

export const getAssignments = catchAsync(async (req, res) => {
  const result = await service.getAssignments(req.user);
  sendResponse(res, 200, 'Proctor assignments retrieved', result);
});

export const getAssignedStudents = catchAsync(async (req, res) => {
  const result = await service.getAssignedStudents(req.user);
  sendResponse(res, 200, 'Assigned students retrieved', result);
});

export const getNotifications = catchAsync(async (req, res) => {
  const result = await service.getNotifications(req.user, req.query);
  sendResponse(res, 200, 'Proctor notifications retrieved', result);
});

export const getPublishedSchedules = catchAsync(async (_req, res) => {
  const result = await service.getPublishedSchedules();
  sendResponse(res, 200, 'Published schedules retrieved', result);
});
