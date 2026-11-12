-- Release B of the AI release (Nov 12, 2026): AI answers kept by fingerprint,
-- the customer's marked-up copies on a contract, and what a compliance file
-- says. New tables only, so existing rows are untouched.
-- CreateTable
CREATE TABLE "AiAnswer" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "body" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractFile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "purpose" TEXT NOT NULL DEFAULT 'REDLINE',
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL DEFAULT '\x',
    "complete" BOOLEAN NOT NULL DEFAULT false,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceInfo" (
    "uploadId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "crewId" TEXT,
    "namedInsured" TEXT,
    "insurer" TEXT,
    "policyNumber" TEXT,
    "limits" JSONB NOT NULL DEFAULT '[]',
    "readByAi" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceInfo_pkey" PRIMARY KEY ("uploadId")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiAnswer_organizationId_kind_key_key" ON "AiAnswer"("organizationId", "kind", "key");

-- CreateIndex
CREATE INDEX "ContractFile_contractId_createdAt_idx" ON "ContractFile"("contractId", "createdAt");

-- CreateIndex
CREATE INDEX "ContractFile_groupId_idx" ON "ContractFile"("groupId");

-- CreateIndex
CREATE INDEX "ComplianceInfo_organizationId_crewId_idx" ON "ComplianceInfo"("organizationId", "crewId");

-- CreateIndex
CREATE INDEX "ComplianceInfo_crewId_idx" ON "ComplianceInfo"("crewId");

-- AddForeignKey
ALTER TABLE "AiAnswer" ADD CONSTRAINT "AiAnswer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractFile" ADD CONSTRAINT "ContractFile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractFile" ADD CONSTRAINT "ContractFile_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractFile" ADD CONSTRAINT "ContractFile_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceInfo" ADD CONSTRAINT "ComplianceInfo_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "Upload"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceInfo" ADD CONSTRAINT "ComplianceInfo_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceInfo" ADD CONSTRAINT "ComplianceInfo_crewId_fkey" FOREIGN KEY ("crewId") REFERENCES "Crew"("id") ON DELETE CASCADE ON UPDATE CASCADE;

