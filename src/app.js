import express from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yamljs';
import { fileURLToPath } from 'url';
import { errorHandler } from './middlewares/errorHandler.js';

const swaggerDocument = YAML.load(
    fileURLToPath(new URL('./docs/openapi.yaml', import.meta.url))
);

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Modular Routes
import authRoutes from './modules/auth/authRoutes.js';
import studentRoutes from './modules/students/studentRoutes.js';
import schedulingRoutes from './modules/scheduling/schedulingRoutes.js';
import supervisorRoutes from './modules/supervisors/supervisorsRoutes.js';
import roomRoutes from './modules/rooms/roomsRoutes.js';
import courseRoutes from './modules/courses/coursesRoutes.js';
import examRoutes from './modules/exams/examsRoutes.js';
import timeSlotRoutes from './modules/timeslots/timeslotsRoutes.js';
import enrollmentRoutes from './modules/enrollments/enrollmentsRoutes.js';
import conflictRoutes from './modules/conflicts/conflictsRoutes.js';
import aiRoutes from './modules/ai/aiRoutes.js';

// Routes (existing)
app.use('/api/auth', authRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/scheduling', schedulingRoutes);
app.use('/api/supervisors', supervisorRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/exams', examRoutes);
app.use('/api/timeslots', timeSlotRoutes);
app.use('/api/enrollments', enrollmentRoutes);
app.use('/api/conflicts', conflictRoutes);
app.use('/api/ai', aiRoutes);

app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// Global Error Handler (must be last middleware)
app.use(errorHandler);

export default app;
