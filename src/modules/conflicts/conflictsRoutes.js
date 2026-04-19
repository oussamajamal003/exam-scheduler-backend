import express from 'express';
import { authGuard } from '../../guards/authguard.js';
import { roleGuard } from '../../guards/roleGuard.js';
import * as controller from './conflictsController.js';

const router = express.Router();
router.use(authGuard);
router.post('/detect', roleGuard(['SCHEDULING_ADMIN', 'TECH_ADMIN']), controller.detect);

export default router;
