-- Assignment-aware exam status notifications.

ALTER TABLE "notifications"
  ADD COLUMN "assignmentId" TEXT;

-- Backfill status notifications created before the assignmentId column existed.
UPDATE "notifications"
SET "assignmentId" = "metadata"->>'assignmentId'
WHERE "type" IN ('SCHEDULE_EXAM_COMPLETED', 'SCHEDULE_EXAM_CANCELLED')
  AND "metadata" ? 'assignmentId'
  AND "assignmentId" IS NULL;

-- Keep only notifications that still match the assignment's current lifecycle state.
DELETE FROM "notifications" n
USING "exam_assignments" ea, "exams" e
WHERE n."assignmentId" = ea."id"
  AND ea."examId" = e."id"
  AND n."type" IN ('SCHEDULE_EXAM_COMPLETED', 'SCHEDULE_EXAM_CANCELLED')
  AND (
    e."status" = 'SCHEDULED'
    OR (n."type" = 'SCHEDULE_EXAM_COMPLETED' AND e."status" <> 'COMPLETED')
    OR (n."type" = 'SCHEDULE_EXAM_CANCELLED' AND e."status" <> 'CANCELLED')
  );

-- Collapse duplicate rows for the same user/status/assignment before adding the unique key.
DELETE FROM "notifications" n
USING (
  SELECT "id"
  FROM (
    SELECT
      "id",
      ROW_NUMBER() OVER (
        PARTITION BY "userId", "type", "scheduleId", "assignmentId"
        ORDER BY "createdAt" DESC, "id" DESC
      ) AS rn
    FROM "notifications"
    WHERE "assignmentId" IS NOT NULL
      AND "type" IN ('SCHEDULE_EXAM_COMPLETED', 'SCHEDULE_EXAM_CANCELLED')
  ) ranked
  WHERE ranked.rn > 1
) duplicates
WHERE n."id" = duplicates."id";

CREATE INDEX "notifications_assignmentId_idx" ON "notifications"("assignmentId");

CREATE UNIQUE INDEX "notifications_userId_type_scheduleId_assignmentId_key"
  ON "notifications"("userId", "type", "scheduleId", "assignmentId");

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_assignmentId_fkey"
  FOREIGN KEY ("assignmentId") REFERENCES "exam_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
