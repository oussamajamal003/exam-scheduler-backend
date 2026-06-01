-- Restore Semester.isActive to keep the database aligned with schema.prisma and
-- the existing semester UI/service contract.
ALTER TABLE "semesters" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT false;
