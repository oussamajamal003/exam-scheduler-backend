import express from 'express';
import { validate } from '../../middlewares/validate.js';
import { authenticate } from '../../middlewares/authMiddleware.js';
import { roleGuard } from '../../guards/roleGuard.js';
import {
  prepareSchedulingSchema,
  validateInputSchema,
  generateScheduleSchema,
  getAnalysisSchema,
  publishScheduleSchema,
} from './schedulingValidation.js';
import {
  prepareScheduling,
  validateInput,
  generateSchedule,
  getScheduleAnalysis,
  publishSchedule,
} from './schedulingController.js';

const router = express.Router();

router.use(authenticate);
// Restrict to admins running algorithms
router.use(roleGuard(['ADMIN']));

router.post('/prepare', validate(prepareSchedulingSchema), prepareScheduling);
router.post('/validate-input', validate(validateInputSchema), validateInput);
router.post('/generate', validate(generateScheduleSchema), generateSchedule);

router.get('/:id/analysis', validate(getAnalysisSchema), getScheduleAnalysis);
router.patch('/:id/publish', validate(publishScheduleSchema), publishSchedule);

export default router;