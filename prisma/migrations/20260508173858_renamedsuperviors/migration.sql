DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM pg_class
		WHERE relkind = 'i'
			AND relname = 'exam_assignments_scheduleId_examId_roomId_proctorId_time_key'
	) THEN
		ALTER INDEX "exam_assignments_scheduleId_examId_roomId_proctorId_time_key"
			RENAME TO "exam_assignments_scheduleId_examId_roomId_proctorId_timeSlo_key";
	END IF;
END $$;
