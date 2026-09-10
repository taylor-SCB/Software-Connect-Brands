-- Deal tracker, uploads and Company Information.
--
-- Safe for rows that already exist: every new column is nullable or has a
-- default, CANCELLED is only added to the status enum (nothing is moved to
-- it), and the seed at the bottom only adds what a workspace is missing.

-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('PERCENT', 'FIXED', 'BALANCE');

-- CreateEnum
CREATE TYPE "UploadKind" AS ENUM ('ORG_LOGO', 'USER_AVATAR', 'COMPANY_LOGO', 'CONTACT_IMAGE', 'COMPLIANCE', 'MARKETING');

-- AlterEnum
ALTER TYPE "ContractStatus" ADD VALUE 'CANCELLED';

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "logoUrl" TEXT;

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "imageUrl" TEXT;

-- AlterTable
ALTER TABLE "Contract" ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "companyId" TEXT,
ADD COLUMN     "lastReminderAt" TIMESTAMP(3),
ADD COLUMN     "paymentTerms" TEXT,
ADD COLUMN     "reminderCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "senderSignerName" TEXT;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "addressLine1" TEXT,
ADD COLUMN     "addressLine2" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "description" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "email" TEXT,
ADD COLUMN     "history" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "postalCode" TEXT,
ADD COLUMN     "state" TEXT,
ADD COLUMN     "website" TEXT;

-- AlterTable
ALTER TABLE "QuoteLineItem" ADD COLUMN     "cancelledAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "avatarUrl" TEXT,
ADD COLUMN     "receiveInAppMessages" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "title" TEXT;

-- CreateTable
CREATE TABLE "ContractLineItem" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "quoteLineItemId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unitPriceCents" INTEGER NOT NULL DEFAULT 0,
    "tag" "LineItemTag" NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ContractLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractPayment" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" "PaymentKind" NOT NULL DEFAULT 'PERCENT',
    "percent" DOUBLE PRECISION,
    "amountCents" INTEGER NOT NULL DEFAULT 0,
    "dueOn" DATE,
    "paidAt" TIMESTAMP(3),
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ContractPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Upload" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" "UploadKind" NOT NULL,
    "category" TEXT,
    "name" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "publicToken" TEXT NOT NULL,
    "expiresOn" DATE,
    "userId" TEXT,
    "companyId" TEXT,
    "contactId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Upload_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContractLineItem_contractId_idx" ON "ContractLineItem"("contractId");

-- CreateIndex
CREATE INDEX "ContractLineItem_quoteLineItemId_idx" ON "ContractLineItem"("quoteLineItemId");

-- CreateIndex
CREATE INDEX "ContractPayment_contractId_idx" ON "ContractPayment"("contractId");

-- CreateIndex
CREATE UNIQUE INDEX "Upload_publicToken_key" ON "Upload"("publicToken");

-- CreateIndex
CREATE INDEX "Upload_organizationId_kind_idx" ON "Upload"("organizationId", "kind");

-- CreateIndex
CREATE INDEX "Upload_userId_idx" ON "Upload"("userId");

-- CreateIndex
CREATE INDEX "Upload_companyId_idx" ON "Upload"("companyId");

-- CreateIndex
CREATE INDEX "Upload_contactId_idx" ON "Upload"("contactId");

-- CreateIndex
CREATE INDEX "Contract_companyId_idx" ON "Contract"("companyId");

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractLineItem" ADD CONSTRAINT "ContractLineItem_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractLineItem" ADD CONSTRAINT "ContractLineItem_quoteLineItemId_fkey" FOREIGN KEY ("quoteLineItemId") REFERENCES "QuoteLineItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractPayment" ADD CONSTRAINT "ContractPayment_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Upload" ADD CONSTRAINT "Upload_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Upload" ADD CONSTRAINT "Upload_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Upload" ADD CONSTRAINT "Upload_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Upload" ADD CONSTRAINT "Upload_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed: every existing workspace gets the four new built-in types and the
-- four new built-in templates (Purchase Order, Sales Order, Invoice,
-- Compliance Agreement). Ids derive from workspace + name so re-running is
-- harmless; a workspace that already has a template by that name keeps its
-- own wording and is skipped.
INSERT INTO "ContractTypeOption" ("id", "organizationId", "name")
SELECT 'cto_' || md5(o."id" || ':' || t."name"), o."id", t."name"
FROM "Organization" o
CROSS JOIN (VALUES ('Purchase Order'), ('Sales Order'), ('Invoice'), ('Compliance')) AS t("name")
ON CONFLICT ("organizationId", "name") DO NOTHING;

