import express from 'express';
import { authenticate } from '../../middlewares/authMiddleware.js';
import { roleGuard } from '../../guards/roleGuard.js';
import * as controller from './demoDataController.js';

const router = express.Router();

router.use(authenticate);
router.post('/generate', roleGuard(['ADMIN']), controller.generate);
router.delete('/clear', roleGuard(['ADMIN']), controller.clear);

export default router;
