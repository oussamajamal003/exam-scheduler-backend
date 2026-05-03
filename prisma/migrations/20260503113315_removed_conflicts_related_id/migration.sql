/*
  Warnings:

  - You are about to drop the column `assignmentId` on the `conflicts` table. All the data in the column will be lost.
  - You are about to drop the column `examId` on the `conflicts` table. All the data in the column will be lost.
  - You are about to drop the column `roomId` on the `conflicts` table. All the data in the column will be lost.
  - You are about to drop the column `supervisorId` on the `conflicts` table. All the data in the column will be lost.
  - You are about to drop the column `timeSlotId` on the `conflicts` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "conflicts_assignmentId_idx";

-- DropIndex
DROP INDEX "conflicts_examId_idx";

-- DropIndex
DROP INDEX "conflicts_roomId_idx";

-- DropIndex
DROP INDEX "conflicts_supervisorId_idx";

-- DropIndex
DROP INDEX "conflicts_timeSlotId_idx";

-- AlterTable
ALTER TABLE "conflicts" DROP COLUMN "assignmentId",
DROP COLUMN "examId",
DROP COLUMN "roomId",
DROP COLUMN "supervisorId",
DROP COLUMN "timeSlotId";
