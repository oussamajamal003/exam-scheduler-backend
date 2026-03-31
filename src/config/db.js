import pkg from 'pg';
import { config } from './env.js';

const { Pool } = pkg;

const pool = new Pool({
  connectionString: config.dbUrl,
  // Add SSL config here for production if needed
});

export const connectDB = async () => {
  try {
    const client = await pool.connect();
    console.log('Database connected successfully');
    client.release();
  } catch (error) {
    console.error('Database connection error:', error.message);
    process.exit(1);
  }
};

export const query = (text, params) => pool.query(text, params);
