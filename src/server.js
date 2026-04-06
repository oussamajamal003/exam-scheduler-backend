import app from './app.js';
import { connectDB } from './config/db.js';
import { config } from './config/env.js';

const startServer = async () => {
  try {
    // 1. Connect to Database first
    await connectDB();

    // 2. Start Express Server
    const server = app.listen(config.port, () => {
      console.log(`Server running on port ${config.port} in ${config.env} mode`);
    });

    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`Port ${config.port} is already in use. Stop the existing process or change PORT in .env.`);
      } else {
        console.error('Server failed to start:', error.message);
      }
      process.exit(1);
    });
  } catch (error) { 
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
};

startServer();
