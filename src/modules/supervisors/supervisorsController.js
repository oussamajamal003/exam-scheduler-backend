import * as service from './supervisorsService.js';
import { sendResponse } from '../../utils/response.js';
import { catchAsync } from '../../utils/catchAsync.js';

export const getAll = catchAsync(async (req, res) => {
  const result = await service.getAll(req.query);
  sendResponse(res, 200, 'supervisors fetched successfully', result);
});

export const getById = catchAsync(async (req, res) => {
  const result = await service.getById(req.params.id);
  sendResponse(res, 200, 'supervisors details retrieved', result);
});

export const create = catchAsync(async (req, res) => {
  const result = await service.create(req.body);
  sendResponse(res, 201, 'supervisors created successfully', result);
});

export const update = catchAsync(async (req, res) => {
  const result = await service.update(req.params.id, req.body);
  sendResponse(res, 200, 'supervisors updated successfully', result);
});

export const remove = catchAsync(async (req, res) => {
  await service.remove(req.params.id);
  sendResponse(res, 200, 'supervisors deleted successfully');
});

export const getWorkload = catchAsync(async (req, res) => {
  const result = await service.getWorkload(req.params.id);
  sendResponse(res, 200, 'Supervisor workload retrieved', result);
});