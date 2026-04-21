import express from 'express';
import { authenticate } from '../../middlewares/authMiddleware.js';
import { roleGuard } from '../../guards/roleGuard.js';
import { validate } from '../../middlewares/validate.js';
import {
	createEnrollmentSchema,
	bulkImportEnrollmentsSchema,
	getEnrollmentSchema,
	getEnrollmentOfferingSchema,
	getEnrollmentStudentSchema,
	getEnrollmentsSchema,
	updateEnrollmentSchema,
} from './enrollmentsValidation.js';
import * as controller from './enrollmentsController.js';

const router = express.Router();
router.use(authenticate);

router.get('/', roleGuard(['TECH_ADMIN', 'SCHEDULING_ADMIN', 'SUPERVISOR', 'STUDENT']), validate(getEnrollmentsSchema), controller.getAll);
router.get('/student/:studentId', roleGuard(['TECH_ADMIN', 'SCHEDULING_ADMIN', 'SUPERVISOR', 'STUDENT']), validate(getEnrollmentStudentSchema), controller.getByStudent);
router.get('/offering/:offeringId', roleGuard(['TECH_ADMIN', 'SCHEDULING_ADMIN', 'SUPERVISOR', 'STUDENT']), validate(getEnrollmentOfferingSchema), controller.getByOffering);
router.post('/bulk-import', roleGuard(['TECH_ADMIN']), validate(bulkImportEnrollmentsSchema), controller.bulkImport);
router.get('/:id', roleGuard(['TECH_ADMIN', 'SCHEDULING_ADMIN', 'SUPERVISOR', 'STUDENT']), validate(getEnrollmentSchema), controller.getById);
router.post('/', roleGuard(['TECH_ADMIN']), validate(createEnrollmentSchema), controller.create);
router.put('/:id', roleGuard(['TECH_ADMIN']), validate(updateEnrollmentSchema), controller.update);
router.delete('/:id', roleGuard(['TECH_ADMIN']), validate(getEnrollmentSchema), controller.remove);

export default router;
