import { catchAsync } from '../../utils/catchAsync.js';
import { sendResponse } from '../../utils/response.js';
import * as service from './systemSettingsService.js';
import * as userSettingsService from '../userSettings/userSettingsService.js';

export const getSystemSettings = catchAsync(async (req, res) => {
  const result = await service.getSystemSettings();
  sendResponse(res, 200, 'System settings retrieved', result);
});

export const updateSystemSettings = catchAsync(async (req, res) => {
  const result = await service.updateSystemSettings(req.body);
  sendResponse(res, 200, 'System settings updated', result);
});

export const getNotifications = catchAsync(async (req, res) => {
  const result = await userSettingsService.getSettings(req.user);
  sendResponse(res, 200, 'Notification preferences retrieved', result);
});

export const updateNotifications = catchAsync(async (req, res) => {
  const result = await userSettingsService.updateSettings(req.user, req.body);
  sendResponse(res, 200, 'Notification preferences updated', result);
});

export const changePassword = catchAsync(async (req, res) => {
  const result = await userSettingsService.changePassword(req.user, req.body);
  sendResponse(res, 200, 'Password changed successfully', result);
});

export const getProfile = catchAsync(async (req, res) => {
  const result = await service.getProfile(req.user);
  sendResponse(res, 200, 'Profile retrieved', result);
});

export const updateProfile = catchAsync(async (req, res) => {
  const result = await service.updateProfile(req.user, req.body);
  sendResponse(res, 200, 'Profile updated', result);
});

export const listUserAccounts = catchAsync(async (req, res) => {
  const result = await service.listUserAccounts(req.query);
  sendResponse(res, 200, 'Accounts retrieved', result);
});

export const getUserAccount = catchAsync(async (req, res) => {
  const result = await service.getUserAccount(req.params.userId);
  sendResponse(res, 200, 'Account retrieved', result);
});

export const updateUserAccount = catchAsync(async (req, res) => {
  const result = await service.updateUserAccount(req.params.userId, req.body);
  sendResponse(res, 200, 'Account updated', result);
});

export const deleteUserAccount = catchAsync(async (req, res) => {
  const result = await service.deleteUserAccount(req.user, req.params.userId);
  sendResponse(res, 200, 'Account deleted', result);
});
