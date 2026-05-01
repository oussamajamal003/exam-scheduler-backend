/*
  Warnings:

  - A unique constraint covering the columns `[code,semesterId]` on the table `courses` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "courses_code_key";

-- AlterTable
ALTER TABLE "courses" ADD COLUMN     "semesterId" TEXT;

-- CreateIndex
CREATE INDEX "courses_semesterId_idx" ON "courses"("semesterId");

-- CreateIndex
CREATE UNIQUE INDEX "courses_code_semesterId_key" ON "courses"("code", "semesterId");

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_semesterId_fkey" FOREIGN KEY ("semesterId") REFERENCES "semesters"("id") ON DELETE SET NULL ON UPDATE CASCADE;
