# Release C report: jobs, photos and money

Branch `claude/ai-release-c`, built on `claude/ai-release` (eecf676). Nothing here is live.

## Built

**C1, tags from the picture (`PHOTO_TAGS`).** Lives on the job's Files tab.
- When a photo is uploaded in the app, it is made small in the browser (1,024 px, JPEG 0.7). Claude then suggests a Photo Type and a Location / Area by id, from the workspace's own lists. The suggestions appear as dashed chips on the tile: tap one to add that tag, or press × to say no.
- Claude may also suggest one new label. It shows as "New: …" and is only created when someone taps it.
- Accepting a Photo Type replaces General Project.
- An id that isn't on the lists, or comes from the wrong list, is dropped.
- Suggestions are stored in `PhotoTagSuggestion`. That row is also the claim, so two tabs never ask twice, and opening the job again never asks again.
- Photos sent through the crew link are asked about the first time someone in the app opens the Files tab: up to 12 per visit, sent in the last 30 days, still missing a Location or a real Photo Type.
- **Select** mode (new on the grid, staff only) offers Suggest tags (asks again), Accept all, and "Check these against the scope".
- Code: `src/app/dashboard/projects/photo-ai-actions.ts`, `src/components/photo-grid.tsx`, `src/components/media-uploader.tsx`, `src/lib/photo-tag-suggestions.ts`, `src/lib/ai-picture.ts`.

**C2, punch list (`PUNCH_LIST`).**
- **Check against the scope** is in an "Ask about this job" card on the job's Budget page. It also runs from Files → Select on the photos picked.
- It sends up to 20 recent pictures (videos and receipts skipped), shrunk to fit under 3.6 MB together. The scopes and their signed rows go with them, each row with its id and fenced.
- Every item must name a row id it was given; photo ids it wasn't sent are dropped.
- The items come back with tick boxes and wording you can edit. **Add N to things to do** writes `ProjectTask` rows. Nothing is added on its own.
- The sheet says the AI can only judge what the photos show.
- Code: `src/components/punch-list.tsx`.

**C3, close-out photo report (`CLOSEOUT_REPORT`).**
- **Make a photo report** is a link beside Close out; Close out itself is unchanged. It opens `/dashboard/projects/[id]/report`.
- The rules pick before and after by Photo Type (Site Walk / Before, Finished Install / After), or by date when the photos aren't tagged. They pair by Location first.
- Claude re-pairs the photos (ids it was sent only, each photo in one pair) and writes a line per pair plus a summary.
- The person edits the words, changes or swaps photos, removes or adds pairs, and saves (`PhotoReport`). Save refuses a photo used twice.
- **Share with the customer** turns on `/jr/<token>`: a public page with no login and no `data-theme`, in the tenant's colours. It has Copy link, Text and Email, which open the person's own apps; nothing is emailed. **Turn off** closes it.
- Photos on that page come only through `/jr/<token>/photo/<id>`, which streams a photo only while the report is shared and only if that photo is in it.
- Without AI, "Pair the photos" still works by the rules.

**C4, site walk to quote (`SITE_WALK`).**
- **Draft from photos** sits in the line editor's bar on a draft quote. You take or pick photos, which are kept small (1,568 px) on the quote as Upload rows with `quoteId` and the Site Walk tag. Then you tick up to 10 and add a sentence.
- Ask one: what the photos show, and the words to search the catalog for. Then `catalogCandidates` runs.
- Ask two: lines drafted from those candidates only, under exactly the rules of Draft lines from the meeting. That is now shared code, `src/lib/drafted-lines.ts`.
- Taylor's call 3:
  - A **Site-walk photos** card on the quote page shows the photos to the team; the customer's copy never does.
  - Photos can be removed until the job is made.
  - They move into the job's Main folder inside `awardFromContract`, which is the one place every path makes a job (signing, Mark as signed, Award without paperwork, Create project).
  - When the job is first made, the photos from all of the deal's quotes move. Later signatures move only the photos of that paperwork's own quote.
  - Deleting a quote removes its un-moved photos and their files.

**C5, photograph the receipt (`RECEIPT_READ`).**
- **Add receipt** is a new Receipts card on the job's Money tab. You snap or pick a photo, which is made small to 1,568 px.
- With AI on, it is read into the form: store, date, total, tax, items. Figures that can't be right come back empty.
- The person picks the scope, checks the store (it shows whether the store is already in their companies) and checks the amounts.
- Save makes a **paid bill from that store** (`src/lib/receipts.ts`):
  - a signed Money-out contract of type Purchase Order, titled "Receipt — Store";
  - rows on the scope picked: goods, plus "Sales tax";
  - one payment row, settled by one payment on the receipt's day.
- So Spent comes from paperwork, and `recompute-projects --check` ties out (the suite checks this).
- The store is matched to a company by name, or made as a supplier company.
- The photo goes in Files → **Receipts**, a mini folder.
- Taylor's call 2: the crew link has **Send a receipt**.
  - The receipt is read the same way and waits in **Receipts waiting for approval** on the Money tab, with who sent it.
  - Its photo belongs to no job until it is approved.
  - An Owner or Admin picks the scope and approves it (then it counts) or declines it (the receipt and the photo go).
  - A Member sees the list but no buttons. A link can have 30 waiting at most.

