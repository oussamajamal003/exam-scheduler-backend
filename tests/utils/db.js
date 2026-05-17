// Truncates every test-managed table so each test file (or describe) starts clean.
// Truncation is safer/faster than per-row deletes and avoids ordering issues.
import prisma from '../../src/config/prisma.js';

const TABLES_IN_DEPENDENCY_ORDER = [
  'exam_assignments',
  'schedules',
  'exams',
  'registrations',
  'course_offerings',
  'courses',
  'students',
  'proctor_availabilities',
  'proctors',
  'rooms',
  'centers',
  'time_slots',
  'semesters',
  'programs',
  'departments',
  'AuditLog',
  'users',
];

export const truncateAll = async () => {
  // Single statement so it runs in one transaction.
  const list = TABLES_IN_DEPENDENCY_ORDER.map((t) => `"${t}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE;`);
};

export const disconnectPrisma = async () => {
  await prisma.$disconnect();
};

export default prisma;
