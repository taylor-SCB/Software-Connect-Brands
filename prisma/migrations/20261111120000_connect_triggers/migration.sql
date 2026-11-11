-- BDR redesign, Releases 2 and 3 (Nov 11, 2026): the latest connect kept on
-- people and companies, and what "Undo" needs to take one save back.
--
-- A connect is an Activity with outcome TALKED, REPLIED or HELD, or a
-- MEETING with no outcome (old rows: a past meeting reads as held). A
-- no-show is neither a touch nor a connect. Marketing sends are neither,
-- as before. Both dates leave out anything dated ahead; crm_touch_due()
-- puts it on once its time comes, as for lastTouchAt.
--
-- Rollback: put the 20261110200000_touch_not_future function bodies back
-- with CREATE OR REPLACE. The columns can stay; no data is lost.

-- The save that wrote a status change or a calendar entry (undoLog).
ALTER TABLE "StatusChange" ADD COLUMN "batchId" TEXT;
CREATE INDEX "StatusChange_batchId_idx" ON "StatusChange"("batchId");
ALTER TABLE "CalendarEvent" ADD COLUMN "batchId" TEXT;
CREATE INDEX "CalendarEvent_batchId_idx" ON "CalendarEvent"("batchId");

-- Backfill, set-based, while the old functions are still in place (they
-- ignore lastConnectAt, so these UPDATEs recompute nothing else).
UPDATE "Contact" c SET "lastConnectAt" = t.at
  FROM (SELECT "contactId", max("occurredAt") AS at FROM "Activity"
         WHERE marketing = false AND "contactId" IS NOT NULL AND "occurredAt" <= now()
           AND ("outcome" IN ('TALKED', 'REPLIED', 'HELD') OR (type = 'MEETING' AND "outcome" IS NULL))
         GROUP BY "contactId") t
 WHERE c.id = t."contactId";

UPDATE "Company" co SET "lastConnectAt" = t.at
  FROM (SELECT id, max(at) AS at FROM (
          SELECT "companyId" AS id, max("occurredAt") AS at FROM "Activity"
           WHERE marketing = false AND "companyId" IS NOT NULL AND "occurredAt" <= now()
             AND ("outcome" IN ('TALKED', 'REPLIED', 'HELD') OR (type = 'MEETING' AND "outcome" IS NULL))
           GROUP BY "companyId"
          UNION ALL
          SELECT "companyId", max("lastConnectAt") FROM "Contact"
           WHERE "companyId" IS NOT NULL AND "lastConnectAt" IS NOT NULL GROUP BY "companyId"
        ) u GROUP BY id) t
 WHERE co.id = t.id;

-- One UPDATE keeps both dates. Each id reads its own activities once.
CREATE OR REPLACE FUNCTION crm_touch_contacts(ids text[]) RETURNS void LANGUAGE sql AS $$
  UPDATE "Contact" c SET "lastTouchAt" = t.at, "lastConnectAt" = t.conn
    FROM (SELECT x.id, s.at, s.conn
            FROM unnest(ids) AS x(id)
            LEFT JOIN LATERAL (
              SELECT max(a."occurredAt") AS at,
                     max(a."occurredAt") FILTER (
                       WHERE a."outcome" IN ('TALKED', 'REPLIED', 'HELD') OR (a.type = 'MEETING' AND a."outcome" IS NULL)) AS conn
                FROM "Activity" a
               WHERE a."contactId" = x.id AND a.marketing = false AND a."occurredAt" <= now()
                 AND (a."outcome" IS NULL OR a."outcome" <> 'NO_SHOW')) s ON true) t
   WHERE c.id = t.id
     AND (c."lastTouchAt" IS DISTINCT FROM t.at OR c."lastConnectAt" IS DISTINCT FROM t.conn);
$$;

