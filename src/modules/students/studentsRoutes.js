import express from 'express';
import { validate } from '../../middlewares/validate.js';
import { authGuard } from '../../guards/authguard.js';
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
router.use(authGuard);

router.get('/', roleGuard(['TECH_ADMIN', 'SCHEDULING_ADMIN']), validate(getStudentsSchema), controller.getAllStudents);
router.post('/', roleGuard(['TECH_ADMIN']), validate(createStudentSchema), controller.createStudent);

router.get('/:id', validate(getStudentSchema), controller.getStudentById);
router.put('/:id', roleGuard(['TECH_ADMIN']), validate(updateStudentSchema), controller.updateStudent);
router.delete('/:id', roleGuard(['TECH_ADMIN']), validate(getStudentSchema), controller.deleteStudent);

router.get('/:id/exams', validate(getStudentSchema), controller.getStudentExams);

export default router;