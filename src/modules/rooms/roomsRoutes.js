import express from 'express';
import { authGuard } from '../../guards/authguard.js';
import { roleGuard } from '../../guards/roleGuard.js';
import { validate } from '../../middlewares/validate.js';
import {
  createRoomSchema,
  getRoomSchema,
  getRoomsSchema,
  updateRoomSchema,
} from './validation.js';
import * as controller from './controller.js';

const router = express.Router();
router.use(authGuard);

router.get('/', validate(getRoomsSchema), controller.getAll);
router.post('/', roleGuard(['TECH_ADMIN']), validate(createRoomSchema), controller.create);
router.get('/available', controller.getAvailable);
router.get('/:id', validate(getRoomSchema), controller.getById);
router.put('/:id', roleGuard(['TECH_ADMIN']), validate(updateRoomSchema), controller.update);
router.delete('/:id', roleGuard(['TECH_ADMIN']), validate(getRoomSchema), controller.remove);

export default router;

