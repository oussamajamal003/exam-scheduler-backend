import express from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yamljs';
import { fileURLToPath } from 'url';
import { errorHandler } from './middlewares/errorHandler.js';
import { requestLogger } from './middlewares/requestLogger.js';
import { authenticate } from './middlewares/authMiddleware.js';
import { roleGuard } from './guards/roleGuard.js';
import { validate } from './middlewares/validate.js';
import { generateScheduleSchema } from './modules/scheduling/schedulingValidation.js';
import { generateSchedule } from './modules/scheduling/schedulingController.js';
import * as schedulesController from './modules/schedules/schedulesController.js';

const swaggerDocument = YAML.load(
    fileURLToPath(new URL('./docs/openapi.yaml', import.meta.url))
);

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Setup Request Logger
app.use(requestLogger);
 
// Modular Routes
import authRoutes from './modules/auth/authRoutes.js';
import studentRoutes from './modules/students/studentsRoutes.js';
import schedulingRoutes from './modules/scheduling/schedulingRoutes.js';
import scheduleRoutes from './modules/schedules/schedulesRoutes.js';
import proctorRoutes from './modules/proctors/proctorsRoutes.js';
import roomRoutes from './modules/rooms/roomsRoutes.js';
import courseRoutes from './modules/courses/coursesRoutes.js';
import programRoutes from './modules/programs/programsRoutes.js';
import departmentRoutes from './modules/departments/departmentsRoutes.js';
import semesterRoutes from './modules/semesters/semestersRoutes.js';
import courseOfferingRoutes from './modules/courseOfferings/courseOfferingsRoutes.js';
import centerRoutes from './modules/centers/centersRoutes.js';
import examRoutes from './modules/exams/examsRoutes.js';
import timeSlotRoutes from './modules/timeslots/timeslotsRoutes.js';
import enrollmentRoutes from './modules/enrollments/enrollmentsRoutes.js';
import aiRoutes from './modules/ai/aiRoutes.js';
import demoDataRoutes from './modules/demoData/demoDataRoutes.js';

// Routes (existing)
app.use('/api/auth', authRoutes);
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
app.use('/api', authenticate);
app.use('/api/students', studentRoutes);
app.use('/api/scheduling', schedulingRoutes);
app.use('/api/schedules', scheduleRoutes);
app.use('/api/proctors', proctorRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/programs', programRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/semesters', semesterRoutes);
app.use('/api/course-offerings', courseOfferingRoutes);
app.use('/api/centers', centerRoutes);
app.use('/api/exams', examRoutes);
app.use('/api/timeslots', timeSlotRoutes);
app.use('/api/enrollments', enrollmentRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/demo-data', demoDataRoutes);

// Compatibility aliases for the first scheduling prototype API surface.
app.post('/generate-schedule', authenticate, roleGuard(['ADMIN']), validate(generateScheduleSchema), generateSchedule);
app.get('/schedules', authenticate, roleGuard(['ADMIN']), schedulesController.getAll);

// Global Error Handler (must be last middleware)
app.use(errorHandler);

export default app;
