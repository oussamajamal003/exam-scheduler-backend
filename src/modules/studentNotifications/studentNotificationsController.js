import { catchAsync } from '../../utils/catchAsync.js';
import { sendResponse } from '../../utils/response.js';
import * as service from './studentNotificationsService.js';

export const list = catchAsync(async (req, res) => {
  const result = await service.listForStudent(req.user, req.query);
  sendResponse(res, 200, 'Student notifications retrieved', result);
});

export const markRead = catchAsync(async (req, res) => {
  const notification = await service.markRead(req.user, req.params.id);
  sendResponse(res, 200, 'Notification marked as read', notification);
});

export const markAllRead = catchAsync(async (req, res) => {
  const result = await service.markAllRead(req.user);
  sendResponse(res, 200, 'Notifications marked as read', result);
});
