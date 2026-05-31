-- Prepare existing data for global uniqueness constraints.
-- Earlier scoped rules allowed duplicate course identifiers across semesters
-- and duplicate room names across centers. Keep the first value unchanged and
-- suffix later duplicates deterministically before the stricter constraints run.

WITH ranked_courses AS (
  SELECT
    "id",
    "code",
    ROW_NUMBER() OVER (PARTITION BY "code" ORDER BY "createdAt", "id") AS duplicate_rank
  FROM "courses"
)
UPDATE "courses" AS course
SET "code" = CONCAT(course."code", '-', ranked_courses.duplicate_rank)
FROM ranked_courses
WHERE course."id" = ranked_courses."id"
  AND ranked_courses.duplicate_rank > 1;

WITH ranked_courses AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (PARTITION BY "title" ORDER BY "createdAt", "id") AS duplicate_rank
  FROM "courses"
)
UPDATE "courses" AS course
SET "title" = CONCAT(course."title", ' (', course."code", ')')
FROM ranked_courses
WHERE course."id" = ranked_courses."id"
  AND ranked_courses.duplicate_rank > 1;

WITH ranked_rooms AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (PARTITION BY "name" ORDER BY "id") AS duplicate_rank
  FROM "rooms"
)
UPDATE "rooms" AS room
SET "name" = CONCAT(room."name", ' #', ranked_rooms.duplicate_rank)
FROM ranked_rooms
WHERE room."id" = ranked_rooms."id"
  AND ranked_rooms.duplicate_rank > 1;
