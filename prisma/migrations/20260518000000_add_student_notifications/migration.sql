CREATE TABLE "student_notifications" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "scheduleId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "student_notifications_studentId_createdAt_idx" ON "student_notifications"("studentId", "createdAt");
CREATE INDEX "student_notifications_scheduleId_idx" ON "student_notifications"("scheduleId");
CREATE UNIQUE INDEX "student_notifications_studentId_scheduleId_type_key" ON "student_notifications"("studentId", "scheduleId", "type");

ALTER TABLE "student_notifications" ADD CONSTRAINT "student_notifications_studentId_fkey"
FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "student_notifications" ADD CONSTRAINT "student_notifications_scheduleId_fkey"
FOREIGN KEY ("scheduleId") REFERENCES "schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
