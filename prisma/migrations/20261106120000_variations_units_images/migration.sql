-- Release 3b (Nov 6, 2026): variation labels, a workspace's own units and
-- product pictures. Additive only: new tables, and nullable columns on
-- Product, QuoteLineItem and ContractLineItem that code from before 3b never
-- reads or writes. No backfill: built-in groups and units are made the first
-- time a workspace opens them, and every existing row prints as it did.
-- CreateEnum
CREATE TYPE "VariationKind" AS ENUM ('UNIT', 'COLOR', 'SIZE', 'CUSTOM');

-- AlterTable
ALTER TABLE "ContractLineItem" ADD COLUMN     "unitLabel" TEXT,
ADD COLUMN     "variationText" TEXT,
ADD COLUMN     "variations" JSONB;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "customUnitId" TEXT;

-- AlterTable
ALTER TABLE "QuoteLineItem" ADD COLUMN     "customUnitId" TEXT,
ADD COLUMN     "imageId" TEXT,
ADD COLUMN     "unitLabel" TEXT,
ADD COLUMN     "variationText" TEXT,
ADD COLUMN     "variations" JSONB;

-- CreateTable
CREATE TABLE "VariationGroup" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" "VariationKind" NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VariationGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VariationOption" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "builtInUnit" "UnitOfMeasure",
    "contains" DOUBLE PRECISION,
    "baseUnit" "UnitOfMeasure",
    "tag" "LineItemTag",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VariationOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariation" (
    "productId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductVariation_pkey" PRIMARY KEY ("productId","optionId")
);

-- CreateTable
CREATE TABLE "ProductImage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT,
    "position" INTEGER,
    "colorOptionId" TEXT,
    "storageKey" TEXT NOT NULL,
    "thumbKey" TEXT NOT NULL,
    "docKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "publicToken" TEXT NOT NULL,
    "removedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VariationGroup_organizationId_position_idx" ON "VariationGroup"("organizationId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "VariationGroup_organizationId_name_key" ON "VariationGroup"("organizationId", "name");

-- CreateIndex
CREATE INDEX "VariationOption_organizationId_idx" ON "VariationOption"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "VariationOption_groupId_name_key" ON "VariationOption"("groupId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "VariationOption_groupId_builtInUnit_key" ON "VariationOption"("groupId", "builtInUnit");

-- CreateIndex
CREATE INDEX "ProductVariation_optionId_idx" ON "ProductVariation"("optionId");

-- CreateIndex
CREATE INDEX "ProductVariation_organizationId_idx" ON "ProductVariation"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductImage_publicToken_key" ON "ProductImage"("publicToken");

-- CreateIndex
CREATE INDEX "ProductImage_storageKey_idx" ON "ProductImage"("storageKey");

-- CreateIndex
CREATE INDEX "ProductImage_organizationId_idx" ON "ProductImage"("organizationId");

-- CreateIndex
CREATE INDEX "ProductImage_colorOptionId_idx" ON "ProductImage"("colorOptionId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductImage_productId_position_key" ON "ProductImage"("productId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "ProductImage_productId_storageKey_key" ON "ProductImage"("productId", "storageKey");

-- CreateIndex
CREATE INDEX "Product_customUnitId_idx" ON "Product"("customUnitId");

-- CreateIndex
CREATE INDEX "QuoteLineItem_customUnitId_idx" ON "QuoteLineItem"("customUnitId");

-- CreateIndex
CREATE INDEX "QuoteLineItem_imageId_idx" ON "QuoteLineItem"("imageId");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_customUnitId_fkey" FOREIGN KEY ("customUnitId") REFERENCES "VariationOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VariationGroup" ADD CONSTRAINT "VariationGroup_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VariationOption" ADD CONSTRAINT "VariationOption_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VariationOption" ADD CONSTRAINT "VariationOption_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "VariationGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariation" ADD CONSTRAINT "ProductVariation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariation" ADD CONSTRAINT "ProductVariation_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "VariationOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariation" ADD CONSTRAINT "ProductVariation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_colorOptionId_fkey" FOREIGN KEY ("colorOptionId") REFERENCES "VariationOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLineItem" ADD CONSTRAINT "QuoteLineItem_customUnitId_fkey" FOREIGN KEY ("customUnitId") REFERENCES "VariationOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLineItem" ADD CONSTRAINT "QuoteLineItem_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "ProductImage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

