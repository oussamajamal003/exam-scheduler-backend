import express from 'express';
import { authenticate } from '../../middlewares/authMiddleware.js';
import { roleGuard } from '../../guards/roleGuard.js';
import { validate } from '../../middlewares/validate.js';
import { getExamSchema, getExamsSchema } from './examsValidation.js';
import * as controller from './examsController.js';

const router = express.Router();
router.use(authenticate);

router.get('/', roleGuard(['ADMIN', 'PROCTOR', 'STUDENT']), validate(getExamsSchema), controller.getAll);
router.post('/generate-from-courses', roleGuard(['ADMIN']), controller.generateFromCourses);
router.get('/:id', roleGuard(['ADMIN', 'PROCTOR', 'STUDENT']), validate(getExamSchema), controller.getById);

export default router;
