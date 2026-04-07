import bcrypt from 'bcrypt';
import { generateToken } from '../utils/jwt.js';
import { AppError } from '../utils/AppError.js';
import * as UserModel from '../models/userModel.js';

export const signupUser = async ({ name, email, password, role }) => {
  const existingUser = await UserModel.findUserByEmail(email);

  if (existingUser) {
    throw new AppError('User with this email already exists', 409);
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  // Default to STUDENT if no known role provided
  const validRoles = ['TECH_ADMIN', 'SCHEDULING_ADMIN', 'SUPERVISOR', 'STUDENT'];
  const userRole = validRoles.includes(role) ? role : 'STUDENT';

  const user = await UserModel.createUser({
    name,
    email,
    password: hashedPassword,
    role: userRole,
  });

  const token = generateToken(user.id, userRole);

  return {
    message: 'User created successfully',
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
    },
  };
};

export const loginUser = async ({ email, password }) => {
  if (!email || !password) {
    throw new AppError('Please provide email and password', 400);
  }

  const user = await UserModel.findUserByEmail(email);

  if (!user || !(await bcrypt.compare(password, user.password))) {
    throw new AppError('Incorrect email or password', 401);
  }

  const token = generateToken(user.id, user.role);

  return {
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
  };
};

export const fetchAllUsers = async () => {
  return await UserModel.findAllUsers();
};

export const removeUser = async (userId) => {
  await UserModel.deleteUserById(userId);
};
