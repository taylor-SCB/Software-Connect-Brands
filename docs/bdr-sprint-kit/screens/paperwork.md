# Screen: paperwork

## What to build (approved)

QUOTE → CONTRACT (plan: Quote → Contract Coordinator → Contract; Release 8). Mount the <DealJourney> strip (Meeting ✓ · Quote ✓ Nov 10 · Contract ● sent Nov 10 · Signed ○ · Deposit ○) with one Next button per step (Send quote → Customer said yes → Make contract → Send for signature → Send deposit invoice) on the quote page, the Contract Coordinator and the contract page; today's badges move to a details row under it. "Mark as sent" becomes "Send quote" and opens a share sheet (Copy link / Text / Email) that marks the quote sent (keep the server refusal with no saved lines and the wait on unsaved edits). Approved decision 19: sending a quote moves its deal to Quote Sent if it is behind (Build Quote no longer does — the Pipeline coder changes that side). On a first contract the Coordinator pre-ticks the open rows onto Contract A with one "Create contract for $6,754 →" button; Award without paperwork becomes a text link; the row's "Cancel" reads "Drop line". "Send deposit invoice" is the main button on a signed contract. Phone: the strip collapses to 5 dots and "Step 3 of 5 · Contract sent" with a full-width sticky Next.

## Files you own

src/app/dashboard/quotes/**, src/app/dashboard/contracts/**, src/app/dashboard/deals/tracker/**, src/components/quote-document.tsx, src/components/payment-table.tsx, src/app/dashboard/projects/award-without-paperwork.tsx, src/lib/quote-accept.ts

## Suites to run (runner groups)

plain:quotes-improvement,contracts,deal-tracker,money-payments,projects-core,project-money
