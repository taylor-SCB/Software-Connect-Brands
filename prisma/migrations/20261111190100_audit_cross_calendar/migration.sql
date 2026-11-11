-- Final audit, cross-area indexes on CalendarEvent (Nov 11, 2026; audit-today
-- F2 and its fix review). Indexes only: no row is read or changed, so it is
-- safe for every row the live database already holds, and IF NOT EXISTS makes
-- a re-run a no-op. In its own file, after the Activity one, so it holds only
-- CalendarEvent's lock and only for its own build (see
-- 20261111190000_audit_cross_activity): 0.09 s at 403,000 entries, the second
-- index less (it holds only multi-day entries). Not CONCURRENTLY: Prisma runs
-- a migration file in one transaction, where Postgres refuses it.
--
-- Both are hand-written: Prisma 7.10 describes a partial index only behind
-- the partialIndexes preview, which this schema doesn't turn on, so
-- schema.prisma carries a comment instead of an @@index. Prisma's diff leaves
-- a partial index alone (`prisma migrate diff` from a database migrated to
-- here against schema.prisma lists neither), so nothing offers to drop them.
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
CREATE INDEX IF NOT EXISTS "CalendarEvent_open_startOn_idx" ON "CalendarEvent"("organizationId", "startOn") WHERE "doneAt" IS NULL;

-- F2, the reads that take done entries too: the Rundown's "On today" count
-- and its Done today list, and every calendar window (Month, Week, Agenda,
-- Team) ask for entries starting in the window OR started before it and
-- still running (endOn on or after its first day). With no index on endOn
-- that second arm could only be answered by reading (organizationId,
-- startOn) from the start of history, so each of those reads walked every
-- past entry as the Overdue list did. Only multi-day entries have an endOn,
-- so this is small; with it both arms are index reads (a BitmapOr).
CREATE INDEX IF NOT EXISTS "CalendarEvent_runs_endOn_idx" ON "CalendarEvent"("organizationId", "endOn") WHERE "endOn" IS NOT NULL;
