-- Release 2 (Oct 25, 2026): account types, type change requests, and a
-- supplier record's link to an account on Software Connect Brands.
-- Every new column is nullable or has a default, so existing rows are
-- valid as they stand: every workspace that exists today is a Business /
-- Vendor, made by a signup, and no supplier is linked yet.


-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('BUSINESS', 'DISTRIBUTOR', 'HARDWARE_OEM', 'SOFTWARE_PROVIDER');

-- CreateEnum
CREATE TYPE "AccountTypeRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Distributor" ADD COLUMN     "platformLinkedAs" TEXT,
ADD COLUMN     "platformLinkedAt" TIMESTAMP(3),
ADD COLUMN     "platformOrganizationId" TEXT;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "accountType" "AccountType" NOT NULL DEFAULT 'BUSINESS',
ADD COLUMN     "createdById" TEXT;

-- CreateTable
CREATE TABLE "AccountTypeRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requestedById" TEXT,
    "fromType" "AccountType" NOT NULL,
    "toType" "AccountType" NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "status" "AccountTypeRequestStatus" NOT NULL DEFAULT 'PENDING',
    "openFor" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountTypeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccountTypeRequest_openFor_key" ON "AccountTypeRequest"("openFor");

-- CreateIndex
CREATE INDEX "AccountTypeRequest_organizationId_createdAt_idx" ON "AccountTypeRequest"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AccountTypeRequest_status_createdAt_idx" ON "AccountTypeRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Distributor_platformOrganizationId_idx" ON "Distributor"("platformOrganizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Distributor_organizationId_platformOrganizationId_key" ON "Distributor"("organizationId", "platformOrganizationId");

-- CreateIndex
CREATE INDEX "Organization_accountType_status_idx" ON "Organization"("accountType", "status");

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountTypeRequest" ADD CONSTRAINT "AccountTypeRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountTypeRequest" ADD CONSTRAINT "AccountTypeRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountTypeRequest" ADD CONSTRAINT "AccountTypeRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Distributor" ADD CONSTRAINT "Distributor_platformOrganizationId_fkey" FOREIGN KEY ("platformOrganizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

