-- Remove unused email notification preference from user settings.
ALTER TABLE "user_settings"
DROP COLUMN IF EXISTS "emailNotifications";
