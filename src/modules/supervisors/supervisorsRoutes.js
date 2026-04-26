import express from 'express';
import { authenticate } from '../../middlewares/authMiddleware.js';
import { roleGuard } from '../../guards/roleGuard.js';
import { validate } from '../../middlewares/validate.js';
import {
	createSupervisorSchema,
	getSupervisorSchema,
	getSupervisorsSchema,
	updateSupervisorSchema,
} from './supervisorsValidation.js';
import * as controller from './supervisorsController.js';

const router = express.Router();
router.use(authenticate);

router.get('/', roleGuard(['ADMIN']), validate(getSupervisorsSchema), controller.getAll);
router.post('/', roleGuard(['ADMIN']), validate(createSupervisorSchema), controller.create);
router.get('/:id/workload', roleGuard(['ADMIN', 'SUPERVISOR']), validate(getSupervisorSchema), controller.getWorkload);
router.get('/:id', roleGuard(['ADMIN', 'SUPERVISOR']), validate(getSupervisorSchema), controller.getById);
router.put('/:id', roleGuard(['ADMIN']), validate(updateSupervisorSchema), controller.update);
router.delete('/:id', roleGuard(['ADMIN']), validate(getSupervisorSchema), controller.remove);

export default router;

