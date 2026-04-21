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

router.get('/', validate(getTimeSlotsSchema), controller.getAll);
router.get('/available', validate(getAvailableTimeSlotsSchema), controller.getAvailable);
router.post('/', authenticate, roleGuard(['TECH_ADMIN']), validate(createTimeSlotSchema), controller.create);
router.get('/:id', validate(getTimeSlotSchema), controller.getById);
router.put('/:id', authenticate, roleGuard(['TECH_ADMIN']), validate(updateTimeSlotSchema), controller.update);
router.delete('/:id', authenticate, roleGuard(['TECH_ADMIN']), validate(getTimeSlotSchema), controller.remove);

export default router;

