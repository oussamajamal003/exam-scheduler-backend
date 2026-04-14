import * as service from './service.js';
import { sendResponse } from '../../utils/response.js';
import { catchAsync } from '../../utils/catchAsync.js';

export const getAll = catchAsync(async (req, res) => {
  const result = await service.getAll(req.query);
  sendResponse(res, 200, 'Enrollments fetched successfully', result);
});

export const create = catchAsync(async (req, res) => {
  const result = await service.create(req.body);
  sendResponse(res, 201, 'Enrollment created successfully', result);
});

export const remove = catchAsync(async (req, res) => {
  await service.remove(req.params.id);
  sendResponse(res, 200, 'Enrollment deleted successfully');
});