-- Collapse legacy admin variants while rebuilding the enum with the final values.
CREATE TYPE "Role_new" AS ENUM ('ADMIN', 'SUPERVISOR', 'STUDENT');

ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "users"
  ALTER COLUMN "role" TYPE "Role_new"
  USING (
    CASE
      WHEN "role"::text IN ('TECH_ADMIN', 'SCHEDULING_ADMIN') THEN 'ADMIN'
      ELSE "role"::text
    END
  )::"Role_new";
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'STUDENT'::"Role_new";

DROP TYPE "Role";
ALTER TYPE "Role_new" RENAME TO "Role";
