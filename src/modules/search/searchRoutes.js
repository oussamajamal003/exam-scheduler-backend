import express from 'express';
import { authenticate } from '../../middlewares/authMiddleware.js';
import { roleGuard } from '../../guards/roleGuard.js';
import * as controller from './searchController.js';

const router = express.Router();
router.use(authenticate);

router.get('/', roleGuard(['ADMIN', 'STUDENT', 'PROCTOR']), controller.search);

export default router;
