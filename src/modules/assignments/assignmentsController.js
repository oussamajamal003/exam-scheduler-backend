import * as service from './assignmentsService.js';
import { sendResponse } from '../../utils/response.js';
import { catchAsync } from '../../utils/catchAsync.js';

// GET /api/schedules/:scheduleId/assignments
export const list = catchAsync(async (req, res) => {
  const result = await service.listForSchedule(req.params.scheduleId);
  sendResponse(res, 200, 'Schedule assignments retrieved', result);
});

// GET /api/schedules/:scheduleId/assignments/:assignmentId
export const getOne = catchAsync(async (req, res) => {
  const result = await service.getOne(
    req.params.scheduleId,
    req.params.assignmentId
  );
  sendResponse(res, 200, 'Assignment details retrieved', result);
});

// PUT /api/schedules/:scheduleId/assignments/:assignmentId
export const update = catchAsync(async (req, res) => {
  const result = await service.update(
    req.params.scheduleId,
    req.params.assignmentId,
    req.body
  );
  sendResponse(res, 200, 'Assignment updated successfully', result);
});

// DELETE /api/schedules/:scheduleId/assignments/:assignmentId
export const remove = catchAsync(async (req, res) => {
  await service.remove(req.params.scheduleId, req.params.assignmentId);
  sendResponse(res, 200, 'Assignment deleted successfully');
});
