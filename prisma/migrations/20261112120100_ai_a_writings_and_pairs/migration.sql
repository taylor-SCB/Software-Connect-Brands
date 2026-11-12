-- AI release A (Nov 12, 2026): kept AI writing, and "Not the same person".
-- New tables only; nothing existing is touched.
CREATE TABLE "AiWriting" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "body" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiWriting_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AiWriting_organizationId_key_key" ON "AiWriting"("organizationId", "key");
CREATE INDEX "AiWriting_organizationId_updatedAt_idx" ON "AiWriting"("organizationId", "updatedAt");
ALTER TABLE "AiWriting" ADD CONSTRAINT "AiWriting_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "DuplicateDismissal" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "aId" TEXT NOT NULL,
    "bId" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DuplicateDismissal_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DuplicateDismissal_organizationId_kind_aId_bId_key" ON "DuplicateDismissal"("organizationId", "kind", "aId", "bId");
CREATE INDEX "DuplicateDismissal_organizationId_kind_bId_idx" ON "DuplicateDismissal"("organizationId", "kind", "bId");
ALTER TABLE "DuplicateDismissal" ADD CONSTRAINT "DuplicateDismissal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
