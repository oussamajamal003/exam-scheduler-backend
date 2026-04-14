import * as service from './service.js';
import { sendResponse } from '../../utils/response.js';
import { catchAsync } from '../../utils/catchAsync.js';

export const detect = catchAsync(async (req, res) => {
  const result = await service.detect(req.body);
  sendResponse(res, 200, 'Conflicts detected successfully', result);
});