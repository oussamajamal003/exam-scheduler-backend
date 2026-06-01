import express from 'express';
import * as controller from './authController.js';
import { authenticate } from '../../middlewares/authMiddleware.js';
import { roleGuard } from '../../guards/roleGuard.js';
import { validate } from '../../middlewares/validate.js';
import { loginSchema } from './authValidation.js';

const router = express.Router();

router.get('/me', authenticate, controller.me);
router.get('/', authenticate, roleGuard(['ADMIN']), controller.getAllUsers);
router.post('/login', validate(loginSchema), controller.login);
router.post('/logout', authenticate, controller.logout);
router.delete('/delete', authenticate, controller.deleteUser);

export default router;
