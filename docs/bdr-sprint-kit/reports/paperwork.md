# Paperwork screen — sprint report

Branch `claude/sprint-paperwork`. Quote → Contract Coordinator → Contract,
with the DealJourney strip (BDR redesign, Release 8).

## Built

- **DealJourney strip on the quote page, the Contract Coordinator and the
  contract page.** Meeting · Quote · Contract · Signed · Deposit with one
  Next button per step. The page's old status badges moved into the strip's
  details row: the quote's status, its deal stage and "Sent <day>" on the
  quote; the deal stage, Open rows, Awaiting signature and Outstanding (with
  "Signed: $…") on the Coordinator; type, direction and status on the
  contract. On a phone the strip is five dots and "Step N of 5 · …" with a
  full-width Next pinned to the foot of the screen (pages get bottom room
  for it). On the Coordinator the strip sits outside the glass card, because
  a card is the box a pinned button would be placed against.
- **What Next does at each step** (`JourneyNext`): Start a quote → the New
  quote page for the deal; Send quote → the Send quote sheet on the quote
  page, the quote page elsewhere; Customer said yes → marks the quote
  Accepted where you are; Make contract → the Coordinator (on the
  Coordinator, jumps to its Create button); Send for signature → sends the
  contract on its own page (a person not allowed to send sees why), opens
  the draft elsewhere; Copy signing link → copies the `/c/` link; Send
  deposit invoice → stamps the signed contract's first payment row as
  INV-n (the same `sendInvoice` as "Send as invoice"), copies and shows its
  `/i/` link, then reads "Copy invoice link".
- **Which paperwork the strip reads.** Quote page: that quote and the
  money-in contracts made from it. Coordinator: the quote picked there and
  every money-in contract on the deal. Contract page: that contract and its
  quote. Purchase orders never count; a cancelled or declined contract
  counts as not made. A purchase order, or a contract with no deal, keeps
  its badges in the header with no strip; a signed money-in contract with no
  deal still gets "Send deposit invoice" in its header.
- **"Mark as sent" is "Send quote"** and opens a share sheet: the customer's
  link, Copy link, Text, Email, and "Just mark it sent" for a quote that
  went out some other way. Whichever is used marks the quote sent. Text and
  Email open the phone's own messages / mail to the contact's mobile (else
  phone) and email with the link written in; nothing is emailed from the
  app. The server still refuses a quote with no saved lines (the words show
  in the sheet) and the button still waits while the editor has unsaved
  edits (the sheet doesn't open). On a draft quote of a deal that has moved
  past the quote step, Send quote stays in the header.
- **Decision 19:** sending a quote moves its deal to Quote Sent if it is
  behind. `setQuoteStatus` already did this (`advanceDealStage` only moves
  forward); a Sprint step proves it from Meeting Completed. Build Quote is
  the Pipeline coder's side.
- **Coordinator, first contract:** when the deal has no contract yet (a
  cancelled one doesn't count) Contract A starts with every open row
  ticked, and the button reads "Create contract for $6,754.00 →" (one
  contract ticked) or "Create N contracts". The Coordinator's Outstanding
  no longer counts unsent drafts (ux-gaps item 4).
- **Coordinator cards:** template, direction, terms and title fold into one
  summary line ("Sales Order · Money in · Net 30") with **Change**; Company
  and Contact stay open. The fields stay in the page, hidden, so nothing
  about what a card posts changed.
- **Award without paperwork is a text link**, not the page's bright button.
- **A row's "Cancel" reads "Drop line"** (Restore unchanged; the footer
  counts "N dropped").
- **`scripts/accept-signed-quotes.ts` is now a migration**,
  `prisma/migrations/20261111140000_paperwork_accept_signed_quotes`. One
  statement: every signed customer contract (not a purchase order) whose
  quote *in the same workspace* is still Sent → the quote becomes Accepted,
  dated by its earliest signed contract, and its open auto-written "Quote
  follow up" / "Quote due" calendar entries are deleted (what
  `syncQuoteEvents` does for a quote no longer Sent; the done "Quote sent"
  line stays). Only Sent quotes are touched, so a second run changes
  nothing. It runs on release with every other migration; nobody runs a
  script by hand. The script is deleted — nothing else used it.

## Not built, and why

- **"Quote sent / Contract sent / Signed" lines on the person's feed.** The
  plan puts them on the contact page's feed (ux-gaps: built from
  `Quote.sentAt`, `Contract.sentAt`, `Contract.signedAt` at render, never as
  Activity rows). That page belongs to the contact-page coder and isn't on
  this branch. Everything they need is already stored.
