-- BDR redesign (Nov 11, 2026): how each touch went, who booked a meeting
-- and how it went, the latest connect on people and companies, a reason on
-- status changes, team goals and the try limit, per-person view choices.
-- Every column is optional or has a default; no existing row is rewritten
-- here. lastConnectAt's triggers and backfill come in their own migration.

CREATE TYPE "ActivityOutcome" AS ENUM ('NO_ANSWER', 'VOICEMAIL', 'GATEKEEPER', 'BAD_NUMBER', 'TALKED', 'REPLIED', 'SENT', 'HELD', 'NO_SHOW');

ALTER TABLE "Activity" ADD COLUMN "outcome" "ActivityOutcome";
CREATE INDEX "Activity_contactId_outcome_occurredAt_idx" ON "Activity"("contactId", "outcome", "occurredAt");

ALTER TABLE "Contact" ADD COLUMN "lastConnectAt" TIMESTAMP(3);
CREATE INDEX "Contact_organizationId_lastConnectAt_idx" ON "Contact"("organizationId", "lastConnectAt");

ALTER TABLE "Company" ADD COLUMN "lastConnectAt" TIMESTAMP(3);
CREATE INDEX "Company_organizationId_lastConnectAt_idx" ON "Company"("organizationId", "lastConnectAt");

ALTER TABLE "StatusChange" ADD COLUMN "reason" TEXT;

ALTER TABLE "OpportunityMeeting" ADD COLUMN "bookedById" TEXT;
ALTER TABLE "OpportunityMeeting" ADD COLUMN "outcome" "ActivityOutcome";

ALTER TABLE "Organization" ADD COLUMN "weeklyTryGoal" INTEGER;
ALTER TABLE "Organization" ADD COLUMN "weeklyTalkGoal" INTEGER;
ALTER TABLE "Organization" ADD COLUMN "weeklyMeetingGoal" INTEGER;
ALTER TABLE "Organization" ADD COLUMN "parkAfterTries" INTEGER NOT NULL DEFAULT 6;
ALTER TABLE "Organization" ADD COLUMN "outcomesSince" TIMESTAMP(3);

ALTER TABLE "User" ADD COLUMN "uiPrefs" JSONB;
