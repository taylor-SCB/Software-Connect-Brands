-- Companies + Contacts v1.
--
-- Safe for rows that already exist:
--   * every distinct typed-in Contact.company becomes a Company row and the
--     contact is linked to it before the text column goes away;
--   * every quote that has no deal gets one, named after the quote, so the
--     new "a quote always belongs to a deal" rule holds from the first
--     request after deploy;
--   * the NEW pipeline stage is renamed LEAD in place.

-- CreateEnum
CREATE TYPE "NoteLabel" AS ENUM ('GENERAL', 'PERSONAL', 'BIRTHDAY', 'HOBBIES', 'FAMILY');

-- AlterEnum: NEW -> LEAD, plus the two paperwork stages.
BEGIN;
CREATE TYPE "DealStage_new" AS ENUM ('LEAD', 'CONTACTED', 'QUOTE_SENT', 'CONTRACT_SENT', 'WON', 'LOST');
ALTER TABLE "Deal" ALTER COLUMN "stage" DROP DEFAULT;
ALTER TABLE "Deal" ALTER COLUMN "stage" TYPE "DealStage_new"
  USING (CASE WHEN "stage"::text = 'NEW' THEN 'LEAD' ELSE "stage"::text END)::"DealStage_new";
ALTER TYPE "DealStage" RENAME TO "DealStage_old";
ALTER TYPE "DealStage_new" RENAME TO "DealStage";
DROP TYPE "DealStage_old";
ALTER TABLE "Deal" ALTER COLUMN "stage" SET DEFAULT 'LEAD';
COMMIT;

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "city" TEXT,
    "state" TEXT,
    "status" "ContactStatus" NOT NULL DEFAULT 'LEAD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Company_organizationId_idx" ON "Company"("organizationId");
CREATE INDEX "Company_organizationId_name_idx" ON "Company"("organizationId", "name");
ALTER TABLE "Company" ADD CONSTRAINT "Company_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: Contact gains its new fields, keeps the text column for now.
ALTER TABLE "Contact"
  ADD COLUMN "birthday" DATE,
  ADD COLUMN "city" TEXT,
  ADD COLUMN "companyId" TEXT,
  ADD COLUMN "state" TEXT,
  ADD COLUMN "title" TEXT;

-- Backfill: one Company per distinct (workspace, trimmed name). A
-- contact's website was really the company's, so it moves across too,
-- and the company inherits the best status among its people.
INSERT INTO "Company" ("id", "organizationId", "name", "website", "status", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  s."organizationId",
  s."name",
  (SELECT c."website" FROM "Contact" c
     WHERE c."organizationId" = s."organizationId" AND btrim(c."company") = s."name" AND c."website" IS NOT NULL
     ORDER BY c."createdAt" LIMIT 1),
  CASE
    WHEN EXISTS (SELECT 1 FROM "Contact" c WHERE c."organizationId" = s."organizationId" AND btrim(c."company") = s."name" AND c."status" = 'CUSTOMER') THEN 'CUSTOMER'::"ContactStatus"
    WHEN EXISTS (SELECT 1 FROM "Contact" c WHERE c."organizationId" = s."organizationId" AND btrim(c."company") = s."name" AND c."status" = 'LEAD') THEN 'LEAD'::"ContactStatus"
    ELSE 'ARCHIVED'::"ContactStatus"
  END,
  (SELECT MIN(c."createdAt") FROM "Contact" c WHERE c."organizationId" = s."organizationId" AND btrim(c."company") = s."name"),
  CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT "organizationId", btrim("company") AS "name"
  FROM "Contact"
  WHERE "company" IS NOT NULL AND btrim("company") <> ''
) s;

UPDATE "Contact" c
SET "companyId" = co."id"
FROM "Company" co
WHERE co."organizationId" = c."organizationId"
  AND c."company" IS NOT NULL
  AND btrim(c."company") = co."name";

ALTER TABLE "Contact" DROP COLUMN "company";

CREATE INDEX "Contact_companyId_idx" ON "Contact"("companyId");
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: notes and activity can sit on a company, and can be batched.
ALTER TABLE "Activity"
  ADD COLUMN "batchId" TEXT,
  ADD COLUMN "companyId" TEXT,
  ALTER COLUMN "contactId" DROP NOT NULL;

ALTER TABLE "Note"
  ADD COLUMN "batchId" TEXT,
  ADD COLUMN "companyId" TEXT,
  ADD COLUMN "label" "NoteLabel",
  ALTER COLUMN "contactId" DROP NOT NULL;

CREATE INDEX "Activity_companyId_idx" ON "Activity"("companyId");
CREATE INDEX "Activity_batchId_idx" ON "Activity"("batchId");
CREATE INDEX "Note_companyId_idx" ON "Note"("companyId");
CREATE INDEX "Note_batchId_idx" ON "Note"("batchId");
ALTER TABLE "Note" ADD CONSTRAINT "Note_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: every quote belongs to a deal. Existing quotes each get a
-- deal named after them, at the stage their status implies.
ALTER TABLE "Quote" ADD COLUMN "dealId" TEXT;
ALTER TABLE "Deal" ADD COLUMN "_fromQuoteId" TEXT;

INSERT INTO "Deal" ("id", "organizationId", "contactId", "title", "valueCents", "stage", "createdAt", "updatedAt", "_fromQuoteId")
SELECT
  gen_random_uuid()::text,
  q."organizationId",
  q."contactId",
  q."title",
  0,
  CASE q."status"::text
    WHEN 'SENT' THEN 'QUOTE_SENT'::"DealStage"
    WHEN 'ACCEPTED' THEN 'WON'::"DealStage"
    WHEN 'DECLINED' THEN 'LOST'::"DealStage"
    ELSE 'LEAD'::"DealStage"
  END,
  q."createdAt",
  CURRENT_TIMESTAMP,
  q."id"
FROM "Quote" q
WHERE q."dealId" IS NULL;

UPDATE "Quote" q SET "dealId" = d."id" FROM "Deal" d WHERE d."_fromQuoteId" = q."id";

ALTER TABLE "Deal" DROP COLUMN "_fromQuoteId";
ALTER TABLE "Quote" ALTER COLUMN "dealId" SET NOT NULL;

CREATE INDEX "Quote_dealId_idx" ON "Quote"("dealId");
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: a contract may point at a deal.
ALTER TABLE "Contract" ADD COLUMN "dealId" TEXT;
CREATE INDEX "Contract_dealId_idx" ON "Contract"("dealId");
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
