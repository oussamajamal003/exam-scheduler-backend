import express from 'express';
import { authGuard } from '../../guards/authguard.js';
import { roleGuard } from '../../guards/roleGuard.js';
import * as controller from './controller.js';

const router = express.Router();
router.use(authGuard);

router.get('/', controller.getAll);
router.post('/generate-from-courses', roleGuard(['SCHEDULING_ADMIN', 'TECH_ADMIN']), controller.generateFromCourses);
router.get('/:id', controller.getById);

export default router;
