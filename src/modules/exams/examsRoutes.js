import express from 'express';
import { authenticate } from '../../middlewares/authMiddleware.js';
import { roleGuard } from '../../guards/roleGuard.js';
import * as controller from './examsController.js';

const router = express.Router();
router.use(authenticate);

router.get('/', roleGuard(['ADMIN', 'PROCTOR', 'STUDENT']), controller.getAll);
router.post('/generate-from-courses', roleGuard(['ADMIN']), controller.generateFromCourses);
router.get('/:id', roleGuard(['ADMIN', 'PROCTOR', 'STUDENT']), controller.getById);

export default router;