-- A company's dates are its own or its people's, whichever is later.
CREATE OR REPLACE FUNCTION crm_touch_companies(ids text[]) RETURNS void LANGUAGE sql AS $$
  UPDATE "Company" co SET "lastTouchAt" = t.at, "lastConnectAt" = t.conn
    FROM (SELECT x.id, GREATEST(s.at, p.at) AS at, GREATEST(s.conn, p.conn) AS conn
            FROM unnest(ids) AS x(id)
            LEFT JOIN LATERAL (
              SELECT max(a."occurredAt") AS at,
                     max(a."occurredAt") FILTER (
                       WHERE a."outcome" IN ('TALKED', 'REPLIED', 'HELD') OR (a.type = 'MEETING' AND a."outcome" IS NULL)) AS conn
                FROM "Activity" a
               WHERE a."companyId" = x.id AND a.marketing = false AND a."occurredAt" <= now()
                 AND (a."outcome" IS NULL OR a."outcome" <> 'NO_SHOW')) s ON true
            LEFT JOIN LATERAL (
              SELECT max(q."lastTouchAt") AS at, max(q."lastConnectAt") AS conn
                FROM "Contact" q WHERE q."companyId" = x.id) p ON true) t
   WHERE co.id = t.id
     AND (co."lastTouchAt" IS DISTINCT FROM t.at OR co."lastConnectAt" IS DISTINCT FROM t.conn);
$$;

-- A person's dates changing, a person moving company, or a person deleted:
-- their company (old and new) is worked out again.
CREATE OR REPLACE FUNCTION crm_contact_touch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    PERFORM crm_touch_companies(ARRAY(
      SELECT DISTINCT x FROM (
        SELECT n."companyId" AS x FROM new_rows n JOIN old_rows o ON o.id = n.id
         WHERE n."companyId" IS DISTINCT FROM o."companyId"
            OR n."lastTouchAt" IS DISTINCT FROM o."lastTouchAt"
            OR n."lastConnectAt" IS DISTINCT FROM o."lastConnectAt"
        UNION ALL
        SELECT o."companyId" FROM new_rows n JOIN old_rows o ON o.id = n.id
         WHERE n."companyId" IS DISTINCT FROM o."companyId"
      ) s WHERE x IS NOT NULL));
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM crm_touch_companies(ARRAY(
      SELECT DISTINCT "companyId" FROM old_rows WHERE "companyId" IS NOT NULL AND "lastTouchAt" IS NOT NULL));
  END IF;
  RETURN NULL;
END $$;

-- The people and companies with a touch (and so maybe a connect) that has
-- come due since it was written and isn't on the row yet. A connect is
-- always a touch, so a due connect is always a due touch.
CREATE OR REPLACE FUNCTION crm_touch_due(org text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM crm_touch_contacts(ARRAY(
    SELECT DISTINCT a."contactId" FROM "Activity" a JOIN "Contact" c ON c.id = a."contactId"
     WHERE a."organizationId" = org AND a."occurredAt" > a."createdAt" AND a.marketing = false
       AND (a."outcome" IS NULL OR a."outcome" <> 'NO_SHOW')
       AND a."occurredAt" <= now() AND (c."lastTouchAt" IS NULL OR c."lastTouchAt" < a."occurredAt")));
  PERFORM crm_touch_companies(ARRAY(
    SELECT DISTINCT a."companyId" FROM "Activity" a JOIN "Company" co ON co.id = a."companyId"
     WHERE a."organizationId" = org AND a."occurredAt" > a."createdAt" AND a.marketing = false
       AND (a."outcome" IS NULL OR a."outcome" <> 'NO_SHOW')
       AND a."occurredAt" <= now() AND (co."lastTouchAt" IS NULL OR co."lastTouchAt" < a."occurredAt")));
END $$;

-- "Talks counted from": today for every workspace that exists, and the day
-- a new one is made. Last on purpose (final audit, Nov 11, 2026): SET
-- DEFAULT locks the Organization table until this file commits, so it
-- waits until the backfills above are done (7.6 s of blocked sign-ins at
-- 200,000 contacts when it came first).
UPDATE "Organization" SET "outcomesSince" = now() WHERE "outcomesSince" IS NULL;
ALTER TABLE "Organization" ALTER COLUMN "outcomesSince" SET DEFAULT CURRENT_TIMESTAMP;
