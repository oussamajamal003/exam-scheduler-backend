import express from 'express';
import { authGuard } from '../../guards/authguard.js';
import { roleGuard } from '../../guards/roleGuard.js';
import { validate } from '../../middlewares/validate.js';
import {
  createCourseSchema,
  getCourseSchema,
  getCoursesSchema,
  updateCourseSchema,
} from './coursesValidation.js';
import * as controller from './coursesController.js';

const router = express.Router();

router.get('/', validate(getCoursesSchema), controller.getAll);
router.post('/', authGuard, roleGuard(['TECH_ADMIN']), validate(createCourseSchema), controller.create);
router.get('/:id', validate(getCourseSchema), controller.getById);
router.put('/:id', authGuard, roleGuard(['TECH_ADMIN']), validate(updateCourseSchema), controller.update);
router.delete('/:id', authGuard, roleGuard(['TECH_ADMIN']), validate(getCourseSchema), controller.remove);

export default router;

