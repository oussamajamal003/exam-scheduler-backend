import * as service from './examsService.js';
import { sendResponse } from '../../utils/response.js';
import { catchAsync } from '../../utils/catchAsync.js';

export const getAll = catchAsync(async (req, res) => {
  const result = await service.getAll(req.query);
  sendResponse(res, 200, 'Exams fetched successfully', result);
});

export const generateFromCourses = catchAsync(async (req, res) => {
  const result = await service.generateFromCourses(req.body);
  sendResponse(res, 201, 'Exams generated successfully', result);
});

export const getById = catchAsync(async (req, res) => {
  const result = await service.getById(req.params.id);
  sendResponse(res, 200, 'Exam details retrieved', result);
});