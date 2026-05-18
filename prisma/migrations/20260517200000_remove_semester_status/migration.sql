-- Remove deprecated semester status fields
-- These fields were no longer used by the application logic.
-- Scheduling context is determined entirely by explicit semester selection in the UI.

ALTER TABLE "semesters" DROP COLUMN IF EXISTS "isActive";
ALTER TABLE "semesters" DROP COLUMN IF EXISTS "isCurrent";
ALTER TABLE "semesters" DROP COLUMN IF EXISTS "status";

-- Drop the SemesterStatus enum type if it exists
DROP TYPE IF EXISTS "SemesterStatus";
