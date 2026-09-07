-- CreateEnum
CREATE TYPE "OrganizationStatus" AS ENUM ('PENDING', 'ACTIVE', 'PAUSED', 'REJECTED');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "status" "OrganizationStatus" NOT NULL DEFAULT 'PENDING';

-- Workspaces that predate the approval gate were created when signup was
-- open, so they are already in use. Leaving them on the PENDING default
-- would lock out every existing customer -- including the operator's own
-- workspace -- the moment this deploys.
UPDATE "Organization" SET "status" = 'ACTIVE', "reviewedAt" = "createdAt";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastLoginAt" TIMESTAMP(3),
ADD COLUMN     "phone" TEXT;

-- CreateIndex
CREATE INDEX "Organization_status_idx" ON "Organization"("status");
