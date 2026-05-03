-- AlterTable
ALTER TABLE "conflicts" ADD COLUMN     "resolvedAt" TIMESTAMP(3),
ADD COLUMN     "resolvedBy" TEXT;
