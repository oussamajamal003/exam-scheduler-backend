import * as studentsService from './studentsService.js';
import { sendResponse } from '../../utils/response.js';
import { catchAsync } from '../../utils/catchAsync.js';

export const getAllStudents = catchAsync(async (req, res) => {
  const result = await studentsService.getAllStudents(req.query);
  sendResponse(res, 200, 'Students fetched successfully', result);
});

export const getStudentById = catchAsync(async (req, res) => {
  const student = await studentsService.getStudentById(req.params.id);
  sendResponse(res, 200, 'Student details retrieved', student);
});

export const createStudent = catchAsync(async (req, res) => {
  const student = await studentsService.createStudent(req.body);
  sendResponse(res, 201, 'Student created successfully', student);
});

export const updateStudent = catchAsync(async (req, res) => {
  const updatedStudent = await studentsService.updateStudent(req.params.id, req.body);
  sendResponse(res, 200, 'Student updated successfully', updatedStudent);
});

export const deleteStudent = catchAsync(async (req, res) => {
  await studentsService.deleteStudent(req.params.id);
  sendResponse(res, 200, 'Student deleted successfully');
});

export const getStudentExams = catchAsync(async (req, res) => {
  const exams = await studentsService.getStudentExams(req.params.id);
  sendResponse(res, 200, 'Student exams retrieved', exams);
});