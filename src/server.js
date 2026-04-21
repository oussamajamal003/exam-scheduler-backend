import logger from './utils/logger.js';
import app from './app.js';
import { connectDB } from './config/db.js';
import { config } from './config/env.js';

const startServer = async () => {
  try {
    // 1. Connect to Database first
    await connectDB();

    // 2. Start Express Server
    const server = app.listen(config.port, () => {
      logger.info(`Server running on port ${config.port} in ${config.env} mode`);
    });

    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        logger.error(`Port ${config.port} is already in use. Stop the existing process or change PORT in .env.`);
      } else {
        logger.error('Server failed to start:', error.message);
      }
      process.exit(1);
    });
  } catch (error) { 
    logger.error('Failed to start server:', error.message);
    process.exit(1);
  }
};

startServer();
