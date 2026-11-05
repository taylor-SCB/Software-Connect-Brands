-- Opportunities on the Pipeline (Oct 27, 2026). New tables only; existing
-- deals and meeting-stage contacts get their opportunities from the
-- board's own reconcile (reconcileOpportunities) the first time it opens.

-- CreateEnum
CREATE TYPE "OpportunityStage" AS ENUM ('MEETING_SET', 'MEETING_COMPLETED', 'LOST');

-- CreateEnum
CREATE TYPE "PocRole" AS ENUM ('PRIMARY', 'ASSOCIATED', 'HIDDEN');

-- CreateEnum
CREATE TYPE "OpportunityLogKind" AS ENUM ('OPPORTUNITY_CREATED', 'DEAL_CREATED');

-- CreateTable
CREATE TABLE "Opportunity" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "stage" "OpportunityStage" NOT NULL DEFAULT 'MEETING_SET',
    "leadLabel" TEXT,
    "ownerId" TEXT,
    "dealId" TEXT,
    "completedAt" TIMESTAMP(3),
    "convertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Opportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpportunityContact" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "role" "PocRole" NOT NULL DEFAULT 'ASSOCIATED',
    "fromMeeting" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpportunityContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpportunityMeeting" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "on" TIMESTAMP(3) NOT NULL,
    "activityId" TEXT,
    "eventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpportunityMeeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpportunityLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "kind" "OpportunityLogKind" NOT NULL,
    "userId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpportunityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadLabelOption" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadLabelOption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Opportunity_dealId_key" ON "Opportunity"("dealId");

-- CreateIndex
CREATE INDEX "Opportunity_organizationId_stage_idx" ON "Opportunity"("organizationId", "stage");

-- CreateIndex
CREATE INDEX "OpportunityContact_contactId_idx" ON "OpportunityContact"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "OpportunityContact_opportunityId_contactId_key" ON "OpportunityContact"("opportunityId", "contactId");

-- CreateIndex
CREATE INDEX "OpportunityMeeting_opportunityId_idx" ON "OpportunityMeeting"("opportunityId");

-- CreateIndex
CREATE INDEX "OpportunityMeeting_eventId_idx" ON "OpportunityMeeting"("eventId");

-- CreateIndex
CREATE INDEX "OpportunityLog_contactId_idx" ON "OpportunityLog"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "OpportunityLog_opportunityId_contactId_kind_key" ON "OpportunityLog"("opportunityId", "contactId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "LeadLabelOption_organizationId_name_key" ON "LeadLabelOption"("organizationId", "name");

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityContact" ADD CONSTRAINT "OpportunityContact_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityContact" ADD CONSTRAINT "OpportunityContact_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityMeeting" ADD CONSTRAINT "OpportunityMeeting_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityLog" ADD CONSTRAINT "OpportunityLog_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityLog" ADD CONSTRAINT "OpportunityLog_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityLog" ADD CONSTRAINT "OpportunityLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadLabelOption" ADD CONSTRAINT "LeadLabelOption_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