INSERT INTO "ContractTemplate" ("id", "organizationId", "name", "type", "description", "body", "allUsersCanSend", "senderUserIds", "createdAt", "updatedAt")
SELECT 'ctp_' || md5(o."id" || ':' || 'Purchase Order'), o."id", 'Purchase Order', 'Purchase Order', 'Orders materials or services from a supplier or subcontractor. Items and total print from the deal tracker.', 'PURCHASE ORDER

PO No. {{contract_number}}
Date: {{date}}
Reference: {{deal_name}}

BUYER
{{company_name}}
{{your_company_address}}
{{your_company_phone}} · {{your_company_email}}

VENDOR
{{client_company}}
Attn: {{client_name}} · {{client_email}} · {{client_phone}}

SHIP TO
{{company_name}}
{{your_company_address}}

ORDER TOTAL: {{contract_total}}
PAYMENT TERMS: {{payment_terms}}

1. ITEMS ORDERED
The items, quantities and unit prices are listed in the Items schedule at the end of this
Purchase Order. Prices are firm for the quantities shown and include all packaging. No
substitutions, quantity changes or price changes are accepted without Buyer''s written
approval.

2. DELIVERY
Vendor will deliver the items to the Ship To address by the date agreed with Buyer, and
will notify Buyer at least two (2) business days before delivery. Title and risk of loss
pass to Buyer on acceptance at delivery. Partial shipments must be identified as such on
the packing slip.

3. INSPECTION AND REJECTION
Buyer may inspect items within ten (10) days of delivery. Items that are damaged,
non-conforming or short may be rejected and returned at Vendor''s expense for replacement
or credit, at Buyer''s option.

4. INVOICING AND PAYMENT
Vendor''s invoice must reference this PO number and match the items delivered. Payment is
made on the terms above from the later of the invoice date and acceptance of the items.
Buyer may withhold payment on disputed items until the dispute is resolved.

5. WARRANTY
Vendor warrants that the items are new, free from defects in material and workmanship,
and conform to the manufacturer''s published specifications for a period of not less than
twelve (12) months from delivery.

6. CANCELLATION
Buyer may cancel any item not yet shipped by written notice. Vendor may not cancel this
order once accepted, except by written agreement of Buyer.

7. COMPLIANCE
Vendor will comply with all laws applicable to the manufacture, sale and delivery of the
items and will carry insurance customary for its trade.

Acceptance of this Purchase Order, by signature or by shipment, is acceptance of the
terms above.', true, ARRAY[]::TEXT[], CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Organization" o
WHERE NOT EXISTS (SELECT 1 FROM "ContractTemplate" x WHERE x."organizationId" = o."id" AND lower(x."name") = lower('Purchase Order'))
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "ContractTemplate" ("id", "organizationId", "name", "type", "description", "body", "allUsersCanSend", "senderUserIds", "createdAt", "updatedAt")
SELECT 'ctp_' || md5(o."id" || ':' || 'Sales Order'), o."id", 'Sales Order', 'Sales Order', 'Confirms what the customer is buying, the total and the payment schedule before work starts.', 'SALES ORDER

Order No. {{contract_number}}
Date: {{date}}
Project: {{deal_name}}
Quote reference: {{quote_number}}

SOLD BY
{{company_name}}
{{your_company_address}}
{{your_company_phone}} · {{your_company_email}}

SOLD TO
{{client_company}}
Attn: {{client_name}} · {{client_email}} · {{client_phone}}

ORDER TOTAL: {{contract_total}}
PAYMENT TERMS: {{payment_terms}}

1. WHAT IS INCLUDED
The products and services on this order are listed in the Items schedule at the end of
this document. Anything not listed there is not included. Quantities are as shown; unit
prices are firm for thirty (30) days from the date above.

2. PAYMENT
Customer agrees to pay the amounts and on the dates shown in the Payment Schedule at the
end of this document. Work and orders for materials begin once the first payment is
received. Amounts unpaid after their due date may accrue interest at 1.5% per month.

3. SCHEDULING
{{company_name}} will schedule the work with Customer once materials are confirmed.
Dates are estimates and depend on site access, timely Customer decisions and supplier
lead times.

4. CHANGES
Additions, substitutions or quantity changes after signature require a written Change
Order. Approved changes adjust the total and the schedule.

5. CANCELLATION AND RETURNS
Custom-ordered or cut-to-size materials cannot be cancelled once ordered. Other items
may be cancelled before they ship, less any restocking charge from the supplier.

6. WARRANTY
Labor is warranted for twelve (12) months from completion. Products carry their
manufacturer''s warranty, which {{company_name}} will help the Customer claim.

