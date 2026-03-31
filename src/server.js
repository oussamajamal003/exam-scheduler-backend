import app from './app.js';
import { connectDB } from './config/db.js';
import { config } from './config/env.js';

const startServer = async () => {
  try {
    // 1. Connect to Database first
    await connectDB();

    // 2. Start Express Server
    app.listen(config.port, () => {
      console.log(`Server running on port ${config.port} in ${config.env} mode`);
    });
  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
};

startServer();
