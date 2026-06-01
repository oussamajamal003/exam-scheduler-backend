-- CreateTable
CREATE TABLE "system_settings" (
    "id" TEXT NOT NULL DEFAULT 'system',
    "systemName" TEXT NOT NULL DEFAULT 'Smart SIS',
    "maintenanceMode" BOOLEAN NOT NULL DEFAULT false,
    "allowScheduleGeneration" BOOLEAN NOT NULL DEFAULT true,
    "notificationsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "academicYear" TEXT,
    "supportEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduling_rules" (
    "id" TEXT NOT NULL DEFAULT 'scheduling',
    "maxStudentExamsPerDay" INTEGER NOT NULL DEFAULT 2,
    "maxProctorAssignmentsPerDay" INTEGER NOT NULL DEFAULT 2,
    "defaultExamDuration" INTEGER NOT NULL DEFAULT 120,
    "proctorStudentRatio" INTEGER NOT NULL DEFAULT 20,
    "preferredExamStartHour" INTEGER NOT NULL DEFAULT 9,
    "preferredExamEndHour" INTEGER NOT NULL DEFAULT 17,
    "preferredSpacingDays" INTEGER NOT NULL DEFAULT 1,
    "enforceStudentExamLimit" BOOLEAN NOT NULL DEFAULT true,
    "enforceProctorLimit" BOOLEAN NOT NULL DEFAULT true,
    "enablePreferredHours" BOOLEAN NOT NULL DEFAULT false,
    "enablePreferredSpacing" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduling_rules_pkey" PRIMARY KEY ("id")
);
