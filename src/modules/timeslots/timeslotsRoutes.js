import express from 'express';
import { authenticate } from '../../middlewares/authMiddleware.js';
import { roleGuard } from '../../guards/roleGuard.js';
import { validate } from '../../middlewares/validate.js';
import {
	createTimeSlotSchema,
	getAvailableTimeSlotsSchema,
	getTimeSlotSchema,
	getTimeSlotsSchema,
	updateTimeSlotSchema,
} from './timeslotsValidation.js';
import * as controller from './timeslotsController.js';

const router = express.Router();
router.use(authenticate);

router.get('/', roleGuard(['ADMIN']), validate(getTimeSlotsSchema), controller.getAll);
router.get('/available', roleGuard(['ADMIN']), validate(getAvailableTimeSlotsSchema), controller.getAvailable);
router.post('/', roleGuard(['ADMIN']), validate(createTimeSlotSchema), controller.create);
router.get('/:id', roleGuard(['ADMIN']), validate(getTimeSlotSchema), controller.getById);
router.put('/:id', roleGuard(['ADMIN']), validate(updateTimeSlotSchema), controller.update);
router.delete('/:id', roleGuard(['ADMIN']), validate(getTimeSlotSchema), controller.remove);

export default router;

