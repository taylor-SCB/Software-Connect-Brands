# Release B: Contracts

Branch: `claude/ai-release-b` (from `claude/ai-release`). Suite: `scripts/browser-tests/ai-release-b.cjs`. Database: `scb_b`.

Where it came from: the Contracts v1 (Sept 10), Deal Tracker (Sept 13), Contract Coordinator (Sept 27) and Contracts v2 (Nov 6) think tanks. Read CLAUDE.md's Contract Coordinator, discounts, Contracts v2 (Suggest fields: its validation is the model for B3) and the Release 3a/3b notes on supplier minimums before you start. Code: `src/app/dashboard/contracts/` (the contract page `[id]`, `actions.ts`, the Coordinator under `tracker` and `src/app/dashboard/deals/tracker`), the customer's signing page `src/app/c/[token]`, `src/lib/template-import.ts` / `src/lib/template-file.ts` (reading Word and PDF files in the browser), `src/lib/supplier-math.ts`.

## B1. Price check before Create (kind `PRICE_CHECK`)

In the Contract Coordinator, before a contract card is created: a short list of problems, each with what to fix and **Create anyway**.

- **Rules find them**: a row priced under its product's cost; under the starred supplier's minimum (`starredMinimumCents`, net of the line's discount); a unit that differs from the product's; a contract discount bigger than the contract's margin; a payment schedule that doesn't add up to the contract total; a money-out (purchase order) row priced above the catalog cost. No problems: no list, no click added.
- With the key, Claude writes one plain line per problem from the rules' findings (`inventedNumbers` on each line; on failure the rules wording stays). Never blocks; nothing is changed for them.

## B2. Read before send (kind `SEND_CHECK`)

When a contract is sent (every path that sends one: find them all), Claude compares the contract's filled-in wording with its rows, its payment schedule and the source quote: amounts, scope, names and dates. Mismatches are listed with **Send anyway** and **Go back and fix**; nothing changes on its own.

- Every quoted value must be found in what was sent (the body text or the rows) or the item is dropped. Rules catch the arithmetic (totals, schedule) without the key; Claude adds the wording ones.
- Ask once per version of the contract (fingerprint of body, rows and schedule), not on every click.

## B3. Redline reader (kind `REDLINE`)

On a contract that has been sent (or is a draft): **Read their marked-up copy**. Upload the customer's version as Word, PDF or a photo of the pages.

- Word: read in the browser with `src/lib/template-file.ts` (keep its limits), and also pick out tracked insertions and deletions if the file has them. PDF or photos: send the file itself as an `AiPart` (PDF up to 10 MB / 100 pages; photos made small) so Claude sees strike-throughs and handwriting.
- Claude returns each change: the exact snippet of our wording it touches, what they want instead (or "deleted"), and a plain-words explanation. **A snippet must be found in our body exactly once**, as Suggest fields requires; anything else is listed as "Couldn't place this one" with their words, so nothing is silently lost.
- **Accept** / **Reject** each. Accepted changes go into the contract's body as a draft (a sent contract is pulled back to draft the way it already can be, with the same confirmation); nothing is saved until Save, and the person resends as today. Keep the uploaded copy in the contract's files.

## B4. Dates onto the calendar (kind `CONTRACT_DATES`)

When a contract is signed (by the customer on `/c` or with Mark as signed), its page offers **Dates in this contract**: Claude reads the signed body and schedule for dated duties (deposit due, start by, completion, warranty walk, insurance renewal, notice periods). Each comes with the snippet it came from (must be in the body) and a date: a date written out, or one worked out from a date the contract has ("30 days after signing" from the signing day). One with no date it can pin is listed as "No date given" and isn't offered.

- Tick → a calendar entry for the contract's rep, with the customer's company and contact and the job if there is one. Don't offer what's already on the calendar (payment rows and follow-ups the app writes today). Ask once per signed contract; never on the signing page itself (the customer never waits on it).

## B5. Compliance watchdog (kind `COMPLIANCE_READ`)

Upload a COI, license or W-9 and Claude reads it: what kind of document, the named insured, the expiry date, the insurer and policy number, and the coverage limits. The person checks the filled-in fields and saves.

- **Yours**: Settings → Company Information → Compliance (`src/app/dashboard/settings/compliance/page.tsx`, `document-upload-form.tsx`, `company-tiles.tsx`), which already has a category and `expiresOn`. Flag a named insured that doesn't match the workspace's business name, and anything expired or running out within 30 days on the compliance tile.
- **Your subcontractors'** (Taylor's call 4): a Compliance section on a sub crew's card (`src/app/dashboard/projects/crews`, `Crew.kind` SUB, linked to its `Company`), with the same upload and reader. Expired or soon-to-expire shows on the crew card, on the crews list, and on a job where that crew is scheduled.
- Files stay in Postgres like today (4 MB cap). A PDF goes to Claude as a PDF; a photo is made small first. Members follow today's rule (they can't manage company files); say in your report who can upload a sub's COI.

## Suites to run

`"ai:ai-assist,ai-release-b"`, `template` (template-import) and at least `plain:contracts,deal-tracker,template-replace,money-payments,projects-core,project-money,crews-time,calendar,calendar-v2,quotes-improvement,variations-pictures`. Add whatever else your files touch.
