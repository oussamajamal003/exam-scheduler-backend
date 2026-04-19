import express from 'express';
import { authGuard } from '../../guards/authguard.js';
import { roleGuard } from '../../guards/roleGuard.js';
import * as controller from './aiController.js';

const router = express.Router();
router.use(authGuard);
router.post('/evaluate-schedule/:scheduleId', roleGuard(['SCHEDULING_ADMIN', 'TECH_ADMIN']), controller.evaluateSchedule);

export default router;
