-- Release C (Nov 12, 2026): site-walk photos on quotes, stored photo tag
-- suggestions, the close-out photo report and receipts. New tables and one
-- nullable column only; safe for every row that already exists.

-- CreateEnum
CREATE TYPE "ReceiptStatus" AS ENUM ('PENDING', 'APPROVED');

-- AlterTable
ALTER TABLE "Upload" ADD COLUMN     "quoteId" TEXT;

-- CreateTable
CREATE TABLE "PhotoTagSuggestion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "typeTagId" TEXT,
    "locationTagId" TEXT,
    "newKind" "PhotoTagKind",
    "newName" TEXT,
    "failed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhotoTagSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhotoReport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "pairs" JSONB NOT NULL DEFAULT '[]',
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "sharedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhotoReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobReceipt" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" "ReceiptStatus" NOT NULL DEFAULT 'PENDING',
    "uploadId" TEXT,
    "storeName" TEXT NOT NULL DEFAULT '',
    "purchasedOn" DATE,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "taxCents" INTEGER NOT NULL DEFAULT 0,
    "items" JSONB NOT NULL DEFAULT '[]',
    "aiRead" BOOLEAN NOT NULL DEFAULT false,
    "sentByName" TEXT,
    "photoLinkId" TEXT,
    "contractId" TEXT,
    "createdById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PhotoTagSuggestion_uploadId_key" ON "PhotoTagSuggestion"("uploadId");

-- CreateIndex
CREATE INDEX "PhotoTagSuggestion_organizationId_idx" ON "PhotoTagSuggestion"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PhotoReport_projectId_key" ON "PhotoReport"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "PhotoReport_token_key" ON "PhotoReport"("token");

-- CreateIndex
CREATE INDEX "PhotoReport_organizationId_idx" ON "PhotoReport"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "JobReceipt_uploadId_key" ON "JobReceipt"("uploadId");

-- CreateIndex
CREATE UNIQUE INDEX "JobReceipt_contractId_key" ON "JobReceipt"("contractId");

-- CreateIndex
CREATE INDEX "JobReceipt_projectId_status_idx" ON "JobReceipt"("projectId", "status");

-- CreateIndex
CREATE INDEX "JobReceipt_organizationId_idx" ON "JobReceipt"("organizationId");

-- CreateIndex
CREATE INDEX "Upload_quoteId_idx" ON "Upload"("quoteId");

-- AddForeignKey
ALTER TABLE "Upload" ADD CONSTRAINT "Upload_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoTagSuggestion" ADD CONSTRAINT "PhotoTagSuggestion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoTagSuggestion" ADD CONSTRAINT "PhotoTagSuggestion_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "Upload"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoReport" ADD CONSTRAINT "PhotoReport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoReport" ADD CONSTRAINT "PhotoReport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobReceipt" ADD CONSTRAINT "JobReceipt_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobReceipt" ADD CONSTRAINT "JobReceipt_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobReceipt" ADD CONSTRAINT "JobReceipt_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "Upload"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobReceipt" ADD CONSTRAINT "JobReceipt_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;