7. ACCEPTANCE
Customer''s signature confirms the items, quantities, total and payment schedule on this
order. This Sales Order, together with any signed Change Orders, is the complete
agreement for the items listed.', true, ARRAY[]::TEXT[], CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Organization" o
WHERE NOT EXISTS (SELECT 1 FROM "ContractTemplate" x WHERE x."organizationId" = o."id" AND lower(x."name") = lower('Sales Order'))
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "ContractTemplate" ("id", "organizationId", "name", "type", "description", "body", "allUsersCanSend", "senderUserIds", "createdAt", "updatedAt")
SELECT 'ctp_' || md5(o."id" || ':' || 'Invoice'), o."id", 'Invoice', 'Invoice', 'Bills the customer for the items on the deal. Prints the items, total and due dates.', 'INVOICE

Invoice No. {{contract_number}}
Invoice date: {{date}}
Project: {{deal_name}}
Reference: {{quote_number}}

FROM
{{company_name}}
{{your_company_address}}
{{your_company_phone}} · {{your_company_email}}

BILL TO
{{client_company}}
Attn: {{client_name}} · {{client_email}} · {{client_phone}}

AMOUNT DUE: {{contract_total}}
TERMS: {{payment_terms}}
FINAL PAYMENT DUE: {{final_payment_date}}

WHAT THIS COVERS
The items and amounts billed are listed in the Items schedule at the end of this invoice.
Where the amount is split across dates, each part and its due date are shown in the
Payment Schedule.

HOW TO PAY
Please reference the invoice number with your payment. Payment instructions and accepted
methods are as agreed with {{company_name}}; contact {{your_company_email}} or
{{your_company_phone}} with any questions about this invoice.

LATE PAYMENT
Amounts unpaid after their due date may accrue interest at 1.5% per month, and work on
the project may pause until the account is current.

QUESTIONS OR DISPUTES
Tell us within ten (10) days of the invoice date if anything on this invoice looks wrong.
Undisputed amounts remain due on their scheduled dates.

Signing below acknowledges receipt of this invoice and the amounts and dates shown.', true, ARRAY[]::TEXT[], CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Organization" o
WHERE NOT EXISTS (SELECT 1 FROM "ContractTemplate" x WHERE x."organizationId" = o."id" AND lower(x."name") = lower('Invoice'))
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "ContractTemplate" ("id", "organizationId", "name", "type", "description", "body", "allUsersCanSend", "senderUserIds", "createdAt", "updatedAt")
SELECT 'ctp_' || md5(o."id" || ':' || 'Compliance Agreement'), o."id", 'Compliance Agreement', 'Compliance', 'What a vendor or subcontractor has to keep current to work with you: insurance, licenses, W-9, safety.', 'COMPLIANCE AGREEMENT

Agreement No. {{contract_number}}
Date: {{date}}

BETWEEN
{{company_name}} ("Company")
AND
{{client_company}} ("Vendor")
Attn: {{client_name}} · {{client_email}} · {{client_phone}}

Vendor agrees to keep the following in place for as long as it performs work for, or
supplies goods to, Company.

1. TAX DOCUMENTATION
Vendor will provide a completed and signed IRS Form W-9 before its first payment and a
new one whenever its legal name, entity type or taxpayer identification number changes.

2. INSURANCE
Vendor will carry, at its own cost, commercial general liability insurance of not less
than $1,000,000 per occurrence, automobile liability where vehicles are used, and
workers'' compensation as required by law. Vendor will deliver a current Certificate of
Insurance naming Company as additional insured before starting work, and a renewal
certificate before each policy expires.

3. LICENSES AND PERMITS
Vendor will hold every license, registration and permit its trade and the work require,
will provide copies on request, and will notify Company within five (5) days if any is
suspended, revoked or allowed to lapse.

4. SAFETY
Vendor will follow all applicable safety laws and Company''s site rules, will supply its
own protective equipment, and will report any incident on a Company job site to Company
the same day.

5. CONFIDENTIALITY
Vendor will keep confidential any pricing, customer information or business details it
learns through its work with Company and will not use them for any other purpose.

6. INDEPENDENT CONTRACTOR
Vendor is an independent contractor. Nothing in this Agreement creates an employment,
partnership or agency relationship, and Vendor is responsible for its own taxes,
employees and subcontractors.

7. RIGHT TO SUSPEND
Company may withhold payment or suspend Vendor''s work while any item above is out of
date, and may end the relationship if it is not corrected within ten (10) days of notice.

By signing below, Vendor confirms that each item above is in place today and agrees to
keep it so.', true, ARRAY[]::TEXT[], CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Organization" o
WHERE NOT EXISTS (SELECT 1 FROM "ContractTemplate" x WHERE x."organizationId" = o."id" AND lower(x."name") = lower('Compliance Agreement'))
ON CONFLICT ("id") DO NOTHING;