- **The opportunity panel's strip.** The panel is the Pipeline screen's;
  `loadDealJourney` + `JourneyNext` below are ready for it.
- **ux-gaps paperwork items outside this spec** (customer "Accept this
  quote" on `/q/`, Build Quote skipping the New quote interstitial, one
  sticky Save on the draft editor, stacked line cards on a phone, a sticky
  "Review and sign" bar on `/c/`, locking a SENT contract's body, the sign
  form's pre-filled name). Not in the approved screen spec; each is its own
  change for a later release.

## API others can use

- `loadDealJourney(organizationId, timeZone, { dealId, quoteId?, contractId?, page: "quote" | "coordinator" | "contract" })`
  from `@/lib/deal-journey-load` (server only, four reads) →
  `{ journey: JourneyState, input: JourneyInput, refs: JourneyRefs } | null`.
  `refs` = `{ dealId, contactId, quote {id, number, status, publicToken} | null, draftContract {id, number} | null, sentContract {id, number, publicToken} | null, signedContract {id, number} | null, depositRow {id, invoiceToken, amountCents} | null }`.
  For the opportunity panel use `page: "coordinator"`.
- `<JourneyNext next={journey.next} refs={refs} page here? />` from
  `@/app/dashboard/contracts/journey-next` (client). `here` maps a next key
  to the page's own control. Test id `journey-next` on every Next.
- `<DepositInvoiceButton rowId token label />` (same file); test ids
  `journey-next`, `deposit-invoice`, `deposit-invoice-link`.
- `<SendQuoteButton quoteId quoteLabel publicPath contact={{name, email, phone}} className? />`
  from `@/app/dashboard/quotes/[id]/mark-sent` (needs `QuoteUnsavedProvider`
  above it for the unsaved-lines wait). Test ids `send-quote`,
  `send-quote-sheet`, `send-quote-link`, `send-quote-copy`,
  `send-quote-text`, `send-quote-email`, `send-quote-mark`,
  `send-quote-error`. The old `mark-sent` / `mark-sent-error` ids are gone.
- `TrackerGrid` takes `firstContract?: boolean`. Coordinator test ids:
  `tracker-open-rows`, `column-summary`, `column-change`; `#make-contracts`
  is the Create bar's anchor.
- Server action `markQuoteSent` is unchanged; `changeQuoteStatus` now also
  revalidates both Coordinator addresses.

## Suite results

SUITE_RESULTS

## Files touched outside yours

- `src/lib/health-journey.ts` (foundation): one line — the Meeting step
  counts as done once a quote is started (`quoteDraft`), so a deal added by
  hand with no logged meeting doesn't show "Meeting" as the current step on
  its own quote page.
- `src/lib/deal-journey-load.ts`: new file (the loader above).
- `prisma/migrations/20261111140000_paperwork_accept_signed_quotes/`: new.
- `scripts/accept-signed-quotes.ts`: deleted.
- Browser suites changed for the moved controls, without weakening a check:
  `quotes-improvement`, `contracts`, `deal-tracker` (mine), and outside my
  groups `calendar-v2`, `companies-contacts`, `variations-pictures` (Send
  quote + Just mark it sent instead of Mark as sent) and `looks` (Clear the
  pre-ticked rows before checking the disabled Create button). Suites that
  tick every row of a first contract (`calendar`, `crews-time`,
  `products-scale`, `projects-core`, `project-money`, `money-payments`) need
  no change: `.check()` on a ticked box is a no-op.

## Notes for CLAUDE.md

- Replace "After this goes live, run once against the live database:
  `npx tsx scripts/accept-signed-quotes.ts --check`…" with: the catch-up is
  the migration `20261111140000_paperwork_accept_signed_quotes`, which runs
  on release by itself; the script is gone.
- Quote page: "Mark as sent" is **Send quote**, a share sheet (Copy link /
  Text / Email / Just mark it sent); suites use `send-quote` then
  `send-quote-mark`.
- **The Contract Coordinator pre-ticks a first contract.** With no contract
  on the deal yet, Contract A starts with every open row ticked; a suite
  that wants a subset clicks Contract A's **Clear** first. A card's
  template / direction / terms / title are behind **Change**
  (`column-change`); `selectOption` on them needs it open, reading them
  doesn't.
- **A pinned (position: fixed) button must not sit inside a `.card`**: the
  glass blur makes the card its containing block. The DealJourney's sticky
  Next on the Coordinator sits outside the card for that reason.
- The Coordinator's Outstanding leaves unsent drafts out.
