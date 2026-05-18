import express from 'express';
import { strictRoleGuard } from '../../guards/roleGuard.js';
import * as controller from './studentNotificationsController.js';

const router = express.Router();

router.use(strictRoleGuard(['STUDENT']));

router.get('/', controller.list);
router.patch('/read-all', controller.markAllRead);
router.patch('/:id/read', controller.markRead);

export default router;
