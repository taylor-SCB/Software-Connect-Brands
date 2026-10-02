-- A deal's rep. Nullable, so every existing row is valid the moment the
-- column exists; the backfill below then names one.
ALTER TABLE "Deal" ADD COLUMN "ownerId" TEXT;

ALTER TABLE "Deal" ADD CONSTRAINT "Deal_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Deal_ownerId_idx" ON "Deal"("ownerId");

-- Existing deals: the lead sales rep on their newest quote that has one...
UPDATE "Deal" d
SET "ownerId" = q."leadSalesRepId"
FROM (
  SELECT DISTINCT ON ("dealId") "dealId", "leadSalesRepId"
  FROM "Quote"
  WHERE "leadSalesRepId" IS NOT NULL
  ORDER BY "dealId", "createdAt" DESC
) q
WHERE q."dealId" = d."id" AND d."ownerId" IS NULL;

-- ...otherwise the workspace's first owner.
UPDATE "Deal" d
SET "ownerId" = (
  SELECT u."id" FROM "User" u
  WHERE u."organizationId" = d."organizationId" AND u."role" = 'OWNER'
  ORDER BY u."createdAt" ASC
  LIMIT 1
)
WHERE d."ownerId" IS NULL;
