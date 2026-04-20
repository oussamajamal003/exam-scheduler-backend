import * as service from './semestersService.js';
import { sendResponse } from '../../utils/response.js';
import { catchAsync } from '../../utils/catchAsync.js';

export const getAll = catchAsync(async (req, res) => {
  const result = await service.getAll(req.query);
  sendResponse(res, 200, 'semesters fetched successfully', result);
});

export const getById = catchAsync(async (req, res) => {
  const result = await service.getById(req.params.id);
  sendResponse(res, 200, 'semester details retrieved', result);
});

export const create = catchAsync(async (req, res) => {
  const result = await service.create(req.body);
  sendResponse(res, 201, 'semester created successfully', result);
});

export const update = catchAsync(async (req, res) => {
  const result = await service.update(req.params.id, req.body);
  sendResponse(res, 200, 'semester updated successfully', result);
});

export const remove = catchAsync(async (req, res) => {
  await service.remove(req.params.id);
  sendResponse(res, 200, 'semester deleted successfully');
});