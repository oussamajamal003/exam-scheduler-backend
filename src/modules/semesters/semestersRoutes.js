import express from 'express';
import { authenticate } from '../../middlewares/authMiddleware.js';
import { roleGuard } from '../../guards/roleGuard.js';
import { validate } from '../../middlewares/validate.js';
import {
  createSemesterSchema,
  getSemesterSchema,
  getSemestersSchema,
  updateSemesterSchema,
} from './semestersValidation.js';
import * as controller from './semestersController.js';

const router = express.Router();

router.get('/', validate(getSemestersSchema), controller.getAll);
router.post('/', authenticate, roleGuard(['TECH_ADMIN']), validate(createSemesterSchema), controller.create);
router.get('/:id', validate(getSemesterSchema), controller.getById);
router.put('/:id', authenticate, roleGuard(['TECH_ADMIN']), validate(updateSemesterSchema), controller.update);
router.delete('/:id', authenticate, roleGuard(['TECH_ADMIN']), validate(getSemesterSchema), controller.remove);

export default router;