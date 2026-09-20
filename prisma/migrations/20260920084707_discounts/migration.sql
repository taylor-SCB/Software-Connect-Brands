-- AlterTable
ALTER TABLE "Contract" ADD COLUMN     "discountCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "discountPercent" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "ContractLineItem" ADD COLUMN     "discountCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "discountPercent" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "QuoteLineItem" ADD COLUMN     "discountCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "discountPercent" DOUBLE PRECISION;
