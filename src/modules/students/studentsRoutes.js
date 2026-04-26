import express from 'express';
import { validate } from '../../middlewares/validate.js';
import { authenticate } from '../../middlewares/authMiddleware.js';
import { roleGuard } from '../../guards/roleGuard.js';
import {
  createStudentSchema,
  updateStudentSchema,
  getStudentSchema,
  getStudentsSchema,
} from './studentsValidation.js';
import * as controller from './studentsController.js';

const router = express.Router();

// Middleware applied to all routes in this file
router.use(authenticate);

router.get('/', roleGuard(['ADMIN']), validate(getStudentsSchema), controller.getAllStudents);
router.post('/', roleGuard(['ADMIN']), validate(createStudentSchema), controller.createStudent);

router.get('/:id', roleGuard(['ADMIN', 'STUDENT']), validate(getStudentSchema), controller.getStudentById);
router.put('/:id', roleGuard(['ADMIN']), validate(updateStudentSchema), controller.updateStudent);
router.delete('/:id', roleGuard(['ADMIN']), validate(getStudentSchema), controller.deleteStudent);

router.get('/:id/exams', roleGuard(['ADMIN', 'STUDENT']), validate(getStudentSchema), controller.getStudentExams);

export default router;