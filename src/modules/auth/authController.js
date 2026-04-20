import { signupUser, loginUser, fetchAllUsers, removeUser } from './authService.js';
import { sendResponse } from '../../utils/response.js';
import { catchAsync } from '../../utils/catchAsync.js';

export const signup = catchAsync(async (req, res) => {
  const result = await signupUser(req.body);
  sendResponse(res, 201, 'User created successfully', result);
});

export const login = catchAsync(async (req, res) => {
  const result = await loginUser(req.body);
  sendResponse(res, 200, 'Login successful', result);
});

export const logout = (req, res) => {
  sendResponse(res, 200, 'Logged out successfully');
};

export const getAllUsers = catchAsync(async (req, res) => {
  const users = await fetchAllUsers();
  sendResponse(res, 200, 'Users fetched successfully', users);
});

export const deleteUser = catchAsync(async (req, res) => {
  await removeUser(req.user.id);
  sendResponse(res, 200, 'User deleted successfully');
});
