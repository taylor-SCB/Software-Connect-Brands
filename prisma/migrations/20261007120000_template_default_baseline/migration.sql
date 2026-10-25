-- AlterTable
ALTER TABLE "ContractTemplate" ADD COLUMN     "baseline" TEXT,
ADD COLUMN     "isDefault" BOOLEAN NOT NULL DEFAULT false;

-- The six built-ins every workspace was given at signup still carry their
-- original name and type unless someone renamed them; those are the ones
-- "Restore the original" can put back.
UPDATE "ContractTemplate"
SET "baseline" = "name"
WHERE "name" = "type"
  AND "name" IN ('Service Agreement', 'Change Order', 'Purchase Order', 'Sales Order', 'Invoice', 'Compliance Agreement');

-- The oldest template of each type is the one the app has been picking
-- (findFirst with no order fell to the oldest row), so it stays the one.
UPDATE "ContractTemplate" t
SET "isDefault" = true
FROM (
  SELECT DISTINCT ON ("organizationId", "type") "id"
  FROM "ContractTemplate"
  ORDER BY "organizationId", "type", "createdAt" ASC, "id" ASC
) first
WHERE t."id" = first."id";
