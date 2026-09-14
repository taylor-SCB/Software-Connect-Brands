-- Projects and budgets: a won job becomes a Project with a budget bar,
-- split into scopes of work by service type. The scope's awarded amount
-- is the sum of its ScopeAward rows, so the history under the bar always
-- explains the number above it (src/lib/projects.ts).
--
-- Safe for rows that already exist: everything here is new tables, new
-- enums, and new columns that are all nullable or defaulted. Nothing is
-- renamed, dropped or rewritten, and no existing row is touched — jobs
-- won before this release simply have no project until someone presses
-- "Create project from this contract".

-- CreateEnum
CREATE TYPE "ProjectStage" AS ENUM ('AWARDED', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AwardKind" AS ENUM ('CONTRACT', 'CHANGE_ORDER', 'CONTRACT_REMOVED', 'QUOTE', 'MANUAL');

-- AlterTable
ALTER TABLE "Contract" ADD COLUMN     "projectId" TEXT;

-- AlterTable
ALTER TABLE "ContractLineItem" ADD COLUMN     "scopeId" TEXT,
ADD COLUMN     "serviceType" TEXT,
ADD COLUMN     "unitCostCents" INTEGER;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "nextProjectNumber" INTEGER NOT NULL DEFAULT 1000;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "serviceType" TEXT;

-- AlterTable
ALTER TABLE "QuoteLineItem" ADD COLUMN     "serviceType" TEXT;

-- CreateTable
CREATE TABLE "ServiceTypeOption" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceTypeOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "stage" "ProjectStage" NOT NULL DEFAULT 'AWARDED',
    "dealId" TEXT,
    "companyId" TEXT,
    "contactId" TEXT,
    "customerName" TEXT NOT NULL,
    "siteAddress" TEXT,
    "awardedAt" TIMESTAMP(3) NOT NULL,
    "awardedOffline" BOOLEAN NOT NULL DEFAULT false,
    "startOn" DATE,
    "closedAt" TIMESTAMP(3),
    "closeOutNote" TEXT,
    "awardedCents" INTEGER NOT NULL DEFAULT 0,
    "spentCents" INTEGER NOT NULL DEFAULT 0,
    "committedCents" INTEGER NOT NULL DEFAULT 0,
    "receivedCents" INTEGER NOT NULL DEFAULT 0,
    "billedCents" INTEGER NOT NULL DEFAULT 0,
    "plannedCostCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectScope" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "serviceType" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "crewLabel" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "awardedCents" INTEGER NOT NULL DEFAULT 0,
    "spentCents" INTEGER NOT NULL DEFAULT 0,
    "committedCents" INTEGER NOT NULL DEFAULT 0,
    "receivedCents" INTEGER NOT NULL DEFAULT 0,
    "billedCents" INTEGER NOT NULL DEFAULT 0,
    "plannedCostCents" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProjectScope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScopeAward" (
    "id" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "kind" "AwardKind" NOT NULL,
    "deltaCents" INTEGER NOT NULL,
    "contractId" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScopeAward_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServiceTypeOption_organizationId_idx" ON "ServiceTypeOption"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceTypeOption_organizationId_name_key" ON "ServiceTypeOption"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Project_dealId_key" ON "Project"("dealId");

-- CreateIndex
CREATE INDEX "Project_organizationId_stage_idx" ON "Project"("organizationId", "stage");

-- CreateIndex
CREATE INDEX "Project_organizationId_updatedAt_idx" ON "Project"("organizationId", "updatedAt");

-- CreateIndex
CREATE INDEX "Project_companyId_idx" ON "Project"("companyId");

-- CreateIndex
CREATE INDEX "Project_contactId_idx" ON "Project"("contactId");

-- CreateIndex
CREATE INDEX "Project_name_trgm_idx" ON "Project" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "Project_organizationId_number_key" ON "Project"("organizationId", "number");

-- CreateIndex
CREATE INDEX "ProjectScope_projectId_idx" ON "ProjectScope"("projectId");

-- CreateIndex
CREATE INDEX "ScopeAward_scopeId_idx" ON "ScopeAward"("scopeId");

-- CreateIndex
CREATE INDEX "ScopeAward_contractId_idx" ON "ScopeAward"("contractId");

-- CreateIndex
CREATE INDEX "Contract_projectId_idx" ON "Contract"("projectId");

-- CreateIndex
CREATE INDEX "ContractLineItem_scopeId_idx" ON "ContractLineItem"("scopeId");

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractLineItem" ADD CONSTRAINT "ContractLineItem_scopeId_fkey" FOREIGN KEY ("scopeId") REFERENCES "ProjectScope"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceTypeOption" ADD CONSTRAINT "ServiceTypeOption_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectScope" ADD CONSTRAINT "ProjectScope_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScopeAward" ADD CONSTRAINT "ScopeAward_scopeId_fkey" FOREIGN KEY ("scopeId") REFERENCES "ProjectScope"("id") ON DELETE CASCADE ON UPDATE CASCADE;
