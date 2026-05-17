/*
  Warnings:

  - You are about to drop the `conflicts` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "conflicts" DROP CONSTRAINT "conflicts_scheduleId_fkey";

-- DropTable
DROP TABLE "conflicts";

-- DropEnum
DROP TYPE "ConflictType";
