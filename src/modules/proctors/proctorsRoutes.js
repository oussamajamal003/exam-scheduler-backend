import express from 'express';
import { authenticate } from '../../middlewares/authMiddleware.js';
import { roleGuard } from '../../guards/roleGuard.js';
import { validate } from '../../middlewares/validate.js';
import {
	createProctorSchema,
	getProctorSchema,
	getProctorsSchema,
	updateProctorSchema,
} from './proctorsValidation.js';
import * as controller from './proctorsController.js';

const router = express.Router();
router.use(authenticate);

router.get('/', roleGuard(['ADMIN']), validate(getProctorsSchema), controller.getAll);
router.post('/', roleGuard(['ADMIN']), validate(createProctorSchema), controller.create);
router.get('/:id/workload', roleGuard(['ADMIN', 'PROCTOR']), validate(getProctorSchema), controller.getWorkload);
router.get('/:id', roleGuard(['ADMIN', 'PROCTOR']), validate(getProctorSchema), controller.getById);
router.put('/:id', roleGuard(['ADMIN']), validate(updateProctorSchema), controller.update);
router.delete('/:id', roleGuard(['ADMIN']), validate(getProctorSchema), controller.remove);

export default router;

