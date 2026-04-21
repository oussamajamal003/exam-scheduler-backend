import express from 'express';
import { authenticate } from '../../middlewares/authMiddleware.js';
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
router.post('/', authenticate, roleGuard(['TECH_ADMIN']), validate(createCourseSchema), controller.create);
router.get('/:id', validate(getCourseSchema), controller.getById);
router.put('/:id', authenticate, roleGuard(['TECH_ADMIN']), validate(updateCourseSchema), controller.update);
router.delete('/:id', authenticate, roleGuard(['TECH_ADMIN']), validate(getCourseSchema), controller.remove);

export default router;