**C6, ask the job a question (`JOB_QUESTION`).**
- A box in the same "Ask about this job" card.
- Facts go in as JSON (`src/lib/job-facts.ts`): budget per scope, bills by supplier, change orders, crew time, schedule and stage.
- The question is fenced.
- The answer is cut to four sentences, and every number must pass `inventedNumbers`. Otherwise it reads "I couldn't answer that from this job's numbers."
- Nothing is stored.

**Without the key**, every AI control is hidden: chips, Suggest tags, the punch list, the question box and Draft from photos. These still work without it:
- receipts typed by hand, including the crew link's, which arrive unread;
- the photo report paired by the rules;
- site-walk photos already kept, which still show and move.

## Not built, and why

Everything in release-c.md is built. One audit finding is left as a known gap (below).

## Questions for Taylor

1. **What a receipt is filed as.** A receipt's bill is a contract of type *Purchase Order* titled "Receipt — Home Depot", so it shows on the Contracts list and under "You owe" (fully paid). I didn't add a "Receipt" contract type to his pick list without asking. Does he want one?
2. **What store a new receipt makes.** A store that isn't a company yet becomes a **supplier company** (Company Type Distributor, like Order materials does) with a "Home Depot receipts" contact. Is that how he wants Home Depot and Lowe's in his CRM?
3. **Where the punch list and the question box live.** They are in one "Ask about this job" card on the Budget page, under the money bar, and the punch list is also in Files → Select. Is that the right place?

## Database changes

Migration `20261112120300_ai_c_jobs`. It adds new tables and one nullable column only; it touches no existing data, adds no value to an existing enum, and is safe for Instant Rollback.

| Table | Before | After |
|---|---|---|
| `Upload` | — | `+ quoteId` (FK to Quote, ON DELETE CASCADE, indexed): a site-walk photo before its job exists. Cleared when it moves to the job. |
| `PhotoTagSuggestion` (new) | — | `uploadId` unique, `typeTagId`, `locationTagId`, `newKind`, `newName`, `failed` |
| `PhotoReport` (new) | — | `projectId` unique, `token` unique, `summary`, `pairs` JSON `[{beforeId, afterId, line}]`, `shared`, `sharedAt` |
| `JobReceipt` (new) + enum `ReceiptStatus` (PENDING, APPROVED) | — | `projectId`, `status`, `uploadId` unique, `storeName`, `purchasedOn`, `totalCents`, `taxCents`, `items` JSON, `aiRead`, `sentByName`, `photoLinkId`, `contractId` unique, approver fields |

Pick lists: no changes. A receipt from a new store adds a Company (type Distributor). The first receipt on a job adds a "Receipts" photo folder to that job.

## AI kinds used

All six are the kinds already in `AI_DAILY_CAPS`; none were added. All run at `low` effort. Sizes were measured in the suite's requests; tokens are estimated as w×h/750 per picture.

| Kind | What it sends | Size | Calls |
|---|---|---|---|
| PHOTO_TAGS | 1 photo at ≤1,024 px, both tag lists (id \| name), current tags, the fenced file name | ~1.1k image + ~0.3k text tokens | 1 per photo |
| PUNCH_LIST | up to 20 photos at ≤1,024 px (shrunk to 800 / 640 / 512 if they pass 3.6 MB together), scopes and signed rows fenced | ~21k tokens at 20 photos | 1 |
| CLOSEOUT_REPORT | up to 20 candidate photos with role, date and tags; the job and scope fenced; the rules' pairs | ~21k tokens | 1 |
| SITE_WALK | ask one: up to 10 stored photos (≤1,568 px) and the fenced sentence. Ask two: words only, up to 40 candidates | ~25k + ~2k tokens | 2 per draft |
| RECEIPT_READ | 1 photo at ≤1,568 px | ~2.5k tokens | 1 |
| JOB_QUESTION | the job's facts as JSON and the fenced question | ~1–3k tokens | 1 |

- The browser makes every picture small. A storage address is never sent.
- No AI call happens on page load except the crew-photo tags. Those are capped at 12 per visit, and the claim row stops them repeating.

## Suite results

Run through `run-suites.sh` against `scb_c`, after the audit fixes:

| Suite | Result |
|---|---|
| ai-release-c (new) | PASS, 29 steps (3 of them "audit fixes"); includes the AI-off server it starts itself on :3127 |
| ai-assist | PASS, 28 |
| job-photos (email group) | PASS, 28 |
| projects-core | PASS, 26 |
| project-money | PASS, 23 |
| crews-time | PASS, 34 |
| properties-closeout | PASS, 28 |
| quotes-improvement | PASS (58 log lines, "All steps passed") |
| variations-pictures | PASS, 30 |
| deal-tracker | PASS, 46 |
| money-payments | PASS, 28 |
| contracts | PASS, 27 |
| overlay-readability | PASS, 16 |

