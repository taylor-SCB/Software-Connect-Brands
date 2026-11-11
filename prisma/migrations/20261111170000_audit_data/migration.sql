-- Final audit, data area (Nov 11, 2026).
--
-- 1. OpportunityMeeting.outcomeUndo: what the save that last answered a
--    meeting (Held, No-show, or a meeting logged on its booked day) found
--    before it — the save's batchId, who made it, the meeting's outcome and
--    day, its calendar entry's tick and its history lines' outcome and
--    time — so Undo puts back exactly that, only for that save, and only
--    whoever made it (or an Owner or Admin) can.
-- 2. A meeting already in history before the BDR release (a past MEETING
--    line with no outcome) is held, as decision 1 counts it: its meeting
--    row says so, so nothing asks "Did the meeting happen?" about a
--    meeting that was logged as having happened. The line itself stays
--    "not recorded" (decision 10). Re-runnable: only rows still unanswered.
-- 3. The touch and connect dates read one index row per person or
--    company again (the BDR functions read a record's whole history on
--    every write: 10 ms a write on a record with 20,000 lines).
--
-- Rollback: the column and the indexes can stay; put the function bodies
-- of 20261111120000_connect_triggers back with CREATE OR REPLACE.

ALTER TABLE "OpportunityMeeting" ADD COLUMN "outcomeUndo" JSONB;

UPDATE "OpportunityMeeting" om SET outcome = 'HELD'
  FROM "Activity" a
 WHERE a.id = om."activityId" AND a.type = 'MEETING' AND a.outcome IS NULL
   AND a."occurredAt" <= now() AND om.outcome IS NULL;

-- A connect, as the functions below and Stats count one.
CREATE INDEX "Activity_contact_connect_idx" ON "Activity"("contactId", "occurredAt")
  WHERE marketing = false AND ("outcome" IN ('TALKED', 'REPLIED', 'HELD') OR (type = 'MEETING' AND "outcome" IS NULL));
CREATE INDEX "Activity_company_touch_idx" ON "Activity"("companyId", "occurredAt") WHERE marketing = false;
CREATE INDEX "Activity_company_connect_idx" ON "Activity"("companyId", "occurredAt")
  WHERE marketing = false AND ("outcome" IN ('TALKED', 'REPLIED', 'HELD') OR (type = 'MEETING' AND "outcome" IS NULL));

-- The same answers as 20261111120000, each the newest row of its index.
CREATE OR REPLACE FUNCTION crm_touch_contacts(ids text[]) RETURNS void LANGUAGE sql AS $$
  UPDATE "Contact" c SET "lastTouchAt" = t.at, "lastConnectAt" = t.conn
    FROM (SELECT x.id,
                 (SELECT a."occurredAt" FROM "Activity" a
                   WHERE a."contactId" = x.id AND a.marketing = false AND a."occurredAt" <= now()
                     AND (a."outcome" IS NULL OR a."outcome" <> 'NO_SHOW')
                   ORDER BY a."occurredAt" DESC LIMIT 1) AS at,
                 (SELECT a."occurredAt" FROM "Activity" a
                   WHERE a."contactId" = x.id AND a.marketing = false AND a."occurredAt" <= now()
                     AND (a."outcome" IN ('TALKED', 'REPLIED', 'HELD') OR (a.type = 'MEETING' AND a."outcome" IS NULL))
                   ORDER BY a."occurredAt" DESC LIMIT 1) AS conn
            FROM unnest(ids) AS x(id)) t
   WHERE c.id = t.id
     AND (c."lastTouchAt" IS DISTINCT FROM t.at OR c."lastConnectAt" IS DISTINCT FROM t.conn);
$$;

CREATE OR REPLACE FUNCTION crm_touch_companies(ids text[]) RETURNS void LANGUAGE sql AS $$
  UPDATE "Company" co SET "lastTouchAt" = t.at, "lastConnectAt" = t.conn
    FROM (SELECT x.id,
                 GREATEST(
                   (SELECT a."occurredAt" FROM "Activity" a
                     WHERE a."companyId" = x.id AND a.marketing = false AND a."occurredAt" <= now()
                       AND (a."outcome" IS NULL OR a."outcome" <> 'NO_SHOW')
                     ORDER BY a."occurredAt" DESC LIMIT 1),
                   (SELECT max(q."lastTouchAt") FROM "Contact" q WHERE q."companyId" = x.id)) AS at,
                 GREATEST(
                   (SELECT a."occurredAt" FROM "Activity" a
                     WHERE a."companyId" = x.id AND a.marketing = false AND a."occurredAt" <= now()
                       AND (a."outcome" IN ('TALKED', 'REPLIED', 'HELD') OR (a.type = 'MEETING' AND a."outcome" IS NULL))
                     ORDER BY a."occurredAt" DESC LIMIT 1),
                   (SELECT max(q."lastConnectAt") FROM "Contact" q WHERE q."companyId" = x.id)) AS conn
            FROM unnest(ids) AS x(id)) t
   WHERE co.id = t.id
     AND (co."lastTouchAt" IS DISTINCT FROM t.at OR co."lastConnectAt" IS DISTINCT FROM t.conn);
$$;
