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
router.use(authenticate);

router.get('/', roleGuard(['ADMIN']), validate(getCourseOfferingsSchema), controller.getAll);
router.post('/', roleGuard(['ADMIN']), validate(createCourseOfferingSchema), controller.create);
router.get('/:id', roleGuard(['ADMIN']), validate(getCourseOfferingSchema), controller.getById);
router.put('/:id', roleGuard(['ADMIN']), validate(updateCourseOfferingSchema), controller.update);
router.delete('/:id', roleGuard(['ADMIN']), validate(getCourseOfferingSchema), controller.remove);

export default router;