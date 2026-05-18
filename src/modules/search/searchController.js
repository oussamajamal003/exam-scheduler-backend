import * as service from './searchService.js';
import { sendResponse } from '../../utils/response.js';
import { catchAsync } from '../../utils/catchAsync.js';

export const search = catchAsync(async (req, res) => {
  const result = await service.globalSearch({
    q: req.query.q,
    limit: req.query.limit,
    user: req.user,
  });
  sendResponse(res, 200, 'search results', result);
});
