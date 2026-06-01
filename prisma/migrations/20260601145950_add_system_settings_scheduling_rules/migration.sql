-- AlterTable
ALTER TABLE "scheduling_rules" ADD COLUMN     "enforceDefaultExamDuration" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "enforceProctorStudentRatio" BOOLEAN NOT NULL DEFAULT true;
