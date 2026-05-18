import express from 'express';
import { strictRoleGuard } from '../../guards/roleGuard.js';
import * as controller from './proctorPortalController.js';

const router = express.Router();

router.use(strictRoleGuard(['PROCTOR']));

router.get('/dashboard', controller.getDashboard);
router.get('/assignments', controller.getAssignments);
router.get('/assigned-students', controller.getAssignedStudents);
router.get('/notifications', controller.getNotifications);
router.get('/published-schedules', controller.getPublishedSchedules);

export default router;
