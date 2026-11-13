-- The apparel pack (Nov 12, 2026): "We do apparel / custom print".
-- New tables (Artwork, Proof, ProofVersion, ProofPanel, ContractProof), one
-- new enum (ProofStatus) and nullable or defaulted columns on Organization,
-- Quote and QuoteLineItem. No existing value changes, so a build from before
-- it reads every row it knew and Instant Rollback stays safe.
-- CreateEnum
CREATE TYPE "ProofStatus" AS ENUM ('DRAFT', 'SENT', 'APPROVED', 'CHANGES', 'SUPERSEDED');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "apparelOn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "apparelOnAt" TIMESTAMP(3),
ADD COLUMN     "printLocationGroupId" TEXT;

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "proofToken" TEXT;

-- AlterTable
ALTER TABLE "QuoteLineItem" ADD COLUMN     "proofId" TEXT;

-- CreateTable
CREATE TABLE "Artwork" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT,
    "contactId" TEXT,
    "name" TEXT NOT NULL,
    "inkNote" TEXT,
    "previewKey" TEXT NOT NULL,
    "thumbKey" TEXT NOT NULL,
    "checkKey" TEXT NOT NULL,
    "previewType" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "printKey" TEXT,
    "printName" TEXT,
    "printFormat" TEXT,
    "printSize" INTEGER,
    "checkStatus" TEXT,
    "checkNote" TEXT,
    "checkHash" TEXT,
    "removedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Artwork_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Proof" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "quoteId" TEXT,
    "number" INTEGER NOT NULL,
    "productId" TEXT,
    "colorOptionId" TEXT,
    "productName" TEXT NOT NULL,
    "colorLabel" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Proof_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProofVersion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "proofId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "displayKey" TEXT NOT NULL,
    "thumbKey" TEXT NOT NULL,
    "docKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "publicToken" TEXT NOT NULL,
    "status" "ProofStatus" NOT NULL DEFAULT 'DRAFT',
    "copiedFrom" TEXT,
    "sentAt" TIMESTAMP(3),
    "approvedByName" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedOffline" BOOLEAN NOT NULL DEFAULT false,
    "approvedById" TEXT,
    "changesByName" TEXT,
    "changesNote" TEXT,
    "changesAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProofVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProofPanel" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "locationOptionId" TEXT,
    "locationLabel" TEXT NOT NULL,
    "artworkId" TEXT,
    "artworkName" TEXT NOT NULL,
    "inkNote" TEXT,
    "baseImageId" TEXT,
    "baseKind" TEXT NOT NULL,
    "baseColor" TEXT,
    "shownOn" TEXT,
    "placement" JSONB NOT NULL,

    CONSTRAINT "ProofPanel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractProof" (
    "contractId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "covers" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "ContractProof_pkey" PRIMARY KEY ("contractId","versionId")
);

-- CreateIndex
CREATE INDEX "Artwork_organizationId_companyId_idx" ON "Artwork"("organizationId", "companyId");

-- CreateIndex
CREATE INDEX "Artwork_organizationId_contactId_idx" ON "Artwork"("organizationId", "contactId");

-- CreateIndex
CREATE INDEX "Artwork_organizationId_checkHash_idx" ON "Artwork"("organizationId", "checkHash");

-- CreateIndex
CREATE INDEX "Artwork_previewKey_idx" ON "Artwork"("previewKey");

-- CreateIndex
CREATE INDEX "Proof_organizationId_idx" ON "Proof"("organizationId");

-- CreateIndex
CREATE INDEX "Proof_productId_idx" ON "Proof"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "Proof_quoteId_number_key" ON "Proof"("quoteId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "ProofVersion_publicToken_key" ON "ProofVersion"("publicToken");

-- CreateIndex
CREATE INDEX "ProofVersion_organizationId_idx" ON "ProofVersion"("organizationId");

-- CreateIndex
CREATE INDEX "ProofVersion_displayKey_idx" ON "ProofVersion"("displayKey");

-- CreateIndex
CREATE UNIQUE INDEX "ProofVersion_proofId_version_key" ON "ProofVersion"("proofId", "version");

-- CreateIndex
CREATE INDEX "ProofPanel_artworkId_idx" ON "ProofPanel"("artworkId");

-- CreateIndex
CREATE INDEX "ProofPanel_baseImageId_idx" ON "ProofPanel"("baseImageId");

-- CreateIndex
CREATE UNIQUE INDEX "ProofPanel_versionId_position_key" ON "ProofPanel"("versionId", "position");

-- CreateIndex
CREATE INDEX "ContractProof_versionId_idx" ON "ContractProof"("versionId");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_proofToken_key" ON "Quote"("proofToken");

-- CreateIndex
CREATE INDEX "QuoteLineItem_proofId_idx" ON "QuoteLineItem"("proofId");

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_printLocationGroupId_fkey" FOREIGN KEY ("printLocationGroupId") REFERENCES "VariationGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Artwork" ADD CONSTRAINT "Artwork_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Artwork" ADD CONSTRAINT "Artwork_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Artwork" ADD CONSTRAINT "Artwork_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Artwork" ADD CONSTRAINT "Artwork_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proof" ADD CONSTRAINT "Proof_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proof" ADD CONSTRAINT "Proof_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proof" ADD CONSTRAINT "Proof_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proof" ADD CONSTRAINT "Proof_colorOptionId_fkey" FOREIGN KEY ("colorOptionId") REFERENCES "VariationOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proof" ADD CONSTRAINT "Proof_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofVersion" ADD CONSTRAINT "ProofVersion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofVersion" ADD CONSTRAINT "ProofVersion_proofId_fkey" FOREIGN KEY ("proofId") REFERENCES "Proof"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofVersion" ADD CONSTRAINT "ProofVersion_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofVersion" ADD CONSTRAINT "ProofVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofPanel" ADD CONSTRAINT "ProofPanel_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ProofVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofPanel" ADD CONSTRAINT "ProofPanel_locationOptionId_fkey" FOREIGN KEY ("locationOptionId") REFERENCES "VariationOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofPanel" ADD CONSTRAINT "ProofPanel_artworkId_fkey" FOREIGN KEY ("artworkId") REFERENCES "Artwork"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofPanel" ADD CONSTRAINT "ProofPanel_baseImageId_fkey" FOREIGN KEY ("baseImageId") REFERENCES "ProductImage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractProof" ADD CONSTRAINT "ContractProof_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractProof" ADD CONSTRAINT "ContractProof_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ProofVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLineItem" ADD CONSTRAINT "QuoteLineItem_proofId_fkey" FOREIGN KEY ("proofId") REFERENCES "Proof"("id") ON DELETE SET NULL ON UPDATE CASCADE;

