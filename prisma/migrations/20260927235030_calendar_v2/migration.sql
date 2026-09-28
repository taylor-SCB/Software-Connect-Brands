-- Calendar v2: whose calendar a day is on, and the paperwork or logged
-- touchpoint the app made it from.
--
-- Safe for rows that already exist: every new column is nullable or has
-- a default. Existing events are handed to the workspace's owner, so a
-- one-person workspace's "Just me" view still shows everything it did
-- before; a workspace with several users can reassign from the form.

-- AlterTable
ALTER TABLE "CalendarEvent"
  ADD COLUMN "ownerId" TEXT,
  ADD COLUMN "auto" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "activityId" TEXT,
  ADD COLUMN "quoteId" TEXT,
  ADD COLUMN "contractId" TEXT;

-- Backfill: the oldest OWNER login of each workspace takes the days that
-- were there before anyone could be named on one.
UPDATE "CalendarEvent" e
SET "ownerId" = (
  SELECT u.id FROM "User" u
  WHERE u."organizationId" = e."organizationId" AND u.role = 'OWNER' AND u."removedAt" IS NULL
  ORDER BY u."createdAt" ASC
  LIMIT 1
)
WHERE e."ownerId" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEvent_activityId_key" ON "CalendarEvent"("activityId");

-- CreateIndex
CREATE INDEX "CalendarEvent_ownerId_startOn_idx" ON "CalendarEvent"("ownerId", "startOn");

-- CreateIndex
CREATE INDEX "CalendarEvent_quoteId_idx" ON "CalendarEvent"("quoteId");

-- CreateIndex
CREATE INDEX "CalendarEvent_contractId_idx" ON "CalendarEvent"("contractId");

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;
