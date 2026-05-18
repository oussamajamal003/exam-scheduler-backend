import { catchAsync } from '../../utils/catchAsync.js';
import { sendResponse } from '../../utils/response.js';
import * as service from './userSettingsService.js';

export const getSettings = catchAsync(async (req, res) => {
  const result = await service.getSettings(req.user);
  sendResponse(res, 200, 'Settings retrieved', result);
});

export const updateSettings = catchAsync(async (req, res) => {
  const result = await service.updateSettings(req.user, req.body);
  sendResponse(res, 200, 'Settings updated', result);
});

export const changePassword = catchAsync(async (req, res) => {
  const result = await service.changePassword(req.user, req.body);
  sendResponse(res, 200, 'Password changed successfully', result);
});
