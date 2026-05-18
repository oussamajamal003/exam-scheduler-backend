import { catchAsync } from '../../utils/catchAsync.js';
import { sendResponse } from '../../utils/response.js';
import * as service from './roleDashboardsService.js';

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
