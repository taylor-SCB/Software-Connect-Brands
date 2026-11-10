-- Reps and who-added on contacts and companies, a Marketing flag on activity,
-- report subscriptions and write-ups, each user's look, and the gone-quiet
-- day count (Nov 10, 2026). Every new column is nullable or has a default.

-- AlterTable
ALTER TABLE "Activity" ADD COLUMN     "marketing" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "ownerId" TEXT;

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "ownerId" TEXT;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "quietDays" INTEGER NOT NULL DEFAULT 8;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "theme" TEXT;

-- CreateTable
CREATE TABLE "ReportSubscription" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "report" TEXT NOT NULL,
    "cadence" TEXT NOT NULL,
    "repId" TEXT,
    "createdById" TEXT,
    "lastSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportNarrative" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportNarrative_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReportSubscription_organizationId_idx" ON "ReportSubscription"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ReportSubscription_recipientId_report_cadence_repId_key" ON "ReportSubscription"("recipientId", "report", "cadence", "repId");

-- CreateIndex
CREATE UNIQUE INDEX "ReportNarrative_organizationId_key_key" ON "ReportNarrative"("organizationId", "key");

-- CreateIndex
CREATE INDEX "Activity_organizationId_marketing_occurredAt_idx" ON "Activity"("organizationId", "marketing", "occurredAt");

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportSubscription" ADD CONSTRAINT "ReportSubscription_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportSubscription" ADD CONSTRAINT "ReportSubscription_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportNarrative" ADD CONSTRAINT "ReportNarrative_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Marketing sends written before the flag existed: an Email line the
-- email-marketing send wrote ("Emailed “Subject”…"). They stay on the log
-- and stop counting as a touch.
UPDATE "Activity" SET marketing = true WHERE type = 'EMAIL' AND body LIKE 'Emailed “%';
