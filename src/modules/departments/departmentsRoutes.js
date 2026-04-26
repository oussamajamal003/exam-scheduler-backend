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
router.use(authenticate);

router.get('/', roleGuard(['ADMIN']), validate(getDepartmentsSchema), controller.getAll);
router.post('/', roleGuard(['ADMIN']), validate(createDepartmentSchema), controller.create);
router.get('/:id', roleGuard(['ADMIN']), validate(getDepartmentSchema), controller.getById);
router.put('/:id', roleGuard(['ADMIN']), validate(updateDepartmentSchema), controller.update);
router.delete('/:id', roleGuard(['ADMIN']), validate(getDepartmentSchema), controller.remove);

export default router;
