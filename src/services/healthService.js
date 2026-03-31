import { query } from '../config/db.js';

/**
 * Health check business logic
 * Service layer should handle the core business rules and database interactions
 */
export const checkDatabaseHealth = async () => {
  try {
    await query('SELECT 1');
    return true;
  } catch (error) {
    throw new Error('Database is unreachable');
  }
};
