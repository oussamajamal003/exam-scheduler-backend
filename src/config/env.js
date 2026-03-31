import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: process.env.PORT || 5000,
  dbUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET,
  env: process.env.NODE_ENV || 'development'
};
