import express from 'express';
import { authenticate } from '../../middlewares/authMiddleware.js';
import { roleGuard } from '../../guards/roleGuard.js';
import * as controller from './conflictsController.js';

const router = express.Router();
router.use(authenticate);
router.post('/detect', roleGuard(['SCHEDULING_ADMIN', 'TECH_ADMIN']), controller.detect);

export default router;
