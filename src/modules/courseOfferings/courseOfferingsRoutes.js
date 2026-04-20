import express from 'express';
import { authGuard } from '../../guards/authguard.js';
import { roleGuard } from '../../guards/roleGuard.js';
import { validate } from '../../middlewares/validate.js';
import {
  createCourseOfferingSchema,
  getCourseOfferingSchema,
  getCourseOfferingsSchema,
  updateCourseOfferingSchema,
} from './courseOfferingsValidation.js';
import * as controller from './courseOfferingsController.js';

const router = express.Router();

router.get('/', validate(getCourseOfferingsSchema), controller.getAll);
router.post('/', authGuard, roleGuard(['TECH_ADMIN', 'SCHEDULING_ADMIN']), validate(createCourseOfferingSchema), controller.create);
router.get('/:id', validate(getCourseOfferingSchema), controller.getById);
router.put('/:id', authGuard, roleGuard(['TECH_ADMIN', 'SCHEDULING_ADMIN']), validate(updateCourseOfferingSchema), controller.update);
router.delete('/:id', authGuard, roleGuard(['TECH_ADMIN', 'SCHEDULING_ADMIN']), validate(getCourseOfferingSchema), controller.remove);

export default router;