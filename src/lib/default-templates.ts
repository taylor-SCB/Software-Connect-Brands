// The contract templates every new organization starts with. They're
// copied into the tenant's own ContractTemplate rows at signup so each
// business can edit its own wording without affecting anyone else.
//
// The order documents (Purchase Order, Sales Order, Invoice) leave the
// itemized rows and the payment schedule to the document itself: a
// contract made from the deal tracker prints its line items and its
// payment table under the body, so the wording only needs the total.

export const DEFAULT_CONTRACT_TEMPLATES = [
  {
    name: "Service Agreement",
    type: "Service Agreement",
    description:
      "Master agreement covering scope, payment terms and liability for a new engagement.",
    body: `SERVICE AGREEMENT

Agreement No. {{contract_number}}
Date: {{date}}

BETWEEN
{{company_name}} ("Provider")
AND
{{client_company}} ("Client")
Attn: {{client_name}} · {{client_email}} · {{client_phone}}

1. SERVICES
Provider agrees to furnish the labor, materials and project services described in the
accompanying proposal or statement of work. Any work not expressly described there is
outside the scope of this Agreement and requires a signed Change Order.

2. SCHEDULE
Provider will begin work on the agreed start date and will proceed with reasonable
diligence to completion. Schedule commitments assume timely site access, timely Client
decisions, and no unforeseen conditions.

3. PRICE AND PAYMENT
Client agrees to pay the amounts set out in the accompanying proposal. Invoices are due
net 30 days from the invoice date unless stated otherwise. Amounts unpaid after 30 days
may accrue interest at 1.5% per month. Provider may suspend work on accounts more than
30 days past due.

4. CHANGES
Changes to scope, materials or schedule must be documented in a written Change Order
signed by both parties before the affected work proceeds. Approved Change Orders adjust
the contract price and schedule accordingly.

5. WARRANTY
Provider warrants that services will be performed in a workmanlike manner consistent with
industry standards, and that materials supplied will be free from defect for twelve (12)
months following substantial completion. This warranty excludes damage caused by misuse,
neglect, unauthorized modification, or normal wear.

6. LIMITATION OF LIABILITY
Neither party is liable for indirect, incidental or consequential damages. Provider's
total aggregate liability under this Agreement will not exceed the total amounts paid by
Client under this Agreement.

7. INSURANCE
Provider will maintain general liability and workers' compensation coverage as required by
law and will furnish certificates of insurance on request.

8. TERMINATION
Either party may terminate this Agreement on fourteen (14) days written notice. On
termination, Client will pay for all work performed and materials ordered through the
termination date.

9. ENTIRE AGREEMENT
This Agreement, together with the accompanying proposal and any signed Change Orders,
constitutes the entire agreement between the parties and supersedes all prior discussions.

By signing below, the parties agree to the terms above.`,
  },
  {
    name: "Change Order",
    type: "Change Order",
    description:
      "Amends an existing agreement when scope, price or schedule changes mid-project.",
    body: `CHANGE ORDER

Change Order No. {{contract_number}}
Date: {{date}}

PROJECT
Client: {{client_company}}
Attn: {{client_name}} · {{client_email}} · {{client_phone}}
Provider: {{company_name}}

This Change Order amends the Service Agreement previously executed between the parties.
All terms of the original Agreement remain in full force except as modified below.

1. DESCRIPTION OF CHANGE
[Describe the change in scope, materials, or conditions that prompted this Change Order.]

2. REASON FOR CHANGE
[Client request / unforeseen site condition / code requirement / design revision.]

3. PRICE ADJUSTMENT
Original contract amount:            $[  ]
Net change from previous orders:     $[  ]
Amount of this Change Order:         $[  ]
New contract total:                  $[  ]

4. SCHEDULE ADJUSTMENT
The contract completion date is adjusted by [  ] calendar days.
Revised substantial completion date: [  ]

5. TERMS
Work described in this Change Order will not begin until this document is signed by both
parties. Payment terms follow the original Agreement. Where this Change Order conflicts
with the original Agreement, this Change Order controls as to the work described here.

By signing below, both parties accept the changes to scope, price and schedule set out
above.`,
  },
  {
    name: "Purchase Order",
    type: "Purchase Order",
    description:
      "Orders materials or services from a supplier or subcontractor. Items and total print from the deal tracker.",
    body: `PURCHASE ORDER

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
substitutions, quantity changes or price changes are accepted without Buyer's written
approval.

2. DELIVERY
Vendor will deliver the items to the Ship To address by the date agreed with Buyer, and
will notify Buyer at least two (2) business days before delivery. Title and risk of loss
pass to Buyer on acceptance at delivery. Partial shipments must be identified as such on
the packing slip.

3. INSPECTION AND REJECTION
Buyer may inspect items within ten (10) days of delivery. Items that are damaged,
non-conforming or short may be rejected and returned at Vendor's expense for replacement
or credit, at Buyer's option.

4. INVOICING AND PAYMENT
Vendor's invoice must reference this PO number and match the items delivered. Payment is
made on the terms above from the later of the invoice date and acceptance of the items.
Buyer may withhold payment on disputed items until the dispute is resolved.

5. WARRANTY
Vendor warrants that the items are new, free from defects in material and workmanship,
and conform to the manufacturer's published specifications for a period of not less than
twelve (12) months from delivery.

6. CANCELLATION
Buyer may cancel any item not yet shipped by written notice. Vendor may not cancel this
order once accepted, except by written agreement of Buyer.

7. COMPLIANCE
Vendor will comply with all laws applicable to the manufacture, sale and delivery of the
items and will carry insurance customary for its trade.

Acceptance of this Purchase Order, by signature or by shipment, is acceptance of the
terms above.`,
  },
  {
    name: "Sales Order",
    type: "Sales Order",
    description:
      "Confirms what the customer is buying, the total and the payment schedule before work starts.",
    body: `SALES ORDER

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
manufacturer's warranty, which {{company_name}} will help the Customer claim.

7. ACCEPTANCE
Customer's signature confirms the items, quantities, total and payment schedule on this
order. This Sales Order, together with any signed Change Orders, is the complete
agreement for the items listed.`,
  },
  {
    name: "Invoice",
    type: "Invoice",
    description:
      "Bills the customer for the items on the deal. Prints the items, total and due dates.",
    body: `INVOICE

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

Signing below acknowledges receipt of this invoice and the amounts and dates shown.`,
  },
  {
    name: "Compliance Agreement",
    type: "Compliance",
    description:
      "What a vendor or subcontractor has to keep current to work with you: insurance, licenses, W-9, safety.",
    body: `COMPLIANCE AGREEMENT

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
workers' compensation as required by law. Vendor will deliver a current Certificate of
Insurance naming Company as additional insured before starting work, and a renewal
certificate before each policy expires.

3. LICENSES AND PERMITS
Vendor will hold every license, registration and permit its trade and the work require,
will provide copies on request, and will notify Company within five (5) days if any is
suspended, revoked or allowed to lapse.

4. SAFETY
Vendor will follow all applicable safety laws and Company's site rules, will supply its
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
Company may withhold payment or suspend Vendor's work while any item above is out of
date, and may end the relationship if it is not corrected within ten (10) days of notice.

By signing below, Vendor confirms that each item above is in place today and agrees to
keep it so.`,
  },
];
