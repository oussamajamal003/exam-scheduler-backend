-- CreateEnum
CREATE TYPE "SchedulingAlgorithmType" AS ENUM ('HYBRID_CONSTRAINT_BASED');

-- CreateEnum
CREATE TYPE "ScheduleGenerationStage" AS ENUM ('PREPARED', 'VALIDATED', 'DRAFT_BUILT', 'EVALUATED', 'OPTIMIZED', 'RE_EVALUATED', 'CONFIRMED', 'GENERATED', 'BLOCKED');

-- AlterTable
ALTER TABLE "schedules" ADD COLUMN     "algorithmMetadata" JSONB,
ADD COLUMN     "algorithmType" "SchedulingAlgorithmType" NOT NULL DEFAULT 'HYBRID_CONSTRAINT_BASED',
ADD COLUMN     "generationStage" "ScheduleGenerationStage" NOT NULL DEFAULT 'GENERATED',
ADD COLUMN     "hardConstraintScore" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "qualityScore" DOUBLE PRECISION,
ADD COLUMN     "softConstraintScore" INTEGER NOT NULL DEFAULT 0;
