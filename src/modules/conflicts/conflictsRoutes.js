import express from 'express';
import { authenticate } from '../../middlewares/authMiddleware.js';
import { roleGuard } from '../../guards/roleGuard.js';
import * as controller from './conflictsController.js';

const router = express.Router();
router.use(authenticate);
router.post('/detect', roleGuard(['ADMIN']), controller.detect);

export default router;
