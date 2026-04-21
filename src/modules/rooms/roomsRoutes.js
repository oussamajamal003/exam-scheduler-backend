import express from 'express';
import { authenticate } from '../../middlewares/authMiddleware.js';
import { roleGuard } from '../../guards/roleGuard.js';
import { validate } from '../../middlewares/validate.js';
import {
  createRoomSchema,
  getRoomSchema,
  getRoomsSchema,
  updateRoomSchema,
} from './roomsValidation.js';
import * as controller from './roomsController.js';

const router = express.Router();

router.get('/', validate(getRoomsSchema), controller.getAll);
router.post('/', authenticate, roleGuard(['TECH_ADMIN']), validate(createRoomSchema), controller.create);
router.get('/available', controller.getAvailable);
router.get('/:id', validate(getRoomSchema), controller.getById);
router.put('/:id', authenticate, roleGuard(['TECH_ADMIN']), validate(updateRoomSchema), controller.update);
router.delete('/:id', authenticate, roleGuard(['TECH_ADMIN']), validate(getRoomSchema), controller.remove);

export default router;

