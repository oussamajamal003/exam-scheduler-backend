-- CreateTable
CREATE TABLE "user_settings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "schedulePublishedNotifications" BOOLEAN NOT NULL DEFAULT true,
    "examAssignmentUpdates" BOOLEAN NOT NULL DEFAULT true,
    "roomTimeChanges" BOOLEAN NOT NULL DEFAULT true,
    "announcementsMessages" BOOLEAN NOT NULL DEFAULT true,
    "emailNotifications" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_settings_userId_key" ON "user_settings"("userId");

-- AddForeignKey
ALTER TABLE "user_settings"
ADD CONSTRAINT "user_settings_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill default settings for existing users.
INSERT INTO "user_settings" ("id", "userId", "updatedAt")
SELECT gen_random_uuid()::text, "id", CURRENT_TIMESTAMP
FROM "users"
ON CONFLICT ("userId") DO NOTHING;
