-- CreateIndex
CREATE INDEX "schedules_isFinal_idx" ON "schedules"("isFinal");

-- CreateIndex
CREATE INDEX "schedules_isFinal_createdAt_idx" ON "schedules"("isFinal", "createdAt");
