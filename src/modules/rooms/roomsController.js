import * as service from './roomsService.js';
import { sendResponse } from '../../utils/response.js';
import { catchAsync } from '../../utils/catchAsync.js';

export const getAll = catchAsync(async (req, res) => {
  const result = await service.getAll(req.query);
  sendResponse(res, 200, 'rooms fetched successfully', result);
});

export const getById = catchAsync(async (req, res) => {
  const result = await service.getById(req.params.id);
  sendResponse(res, 200, 'rooms details retrieved', result);
});

export const create = catchAsync(async (req, res) => {
  const result = await service.create(req.body);
  sendResponse(res, 201, 'rooms created successfully', result);
});

export const update = catchAsync(async (req, res) => {
  const result = await service.update(req.params.id, req.body);
  sendResponse(res, 200, 'rooms updated successfully', result);
});

export const remove = catchAsync(async (req, res) => {
  await service.remove(req.params.id);
  sendResponse(res, 200, 'rooms deleted successfully');
});

export const getAvailable = catchAsync(async (req, res) => {
  const result = await service.getAvailable(req.query);
  sendResponse(res, 200, 'Available rooms retrieved', result);
});