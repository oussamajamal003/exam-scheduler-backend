import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';

const JWT_SECRET = config.jwtSecret || (config.env === 'production' ? null : 'supersecretkey_dev');
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '150m';

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is required');
}

export const generateToken = (userId, role) => {
  return jwt.sign({ id: userId, role }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });
};

export const verifyToken = (token) => {
  return jwt.verify(token, JWT_SECRET);
};
