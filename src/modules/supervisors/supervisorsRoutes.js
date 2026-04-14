import express from 'express';
import { authGuard } from '../../guards/authguard.js';
import { roleGuard } from '../../guards/roleGuard.js';
import { validate } from '../../middlewares/validate.js';
import {
	createSupervisorSchema,
	getSupervisorSchema,
	getSupervisorsSchema,
	updateSupervisorSchema,
} from './validation.js';
import * as controller from './controller.js';

const router = express.Router();
router.use(authGuard);

router.get('/', validate(getSupervisorsSchema), controller.getAll);
router.post('/', roleGuard(['TECH_ADMIN']), validate(createSupervisorSchema), controller.create);
router.get('/:id/workload', validate(getSupervisorSchema), controller.getWorkload);
router.get('/:id', validate(getSupervisorSchema), controller.getById);
router.put('/:id', roleGuard(['TECH_ADMIN']), validate(updateSupervisorSchema), controller.update);
router.delete('/:id', roleGuard(['TECH_ADMIN']), validate(getSupervisorSchema), controller.remove);

export default router;

