import express from 'express';
import { strictRoleGuard } from '../../guards/roleGuard.js';
import { validate } from '../../middlewares/validate.js';
import * as controller from './proctorPortalController.js';
import * as pdfController from '../schedulePdf/schedulePdfController.js';
import * as settingsController from '../userSettings/userSettingsController.js';
import { changePasswordSchema, updateProfileSchema, updateSettingsSchema } from '../userSettings/userSettingsValidation.js';

const router = express.Router();

router.use(strictRoleGuard(['PROCTOR']));

router.get('/dashboard', controller.getDashboard);
router.get('/assignments', controller.getAssignments);
router.get('/assigned-students', controller.getAssignedStudents);
router.get('/schedule/pdf', pdfController.downloadProctorSchedulePdf);
router.get('/schedule/full-pdf', (req, _res, next) => { req.scope = 'Proctor / Full Published Schedule'; next(); }, pdfController.downloadFullPublishedSchedulePdf);
router.get('/notifications', controller.getNotifications);
router.patch('/notifications/read-all', controller.markAllNotificationsRead);
router.patch('/notifications/:id/read', controller.markNotificationRead);
router.get('/published-schedules', controller.getPublishedSchedules);
router.get('/settings', settingsController.getSettings);
router.get('/settings/profile', settingsController.getProfile);
router.patch('/settings/profile', validate(updateProfileSchema), settingsController.updateProfile);
router.patch('/settings', validate(updateSettingsSchema), settingsController.updateSettings);
router.patch('/settings/change-password', validate(changePasswordSchema), settingsController.changePassword);

export default router;
