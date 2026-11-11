-- Clean CRM data (Nov 10, 2026): Retire on the CRM Labels screen, and the
-- indexes the Rep / Added by / Added / Activity filters read, and the last
-- touch kept by triggers (below). Every new column is nullable.
-- (Prisma offered to drop the hand-made Contact_mobile_trgm_idx; that line
-- is taken out, as for every hand-made trigram index.)

-- AlterTable
ALTER TABLE "CompanyTypeOption" ADD COLUMN     "retiredAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "IndustryOption" ADD COLUMN     "retiredAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "LeadLabelOption" ADD COLUMN     "retiredAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Activity_contactId_marketing_occurredAt_idx" ON "Activity"("contactId", "marketing", "occurredAt");

-- CreateIndex
CREATE INDEX "Company_organizationId_ownerId_idx" ON "Company"("organizationId", "ownerId");

-- CreateIndex
CREATE INDEX "Company_organizationId_createdById_idx" ON "Company"("organizationId", "createdById");

-- CreateIndex
CREATE INDEX "Company_organizationId_createdAt_idx" ON "Company"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "Contact_organizationId_ownerId_idx" ON "Contact"("organizationId", "ownerId");

-- CreateIndex
CREATE INDEX "Contact_organizationId_createdById_idx" ON "Contact"("organizationId", "createdById");

-- CreateIndex
CREATE INDEX "Contact_organizationId_createdAt_idx" ON "Contact"("organizationId", "createdAt");

-- ---------------------------------------------------------------------
-- Last touch on contacts and companies, for the lists' Activity filter
-- (touched / not touched in 7, 30, 90 days, never). A company is touched
-- when it or any of its people is, and that OR can't be answered fast at
-- 200,000 contacts from Activity itself (3.4 s for a page), so the latest
-- touch is kept on the row by the triggers below and the filter is an
-- indexed range. A touch is any Activity that is not a marketing send.

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN "lastTouchAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Company" ADD COLUMN "lastTouchAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Contact_organizationId_lastTouchAt_idx" ON "Contact"("organizationId", "lastTouchAt");

-- CreateIndex
CREATE INDEX "Company_organizationId_lastTouchAt_idx" ON "Company"("organizationId", "lastTouchAt");

-- Backfill, before the triggers exist.
UPDATE "Contact" c SET "lastTouchAt" = t.at
  FROM (SELECT "contactId", max("occurredAt") AS at FROM "Activity"
         WHERE marketing = false AND "contactId" IS NOT NULL GROUP BY "contactId") t
 WHERE c.id = t."contactId";

UPDATE "Company" co SET "lastTouchAt" = t.at
  FROM (SELECT id, max(at) AS at FROM (
          SELECT "companyId" AS id, max("occurredAt") AS at FROM "Activity"
           WHERE marketing = false AND "companyId" IS NOT NULL GROUP BY "companyId"
          UNION ALL
          SELECT "companyId", max("lastTouchAt") FROM "Contact"
           WHERE "companyId" IS NOT NULL AND "lastTouchAt" IS NOT NULL GROUP BY "companyId"
        ) u GROUP BY id) t
 WHERE co.id = t.id;

-- Recompute the given contacts' / companies' last touch, set-based.
CREATE OR REPLACE FUNCTION crm_touch_contacts(ids text[]) RETURNS void LANGUAGE sql AS $$
  UPDATE "Contact" c SET "lastTouchAt" = t.at
    FROM (SELECT x.id, (SELECT max(a."occurredAt") FROM "Activity" a
                         WHERE a."contactId" = x.id AND a.marketing = false) AS at
            FROM unnest(ids) AS x(id)) t
   WHERE c.id = t.id AND c."lastTouchAt" IS DISTINCT FROM t.at;
$$;

CREATE OR REPLACE FUNCTION crm_touch_companies(ids text[]) RETURNS void LANGUAGE sql AS $$
  UPDATE "Company" co SET "lastTouchAt" = t.at
    FROM (SELECT x.id, GREATEST(
            (SELECT max(a."occurredAt") FROM "Activity" a WHERE a."companyId" = x.id AND a.marketing = false),
            (SELECT max(p."lastTouchAt") FROM "Contact" p WHERE p."companyId" = x.id)) AS at
            FROM unnest(ids) AS x(id)) t
   WHERE co.id = t.id AND co."lastTouchAt" IS DISTINCT FROM t.at;
$$;

-- An activity written, moved (merge, claim) or deleted.
CREATE OR REPLACE FUNCTION crm_activity_touch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    PERFORM crm_touch_contacts(ARRAY(SELECT DISTINCT "contactId" FROM new_rows WHERE "contactId" IS NOT NULL));
    PERFORM crm_touch_companies(ARRAY(SELECT DISTINCT "companyId" FROM new_rows WHERE "companyId" IS NOT NULL));
  END IF;
  IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
    PERFORM crm_touch_contacts(ARRAY(SELECT DISTINCT "contactId" FROM old_rows WHERE "contactId" IS NOT NULL));
    PERFORM crm_touch_companies(ARRAY(SELECT DISTINCT "companyId" FROM old_rows WHERE "companyId" IS NOT NULL));
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER activity_touch_insert AFTER INSERT ON "Activity"
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_activity_touch();
CREATE TRIGGER activity_touch_update AFTER UPDATE ON "Activity"
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_activity_touch();
CREATE TRIGGER activity_touch_delete AFTER DELETE ON "Activity"
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_activity_touch();

-- A person's last touch changing, a person moving company, or a person
-- deleted: their company (old and new) is worked out again.
CREATE OR REPLACE FUNCTION crm_contact_touch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    PERFORM crm_touch_companies(ARRAY(
      SELECT DISTINCT x FROM (
        SELECT n."companyId" AS x FROM new_rows n JOIN old_rows o ON o.id = n.id
         WHERE n."companyId" IS DISTINCT FROM o."companyId" OR n."lastTouchAt" IS DISTINCT FROM o."lastTouchAt"
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

CREATE TRIGGER contact_touch_update AFTER UPDATE ON "Contact"
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_contact_touch();
CREATE TRIGGER contact_touch_delete AFTER DELETE ON "Contact"
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION crm_contact_touch();
