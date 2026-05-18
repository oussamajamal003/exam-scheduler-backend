-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_userId_createdAt_idx" ON "notifications"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_idx" ON "notifications"("userId", "readAt");

-- AddForeignKey
ALTER TABLE "notifications"
ADD CONSTRAINT "notifications_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill existing student notifications into the generic notifications table.
INSERT INTO "notifications" (
    "id",
    "userId",
    "type",
    "title",
    "message",
    "metadata",
    "readAt",
    "createdAt"
)
SELECT
    sn."id",
    s."userId",
    sn."type",
    sn."title",
    sn."message",
    COALESCE(sn."metadata", '{}'::jsonb)
      || jsonb_build_object(
        'studentId', sn."studentId",
        'scheduleId', sn."scheduleId",
        'schedule', CASE
          WHEN sch."id" IS NULL THEN NULL
          ELSE jsonb_build_object(
            'id', sch."id",
            'name', sch."name",
            'examPeriod', sch."examPeriod",
            'isFinal', sch."isFinal"
          )
        END
      ),
    sn."readAt",
    sn."createdAt"
FROM "student_notifications" sn
JOIN "students" s ON s."id" = sn."studentId"
LEFT JOIN "schedules" sch ON sch."id" = sn."scheduleId";
