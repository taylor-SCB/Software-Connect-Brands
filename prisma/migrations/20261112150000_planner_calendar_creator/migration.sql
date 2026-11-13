-- Planner AI (Nov 12, 2026): who put a calendar entry on the calendar, so
-- an entry delegated to someone else can be handed back but not deleted.
-- One nullable column; existing rows read as not delegated. Safe to roll
-- back past (an older build simply ignores the column).
ALTER TABLE "CalendarEvent" ADD COLUMN "createdById" TEXT;

ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
