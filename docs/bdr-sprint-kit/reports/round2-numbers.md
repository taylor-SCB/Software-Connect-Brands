# Round 2: numbers (stats, reports, paperwork polish)

On branch `claude/sprint-numbers`, fast-forwarded to `origin/claude/sprint-final` (c1f64d0) first. Migrations: none new; `migrate deploy`, `generate` and `typegen` were run.

## Built

**1. A zero baseline reads "new this period"** (plan R0)
- `changeSize` in `src/lib/reports/format.ts` is the one place it lives, so Stats tiles, report tiles, the report email and the write-up all follow.
- A rise from 0 now reads "new this period" (still `fromZero`, so no "vs 0" is added after it). A fall below 0 on a net figure still reads "▼ down from $0".
- `reports.cjs` and `crm-pipeline-stats.cjs` assert the new words.

**2. Report and Stats tables become two-column lists on a phone**
- One CSS class, `.table-stack` in `globals.css`. Below 768px it hides the header row and turns each row into a grid: the row's name across the top, then `label · value` pairs two to a line. Each label comes from the cell's `data-label`.
- It's one copy of the table, so suites that read rows read the same cells at every width.
- Applied to:
  - every report summary table (`Table` in `report-views.tsx`);
  - the Pipeline report's "What moved";
  - Money Owed's "Who owes the most";
  - Stats' per-day numbers.
- The Stats leaderboard was already one card per rep.

