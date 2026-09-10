-- Contracts v1.
--
-- Safe for rows that already exist:
--   * a template's or contract's type is converted in place from the old
--     enum to its label ("SERVICE_AGREEMENT" -> "Service Agreement"), so
--     nothing is dropped and every list keeps reading the same;
--   * every existing workspace gets the three built-in type options it had
--     before, so its Type dropdown is not empty after deploy;
--   * new columns all have defaults (everyone can send; no quote linked).

-- Contract.type: enum -> text label, in place.
ALTER TABLE "Contract" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "Contract" ALTER COLUMN "type" TYPE TEXT
  USING (CASE "type"::text
           WHEN 'SERVICE_AGREEMENT' THEN 'Service Agreement'
           WHEN 'CHANGE_ORDER' THEN 'Change Order'
           ELSE 'Custom'
         END);
ALTER TABLE "Contract" ALTER COLUMN "type" SET DEFAULT 'Custom';

-- ContractTemplate.type: same conversion.
ALTER TABLE "ContractTemplate" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "ContractTemplate" ALTER COLUMN "type" TYPE TEXT
  USING (CASE "type"::text
           WHEN 'SERVICE_AGREEMENT' THEN 'Service Agreement'
           WHEN 'CHANGE_ORDER' THEN 'Change Order'
           ELSE 'Custom'
         END);
ALTER TABLE "ContractTemplate" ALTER COLUMN "type" SET DEFAULT 'Custom';

-- DropEnum
DROP TYPE "ContractType";

-- AlterTable: the quote whose numbers filled the merge fields.
ALTER TABLE "Contract" ADD COLUMN "quoteId" TEXT;

-- AlterTable: who can send.
ALTER TABLE "ContractTemplate" ADD COLUMN "allUsersCanSend" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "senderUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "ContractTypeOption" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractTypeOption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContractTypeOption_organizationId_idx" ON "ContractTypeOption"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ContractTypeOption_organizationId_name_key" ON "ContractTypeOption"("organizationId", "name");

-- CreateIndex
CREATE INDEX "Contract_quoteId_idx" ON "Contract"("quoteId");

-- AddForeignKey
ALTER TABLE "ContractTypeOption" ADD CONSTRAINT "ContractTypeOption_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed: every existing workspace starts with the same three types it had
-- as an enum. Ids are derived from the workspace + name so re-running is
-- harmless. Types a workspace already uses on a template but that are not
-- in this list (none today) are added too, so no template points at a
-- type its dropdown can't show.
INSERT INTO "ContractTypeOption" ("id", "organizationId", "name")
SELECT 'cto_' || md5(o."id" || ':' || t."name"), o."id", t."name"
FROM "Organization" o
CROSS JOIN (VALUES ('Service Agreement'), ('Change Order'), ('Custom')) AS t("name")
ON CONFLICT ("organizationId", "name") DO NOTHING;

INSERT INTO "ContractTypeOption" ("id", "organizationId", "name")
SELECT DISTINCT 'cto_' || md5(tp."organizationId" || ':' || tp."type"), tp."organizationId", tp."type"
FROM "ContractTemplate" tp
ON CONFLICT ("organizationId", "name") DO NOTHING;
