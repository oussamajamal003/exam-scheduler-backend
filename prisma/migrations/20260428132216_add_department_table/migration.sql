-- AlterTable
ALTER TABLE "course_offerings" ADD COLUMN     "difficulty" INTEGER,
ADD COLUMN     "priority" INTEGER;

-- CreateIndex
CREATE INDEX "courses_programId_idx" ON "courses"("programId");

-- CreateIndex
CREATE INDEX "students_programId_idx" ON "students"("programId");

-- CreateIndex
CREATE INDEX "time_slots_date_idx" ON "time_slots"("date");
