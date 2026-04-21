import express from 'express';
import { authenticate } from '../../middlewares/authMiddleware.js';
import { roleGuard } from '../../guards/roleGuard.js';
import * as controller from './examsController.js';

const router = express.Router();
router.use(authenticate);

router.get('/', controller.getAll);
router.post('/generate-from-courses', roleGuard(['SCHEDULING_ADMIN', 'TECH_ADMIN']), controller.generateFromCourses);
router.get('/:id', controller.getById);

export default router;
