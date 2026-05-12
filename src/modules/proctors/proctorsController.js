import * as service from './proctorsService.js';
import { sendResponse } from '../../utils/response.js';
import { catchAsync } from '../../utils/catchAsync.js';

export const getAll = catchAsync(async (req, res) => {
  const result = await service.getAll(req.query);
  sendResponse(res, 200, 'proctors fetched successfully', result);
});

export const getById = catchAsync(async (req, res) => {
  const result = await service.getById(req.params.id, req.user);
  sendResponse(res, 200, 'proctors details retrieved', result);
});

export const create = catchAsync(async (req, res) => {
  const result = await service.create(req.body, req.user);
  sendResponse(res, 201, 'proctors created successfully', result);
});

export const update = catchAsync(async (req, res) => {
  const result = await service.update(req.params.id, req.body);
  sendResponse(res, 200, 'proctors updated successfully', result);
});

export const remove = catchAsync(async (req, res) => {
  await service.remove(req.params.id);
  sendResponse(res, 200, 'proctors deleted successfully');
});

export const getWorkload = catchAsync(async (req, res) => {
  const result = await service.getWorkload(req.params.id, req.user);
  sendResponse(res, 200, 'Proctor workload retrieved', result);
});