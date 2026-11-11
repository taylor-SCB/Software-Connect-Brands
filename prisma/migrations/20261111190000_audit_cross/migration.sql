-- Final audit, cross-area indexes (Nov 11, 2026; audit-today F2 and F3).
-- Indexes only: no row is read or changed, so it is safe for every row the
-- live database already holds, and IF NOT EXISTS makes a re-run a no-op.
--
-- Lock time. CREATE INDEX blocks writes to its table (reads carry on) until
-- this file commits, so the quick one goes first. Measured on the load-test
-- workspace grown to 400,000 activities and 403,000 calendar entries
-- (200,000 contacts): the calendar index 0.09 s (it holds only the open
-- entries, 3,000 there), the Activity index 0.5 s. Not CONCURRENTLY: Prisma
-- runs a migration file in one transaction, where Postgres refuses it.
--
-- Rollback: DROP INDEX for either; nothing reads them by name.

-- F2. Open calendar entries, by day. Every logged touch writes a calendar
-- entry ticked done, so a workspace's past is almost all done entries, and
-- every "what is still open" read walked all of them through
-- CalendarEvent_organizationId_startOn_idx and threw them away: My day's
-- due follow-ups (due_ev) and booked-ahead check, the Daily Rundown's
-- Overdue count and list, and the calendar's Overdue (Agenda and Log).
-- With 400,000 done entries (EXPLAIN on scb_final) the Rundown's Overdue
-- list took 127 ms and takes 0.2 ms, its count 18 ms and 0.7 ms, and My
-- day's due lookup reads the 1,600 open entries instead of all 403,000.
-- Hand-written: Prisma 7.10 describes a partial index only behind the
-- partialIndexes preview, which this schema doesn't turn on, so schema.prisma
-- carries a comment instead of an @@index. Prisma's diff leaves a partial
-- index alone (`prisma migrate diff` from a database migrated to here
-- against schema.prisma lists neither index), so nothing offers to drop it.
CREATE INDEX IF NOT EXISTS "CalendarEvent_open_startOn_idx" ON "CalendarEvent"("organizationId", "startOn") WHERE "doneAt" IS NULL;

-- F3. Who logged what, when it was saved: Team today's "last logged"
-- (repNumbers) and sellingReps' "logged a touch in the last 30 days".
-- Activity had no index on userId at all, so a teammate with nothing in the
-- last 30 days (an owner who doesn't sell) read the whole table: 25 ms at
-- 400,000 activities, 0.03 ms with this. In schema.prisma as
-- @@index([organizationId, userId, createdAt]).
CREATE INDEX IF NOT EXISTS "Activity_organizationId_userId_createdAt_idx" ON "Activity"("organizationId", "userId", "createdAt");
