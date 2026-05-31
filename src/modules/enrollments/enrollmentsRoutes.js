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
	getEnrollmentFiltersSchema,
	getEnrollmentsSchema,
	updateEnrollmentSchema,
} from './enrollmentsValidation.js';
import * as controller from './enrollmentsController.js';

const router = express.Router();
router.use(authenticate);

router.get('/', roleGuard(['ADMIN', 'STUDENT']), validate(getEnrollmentsSchema), controller.getAll);
router.get('/filters', roleGuard(['ADMIN', 'STUDENT']), validate(getEnrollmentFiltersSchema), controller.getFilterOptions);
router.get('/student/:studentId', roleGuard(['ADMIN', 'STUDENT']), validate(getEnrollmentStudentSchema), controller.getByStudent);
router.get('/offering/:offeringId', roleGuard(['ADMIN', 'STUDENT']), validate(getEnrollmentOfferingSchema), controller.getByOffering);
router.post('/bulk-import', roleGuard(['ADMIN']), validate(bulkImportEnrollmentsSchema), controller.bulkImport);
router.get('/:id', roleGuard(['ADMIN', 'STUDENT']), validate(getEnrollmentSchema), controller.getById);
router.post('/', roleGuard(['ADMIN']), validate(createEnrollmentSchema), controller.create);
router.put('/:id', roleGuard(['ADMIN']), validate(updateEnrollmentSchema), controller.update);
router.delete('/:id', roleGuard(['ADMIN']), validate(getEnrollmentSchema), controller.remove);

export default router;
