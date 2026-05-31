-- Enforce global uniqueness for critical scheduling identifiers.
-- Backend services perform friendly case-insensitive checks before writes;
-- these database constraints close exact-value race windows.

ALTER TABLE "courses" DROP CONSTRAINT IF EXISTS "courses_code_semesterId_key";
ALTER TABLE "rooms" DROP CONSTRAINT IF EXISTS "rooms_centerId_name_key";

ALTER TABLE "courses" ADD CONSTRAINT "courses_code_key" UNIQUE ("code");
ALTER TABLE "courses" ADD CONSTRAINT "courses_title_key" UNIQUE ("title");
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_name_key" UNIQUE ("name");
