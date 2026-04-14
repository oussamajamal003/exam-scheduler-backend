import express from 'express';
import { authGuard } from '../../guards/authguard.js';
import { roleGuard } from '../../guards/roleGuard.js';
import * as controller from './controller.js';

const router = express.Router();
router.use(authGuard);

router.get('/', controller.getAll);
router.post('/', roleGuard(['TECH_ADMIN']), controller.create);
router.delete('/:id', roleGuard(['TECH_ADMIN']), controller.remove);

export default router;
