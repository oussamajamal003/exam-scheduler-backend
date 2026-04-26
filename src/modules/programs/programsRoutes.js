import express from 'express';
import { authenticate } from '../../middlewares/authMiddleware.js';
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
router.use(authenticate);

router.get('/', roleGuard(['ADMIN']), validate(getProgramsSchema), controller.getAll);
router.post('/', roleGuard(['ADMIN']), validate(createProgramSchema), controller.create);
router.get('/:id', roleGuard(['ADMIN']), validate(getProgramSchema), controller.getById);
router.put('/:id', roleGuard(['ADMIN']), validate(updateProgramSchema), controller.update);
router.delete('/:id', roleGuard(['ADMIN']), validate(getProgramSchema), controller.remove);

export default router;