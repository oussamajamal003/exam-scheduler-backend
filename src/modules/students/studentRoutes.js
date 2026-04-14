import express from 'express';
import { validate } from '../../middlewares/validate.js';
import { authGuard } from '../../guards/authguard.js'; // Base JWT check
import { roleGuard } from '../../guards/roleGuard.js';
import {
  createStudentSchema,
  updateStudentSchema,
  getStudentSchema,
  getStudentsSchema,
} from './studentValidation.js';
import {
  getAllStudents,
  getStudentById,
  createStudent,
  updateStudent,
  deleteStudent,
  getStudentExams
} from './studentController.js';

const router = express.Router();

// Middleware applied to all routes in this file
router.use(authGuard);

router.get('/', roleGuard(['TECH_ADMIN', 'SCHEDULING_ADMIN']), validate(getStudentsSchema), getAllStudents);
router.post('/', roleGuard(['TECH_ADMIN']), validate(createStudentSchema), createStudent);

router.get('/:id', validate(getStudentSchema), getStudentById);
router.put('/:id', roleGuard(['TECH_ADMIN']), validate(updateStudentSchema), updateStudent);
router.delete('/:id', roleGuard(['TECH_ADMIN']), validate(getStudentSchema), deleteStudent);

router.get('/:id/exams', validate(getStudentSchema), getStudentExams);

export default router;