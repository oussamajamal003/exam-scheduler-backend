-- Proctors are no longer bound to a specific center.
-- DropForeignKey
ALTER TABLE "proctors" DROP CONSTRAINT IF EXISTS "proctors_centerId_fkey";

-- DropColumn
ALTER TABLE "proctors" DROP COLUMN IF EXISTS "centerId";
