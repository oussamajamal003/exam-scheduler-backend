-- Add endTime field to the mapped CourseOffering table.
ALTER TABLE "course_offerings" ADD COLUMN IF NOT EXISTS "endTime" TEXT;
