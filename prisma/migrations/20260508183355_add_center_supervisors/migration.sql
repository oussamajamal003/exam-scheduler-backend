-- CreateTable
CREATE TABLE "center_supervisors" (
    "centerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "center_supervisors_pkey" PRIMARY KEY ("centerId","userId")
);

-- CreateIndex
CREATE INDEX "center_supervisors_userId_idx" ON "center_supervisors"("userId");

-- AddForeignKey
ALTER TABLE "center_supervisors" ADD CONSTRAINT "center_supervisors_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "centers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "center_supervisors" ADD CONSTRAINT "center_supervisors_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
