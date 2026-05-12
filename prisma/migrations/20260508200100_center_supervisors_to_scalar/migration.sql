ALTER TABLE "centers"
ADD COLUMN IF NOT EXISTS "supervisors" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "centers" AS c
SET "supervisors" = source."supervisors"
FROM (
  SELECT
    cs."centerId",
    COALESCE(
      ARRAY_AGG(
        DISTINCT NULLIF(BTRIM(COALESCE(u."name", u."email")), '')
        ORDER BY NULLIF(BTRIM(COALESCE(u."name", u."email")), '')
      ) FILTER (WHERE NULLIF(BTRIM(COALESCE(u."name", u."email")), '') IS NOT NULL),
      ARRAY[]::TEXT[]
    ) AS "supervisors"
  FROM "center_supervisors" AS cs
  JOIN "users" AS u ON u."id" = cs."userId"
  GROUP BY cs."centerId"
) AS source
WHERE c."id" = source."centerId";

DROP TABLE IF EXISTS "center_supervisors";