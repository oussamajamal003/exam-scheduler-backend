import * as service from './service.js';
import { sendResponse } from '../../utils/response.js';
import { catchAsync } from '../../utils/catchAsync.js';

export const evaluateSchedule = catchAsync(async (req, res) => {
  const result = await service.evaluateSchedule(req.params.scheduleId);
  sendResponse(res, 200, 'AI schedule evaluation complete', result);
});