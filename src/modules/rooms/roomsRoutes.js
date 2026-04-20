import express from 'express';
import { authGuard } from '../../guards/authguard.js';
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
router.post('/', authGuard, roleGuard(['TECH_ADMIN']), validate(createRoomSchema), controller.create);
router.get('/available', controller.getAvailable);
router.get('/:id', validate(getRoomSchema), controller.getById);
router.put('/:id', authGuard, roleGuard(['TECH_ADMIN']), validate(updateRoomSchema), controller.update);
router.delete('/:id', authGuard, roleGuard(['TECH_ADMIN']), validate(getRoomSchema), controller.remove);

export default router;

