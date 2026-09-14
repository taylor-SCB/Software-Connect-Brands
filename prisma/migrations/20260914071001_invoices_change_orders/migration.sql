-- Invoices, change orders, ordering materials, and files on a job.
--
-- A payment row can now be sent as an invoice: it gets INV-n, a link the
-- customer can open without a login, and the date it went out. A change
-- order says which agreement it changes. A distributor can point at the
-- company its purchase orders are addressed to, so money owed to a
-- supplier lands on one record rather than two. Files can belong to a job.
--
-- Safe for rows that already exist: every new column is nullable or
-- defaulted, and nothing is renamed, dropped or rewritten. Rows already
-- owed stay owed — they simply have no invoice number until one is sent,
-- and NULLs never collide in the new unique indexes.

-- AlterTable
ALTER TABLE "Contract" ADD COLUMN     "amendsContractId" TEXT;

-- AlterTable
ALTER TABLE "ContractPayment" ADD COLUMN     "invoiceNumber" INTEGER,
ADD COLUMN     "invoiceToken" TEXT,
ADD COLUMN     "issuedAt" TIMESTAMP(3),
ADD COLUMN     "reference" TEXT;

-- AlterTable
ALTER TABLE "Distributor" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "nextInvoiceNumber" INTEGER NOT NULL DEFAULT 1000,
ADD COLUMN     "paymentInstructions" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Upload" ADD COLUMN     "projectId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ContractPayment_invoiceToken_key" ON "ContractPayment"("invoiceToken");

-- CreateIndex
CREATE UNIQUE INDEX "ContractPayment_organizationId_invoiceNumber_key" ON "ContractPayment"("organizationId", "invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Distributor_companyId_key" ON "Distributor"("companyId");

-- CreateIndex
CREATE INDEX "Upload_projectId_idx" ON "Upload"("projectId");

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_amendsContractId_fkey" FOREIGN KEY ("amendsContractId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Distributor" ADD CONSTRAINT "Distributor_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Upload" ADD CONSTRAINT "Upload_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
