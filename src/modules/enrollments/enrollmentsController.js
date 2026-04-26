import * as service from './enrollmentsService.js';
import { sendResponse } from '../../utils/response.js';
import { catchAsync } from '../../utils/catchAsync.js';

export const getAll = catchAsync(async (req, res) => {
  const result = await service.getAll(req.query, req.user);
  sendResponse(res, 200, 'Enrollments fetched successfully', result);
});

export const getById = catchAsync(async (req, res) => {
  const result = await service.getById(req.params.id, req.user);
  sendResponse(res, 200, 'Enrollment details retrieved', result);
});

export const getByStudent = catchAsync(async (req, res) => {
  const result = await service.getByStudent(req.params.studentId, req.query, req.user);
  sendResponse(res, 200, 'Student enrollments fetched successfully', result);
});

export const getByOffering = catchAsync(async (req, res) => {
  const result = await service.getByOffering(req.params.offeringId, req.query, req.user);
  sendResponse(res, 200, 'Course offering enrollments fetched successfully', result);
});

export const create = catchAsync(async (req, res) => {
  const result = await service.create(req.body);
  sendResponse(res, 201, 'Enrollment created successfully', result);
});

export const bulkImport = catchAsync(async (req, res) => {
  const result = await service.bulkImport(req.body.enrollments);
  sendResponse(res, 201, 'Enrollments imported successfully', result);
});

export const update = catchAsync(async (req, res) => {
  const result = await service.update(req.params.id, req.body);
  sendResponse(res, 200, 'Enrollment updated successfully', result);
});

export const remove = catchAsync(async (req, res) => {
  await service.remove(req.params.id);
  sendResponse(res, 200, 'Enrollment deleted successfully');
});