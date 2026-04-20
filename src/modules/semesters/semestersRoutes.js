import express from 'express';
import { authGuard } from '../../guards/authguard.js';
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
router.post('/', authGuard, roleGuard(['TECH_ADMIN']), validate(createSemesterSchema), controller.create);
router.get('/:id', validate(getSemesterSchema), controller.getById);
router.put('/:id', authGuard, roleGuard(['TECH_ADMIN']), validate(updateSemesterSchema), controller.update);
router.delete('/:id', authGuard, roleGuard(['TECH_ADMIN']), validate(getSemesterSchema), controller.remove);

export default router;