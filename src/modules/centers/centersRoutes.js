import express from 'express';
import { authenticate } from '../../middlewares/authMiddleware.js';
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
router.use(authenticate);

router.get('/', roleGuard(['ADMIN']), validate(getCentersSchema), controller.getAll);
router.post('/', roleGuard(['ADMIN']), validate(createCenterSchema), controller.create);
router.get('/:id', roleGuard(['ADMIN']), validate(getCenterSchema), controller.getById);
router.put('/:id', roleGuard(['ADMIN']), validate(updateCenterSchema), controller.update);
router.delete('/:id', roleGuard(['ADMIN']), validate(getCenterSchema), controller.remove);

export default router;