-- Quotes improvement: a payment table of their own, who we buy each line
-- from, software billing terms on a line, and who is on the deal.
--
-- Safe for rows that already exist, and there is nothing to backfill.
-- Every quote gets zero payment rows, which is the right empty state —
-- the table reads "No payment schedule yet" until someone builds one.
-- Every line gets a null supplier, null unit and null software terms.
-- hidePaymentTable starts false, so a table prints once one exists.
-- Every ContractPayment gets terms null and keeps printing "—" in its Due
-- cell exactly as it does today; dueOn is not touched, so Owes you, the
-- Owed to you tile, every overdue badge and the Balance card all read the
-- same the morning after.
--
-- The two Quote → User keys are ON DELETE SET NULL on purpose. Every other
-- link to a person in this schema cascades; cascading here would delete
-- the quote along with whoever owned it.

-- AlterTable
ALTER TABLE "Contract" ADD COLUMN     "scheduleAmendedAt" TIMESTAMP(3),
ADD COLUMN     "scheduleFromQuote" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ContractPayment" ADD COLUMN     "terms" TEXT;

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "contractSignerId" TEXT,
ADD COLUMN     "hidePaymentTable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "leadSalesRepId" TEXT,
ADD COLUMN     "paymentTerms" TEXT,
ADD COLUMN     "teamUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "QuoteLineItem" ADD COLUMN     "softwareRate" "SoftwareRate",
ADD COLUMN     "softwareTermMonths" INTEGER,
ADD COLUMN     "supplierCompanyId" TEXT,
ADD COLUMN     "unitOfMeasure" "UnitOfMeasure";

-- CreateTable
CREATE TABLE "QuotePayment" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "organizationId" TEXT,
    "label" TEXT NOT NULL,
    "kind" "PaymentKind" NOT NULL DEFAULT 'PERCENT',
    "percent" DOUBLE PRECISION,
    "amountCents" INTEGER NOT NULL DEFAULT 0,
    "dueOn" DATE,
    "terms" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuotePayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuotePayment_quoteId_idx" ON "QuotePayment"("quoteId");

-- CreateIndex
CREATE INDEX "QuotePayment_organizationId_idx" ON "QuotePayment"("organizationId");

-- CreateIndex
CREATE INDEX "Quote_leadSalesRepId_idx" ON "Quote"("leadSalesRepId");

-- CreateIndex
CREATE INDEX "Quote_contractSignerId_idx" ON "Quote"("contractSignerId");

-- CreateIndex
CREATE INDEX "QuoteLineItem_supplierCompanyId_idx" ON "QuoteLineItem"("supplierCompanyId");

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_leadSalesRepId_fkey" FOREIGN KEY ("leadSalesRepId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_contractSignerId_fkey" FOREIGN KEY ("contractSignerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLineItem" ADD CONSTRAINT "QuoteLineItem_supplierCompanyId_fkey" FOREIGN KEY ("supplierCompanyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotePayment" ADD CONSTRAINT "QuotePayment_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
