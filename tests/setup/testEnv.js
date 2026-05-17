// Loaded by Jest before any test/module import.
// Forces all Prisma operations to use the isolated test database.
import dotenv from 'dotenv';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

// Load .env.test first (if present), then fall back to .env so TEST_DATABASE_URL
// can be defined anywhere.
dotenv.config({ path: path.resolve(__dirname, '../../.env.test') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

if (!process.env.TEST_DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.error(
    '\n[tests] TEST_DATABASE_URL is not set. Define it in server/.env.test or your shell environment\n' +
    '         pointing at an isolated PostgreSQL database. Tests refuse to run against DATABASE_URL.\n',
  );
  throw new Error('TEST_DATABASE_URL is required to run the scheduling test suite.');
}

// IMPORTANT: override the application DATABASE_URL so the singleton Prisma client
// in src/config/prisma.js binds to the test database when first imported.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-do-not-use-in-prod';
