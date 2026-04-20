import express from 'express';
import { authGuard } from '../../guards/authguard.js';
import { roleGuard } from '../../guards/roleGuard.js';
import { validate } from '../../middlewares/validate.js';
import {
  createProgramSchema,
  getProgramSchema,
  getProgramsSchema,
  updateProgramSchema,
} from './programsValidation.js';
import * as controller from './programsController.js';

const router = express.Router();

router.get('/', validate(getProgramsSchema), controller.getAll);
router.post('/', authGuard, roleGuard(['TECH_ADMIN']), validate(createProgramSchema), controller.create);
router.get('/:id', validate(getProgramSchema), controller.getById);
router.put('/:id', authGuard, roleGuard(['TECH_ADMIN']), validate(updateProgramSchema), controller.update);
router.delete('/:id', authGuard, roleGuard(['TECH_ADMIN']), validate(getProgramSchema), controller.remove);

export default router;