import express from 'express';
import { strictRoleGuard } from '../../guards/roleGuard.js';
import * as controller from './studentPortalController.js';

const router = express.Router();

router.use(strictRoleGuard(['STUDENT']));

router.get('/dashboard', controller.getDashboard);
router.get('/courses', controller.getCourses);
router.get('/exams', controller.getExams);
router.get('/notifications', controller.getNotifications);
router.get('/published-schedules', controller.getPublishedSchedules);

export default router;
