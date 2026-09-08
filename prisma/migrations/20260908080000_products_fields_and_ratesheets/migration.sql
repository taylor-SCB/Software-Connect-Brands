-- CreateEnum
CREATE TYPE "UnitOfMeasure" AS ENUM ('PER_HOUR', 'PER_DAY', 'PER_PERSON_PER_HOUR', 'PER_PERSON_PER_DAY', 'PER_ROOM', 'PER_BUILDING', 'PER_PROPERTY', 'EACH', 'PER_PIECE', 'PER_SQFT', 'PER_LINEAR_FT', 'PER_CUBIC_YARD', 'PER_ITEM', 'PER_GALLON', 'PER_POUND', 'PER_UNIT', 'PER_BED', 'PER_LOCATION', 'PER_DEVICE');

-- CreateEnum
CREATE TYPE "SoftwareRate" AS ENUM ('PER_MONTH', 'PER_YEAR', 'PER_TERM');

-- CreateEnum
CREATE TYPE "RatesheetVisibility" AS ENUM ('PUBLIC', 'INVITE_APPROVE', 'PARTNER_SPECIFIC');

-- CreateEnum
CREATE TYPE "RatesheetInviteStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "costCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "distributorId" TEXT,
ADD COLUMN     "manufacturerId" TEXT,
ADD COLUMN     "softwareRate" "SoftwareRate",
ADD COLUMN     "softwareTerm" INTEGER,
ADD COLUMN     "unitOfMeasure" "UnitOfMeasure";

-- CreateTable
CREATE TABLE "Manufacturer" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Manufacturer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Distributor" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Distributor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DistributorContact" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "distributorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DistributorContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ratesheet" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "visibility" "RatesheetVisibility" NOT NULL DEFAULT 'PUBLIC',
    "expiresOn" TIMESTAMP(3),
    "respondWithinDays" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "publicToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ratesheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RatesheetItem" (
    "id" TEXT NOT NULL,
    "ratesheetId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RatesheetItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RatesheetInvite" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ratesheetId" TEXT NOT NULL,
    "partnerEmail" TEXT NOT NULL,
    "partnerName" TEXT,
    "token" TEXT NOT NULL,
    "status" "RatesheetInviteStatus" NOT NULL DEFAULT 'PENDING',
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondBy" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RatesheetInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LinkedRatesheet" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LinkedRatesheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_DistributorContactToProduct" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_DistributorContactToProduct_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "Manufacturer_organizationId_idx" ON "Manufacturer"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Manufacturer_organizationId_name_key" ON "Manufacturer"("organizationId", "name");

-- CreateIndex
CREATE INDEX "Distributor_organizationId_idx" ON "Distributor"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Distributor_organizationId_name_key" ON "Distributor"("organizationId", "name");

-- CreateIndex
CREATE INDEX "DistributorContact_organizationId_idx" ON "DistributorContact"("organizationId");

-- CreateIndex
CREATE INDEX "DistributorContact_distributorId_idx" ON "DistributorContact"("distributorId");

-- CreateIndex
CREATE UNIQUE INDEX "Ratesheet_publicToken_key" ON "Ratesheet"("publicToken");

-- CreateIndex
CREATE INDEX "Ratesheet_organizationId_idx" ON "Ratesheet"("organizationId");

-- CreateIndex
CREATE INDEX "Ratesheet_visibility_active_idx" ON "Ratesheet"("visibility", "active");

-- CreateIndex
CREATE INDEX "RatesheetItem_ratesheetId_idx" ON "RatesheetItem"("ratesheetId");

-- CreateIndex
CREATE INDEX "RatesheetItem_productId_idx" ON "RatesheetItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "RatesheetItem_ratesheetId_productId_key" ON "RatesheetItem"("ratesheetId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "RatesheetInvite_token_key" ON "RatesheetInvite"("token");

-- CreateIndex
CREATE INDEX "RatesheetInvite_organizationId_status_idx" ON "RatesheetInvite"("organizationId", "status");

-- CreateIndex
CREATE INDEX "RatesheetInvite_ratesheetId_idx" ON "RatesheetInvite"("ratesheetId");

-- CreateIndex
CREATE INDEX "LinkedRatesheet_organizationId_idx" ON "LinkedRatesheet"("organizationId");

-- CreateIndex
CREATE INDEX "_DistributorContactToProduct_B_index" ON "_DistributorContactToProduct"("B");

-- CreateIndex
CREATE INDEX "Product_manufacturerId_idx" ON "Product"("manufacturerId");

-- CreateIndex
CREATE INDEX "Product_distributorId_idx" ON "Product"("distributorId");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_manufacturerId_fkey" FOREIGN KEY ("manufacturerId") REFERENCES "Manufacturer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_distributorId_fkey" FOREIGN KEY ("distributorId") REFERENCES "Distributor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Manufacturer" ADD CONSTRAINT "Manufacturer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Distributor" ADD CONSTRAINT "Distributor_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DistributorContact" ADD CONSTRAINT "DistributorContact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DistributorContact" ADD CONSTRAINT "DistributorContact_distributorId_fkey" FOREIGN KEY ("distributorId") REFERENCES "Distributor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ratesheet" ADD CONSTRAINT "Ratesheet_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RatesheetItem" ADD CONSTRAINT "RatesheetItem_ratesheetId_fkey" FOREIGN KEY ("ratesheetId") REFERENCES "Ratesheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RatesheetItem" ADD CONSTRAINT "RatesheetItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RatesheetInvite" ADD CONSTRAINT "RatesheetInvite_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RatesheetInvite" ADD CONSTRAINT "RatesheetInvite_ratesheetId_fkey" FOREIGN KEY ("ratesheetId") REFERENCES "Ratesheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinkedRatesheet" ADD CONSTRAINT "LinkedRatesheet_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_DistributorContactToProduct" ADD CONSTRAINT "_DistributorContactToProduct_A_fkey" FOREIGN KEY ("A") REFERENCES "DistributorContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_DistributorContactToProduct" ADD CONSTRAINT "_DistributorContactToProduct_B_fkey" FOREIGN KEY ("B") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
