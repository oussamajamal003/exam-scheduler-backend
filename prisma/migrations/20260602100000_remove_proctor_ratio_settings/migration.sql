-- Remove deprecated proctor/student ratio settings from scheduling_rules.
ALTER TABLE "scheduling_rules"
  DROP COLUMN IF EXISTS "proctorStudentRatio",
  DROP COLUMN IF EXISTS "enforceProctorStudentRatio";
