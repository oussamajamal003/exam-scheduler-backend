import express from 'express';
import { authenticate } from '../../middlewares/authMiddleware.js';
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
router.post('/', authenticate, roleGuard(['TECH_ADMIN', 'SCHEDULING_ADMIN']), validate(createCourseOfferingSchema), controller.create);
router.get('/:id', validate(getCourseOfferingSchema), controller.getById);
router.put('/:id', authenticate, roleGuard(['TECH_ADMIN', 'SCHEDULING_ADMIN']), validate(updateCourseOfferingSchema), controller.update);
router.delete('/:id', authenticate, roleGuard(['TECH_ADMIN', 'SCHEDULING_ADMIN']), validate(getCourseOfferingSchema), controller.remove);

export default router;