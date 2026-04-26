import bcrypt from 'bcrypt';
import { generateToken } from '../../utils/jwt.js';
import { AppError } from '../../utils/AppError.js';
import * as UserModel from '../../models/userModel.js';
import prisma from '../../config/prisma.js';
import { normalizeRole, toDatabaseRole } from '../../guards/roleGuard.js';

const adminUsers = [
  ['System Admin 01', 'admin01@uni.edu', 'Admin@2026#01'],
  ['System Admin 02', 'admin02@uni.edu', 'Admin@2026#02'],
  ['System Admin 03', 'admin03@uni.edu', 'Admin@2026#03'],
  ['System Admin 04', 'admin04@uni.edu', 'Admin@2026#04'],
  ['System Admin 05', 'admin05@uni.edu', 'Admin@2026#05'],
  ['System Admin 06', 'admin06@uni.edu', 'Admin@2026#06'],
  ['System Admin 07', 'admin07@uni.edu', 'Admin@2026#07'],
  ['System Admin 08', 'admin08@uni.edu', 'Admin@2026#08'],
  ['System Admin 09', 'admin09@uni.edu', 'Admin@2026#09'],
  ['System Admin 10', 'admin10@uni.edu', 'Admin@2026#10'],
];

const serializeUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: normalizeRole(user.role),
  createdAt: user.createdAt,
});

export const ensureAdminUsers = async () => {
  for (const [name, email, password] of adminUsers) {
    const hashedPassword = await bcrypt.hash(password, 10);

    await prisma.user.upsert({
      where: { email },
      update: { name, password: hashedPassword, role: 'ADMIN' },
      create: { name, email, password: hashedPassword, role: 'ADMIN' },
    });
  }
};

export const loginUser = async ({ email, password }) => {
  if (!email || !password) {
    throw new AppError('Please provide email and password', 400);
  }

  const user = await UserModel.findUserByEmail(email);

  if (!user || !(await bcrypt.compare(password, user.password))) {
    throw new AppError('Incorrect email or password', 401);
  }

  const role = normalizeRole(user.role);
  const token = generateToken(user.id, role);

  return {
    token,
    user: serializeUser(user),
  };
};

export const fetchAllUsers = async () => {
  const users = await UserModel.findAllUsers();
  return users.map(serializeUser);
};

export const removeUser = async (userId) => {
  await UserModel.deleteUserById(userId);
};
