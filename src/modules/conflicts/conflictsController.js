import * as service from './conflictsService.js';
import { sendResponse } from '../../utils/response.js';
import { catchAsync } from '../../utils/catchAsync.js';

// GET /api/conflicts
export const getAll = catchAsync(async (req, res) => {
  const result = await service.getAll(req.query);
  sendResponse(res, 200, 'Conflicts fetched successfully', result);
});

// GET /api/conflicts/:id
export const getById = catchAsync(async (req, res) => {
  const result = await service.getById(req.params.id);
  sendResponse(res, 200, 'Conflict details retrieved', result);
});

// GET /api/schedules/:id/conflicts
export const getByScheduleId = catchAsync(async (req, res) => {
  const result = await service.getByScheduleId(req.params.id);
  sendResponse(res, 200, 'Schedule conflicts retrieved', result);
});

// POST /api/conflicts/detect
export const detect = catchAsync(async (req, res) => {
  const result = await service.detect(req.body, req.user);
  sendResponse(res, 200, 'Conflicts detected successfully', result);
});