`npx tsc --noEmit -p .`, `eslint` on every touched file, and `npx next build` are green.

**Session audit:** 16 flagged, 14 distinct, 13 confirmed, 1 refuted ("Select mode acts on photos hidden by a filter", judged intended). 12 are fixed, each with a step:
- the grid's tag list now follows the page;
- the report's Text and Email links keep the site's address after a reload;
- Save refuses a photo used twice instead of dropping the pair;
- the report offers the newest 400 photos, and a clone counts once (the Main-folder copy, else the lowest id, so the choice is the same every time);
- a draft's pairs are always among the photos the editor offers;
- `schema.prisma` now matches the migration's CASCADE;
- a later signature on a deal no longer moves a new draft quote's photos;
- a photo removed on the card no longer stays ticked in the site-walk sheet;
- the job question's dates go in as words (an ISO date let its day and month pass as numbers);
- the store's company is made inside the bill's transaction, under a lock;
- Add receipt forgets a stale match or stale items.

## Files touched outside the release's own new files

- `prisma/schema.prisma`: relations on Organization, Quote, Contract, Upload and Project.
- `src/lib/projects.ts`: `quoteId` added to `CONTRACT_FOR_AWARD`; `moveSiteWalkPhotos` called inside `awardFromContract`.
- `src/lib/storage.ts`: `putSmallObject`, `readSmallObject`, `streamStoredFile`, `smallPictureKey`.
- `src/lib/job-photos.ts` and `photo-actions.ts`: finishing an upload returns the new id, to the workspace's own people only.
- `src/app/files/[token]/route.ts`: `?stream=1` streams a stored file to the workspace's own people (same origin, so it can be drawn on a canvas).
- `src/components/photo-grid.tsx`, `media-uploader.tsx`.
- `src/app/p/[token]/page.tsx`: Send a receipt. "N sent on this link" leaves receipts out.
- `src/app/dashboard/projects/[id]/page.tsx`: the report link beside Close out (its wrapper is now a flex row) and the Ask card. `[id]/files/page.tsx`, `[id]/money/page.tsx`.
- `src/app/dashboard/quotes/ai-actions.ts`: product-to-line mapping moved to `src/lib/drafted-lines.ts`, behaviour unchanged (ai-assist passes). `quotes/actions.ts` `deleteQuote` removes site-walk files. `quotes/[id]/page.tsx`, `line-items-editor.tsx`.

## Notes for CLAUDE.md

**AI on jobs, photos and money (Release C, Nov 12, 2026).**
- Pictures for Claude are made small in the browser by `src/lib/ai-picture.ts`: `pictureForAi`, and `picturesForAi`, which keeps a request under 3.6 MB of base64.
- Job photos are fetched through `/files/<token>?stream=1`, staff only, so the canvas isn't tainted.
- Server side, every picture is checked as a JPEG by `jpegFromBase64` / `readAiImages` (`src/lib/job-ai.ts`). Workspace words are fenced with `fenced()`.
- **Photo tag suggestions** are `PhotoTagSuggestion` rows: one per photo, created *before* Claude is asked (the claim). Each part is set to null once it is answered. `failed` means it isn't asked again on its own.
- **The close-out report** is `PhotoReport`. The customer's page is **`/jr/<token>`** (never `/p`, the crew link); its photos come only through `/jr/<token>/photo/<id>`, while shared and only if in the report. `pairsProblem` refuses a repeated photo on save; `cleanPairs` reads stored pairs.
- **Site-walk photos** are Uploads with `quoteId` set and `projectId` null.
  - `moveSiteWalkPhotos` in `awardFromContract` moves them: all of the deal's quotes when the job is first made, and only the signed paperwork's own quote after that. It sets `projectId` and clears `quoteId`.
  - `Upload.quoteId` cascades, so a deleted quote or deal takes its un-moved rows. `deleteQuote` also removes their files.
- **A receipt is a paid bill**, made by `makeReceiptBill` (`src/lib/receipts.ts`):
  - a signed, payable "Purchase Order" titled "Receipt — Store", with rows on one scope (goods + Sales tax);
  - one payment row settled on the receipt's day;
  - the store's company found or made inside that transaction, under an advisory lock on the name.
- `JobReceipt` PENDING (from the crew link) counts nowhere, and its photo has `projectId` null until it is approved. Approve and decline are Owner/Admin only; Approve claims the row by `contractId: null`.
- **Ask the job** facts are `jobFacts` (`src/lib/job-facts.ts`). Dates are written "Nov 12, 2026", because `withoutDates` doesn't strip ISO dates. The answer is split on `[.!?]` followed by a space, never on every `.` (that broke "$1,000.00").
- The suite is `ai-release-c.cjs` (29 steps). It starts its own AI-off server on `NOAI_PORT` (3127), so it needs a build.

**Known gap.** Deleting a contact or a deal that has a draft quote with site-walk photos removes the rows (they cascade) but leaves the picture files in Blob. Only Delete quote removes the files. This is the same gap as deleting a workspace or a job; a sweep by the `org/<id>/quotes/` prefix is the fix when it matters.
