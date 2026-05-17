import * as schedulingService from './schedulingService.js';
import { sendResponse } from '../../utils/response.js';
import { catchAsync } from '../../utils/catchAsync.js';

export const prepareScheduling = catchAsync(async (req, res) => {
  const result = await schedulingService.prepareScheduling(req.body);
  sendResponse(res, 200, 'Scheduling prepared.', result);
});

export const validateInput = catchAsync(async (req, res) => {
  const result = await schedulingService.validateInput(req.body);
  sendResponse(res, 200, 'Data validation complete', result);
});

export const optimizeScheduling = catchAsync(async (req, res) => {
  const result = await schedulingService.optimizeScheduling(req.body);
  sendResponse(res, 200, 'Scheduling optimization complete', result);
});

export const generateSchedule = catchAsync(async (req, res) => {
  const result = await schedulingService.generateSchedule(req.body);
  sendResponse(res, 202, 'Hybrid constraint-based scheduling complete', result);
});

export const getScheduleAnalysis = catchAsync(async (req, res) => {
  const analysis = await schedulingService.getScheduleAnalysis(req.params.id);
  sendResponse(res, 200, 'Schedule analysis retrieved', analysis);
});

export const publishSchedule = catchAsync(async (req, res) => {
  const result = await schedulingService.publishSchedule(req.params.id, req.body);
  sendResponse(res, 200, result.message, result.schedule);
});