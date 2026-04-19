import express from 'express';
import { authGuard } from '../../guards/authguard.js';
import { roleGuard } from '../../guards/roleGuard.js';
import { validate } from '../../middlewares/validate.js';
import {
	createTimeSlotSchema,
	getTimeSlotSchema,
	getTimeSlotsSchema,
	updateTimeSlotSchema,
} from './timeslotsValidation.js';
import * as controller from './timeslotsController.js';

const router = express.Router();
router.use(authGuard);

router.get('/', validate(getTimeSlotsSchema), controller.getAll);
router.post('/', roleGuard(['TECH_ADMIN']), validate(createTimeSlotSchema), controller.create);
router.get('/:id', validate(getTimeSlotSchema), controller.getById);
router.put('/:id', roleGuard(['TECH_ADMIN']), validate(updateTimeSlotSchema), controller.update);
router.delete('/:id', roleGuard(['TECH_ADMIN']), validate(getTimeSlotSchema), controller.remove);

export default router;

