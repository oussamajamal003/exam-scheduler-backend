import pkg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { config } from './env.js';
import { applyAuditExtension } from '../modules/audit/auditService.js';

const { Pool } = pkg;

const connectionString = config.dbUrl;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);

const basePrisma = globalThis.prisma || new PrismaClient({ adapter });

if (process.env.NODE_ENV !== 'production') {
  globalThis.prisma = basePrisma;
}

const prisma = applyAuditExtension(basePrisma);

export default prisma;