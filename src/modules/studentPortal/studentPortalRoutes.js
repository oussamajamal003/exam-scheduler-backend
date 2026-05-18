import express from 'express';
import { strictRoleGuard } from '../../guards/roleGuard.js';
import { validate } from '../../middlewares/validate.js';
import * as controller from './studentPortalController.js';
import * as pdfController from '../schedulePdf/schedulePdfController.js';
import * as settingsController from '../userSettings/userSettingsController.js';
import { changePasswordSchema, updateSettingsSchema } from '../userSettings/userSettingsValidation.js';

const router = express.Router();

router.use(strictRoleGuard(['STUDENT']));

router.get('/dashboard', controller.getDashboard);
router.get('/courses', controller.getCourses);
router.get('/exams', controller.getExams);
router.get('/schedule/pdf', pdfController.downloadStudentSchedulePdf);
router.get('/schedule/full-pdf', (req, _res, next) => { req.scope = 'Student / Full Published Schedule'; next(); }, pdfController.downloadFullPublishedSchedulePdf);
router.get('/notifications', controller.getNotifications);
router.patch('/notifications/read-all', controller.markAllNotificationsRead);
router.patch('/notifications/:id/read', controller.markNotificationRead);
router.get('/published-schedules', controller.getPublishedSchedules);
router.get('/settings', settingsController.getSettings);
router.patch('/settings', validate(updateSettingsSchema), settingsController.updateSettings);
router.patch('/settings/change-password', validate(changePasswordSchema), settingsController.changePassword);

export default router;
