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
router.use(authenticate);

router.get('/', roleGuard(['ADMIN']), validate(getRoomsSchema), controller.getAll);
router.post('/', roleGuard(['ADMIN']), validate(createRoomSchema), controller.create);
router.get('/available', roleGuard(['ADMIN']), controller.getAvailable);
router.get('/:id', roleGuard(['ADMIN']), validate(getRoomSchema), controller.getById);
router.put('/:id', roleGuard(['ADMIN']), validate(updateRoomSchema), controller.update);
router.delete('/:id', roleGuard(['ADMIN']), validate(getRoomSchema), controller.remove);

export default router;

