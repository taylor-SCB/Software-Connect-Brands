# Release C: Jobs, photos and money

Branch: `claude/ai-release-c` (from `claude/ai-release`). Suite: `scripts/browser-tests/ai-release-c.cjs`. Database: `scb_c`.

Where it came from: the Job Photos (Nov 6) and Projects & Budgets (Sept 14) think tanks. Read CLAUDE.md's Projects, the job's Money tab, Crews, Close out, job photos and the Known gaps on Blob storage first. Code: the job page `src/app/dashboard/projects/[id]/` (Files tab `files/`, Money tab `money/`, `close-out-button.tsx`, `scope-card.tsx`), `src/app/dashboard/projects/photo-actions.ts`, `src/lib/storage.ts` (tickets, the local driver for tests), the crew photo link `src/app/p/[token]`, `src/lib/image-resize.ts`, the quote editor `src/app/dashboard/quotes/[id]/` and its AI drafting `src/app/dashboard/quotes/ai-actions.ts`. `npm run recompute-projects -- --check` must stay clean: money on a job is always derived from paperwork.

Photos: never send a storage URL to Anthropic. Make each picture small in the browser (the tile's image drawn to a canvas, about 1,024 px, JPEG 0.7) and send the bytes; keep every request under 4 MB (Vercel's limit), batching when needed. Videos are skipped.

## C1. Tags from the picture (kind `PHOTO_TAGS`)

As photos upload in the app, Claude suggests a Photo Type and a Location / Area **from the workspace's own lists** (by id), shown as dashed chips on the tile: tap to accept, or "Accept all" for a selection. It may suggest one new label, marked as new, which is only created when accepted. "Suggest tags" also works on photos picked in Select mode. One photo per request (about 1 cent; cap 500 a day). Suggestions are stored until accepted or dismissed, so reopening the job doesn't pay again. Photos sent through the crew link get suggestions the next time someone in the app opens the job.

## C2. Punch list (kind `PUNCH_LIST`)

On a job: **Check against the scope**. Claude compares the job's most recent photos (up to 20, or the ones picked) with its scopes and contract rows and lists what it can't see yet, each item naming the scope line and the photos it looked at. Tick items to add them to the job's things-to-do (`ProjectTask`); nothing is added on its own. Every scope line it names must be one it was given. Say plainly that it can only judge what the photos show.

## C3. Close-out photo report (kind `CLOSEOUT_REPORT`)

Beside Close out (`close-out-button.tsx`; don't change what Close out does): **Make a photo report**. Claude pairs before and after photos (by Photo Type tags where they exist, else by date) and writes one plain line for each pair plus a short summary. The person edits the words, removes or swaps photos, and saves. **Share** gives a link for the customer (a new public page with a token, no `data-theme`, like `/q`; pick a short path that isn't taken, never `/p`, which is the crew link) with Copy link · Text · Email opening the person's own apps, like Send quote. Nothing is emailed. Photos on that page are served by token the way `/files/<token>` does, only those in the report. The report can be turned off.

## C4. Site walk to quote (kind `SITE_WALK`)

On a draft quote: **Draft from photos**. Take or pick up to 10 photos and add one sentence. First Claude names what it sees and the words to search the catalog for; then the catalog is searched (`catalogCandidates`) and Claude drafts lines from those candidates only, with exactly the rules of Draft lines from the meeting: a line names a candidate's id with a quantity or is a typed line at $0 marked **Price needed**; lines land in the editor unsaved; the quote stays a Draft; the AI's reason shows in the editor only, never in printed project notes. Both asks count against `SITE_WALK`.

Taylor's call 3: **the photos are kept** on the quote (stored like job photos, with tickets), shown on the draft quote (never on the customer's copy), and **moved into the job's Main folder when the job is made from the signed paperwork** (find every path that makes a job: signing, Mark as signed, Award without paperwork, Create project).

## C5. Photograph the receipt (kind `RECEIPT_READ`)

On the job's Money tab: **Add receipt**. Snap or pick a photo; Claude reads the store, date, total, tax and items. The person picks the scope, checks the supplier (matched to an existing supplier or company by name, else a new one) and the amount, and saves. It lands as a **paid bill from that store** on that scope, counted in Spent through the same paperwork the Money tab already reads (find how Spent is derived and fit the receipt into it, so `recompute-projects --check` ties out), with the receipt photo filed in the job's Files.

Taylor's call 2: **the crew photo link gets "Send a receipt"** too. A receipt sent there is read the same way but **waits** in a "Receipts waiting for approval" list on the Money tab for an Owner or Admin, who picks the scope and approves (then it counts) or declines (it's removed). Until approved it counts nowhere. Who sent it (the name typed on the link) stays on it.

## C6. Ask the job a question (kind `JOB_QUESTION`)

A box on the job page: "Are we over on electrical?" Claude answers in up to four sentences **from the job's own numbers only** (Awarded / Spent / Committed / Left per scope, bills by supplier, change orders, crew time, schedule dates, stage), given as JSON. Every number in the answer must pass `inventedNumbers`; otherwise "I couldn't answer that from this job's numbers." Only people who can see the job's Money tab can ask. Not stored beyond the page.

## Suites to run

`"ai:ai-assist,ai-release-c"` and at least `email:job-photos`, `plain:projects-core,project-money,crews-time,properties-closeout,quotes-improvement,variations-pictures,deal-tracker,money-payments`. Add whatever else your files touch.
