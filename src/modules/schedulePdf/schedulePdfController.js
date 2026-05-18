import { catchAsync } from '../../utils/catchAsync.js';
import * as service from './schedulePdfService.js';

export const downloadAdminSchedulePdf = catchAsync(async (req, res) => {
  await service.streamAdminSchedulePdf(res, req.params.id);
});

export const downloadStudentSchedulePdf = catchAsync(async (req, res) => {
  await service.streamStudentSchedulePdf(res, req.user);
});

export const downloadProctorSchedulePdf = catchAsync(async (req, res) => {
  await service.streamProctorSchedulePdf(res, req.user);
});

export const downloadFullPublishedSchedulePdf = catchAsync(async (req, res) => {
  await service.streamFullPublishedSchedulePdf(res, {
    scheduleId: req.query.scheduleId ?? null,
    scopeLabel: req.scope ?? 'Full Published Schedule',
  });
});
