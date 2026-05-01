import express from 'express';
import { authenticate } from '../../middlewares/authMiddleware.js';
import { roleGuard } from '../../guards/roleGuard.js';
import { validate } from '../../middlewares/validate.js';
import {
  deleteAssignmentSchema,
  getAssignmentSchema,
  listAssignmentsSchema,
  updateAssignmentSchema,
} from './assignmentsValidation.js';
import * as controller from './assignmentsController.js';

// Mounted under /api/schedules/:scheduleId/assignments — mergeParams to inherit
// :scheduleId from the parent router.
const router = express.Router({ mergeParams: true });

router.use(authenticate);
router.use(roleGuard(['ADMIN']));

router.get('/', validate(listAssignmentsSchema), controller.list);
router.get('/:assignmentId', validate(getAssignmentSchema), controller.getOne);
router.put('/:assignmentId', validate(updateAssignmentSchema), controller.update);
router.delete('/:assignmentId', validate(deleteAssignmentSchema), controller.remove);

export default router;
