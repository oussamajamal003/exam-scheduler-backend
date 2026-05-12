ALTER TYPE "Role" RENAME VALUE 'SUPERVISOR' TO 'PROCTOR';

ALTER TYPE "ConflictType" RENAME VALUE 'SUPERVISOR_DOUBLE_BOOKED' TO 'PROCTOR_DOUBLE_BOOKED';

ALTER TABLE "supervisors" RENAME TO "proctors";

ALTER INDEX "supervisors_pkey" RENAME TO "proctors_pkey";
ALTER INDEX "supervisors_userId_key" RENAME TO "proctors_userId_key";

ALTER TABLE "proctors" RENAME CONSTRAINT "supervisors_userId_fkey" TO "proctors_userId_fkey";
ALTER TABLE "proctors" RENAME CONSTRAINT "supervisors_centerId_fkey" TO "proctors_centerId_fkey";

ALTER TABLE "exam_assignments" RENAME COLUMN "supervisorId" TO "proctorId";

ALTER INDEX "exam_assignments_supervisorId_idx" RENAME TO "exam_assignments_proctorId_idx";
ALTER INDEX "exam_assignments_scheduleId_examId_roomId_supervisorId_time_key" RENAME TO "exam_assignments_scheduleId_examId_roomId_proctorId_timeSlo_key";

ALTER TABLE "exam_assignments"
  RENAME CONSTRAINT "exam_assignments_supervisorId_fkey" TO "exam_assignments_proctorId_fkey";