import express from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yamljs';
import { fileURLToPath } from 'url';
import { errorHandler } from './middlewares/errorHandler.js';
import authRoutes from './routes/authRoutes.js';

const swaggerDocument = YAML.load(
	fileURLToPath(new URL('./docs/openapi.yaml', import.meta.url))
);

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/docs', swaggerUi.serve);
app.get('/api/docs', swaggerUi.setup(swaggerDocument));

// Add future routes here (e.g. users, exams, rooms, students)
// app.use('/api/users', userRoutes);

// Global Error Handler (must be last middleware)
app.use(errorHandler);

export default app;
