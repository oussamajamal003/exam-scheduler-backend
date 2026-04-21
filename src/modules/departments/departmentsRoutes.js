import express from 'express';
import { authenticate } from '../../middlewares/authMiddleware.js';
import { roleGuard } from '../../guards/roleGuard.js';
import { validate } from '../../middlewares/validate.js';
import {
  createDepartmentSchema,
  getDepartmentSchema,
  getDepartmentsSchema,
  updateDepartmentSchema,
} from './departmentsValidation.js';
import * as controller from './departmentsController.js';

const router = express.Router();

router.get('/', validate(getDepartmentsSchema), controller.getAll);
router.post(
  '/',
  authenticate,
  roleGuard(['TECH_ADMIN']),
  validate(createDepartmentSchema),
  controller.create
);
router.get('/:id', validate(getDepartmentSchema), controller.getById);
router.put(
  '/:id',
  authenticate,
  roleGuard(['TECH_ADMIN']),
  validate(updateDepartmentSchema),
  controller.update
);
router.delete(
  '/:id',
  authenticate,
  roleGuard(['TECH_ADMIN']),
  validate(getDepartmentSchema),
  controller.remove
);

export default router;