**3. One Save on the quote editor** (ux-gaps' quote gap)
- **How it works:** `quotes/[id]/quote-save.tsx` (`QuoteSaveProvider`, `useQuoteSaveSection`, `useQuoteSaveAll`, `QuoteSaveBar`).
  - The Line items, Payment table and Quote details cards each report whether they have unsaved edits and how to save themselves.
  - One bar, pinned to the foot of the window on desktop, lists what's unsaved ("Unsaved changes: Line items · Payment table") and saves it in page order: lines, then payment table, then details.
  - Each card still saves through its own server action (`saveLineItems`, `saveQuotePaymentSchedule`, `updateQuoteMeta`), so every server check is unchanged, and each card shows its own refusal in place.
  - A refusal stops the run there; the bar names the card that wasn't saved.
- **Phone:** the Line items card's pinned bar (with the total) now runs the same one Save.
- **Send quote:** still waits on unsaved lines (`useReportUnsavedLines` unchanged).
- **The old buttons are gone:** "Save line items", "Save details" and the payment table's "Save payment table".
  - `PaymentTable` gained an optional `join` prop for this, so the contract page keeps its own "Save schedule".
  - Quote details now sends from `onSubmit` instead of a form action, so React never resets the form after a save (Enter in a box still saves).
- **The suggested payment table:** it is written only when someone edits it or presses "Use this table" in its "Not saved yet" note. It is never written as a side effect of saving the lines. `quotes-improvement` asserts that a page load and a lines save write no payment rows.
- **Nothing hides under the bar:** `scroll-padding-bottom` while the bar is on screen, so a catalog row reached with the arrow keys or a field scrolled into view stops above it.

**4. Polish from ux-gaps**
- Find duplicates: "Nothing shares **an** email" (and "a phone"), through `sharedThing()` in `duplicates-view.tsx`.
- Add contact asks the Name (required) before the Company.
- Hints that said "deal tracker" now say "Contract Coordinator": the contact form, the company form and the Purchase Order template's description.
- A new person's Notes card says "None yet" instead of "0 total" (contact page and company page).
- Settings tile descriptions show whole, wrapping instead of being cut off with "…". The critic only said "cut off" and gave no new wording, so the words are unchanged.
- Products' header has one filled button (Add product). Link Ratesheet (was pink) and Create Ratesheet (was neon) are plain.
- **Already fixed before this round,** so no change: Money Owed's double empty message, Calendar Month's ISO-date day title, the phone strip's stray active bar, the Light contrast items, and multi-word search.

**5. `scripts/label-old-attempts.cjs`** (decision 10, demo only; not run anywhere real)
- **Dry run by default:** counts per workspace (voicemail / no answer). `--org <slug>` narrows it.
- **`--apply` refuses without `--org`** (exit 2). An unknown slug is refused.
- **What it writes:** each named workspace is written in its own transaction, and only NO_ANSWER or VOICEMAIL. It labels only `PHONE_CALL` rows with no outcome, not marketing, dated before that workspace's `outcomesSince`, whose note says voicemail / VM / left a message (→ VOICEMAIL) or no answer / didn't pick up / busy (→ NO_ANSWER).
- **What it skips:** a note that also mentions talking, speaking, connecting, interest, a meeting booked or a call back.
- A second run finds nothing left.

## Sprint steps added
- **reports.cjs:**
  - "new this period" on the meetings tile;
  - **"Sprint: on a phone every report's numbers table is a two-column list …"** (Pipeline's What moved, Activity's table, Closing's table behind Show numbers: no header row, rows are grids, every cell's label shown, nothing sideways).
- **crm-pipeline-stats.cjs:**
  - "new this period" on Stats tiles;
  - the per-day numbers as a list on a phone;
  - **"Sprint: label-old-attempts.cjs — …"**. It seeds 8 calls across the suite's workspace and a second one, then runs the script itself. It checks the dry run's counts and that nothing was written, the refusal without `--org`, an unknown slug, `--apply --org` labelling exactly the three plain old calls and nothing in the other workspace, and a second run labelling 0.
- **quotes-improvement.cjs: "Sprint: a draft quote has one Save at the foot of the window …"**
  - no separate save buttons;
  - pinned at the top of the page and halfway down in a short window;
  - lines, payment table and title saved in one press;
  - a blank line name stops it with the title left unsaved;
  - fixing it saves the rest.
- **companies-contacts.cjs:** three polish steps:
  - Name before Company, no "deal tracker";
  - "None yet" on Notes, "Nothing shares an email.";
  - Settings blurbs whole, and Products' one filled button.

## Suites that followed moved controls
- **Quote editor:** every click on "Save line items" / "Save details" / the quote's `save-schedule` is now `quote-save` (`quote-save-phone` on a phone). This touched `account-types`, `ai-assist`, `catalog-suppliers`, `deal-tracker`, `products-load-test`, `products-ratesheets`, `products-scale`, `projects-core`, `quotes-improvement` and `variations-pictures`. Contract-page `save-schedule` clicks are unchanged.
  - One quotes-improvement step had saved an unchanged Quote details form as its setup. One Save writes only what changed, so that step now waits for "All changes saved" and then runs its refusal checks as before.
- **Breaks already on sprint-final** (the redesigned contact and company pages), fixed in the suites:
  - `products-ratesheets`: New quote is under ⋯ More.
  - `contacts-import-filters`:
    - the company Details card opens closed;
    - Industry · Type is under More details;
    - Add deal is under ⋯ More;
    - the People card shows "Show all 60" before paging.
  - `products-ratesheets` also matched products by name across every workspace, and so read products-scale's leftovers. Those lookups are now scoped to its own workspace.

## Suite results
`npx next typegen && npx tsc --noEmit -p . && npx next build` is green. All of these ran against a production build on the local Postgres, in one final run:

| Suite | Result |
|---|---|
| reports | PASS, 48 steps |
| crm-pipeline-stats | PASS, 35 |
| quotes-improvement | PASS |
| contracts | PASS, 25 |
| deal-tracker | PASS, 45 |
| companies-contacts | PASS, 29 |
| contacts-import-filters | PASS, 24 |
| looks | PASS, 31 |
| overlay-readability | PASS, 16 |
| catalog-suppliers | PASS, 38 |
| products-ratesheets | PASS |
| products-scale | PASS, 18 |
| projects-core | PASS, 26 |
| variations-pictures | PASS |
| email-marketing-users | PASS |
| account-types | PASS, 34 |
| ai-assist | PASS, 26 |

Not run: `products-load-test` (it needs the slow proxy). Its one changed line is the same `quote-save` swap.

## Files touched outside the screen's own
- `src/app/globals.css`: `.table-stack` and the quote Save bar's scroll padding.
- `src/components/payment-table.tsx`: the optional `join` prop.
- `src/components/duplicates-view.tsx`.
- `src/app/dashboard/contacts/contact-form.tsx`, `src/app/dashboard/contacts/[id]/page.tsx` and `src/app/dashboard/companies/company-form.tsx`, `src/app/dashboard/companies/[id]/page.tsx`: the polish items.
- `src/app/dashboard/settings/company-tiles.tsx`.
- `src/app/dashboard/products/page.tsx` and `link-ratesheet-button.tsx`.
- `src/lib/default-templates.ts`: description text only.

## Notes for CLAUDE.md
- **A rise from 0 reads "new this period"** (plan R0, replacing the Nov 10 "▲ up from 0" rule). It's done in one place, `changeSize`.
- **Numbers tables on a phone:** add `table-stack` to the table and `data-label` to every cell after the first.
- **The quote editor has one Save** (`quote-save` / `quote-save-phone`; `quote-save.tsx`).
  - A new card on the quote page joins it with `useQuoteSaveSection(key, { label, order, dirty, pending, save })`, where `save` resolves `true` or `false`.
  - It saves only what changed. A suggested payment table needs an edit or "Use this table".
- **`scripts/label-old-attempts.cjs`** is the decision-10 labeller. It's a dry run unless `--apply --org <slug>`, and should be run on the demo only, with Taylor's yes.
