-- Schedule publish lifecycle: version tracking + notification deduplication.

-- AlterTable: track each publish round on the schedule so republish notifications
-- can be distinguished from the first publish and from any prior round.
ALTER TABLE "schedules"
  ADD COLUMN "publishedVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastPublishedAt" TIMESTAMP(3);

-- Backfill: any schedule that is already final has been published exactly once,
-- so we mark it as version 1. This ensures the next publish after deploy is
-- treated as a republish, not a first publish.
UPDATE "schedules"
SET "publishedVersion" = 1,
    "lastPublishedAt" = "updatedAt"
WHERE "isFinal" = true;

-- AlterTable: persist schedule lifecycle dedup keys on each notification so
-- repeated publish/unpublish actions for the same round cannot insert duplicates.
ALTER TABLE "notifications"
  ADD COLUMN "scheduleId" TEXT,
  ADD COLUMN "scheduleVersion" INTEGER;

-- Index for fast lookups by schedule.
CREATE INDEX "notifications_scheduleId_idx" ON "notifications"("scheduleId");

-- Unique dedup key for schedule lifecycle events. Postgres treats NULLs as
-- distinct, so non-schedule notifications (announcements, etc.) are unaffected.
CREATE UNIQUE INDEX "notifications_userId_type_scheduleId_scheduleVersion_key"
  ON "notifications"("userId", "type", "scheduleId", "scheduleVersion");
