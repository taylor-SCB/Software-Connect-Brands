# Release B report: contracts (Nov 12, 2026)

Branch `claude/ai-release-b`, from `claude/ai-release`. Suite: `scripts/browser-tests/ai-release-b.cjs` (plus `scripts/contract-checks-check.ts`, the rules case by case, which the suite runs first).

## Built

**B1. Price check before Create** (kind `PRICE_CHECK`). Contract Coordinator, the Create button (`src/app/dashboard/deals/tracker/tracker-grid.tsx`, `check-actions.ts`, `price-check-panel.tsx`). After the rows save and before anything is made, the rules (`priceCheckProblems` in `src/lib/contract-checks.ts`) look at every ticked card the way `createSplitContracts` will build it (same discount, same schedule source):
- a row under its product's cost;
- a row under the starred supplier's minimum, net of its own discount (compared before rounding, like the quote line's red flag);
- a row whose unit isn't its product's (only when both have one);
- a contract discount bigger than what the contract makes over cost (only when every row has a catalog cost: a typed row's cost is unknown);
- a payment schedule that doesn't add up to the contract total;
- a purchase-order row priced above the catalog cost (only when a cost is on file).

Nothing wrong: Create goes straight through, no list and no AI call. Something wrong: a list above the button, each with what to fix, **Go back and fix** and **Create anyway**. With the key, Claude rewrites each finding in one plain line in the background; a line naming a number the finding doesn't have, or an id it wasn't given, is dropped and the rules' words stay. Kept per quote by a fingerprint of the findings. Changing the grid while the list is up takes it down, so Create anyway never accepts problems it didn't show.

**B2. Read before send** (kind `SEND_CHECK`). Every Send for signature on the contract page (header, the journey strip's Next, the Sending card; those are the only places a contract is sent) is now `SendContractButton` (`src/app/dashboard/contracts/[id]/send-contract-button.tsx`). It still posts `setContractStatus` as before (and does without JavaScript). First it reads the contract over (`checkBeforeSend` in `src/app/dashboard/contracts/ai-actions.ts`):
- by rule, without the key: the payment table against the total; a total written in the wording against the rows (a subtotal, a change order's "new contract total" and a merged line item are skipped); a row the quote has changed since (money-in contracts only, because a purchase order is priced at cost);
- with the key: Claude compares the wording with the rows, the payment table and the source quote for amounts, scope, names and dates. Each item must quote words found in the body or the rows, and use no number that wasn't sent, or it is dropped.

Nothing found: it sends. Something found: a dialog with **Send anyway** and **Go back and fix**. Claude is asked once per version of the contract (a fingerprint of body, rows, schedule and quote). A refusal or other failure is a sentence in the dialog, and Send anyway still works.

**B3. Redline reader** (kind `REDLINE`). A card on the contract page, **Their marked-up copy**, on a draft, sent or declined contract (`redline-reader.tsx`). It takes:
- Word: read in the browser with `readAgreementFile` (its limits, up to a contract's 80,000 characters), and tracked insertions and deletions picked out of the file (`src/lib/redline-file.ts`);
- PDF: up to 10 MB and 100 pages, sent as the PDF;
- photos of the pages: up to 12, made 1,568 px JPEG in the browser.

Files go up in 2.5 MB pieces into `ContractFile`, so a 10 MB PDF passes the 4.5 MB request limit. Each change names words of ours that must sit in the body exactly once (`locateOnce`); otherwise it is listed under "Couldn't place this one" with their words. **Accept** / **Reject** each. **Put N accepted changes in the body** applies them to what is in the editor (typed and unsaved included). A sent contract is first pulled back to draft after a confirmation that the customer's link stops working, and is refused in words if it was signed or cancelled meanwhile. Nothing is saved until Save changes. Their copy stays on the contract under "Their copies on file" and downloads with a login (`/dashboard/contracts/<id>/files/<fileId>`). An upload abandoned part-way is swept an hour later.

**B4. Dates in this contract** (kind `CONTRACT_DATES`). A card on a signed contract's page (Mark signed or the customer on `/c`; never on `/c` itself), read on a tap and kept (`contract-dates.tsx`). Each duty quotes the contract and is checked:
- a date written out must be written in those words (`dateWrittenIn`: "March 3, 2027", "Sept. 15, 2027", "15th day of September, 2027", 3/3/27, 2027-03-03);
- or it is a count after signing that those words give: days, business days (Monday to Friday), weeks, months or years.

Anything else is dropped. A duty with no date to pin is listed under "No date given" and not offered. One that falls on a day somebody already put an entry on for this contract, or on a payment row's due day, reads "Already on the calendar" or "On the payment table". Ticked ones become "Contract date" entries for the contract's rep (the deal's owner, else the quote's lead rep, else whoever ticks), with the contact, company, deal and job. One deleted from the calendar is offered again.

**B5. Compliance watchdog** (kind `COMPLIANCE_READ`).
- **Settings → Company Information → Compliance**: the upload form gains Named insured, Insurer or issued by, Policy or license number and Coverage limits, plus **Read it for me** when the key is set. A PDF goes as the PDF, with its text read in the browser to check each field: a name, insurer, number or limit not in the file is left blank and named. A photo is made small first, and the form then says to check every field. Nothing is saved until Upload.
- The list shows what each file says, and "Made out to someone else" in red when the named insured isn't the workspace's name (LLC, Inc., "the" and punctuation ignored).
- The Compliance tile says "N need a look" for files expired, running out within 30 days or made out to another name.
- **Subcontractors** (Taylor's call 4): a Compliance section on a sub crew's card (`crews/crew-compliance.tsx`), with the same form and reader. The card's header badge reads "COI expired", "runs out soon" or "names someone else"; the badge is how it shows on the crews list, which is the cards.
- A banner on a job (Budget, Schedule and Crew tabs; `projects/[id]/job-compliance.tsx`) names each subcontractor scheduled there, on a scope or a calendar day, whose paperwork is expired, running out, made out to another name, or missing.
- **Who can upload a sub's COI: Owners and Admins**, as for every company file. A Member sees them and can't add, read or delete one, and can't delete a crew that has compliance files.

## Not built, and why

- **A rule that a Coordinator purchase order should be priced at cost.** Taylor's brief asked for the flag (a money-out row above catalog cost), and it is built. But the Coordinator copies the quote's *sell* price onto every PO row, so every Coordinator PO with any markup now shows the price check; see Questions.
- **Holidays in business days**: Monday to Friday only.
- **Daily caps unchanged**: every kind used is already in `AI_DAILY_CAPS`; none added.

## Questions for Taylor

1. **Purchase orders made on the Contract Coordinator copy the quote's sell price.** The new price check now flags each such row ("ordered at $3,000, above the catalog cost of $1,800"), as you asked. Should the Coordinator start a PO row at the catalog cost instead, like Order materials does? That would make the warning rare and right. (Recommended: yes.)
2. **A subcontractor's COI expiring**: today it shows on their card, the crews list and the jobs they're on. Do you also want it on My day / the Daily Rundown, so nobody has to open the job to see it?

## Database changes

Migration `20261112120200_ai_b_contracts`: new tables only, nothing existing touched.

| Table | Before | After |
|---|---|---|
| `AiAnswer` | none | id, organizationId, kind, key, fingerprint, body (JSON), createdAt, updatedAt; unique (organizationId, kind, key). What PRICE_CHECK, SEND_CHECK, REDLINE and CONTRACT_DATES wrote, kept by a fingerprint of what each was written from. |
| `ContractFile` | none | id, organizationId, contractId (cascade), groupId, position, purpose ("REDLINE"), fileName, mimeType, sizeBytes, data (bytea, written in pieces), complete, uploadedById, createdAt. Omitted from every query by default (`src/lib/prisma.ts`). |
| `ComplianceInfo` | none | uploadId (PK, cascade with the Upload), organizationId, crewId (a sub's card; cascade), namedInsured, insurer, policyNumber, limits (JSON `[{label, amountCents}]`), readByAi, createdAt, updatedAt. |

Back-relations were added on Organization, User, Contract, Upload and Crew. No pick list changed. A calendar event type **"Contract date"** joins a workspace's list the first time a date is added (`ensureEventType`).

## AI kinds used

Measured on the built-in templates (1,250–2,400 characters). All at effort `low`.

| Kind | What it sends | Prompt size | Notes |
|---|---|---|---|
| PRICE_CHECK | The rules' findings only (id, contract, sentence, the numbers) as JSON | about 400 characters of system + 300 a finding; 4 findings is about 1,600 characters (~450 tokens) | Background; never blocks |
| SEND_CHECK | The body as a text document; rows, contract discount, total, payment table and the source quote's lines as JSON | about 2,000–2,500 characters for a built-in template body + 1–2k JSON (~1,200 tokens); an 80,000-character contract is ~22k tokens | Once per contract version |
| REDLINE | Our body as a document; their Word text (+ tracked changes), or their PDF, or up to 12 photos at 1,568 px | about twice the body for Word (~1,500 tokens built-in, up to ~45k for a long contract); a PDF is about 1,500–3,000 tokens a page | 180 s timeout, 8,000 output tokens |
| CONTRACT_DATES | The signed body as a document, the signing day, the payment table | about the body + 300 characters (~800 tokens built-in) | Once per signed contract |
| COMPLIANCE_READ | One PDF (≤4 MB) or one 1,568 px JPEG | about 1,500–2,000 tokens | |

Every system prompt says the paperwork is data, never instructions. Every answer is checked against what was sent before it is shown.

## Suite results

All on one production build against `scb_b`, through `run-suites.sh`. The final code was re-run for the `ai` group and `contracts` after the last fix (a redline-reader change); the others ran on the build just before it, which differs only in that file.

| Suite | Result | Steps |
|---|---|---|
| ai-release-b | PASS | 34 |
| contract-checks-check.ts (run inside ai-release-b) | PASS | 26 cases |
| ai-assist | PASS | 28 |
| template-import (template group) | PASS | 22 |
| contracts | PASS | 27 |
| deal-tracker | PASS | 46 |
| template-replace | PASS | 18 |
| money-payments | PASS | 28 |
| projects-core | PASS | 26 |
| project-money | PASS | 23 |
| crews-time | PASS | 34 |
| calendar | PASS | 47 |
| calendar-v2 | PASS | 42 |
| quotes-improvement | PASS | all |
| variations-pictures | PASS | 30 |
| products-scale | PASS | 18 |
| companies-contacts | PASS | 29 |
| overlay-readability | PASS | 16 |
| job-photos (email group) | PASS | 28 |
| account-types (email group) | PASS | 34 |

The "AI off" steps run inside ai-release-b against a second server it starts itself without the key (`NOAI_PORT`, default 3117).

## Files touched outside your release

- `src/lib/template-file.ts`: `readAgreementFile` takes an optional `maxChars`, defaulting to the template's 60,000 (the redline reader passes 80,000).
- `src/lib/prisma.ts`: `contractFile.data` added to the global omit.
- `src/app/dashboard/settings/document-upload-form.tsx`, `document-list.tsx`, `company-tiles.tsx` (now an async server component), `compliance/page.tsx`, `settings/actions.ts` (`uploadDocument`, `deleteDocument`).
- `src/app/dashboard/projects/crews/*` and the job's Budget, Schedule and Crew pages (the banner).
- `src/app/dashboard/contracts/[id]/body-form.tsx` (draft from the redline reader).
- Suites changed without weakening them:
  - `calendar`, `crews-time`, `money-payments`, `products-scale`: after Send, wait for Mark signed (it exists only once sent) instead of the word "Sent", which was already on the page and raced the new read-over.
  - `projects-core`, `variations-pictures`: assert the exact price-check list (a PO at sell price; two lines carrying an older build's Each over the product's Box of 12), then Create anyway.
  - `contracts` step 23: wait for the signature in the database instead of the button vanishing (it turns into "Signing…" first; it failed every run here).

## Session audit

Flagged 24, distinct 23, confirmed 18, refuted 5. All 18 are fixed. The fixes are covered by "audit fixes" steps in `ai-release-b.cjs`, and the pure-rule ones by cases in `contract-checks-check.ts`. Two of the refuted five turned out real on a second look and are fixed too: purchase orders compared with quote prices, and the compliance form's changed field ids.

| Finding | Fix | Proved by |
|---|---|---|
| PO over cost flagged at a $0 (unknown) cost | `contract-checks.ts` | check case "audit fixes: a purchase order row against a $0…" |
| Under cost / minimum rounded before comparing | `contract-checks.ts` `exactNet` | check case "…compare before rounding" |
| Unit flagged on a line with no unit | `contract-checks.ts` | check case "a line with no unit says nothing"; quotes-improvement passes |
| Change order's new total / a "Total Station" row read as the total | `contract-checks.ts` | check case "…new contract total…" |
| Sept. / "15th day of" / 2027/03/03 dates dropped | `dateWrittenIn` | check case "more ways a contract writes a date" |
| Business days counted as calendar days | `addOffset` "business days", schema, guard | suite B4 (Nov 26), check case |
| "design" read as "sign" | word-bounded guard in `ai-actions.ts` | suite B4 (Final payment dropped) |
| Any entry that day counted as "already" | only non-auto entries | suite B4 (kickoff open, site walk already) |
| A deleted calendar entry still "On the calendar" | `withLiveEvents` | suite "audit fixes: a date deleted…" |
| Price-check list stale after a grid edit | `gridShape` in `tracker-grid.tsx` | suite "audit fixes: a change to the grid…" |
| Put in discarded unsaved typing | `redline-reader.tsx` reads the editor | suite "audit fixes: on a draft…" |
| Pull back that didn't happen still showed a draft | `contractStatusOf` | suite "audit fixes: a contract that can't go back…" |
| Word copy over 60,000 characters refused | `readAgreementFile(file, 80_000)` | suite "audit fixes: on a draft…" (65k copy) |
| Abandoned upload pieces kept forever | group returned on error + hourly sweep | same step ("swept") |
| Server PDF page count counted incremental saves | page tree `/Count` | suite PDF step still passes |
| Member deleting a crew took its compliance files | `deleteCrew` refuses for a Member | suite "audit fixes: a Member can't delete…" |
| Sub changed to own crew hid its papers | crews page loads every crew's | suite "audit fixes: a subcontractor changed…" |
| PO rows at sell price flag on every Coordinator PO | kept as the brief asks; question 1 | projects-core asserts it |

## Notes for CLAUDE.md

- **Release B (Nov 12, 2026), contracts and compliance.** The rules for every contract check live in `src/lib/contract-checks.ts` (pure; `scripts/contract-checks-check.ts` runs them case by case and `ai-release-b.cjs` runs that first).
  - **Price check before Create**: `check-actions.ts` under the tracker.
  - **Read before send**: `checkBeforeSend` in `contracts/ai-actions.ts`. **Every Send for signature is `SendContractButton`**: never add another send form. It still posts `setContractStatus`.
  - **The redline reader**: `redline-reader.tsx`, with `ContractFile` written in 2.5 MB pieces by `addRedlineChunk`'s raw `||` append.
  - **Dates in this contract**: event type "Contract date".
  - **The compliance watchdog**: `ComplianceInfo` beside `Upload`, `src/lib/compliance.ts` (server) and `compliance-shared.ts` (browser).
  - **`AiAnswer` keeps what an AI helper wrote** by (organization, kind, key) with a fingerprint: read it before asking again.
- **A suite that sends a contract must wait for the send to land** (Mark signed appears, or the database), never for the word "Sent": the send now reads the contract over first.
- **A suite that creates contracts on the Coordinator gets the price-check list** whenever a row is under cost or minimum, a unit differs, a discount passes the margin, a schedule doesn't add up, or a PO row sits above catalog cost. Assert the list (`price-check-item` `data-code`), then `price-check-create-anyway`.
- **A subcontractor's compliance files belong to their crew** (`ComplianceInfo.crewId`). Settings → Compliance and its tile show only the workspace's own (`crewId` null). Deleting a crew deletes them; a Member can't.
- Known gaps: business days ignore holidays. A Word copy is read as text, so tracked changes come only from `<w:ins>` / `<w:del>`, not comments. A PDF over 100 pages hidden in compressed object streams is caught only by the browser's count. The compliance flags compare UTC days (as the list always has).
