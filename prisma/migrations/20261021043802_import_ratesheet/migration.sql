-- CreateEnum
CREATE TYPE "PriceRule" AS ENUM ('MARKUP', 'MARGIN', 'LIST');

-- AlterTable
ALTER TABLE "Distributor" ADD COLUMN     "priceRule" "PriceRule",
ADD COLUMN     "ratesheetColumns" JSONB,
ADD COLUMN     "priceRuleBasisPoints" INTEGER;

-- AlterTable
ALTER TABLE "LinkedRatesheet" ADD COLUMN     "addedCount" INTEGER,
ADD COLUMN     "costDownCount" INTEGER,
ADD COLUMN     "costUpCount" INTEGER,
ADD COLUMN     "distributorId" TEXT,
ADD COLUMN     "effectiveOn" DATE,
ADD COLUMN     "importedAt" TIMESTAMP(3),
ADD COLUMN     "updatedCount" INTEGER;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "listPriceCents" INTEGER;

-- CreateTable
CREATE TABLE "RatesheetImportIssue" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "distributorId" TEXT,
    "note" TEXT NOT NULL,
    "detected" JSONB,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "RatesheetImportIssue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RatesheetImportIssue_organizationId_idx" ON "RatesheetImportIssue"("organizationId");

-- CreateIndex
CREATE INDEX "RatesheetImportIssue_resolvedAt_createdAt_idx" ON "RatesheetImportIssue"("resolvedAt", "createdAt");

-- CreateIndex
CREATE INDEX "LinkedRatesheet_distributorId_idx" ON "LinkedRatesheet"("distributorId");

-- AddForeignKey
ALTER TABLE "LinkedRatesheet" ADD CONSTRAINT "LinkedRatesheet_distributorId_fkey" FOREIGN KEY ("distributorId") REFERENCES "Distributor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RatesheetImportIssue" ADD CONSTRAINT "RatesheetImportIssue_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RatesheetImportIssue" ADD CONSTRAINT "RatesheetImportIssue_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RatesheetImportIssue" ADD CONSTRAINT "RatesheetImportIssue_distributorId_fkey" FOREIGN KEY ("distributorId") REFERENCES "Distributor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

