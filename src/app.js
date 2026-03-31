import express from 'express';
import cors from 'cors';
import { errorHandler } from './middlewares/errorHandler.js';
import healthRoutes from './routes/healthRoutes.js';

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api', healthRoutes);

// Add future routes here (e.g. users, exams, rooms, students)
// app.use('/api/users', userRoutes);

// Global Error Handler (must be last middleware)
app.use(errorHandler);

export default app;
