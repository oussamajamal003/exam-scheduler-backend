import express from 'express';
import { authenticate } from '../../middlewares/authMiddleware.js';
import { roleGuard } from '../../guards/roleGuard.js';
import { validate } from '../../middlewares/validate.js';
import * as controller from './conflictsController.js';
import {
  detectConflictsSchema,
  getConflictSchema,
  getConflictsSchema,
} from './conflictsValidation.js';

const router = express.Router();

router.use(authenticate);

// GET /api/conflicts
router.get('/', validate(getConflictsSchema), controller.getAll);

// POST /api/conflicts/detect (admin-only)
router.post(
  '/detect',
  roleGuard(['ADMIN']),
  validate(detectConflictsSchema),
  controller.detect
);

// GET /api/conflicts/:id  (must come after /detect)
router.get('/:id', validate(getConflictSchema), controller.getById);

export default router;
