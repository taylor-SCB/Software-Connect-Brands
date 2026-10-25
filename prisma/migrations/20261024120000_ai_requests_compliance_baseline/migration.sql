-- CreateTable
CREATE TABLE "AiRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiRequest_organizationId_kind_createdAt_idx" ON "AiRequest"("organizationId", "kind", "createdAt");

-- AddForeignKey
ALTER TABLE "AiRequest" ADD CONSTRAINT "AiRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiRequest" ADD CONSTRAINT "AiRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The Oct 7 backfill matched built-ins by name = type, and the built-in
-- Compliance Agreement is the one whose type differs ("Compliance"), so
-- in every workspace that already existed it would have had no "Restore
-- the original". New workspaces get it at signup.
UPDATE "ContractTemplate"
SET "baseline" = 'Compliance Agreement'
WHERE "baseline" IS NULL
  AND "name" = 'Compliance Agreement'
  AND "type" = 'Compliance';
