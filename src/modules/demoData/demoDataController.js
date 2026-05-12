import * as demoDataService from './demoDataService.js';
import { catchAsync } from '../../utils/catchAsync.js';
import { sendResponse } from '../../utils/response.js';

export const generate = catchAsync(async (req, res) => {
  const result = await demoDataService.generateDemoData(req.body ?? {});
  sendResponse(res, 201, result.message, result);
});

export const clear = catchAsync(async (req, res) => {
  const result = await demoDataService.clearDemoData(req.body ?? {});
  sendResponse(res, 200, result.message, result);
});
