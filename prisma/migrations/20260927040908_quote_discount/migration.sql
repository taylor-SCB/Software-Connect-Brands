-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "discountCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "discountPercent" DOUBLE PRECISION;
