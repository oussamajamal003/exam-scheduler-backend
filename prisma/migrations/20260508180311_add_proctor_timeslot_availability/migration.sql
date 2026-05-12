-- CreateTable
CREATE TABLE "proctor_availabilities" (
    "proctorId" TEXT NOT NULL,
    "timeSlotId" TEXT NOT NULL,

    CONSTRAINT "proctor_availabilities_pkey" PRIMARY KEY ("proctorId","timeSlotId")
);

-- CreateIndex
CREATE INDEX "proctor_availabilities_timeSlotId_idx" ON "proctor_availabilities"("timeSlotId");

-- AddForeignKey
ALTER TABLE "proctor_availabilities" ADD CONSTRAINT "proctor_availabilities_proctorId_fkey" FOREIGN KEY ("proctorId") REFERENCES "supervisors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proctor_availabilities" ADD CONSTRAINT "proctor_availabilities_timeSlotId_fkey" FOREIGN KEY ("timeSlotId") REFERENCES "time_slots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
