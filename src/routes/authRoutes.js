import express from 'express';
import { signup, login, logout, getAllUsers, deleteUser } from '../controllers/authController.js';
import { authGuard } from '../guards/authguard.js';

const router = express.Router();

router.get('/', authGuard, getAllUsers);
router.post('/signup', signup);
router.post('/login', login);
router.post('/logout', authGuard, logout);
router.delete('/delete', authGuard, deleteUser);

export default router;
