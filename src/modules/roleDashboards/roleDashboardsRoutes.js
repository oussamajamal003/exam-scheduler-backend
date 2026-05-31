import express from 'express';
import { strictRoleGuard } from '../../guards/roleGuard.js';
import * as controller from './roleDashboardsController.js';

const router = express.Router();

router.get('/admin/counts', strictRoleGuard(['ADMIN']), controller.getAdminDashboardCounts);
router.get('/student', strictRoleGuard(['STUDENT']), controller.getStudentDashboard);
router.get('/proctor', strictRoleGuard(['PROCTOR']), controller.getProctorDashboard);
router.get('/published-schedules', strictRoleGuard(['STUDENT', 'PROCTOR']), controller.getPublishedSchedulesForRole);

export default router;
