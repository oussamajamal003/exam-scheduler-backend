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
router.use(authenticate);

router.get('/', roleGuard(['ADMIN']), validate(getCoursesSchema), controller.getAll);
router.post('/', roleGuard(['ADMIN']), validate(createCourseSchema), controller.create);
router.get('/:id', roleGuard(['ADMIN']), validate(getCourseSchema), controller.getById);
router.put('/:id', roleGuard(['ADMIN']), validate(updateCourseSchema), controller.update);
router.delete('/:id', roleGuard(['ADMIN']), validate(getCourseSchema), controller.remove);

export default router;

