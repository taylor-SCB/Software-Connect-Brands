-- Money foundation, part A: real payment records, which way each contract's
-- money goes, "Mark signed", and the Preset Payment Table.
--
-- Safe for rows that already exist: every new column is nullable or has a
-- default, and the three UPDATE/INSERT statements at the bottom only fill
-- the new columns in from data the rows already carry — a Purchase Order
-- becomes "Money out", every payment row learns its workspace, and a row
-- that was ticked Paid before payments existed gets one Payment for its
-- full amount, so every total reads the same the morning after.

-- AlterTable
ALTER TABLE "Contract" ADD COLUMN     "payable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "signedNote" TEXT,
ADD COLUMN     "signedOffline" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ContractPayment" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "defaultDepositPercent" INTEGER NOT NULL DEFAULT 50,
ADD COLUMN     "defaultInstallmentCount" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "defaultPaymentPreset" TEXT NOT NULL DEFAULT 'FULL',
ADD COLUMN     "defaultPaymentTerms" TEXT NOT NULL DEFAULT 'Net 30';

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contractPaymentId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "paidOn" DATE NOT NULL,
    "method" TEXT,
    "reference" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Payment_contractPaymentId_idx" ON "Payment"("contractPaymentId");

-- CreateIndex
CREATE INDEX "Payment_organizationId_paidOn_idx" ON "Payment"("organizationId", "paidOn");

-- CreateIndex
CREATE INDEX "Contract_organizationId_payable_status_idx" ON "Contract"("organizationId", "payable", "status");

-- CreateIndex
CREATE INDEX "ContractPayment_organizationId_idx" ON "ContractPayment"("organizationId");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_contractPaymentId_fkey" FOREIGN KEY ("contractPaymentId") REFERENCES "ContractPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: existing purchase orders are money going out.
UPDATE "Contract" SET "payable" = true WHERE "type" = 'Purchase Order';

-- Backfill: every payment row learns which workspace it belongs to.
UPDATE "ContractPayment" cp
SET "organizationId" = c."organizationId"
FROM "Contract" c
WHERE c.id = cp."contractId";

-- Backfill: a row ticked Paid before payments existed gets one Payment for
-- its whole amount, dated the day it was ticked, so "paid so far" totals
-- don't drop to zero on release day.
INSERT INTO "Payment" (id, "organizationId", "contractPaymentId", "amountCents", "paidOn", note, "createdAt")
SELECT gen_random_uuid()::text, cp."organizationId", cp.id, cp."amountCents", cp."paidAt"::date,
       'Marked paid before payments existed', cp."paidAt"
FROM "ContractPayment" cp
WHERE cp."paidAt" IS NOT NULL AND cp."amountCents" > 0 AND cp."organizationId" IS NOT NULL;
