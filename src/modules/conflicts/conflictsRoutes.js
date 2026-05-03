import express from 'express';
import { authenticate } from '../../middlewares/authMiddleware.js';
import { roleGuard } from '../../guards/roleGuard.js';
import { validate } from '../../middlewares/validate.js';
import * as controller from './conflictsController.js';
import {
  detectConflictsSchema,
  getConflictSchema,
  getConflictsSchema,
  getConflictExplanationSchema,
  getConflictSuggestionsSchema,
  resolveConflictSchema,
} from './conflictsValidation.js';

const router = express.Router();

router.use(authenticate);

// GET /api/conflicts
router.get('/', validate(getConflictsSchema), controller.getAll);

// POST /api/conflicts/detect  (admin-only — must come before /:id)
router.post(
  '/detect',
  roleGuard(['ADMIN']),
  validate(detectConflictsSchema),
  controller.detect
);

// GET /api/conflicts/:id/explanation  (must come before bare /:id)
router.get(
  '/:id/explanation',
  validate(getConflictExplanationSchema),
  controller.getExplanation
);

// GET /api/conflicts/:id/suggestions
router.get(
  '/:id/suggestions',
  validate(getConflictSuggestionsSchema),
  controller.getSuggestions
);

// POST /api/conflicts/:id/resolve  (admin-only)
router.post(
  '/:id/resolve',
  roleGuard(['ADMIN']),
  validate(resolveConflictSchema),
  controller.resolve
);

// GET /api/conflicts/:id
router.get('/:id', validate(getConflictSchema), controller.getById);

export default router;
