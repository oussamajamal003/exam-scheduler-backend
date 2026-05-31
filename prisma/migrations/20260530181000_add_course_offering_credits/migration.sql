-- Add editable credits field to course offerings.
ALTER TABLE "course_offerings" ADD COLUMN IF NOT EXISTS "credits" INTEGER;
