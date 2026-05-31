-- Enforce case-insensitive, trim-normalized schedule name uniqueness.
DO $$
DECLARE
	duplicate_names TEXT;
BEGIN
	SELECT STRING_AGG(FORMAT('%s (%s rows)', normalized_name, duplicate_count), ', ')
	INTO duplicate_names
	FROM (
		SELECT LOWER(BTRIM("name")) AS normalized_name, COUNT(*) AS duplicate_count
		FROM "schedules"
		GROUP BY LOWER(BTRIM("name"))
		HAVING COUNT(*) > 1
	) duplicates;

	IF duplicate_names IS NOT NULL THEN
		RAISE EXCEPTION 'Cannot create unique schedule name index. Resolve duplicate schedule names first: %', duplicate_names;
	END IF;
END $$;

UPDATE "schedules"
SET "name" = BTRIM("name")
WHERE "name" <> BTRIM("name");

CREATE UNIQUE INDEX "schedules_name_normalized_unique" ON "schedules"(LOWER(BTRIM("name")));