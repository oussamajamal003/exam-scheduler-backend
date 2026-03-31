import { checkDatabaseHealth } from '../services/healthService.js';

export const checkHealth = async (req, res, next) => {
  try {
    // Service handles the database check
    await checkDatabaseHealth();
    
    return res.status(200).json({
      status: 'UP',
      message: 'Server is running',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    // Pass to global error handler
    next(error);
  }
};
