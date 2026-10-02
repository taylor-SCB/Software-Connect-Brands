-- The status ladder (Sept 30, 2026). Lead becomes Not Actioned and
-- Customer becomes Won by renaming the values, so every existing row
-- carries over with no rewrite. The data step is the next migration: a
-- new enum value cannot be used in the transaction that adds it.
ALTER TYPE "ContactStatus" RENAME VALUE 'LEAD' TO 'NOT_ACTIONED';
ALTER TYPE "ContactStatus" RENAME VALUE 'CUSTOMER' TO 'WON';
ALTER TYPE "ContactStatus" ADD VALUE IF NOT EXISTS 'CONTACTED';
ALTER TYPE "ContactStatus" ADD VALUE IF NOT EXISTS 'NOT_INTERESTED';
ALTER TYPE "ContactStatus" ADD VALUE IF NOT EXISTS 'INTERESTED';
ALTER TYPE "ContactStatus" ADD VALUE IF NOT EXISTS 'MEETING_SET';
ALTER TYPE "ContactStatus" ADD VALUE IF NOT EXISTS 'MEETING_COMPLETED';
ALTER TYPE "ContactStatus" ADD VALUE IF NOT EXISTS 'QUOTE_SENT';
ALTER TYPE "ContactStatus" ADD VALUE IF NOT EXISTS 'CONTRACT_SENT';
ALTER TYPE "ContactStatus" ADD VALUE IF NOT EXISTS 'LOST';

ALTER TABLE "Contact" ALTER COLUMN "status" SET DEFAULT 'NOT_ACTIONED';
ALTER TABLE "Company" ALTER COLUMN "status" SET DEFAULT 'NOT_ACTIONED';

ALTER TYPE "DealStage" ADD VALUE IF NOT EXISTS 'ARCHIVED';

-- When a deal reached its stage. Existing deals take their last update,
-- the closest thing on record.
ALTER TABLE "Deal" ADD COLUMN "stageChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "Deal" SET "stageChangedAt" = "updatedAt";
CREATE INDEX "Deal_organizationId_stage_idx" ON "Deal"("organizationId", "stage");

CREATE TABLE "StatusChange" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT,
    "companyId" TEXT,
    "dealId" TEXT,
    "userId" TEXT,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "on" TIMESTAMP(3) NOT NULL,
    "auto" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatusChange_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StatusChange_organizationId_on_idx" ON "StatusChange"("organizationId", "on");
CREATE INDEX "StatusChange_contactId_idx" ON "StatusChange"("contactId");
CREATE INDEX "StatusChange_companyId_idx" ON "StatusChange"("companyId");
CREATE INDEX "StatusChange_dealId_idx" ON "StatusChange"("dealId");

ALTER TABLE "StatusChange" ADD CONSTRAINT "StatusChange_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StatusChange" ADD CONSTRAINT "StatusChange_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StatusChange" ADD CONSTRAINT "StatusChange_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StatusChange" ADD CONSTRAINT "StatusChange_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StatusChange" ADD CONSTRAINT "StatusChange_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
