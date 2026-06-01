import express from 'express';
import { authenticate } from '../../middlewares/authMiddleware.js';
import { roleGuard } from '../../guards/roleGuard.js';
import { validate } from '../../middlewares/validate.js';
import { changePasswordSchema } from '../userSettings/userSettingsValidation.js';
import {
  updateSystemSettingsSchema,
  updateNotificationsSchema,
  updateProfileSchema,
  listAccountsSchema,
  accountIdSchema,
  updateAccountSchema,
} from './systemSettingsValidation.js';
import * as controller from './systemSettingsController.js';

const router = express.Router();

router.use(authenticate, roleGuard(['ADMIN']));

// Notification preferences (admin's own account)
router.get('/notifications', controller.getNotifications);
router.put('/notifications', validate(updateNotificationsSchema), controller.updateNotifications);

// Admin account / profile
router.get('/profile', controller.getProfile);
router.put('/profile', validate(updateProfileSchema), controller.updateProfile);
router.put('/change-password', validate(changePasswordSchema), controller.changePassword);

// User account management
router.get('/accounts', validate(listAccountsSchema), controller.listUserAccounts);
router.get('/accounts/:userId', validate(accountIdSchema), controller.getUserAccount);
router.put('/accounts/:userId', validate(updateAccountSchema), controller.updateUserAccount);
router.delete('/accounts/:userId', validate(accountIdSchema), controller.deleteUserAccount);

// System settings (must stay last so '/' does not shadow sub-routes)
router.get('/', controller.getSystemSettings);
router.put('/', validate(updateSystemSettingsSchema), controller.updateSystemSettings);

export default router;
