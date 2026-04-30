import express from 'express';
import { authenticate } from '../../middlewares/authMiddleware.js';
import { roleGuard } from '../../guards/roleGuard.js';
import { validate } from '../../middlewares/validate.js';
import {
  createScheduleSchema,
  getScheduleSchema,
  getSchedulesSchema,
  updateScheduleSchema,
} from './schedulesValidation.js';
import * as controller from './schedulesController.js';

const router = express.Router();

router.use(authenticate);
router.use(roleGuard(['ADMIN']));

router.get('/', validate(getSchedulesSchema), controller.getAll);
router.post('/', validate(createScheduleSchema), controller.create);
router.get('/:id', validate(getScheduleSchema), controller.getById);
router.put('/:id', validate(updateScheduleSchema), controller.update);
router.delete('/:id', validate(getScheduleSchema), controller.remove);

export default router;