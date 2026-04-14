import express from 'express';
import { signup, login, logout, getAllUsers, deleteUser } from './authController.js';
import { authGuard } from '../../guards/authguard.js';
import { validate } from '../../middlewares/validate.js';
import { loginSchema, signupSchema } from './validation.js';

const router = express.Router();

router.get('/', authGuard, getAllUsers);
router.post('/signup', validate(signupSchema), signup);
router.post('/login', validate(loginSchema), login);
router.post('/logout', authGuard, logout);
router.delete('/delete', authGuard, deleteUser);

export default router;
