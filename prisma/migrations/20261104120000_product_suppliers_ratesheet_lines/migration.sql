-- Release 3a (Nov 4, 2026): a product's suppliers as rows of their own,
-- one of them starred; every product row of an imported sheet kept; a
-- sheet's COGS discount and required minimum markup. Every new column has
-- a default or is nullable, and the backfill below changes no product.


-- AlterTable
ALTER TABLE "LinkedRatesheet" ADD COLUMN     "discountBp" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lineCount" INTEGER,
ADD COLUMN     "linesStoredAt" TIMESTAMP(3),
ADD COLUMN     "minMarkupBp" INTEGER,
ADD COLUMN     "savingAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ProductSupplier" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "distributorId" TEXT NOT NULL,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "discountBp" INTEGER NOT NULL DEFAULT 0,
    "listPriceCents" INTEGER,
    "minMarginBp" INTEGER,
    "preferredFor" TEXT,
    "linkedRatesheetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductSupplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RatesheetLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "linkedRatesheetId" TEXT NOT NULL,
    "rowKey" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "manufacturer" TEXT,
    "defaultTag" "LineItemTag" NOT NULL DEFAULT 'MATERIALS',
    "unitOfMeasure" "UnitOfMeasure",
    "costCents" INTEGER,
    "listPriceCents" INTEGER,
    "sellCents" INTEGER,
    "productId" TEXT,

    CONSTRAINT "RatesheetLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductSupplier_preferredFor_key" ON "ProductSupplier"("preferredFor");

-- CreateIndex
CREATE INDEX "ProductSupplier_organizationId_idx" ON "ProductSupplier"("organizationId");

-- CreateIndex
CREATE INDEX "ProductSupplier_distributorId_idx" ON "ProductSupplier"("distributorId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductSupplier_productId_distributorId_key" ON "ProductSupplier"("productId", "distributorId");

-- CreateIndex
CREATE INDEX "RatesheetLine_linkedRatesheetId_position_idx" ON "RatesheetLine"("linkedRatesheetId", "position");

-- CreateIndex
CREATE INDEX "RatesheetLine_productId_idx" ON "RatesheetLine"("productId");

-- CreateIndex
CREATE INDEX "RatesheetLine_organizationId_idx" ON "RatesheetLine"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "RatesheetLine_linkedRatesheetId_rowKey_key" ON "RatesheetLine"("linkedRatesheetId", "rowKey");

-- AddForeignKey
ALTER TABLE "ProductSupplier" ADD CONSTRAINT "ProductSupplier_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSupplier" ADD CONSTRAINT "ProductSupplier_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSupplier" ADD CONSTRAINT "ProductSupplier_distributorId_fkey" FOREIGN KEY ("distributorId") REFERENCES "Distributor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSupplier" ADD CONSTRAINT "ProductSupplier_linkedRatesheetId_fkey" FOREIGN KEY ("linkedRatesheetId") REFERENCES "LinkedRatesheet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RatesheetLine" ADD CONSTRAINT "RatesheetLine_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RatesheetLine" ADD CONSTRAINT "RatesheetLine_linkedRatesheetId_fkey" FOREIGN KEY ("linkedRatesheetId") REFERENCES "LinkedRatesheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RatesheetLine" ADD CONSTRAINT "RatesheetLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Every product that has a supplier today gets that supplier as its one,
-- starred, supplier row: their price is the product's COGS as it stands,
-- no discount, its MSRP. The product itself is untouched.
INSERT INTO "ProductSupplier" ("id", "organizationId", "productId", "distributorId", "costCents", "discountBp", "listPriceCents", "preferredFor", "createdAt", "updatedAt")
SELECT 'ps_' || md5(p."id" || ':' || p."distributorId"), p."organizationId", p."id", p."distributorId", p."costCents", 0, p."listPriceCents", p."id", p."createdAt", CURRENT_TIMESTAMP
  FROM "Product" p
  JOIN "Distributor" d ON d."id" = p."distributorId" AND d."organizationId" = p."organizationId";
