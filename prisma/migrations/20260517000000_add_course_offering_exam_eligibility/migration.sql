-- Add explicit course offering exam eligibility.
CREATE TYPE "CourseType" AS ENUM ('COURSE', 'PROJECT');

ALTER TABLE "course_offerings"
ADD COLUMN "courseType" "CourseType" NOT NULL DEFAULT 'COURSE',
ADD COLUMN "hasExam" BOOLEAN NOT NULL DEFAULT true;

UPDATE "course_offerings"
SET "hasExam" = CASE WHEN "courseType" = 'PROJECT' THEN false ELSE true END;
