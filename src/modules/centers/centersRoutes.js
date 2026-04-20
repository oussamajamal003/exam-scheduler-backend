import express from 'express';
import { authGuard } from '../../guards/authguard.js';
import { roleGuard } from '../../guards/roleGuard.js';
import { validate } from '../../middlewares/validate.js';
import {
  createCenterSchema,
  getCenterSchema,
  getCentersSchema,
  updateCenterSchema,
} from './centersValidation.js';
import * as controller from './centersController.js';

const router = express.Router();

router.get('/', validate(getCentersSchema), controller.getAll);
router.post('/', authGuard, roleGuard(['TECH_ADMIN']), validate(createCenterSchema), controller.create);
router.get('/:id', validate(getCenterSchema), controller.getById);
router.put('/:id', authGuard, roleGuard(['TECH_ADMIN']), validate(updateCenterSchema), controller.update);
router.delete('/:id', authGuard, roleGuard(['TECH_ADMIN']), validate(getCenterSchema), controller.remove);

export default router;