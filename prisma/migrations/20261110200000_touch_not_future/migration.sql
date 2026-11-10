-- Audit fix (Nov 10, 2026): a touch dated ahead counts once its day comes.
--
-- lastTouchAt took max("occurredAt") with no upper bound, so ticking a
-- follow-up call two weeks out Done (logEventDone writes the activity on
-- the call's own day) made the contact "touched in the last 7 days" and
-- never "never touched", while Last Contacted By, which skips future
-- rows, still read "—". Now a future-dated activity is left out, and
-- crm_touch_due() picks it up once its time has passed: the lists call it
-- before an Activity filter is used.

CREATE OR REPLACE FUNCTION crm_touch_contacts(ids text[]) RETURNS void LANGUAGE sql AS $$
  UPDATE "Contact" c SET "lastTouchAt" = t.at
    FROM (SELECT x.id, (SELECT max(a."occurredAt") FROM "Activity" a
                         WHERE a."contactId" = x.id AND a.marketing = false AND a."occurredAt" <= now()) AS at
            FROM unnest(ids) AS x(id)) t
   WHERE c.id = t.id AND c."lastTouchAt" IS DISTINCT FROM t.at;
$$;

CREATE OR REPLACE FUNCTION crm_touch_companies(ids text[]) RETURNS void LANGUAGE sql AS $$
  UPDATE "Company" co SET "lastTouchAt" = t.at
    FROM (SELECT x.id, GREATEST(
            (SELECT max(a."occurredAt") FROM "Activity" a
              WHERE a."companyId" = x.id AND a.marketing = false AND a."occurredAt" <= now()),
            (SELECT max(p."lastTouchAt") FROM "Contact" p WHERE p."companyId" = x.id)) AS at
            FROM unnest(ids) AS x(id)) t
   WHERE co.id = t.id AND co."lastTouchAt" IS DISTINCT FROM t.at;
$$;

-- Activities written dated ahead of when they were written: the only ones
-- that can come due later. Small, so the catch-up below is cheap.
CREATE INDEX "Activity_dated_ahead_idx" ON "Activity"("organizationId", "occurredAt")
  WHERE "occurredAt" > "createdAt" AND marketing = false;

-- The people and companies with a touch that has come due since it was
-- written and isn't on the row yet.
CREATE OR REPLACE FUNCTION crm_touch_due(org text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM crm_touch_contacts(ARRAY(
    SELECT DISTINCT a."contactId" FROM "Activity" a JOIN "Contact" c ON c.id = a."contactId"
     WHERE a."organizationId" = org AND a."occurredAt" > a."createdAt" AND a.marketing = false
       AND a."occurredAt" <= now() AND (c."lastTouchAt" IS NULL OR c."lastTouchAt" < a."occurredAt")));
  PERFORM crm_touch_companies(ARRAY(
    SELECT DISTINCT a."companyId" FROM "Activity" a JOIN "Company" co ON co.id = a."companyId"
     WHERE a."organizationId" = org AND a."occurredAt" > a."createdAt" AND a.marketing = false
       AND a."occurredAt" <= now() AND (co."lastTouchAt" IS NULL OR co."lastTouchAt" < a."occurredAt")));
END $$;

-- Rows already carrying a future touch get their real last touch back.
SELECT crm_touch_contacts(ARRAY(SELECT id FROM "Contact" WHERE "lastTouchAt" > now()));
SELECT crm_touch_companies(ARRAY(SELECT id FROM "Company" WHERE "lastTouchAt" > now()));
