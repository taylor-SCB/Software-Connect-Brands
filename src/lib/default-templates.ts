// The two contract templates every new organization starts with. They're
// copied into the tenant's own ContractTemplate rows at signup so each
// business can edit its own wording without affecting anyone else.

export const DEFAULT_CONTRACT_TEMPLATES = [
  {
    name: "Service Agreement",
    type: "SERVICE_AGREEMENT" as const,
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
    type: "CHANGE_ORDER" as const,
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
];
