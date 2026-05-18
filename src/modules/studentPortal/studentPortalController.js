import { catchAsync } from '../../utils/catchAsync.js';
import { sendResponse } from '../../utils/response.js';
import * as service from './studentPortalService.js';

export const getDashboard = catchAsync(async (req, res) => {
  const result = await service.getDashboard(req.user);
  sendResponse(res, 200, 'Student dashboard retrieved', result);
});

export const getCourses = catchAsync(async (req, res) => {
  const result = await service.getCourses(req.user);
  sendResponse(res, 200, 'Student courses retrieved', result);
});

export const getExams = catchAsync(async (req, res) => {
  const result = await service.getExams(req.user);
  sendResponse(res, 200, 'Student exams retrieved', result);
});

export const getNotifications = catchAsync(async (req, res) => {
  const result = await service.getNotifications(req.user, req.query);
  sendResponse(res, 200, 'Student notifications retrieved', result);
});

export const getPublishedSchedules = catchAsync(async (_req, res) => {
  const result = await service.getPublishedSchedules();
  sendResponse(res, 200, 'Published schedules retrieved', result);
});
