// Global Jest setup: runs once before any test file.
// Applies pending Prisma migrations to the isolated test database.
import { execSync } from 'node:child_process';
import path from 'node:path';
import url from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, '../..');

dotenv.config({ path: path.resolve(serverRoot, '.env.test') });
dotenv.config({ path: path.resolve(serverRoot, '.env') });

if (!process.env.TEST_DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL is required to run the scheduling test suite.');
}

export default async function globalSetup() {
  // eslint-disable-next-line no-console
  console.log('[tests] Applying Prisma migrations to test database...');
  execSync('npx prisma migrate deploy', {
    cwd: serverRoot,
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL },
  });
}
