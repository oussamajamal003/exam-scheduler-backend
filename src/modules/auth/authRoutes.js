import express from 'express';
import * as controller from './authController.js';
import { authGuard } from '../../guards/authguard.js';
import { roleGuard } from '../../guards/roleGuard.js';
import { validate } from '../../middlewares/validate.js';
import { loginSchema, signupSchema } from './authValidation.js';

const router = express.Router();

router.get('/', authGuard, roleGuard(['TECH_ADMIN']), controller.getAllUsers);
router.post('/signup', validate(signupSchema), controller.signup);
router.post('/login', validate(loginSchema), controller.login);
router.post('/logout', authGuard, controller.logout);
router.delete('/delete', authGuard, controller.deleteUser);

export default router;
