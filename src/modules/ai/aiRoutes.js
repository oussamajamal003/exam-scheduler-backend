import express from 'express';
import { authenticate } from '../../middlewares/authMiddleware.js';
import { roleGuard } from '../../guards/roleGuard.js';
import * as controller from './aiController.js';

const router = express.Router();
router.use(authenticate);
router.post('/evaluate-schedule/:scheduleId', roleGuard(['ADMIN']), controller.evaluateSchedule);

export default router;
