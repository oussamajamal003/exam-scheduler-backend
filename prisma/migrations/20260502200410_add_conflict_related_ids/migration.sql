-- AlterTable
ALTER TABLE "conflicts" ADD COLUMN     "assignmentId" TEXT,
ADD COLUMN     "examId" TEXT,
ADD COLUMN     "roomId" TEXT,
ADD COLUMN     "supervisorId" TEXT,
ADD COLUMN     "timeSlotId" TEXT;

-- CreateIndex
CREATE INDEX "conflicts_examId_idx" ON "conflicts"("examId");

-- CreateIndex
CREATE INDEX "conflicts_assignmentId_idx" ON "conflicts"("assignmentId");

-- CreateIndex
CREATE INDEX "conflicts_roomId_idx" ON "conflicts"("roomId");

-- CreateIndex
CREATE INDEX "conflicts_supervisorId_idx" ON "conflicts"("supervisorId");

-- CreateIndex
CREATE INDEX "conflicts_timeSlotId_idx" ON "conflicts"("timeSlotId");
