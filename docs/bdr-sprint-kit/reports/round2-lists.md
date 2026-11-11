# Round 2 — Contacts and Companies lists

Branch `claude/round2-lists`. The eight approved-plan items still unbuilt on the lists (ux-plan.txt: Contacts list, Companies list, hiddenNotRemoved, dataChanges; ux-gaps.txt).

## Built

1. **Activity and Last Contacted By come back from Columns** (Contacts). Two new column keys, `activity` and `lastContacted`, at the head of the Columns menu, remembered in `uiPrefs.contacts.columns` like the rest.
   - Activity is the four count chips (calls, texts, emails, meetings), each a link to the contact's history. The counts come from the page's own health load (already two grouped statements a page), so they match the Pulse caption: once per batch, never a marketing send or a no-show.
   - Last Contacted By is the old `LastContactedCell` ("who" + date), from `lastContactedContacts` — one statement for the page, only when the column is on.
2. **Per page is in the footer.** `Pagination` takes an optional `perPage` and draws a "Per page" select (still labelled "Rows per page") beside the page numbers on both lists. It's gone from the filter bar and from the phone sheet's Order group.
3. **Row tick boxes appear only when wanted** (desktop table). Each box keeps its place (nothing shifts) but is see-through until the row is hovered, the keyboard is in the row or on the box, anything is ticked, or Select mode is on. A screen with no hover always shows them. Tab still lands on every box. The page box in the header stays visible. "Select" is now on desktop too (end of the presets row).
4. **The Import CSV preview reads clearly.** Top to bottom:
   - the summary;
   - the duplicate summary (moved above the table);
   - an offer, unticked: *Keep "Notes" and "Lead Source" as a note on each contact*;
   - the first six rows as **Person · Reach · Company**. Person shows the name, title and place. Reach shows the email, Phone and Mobile. Company shows the company, its "Main" line and its tags. A row that lands on someone already here wears **Updates \<name\>**.
   - The table fits the 672px dialog with no sideways scroll.
   - Ticked, each person gets one GENERAL note: "Notes: …" and "Lead Source: …" lines. Re-importing the same file never adds it twice (an identical note on that person is skipped). The finish screen says how many were kept.
   - Columns offered: unclaimed headers reading Notes, Comments, Remarks, Description, Background, About, Lead Source, Source, Referral, How did you hear…, Origin.
5. **Import my list assigns to the Member.** `/dashboard/contacts?import=1` opened by a **Member** starts "Assign everyone in this file to" on that Member. An Owner or Admin there, and Clean up → Import CSV for anyone, still start Unassigned. They can change it before importing.
6. **Not connected / Never connected leave out people whose status already means a talk.** Those statuses are Connected, Interested, Not interested, and Meeting Set through Won. Done in SQL (Prisma relation filters on `StatusChange`), so **no migration and no backfill**.
   - Never connected: no talk logged, not at one of those statuses, and never moved into a talk status (Connected, Interested, Not interested, Meeting Set, Meeting Completed).
   - Not connected in 7 / 30 days: their date is the later of `lastConnectAt` and the latest move into a talk status. Someone at one of those statuses with neither date is left out; nobody knows when they talked.
   - Lost and Archived say nothing either way.
7. **Pulse filter and sort, from a SQL twin of the health rules** (Contacts).
   - `src/lib/health-sql.ts`: `pulseRulesSql()` is leadHealth()'s colour logic in SQL: the state, the 0–100 score, stalled, late money on a win, and warmth. `contactPulseInputs()` reads its inputs for a whole workspace from the same tables and definitions as the health loader.
   - **Filter**: Filters → Stage → **Pulse**, with Won, Won — owes money, Warm, Cooling, Cold, Trying, Trying — stalled, New and Closed (`?pulse=`). Choices stack as "any of", and each shows as a removable chip.
   - **Sort**: **Warmest first** (`?sort=pulse`) runs Won → Warm → Cooling → Cold → Trying → stalled → New → Closed, most recently touched first inside each. Contacts only; Companies never offer it and a pasted one reads as the default.
   - **Speed**: the list's sets score only "candidates" — won, touched within Q days, talked (or moved into a talk status) within 2Q, or with something booked, late or paperwork out. Everyone else reached can score at most 10 (Cold), and everyone else being tried has nothing late or booked, so the answer is the same.
     - JIT is switched off for that one statement (`SET LOCAL jit = off` in a transaction): the planner's estimate for the per-person paperwork look set off ~2 seconds of compiling.
     - Warmest first went from 6.1s to 1.47s at 200,000 contacts.
   - **Proof**: `scripts/health-check.ts` runs every one of its 140 leadHealth() fixtures through the twin. It also checks the twin's table inputs against `loadContactHealth()` on its seeded workspace, and the list's where-clauses (alone and in every pair and several triples) against each seeded person. `health.cjs` runs that script and checks the list against every person's own meter.
8. **The first card on a phone starts ~185px down** (was ~355–430). On a phone the list header is one row: the search box, with ⋯ (Clean up) and + (Add) beside it. Under it is one sideways-scrolling row: Mine · Everyone · Unowned · Filters · Select · the presets.
   - The page title and count stay for screen readers. The count also shows in the Filters sheet ("Show 27 people") and the footer.
   - A search alone adds no chip row on a phone (the search box shows it).
   - Desktop is unchanged; `looks.cjs` checks the header lands where it always did.
   - The server picks the phone layout from the user agent, as the card list already did; the screen width decides after load.

## Not built, and why

- **Pulse on the Companies list.** A company's health is a roll-up of its people plus its own touches; a SQL twin of `rollUpCompany` is a separate piece of work. The Contacts Pulse filter plus the Company filter covers "who's warm at X".
- **Inside a Reached band, Warmest first orders by most recent touch, not the exact score.** Ordering by score would mean shipping the whole Reached set's scores through the database as ids. The band (Warm / Cooling / Cold) is exact.
- **Bulk "all matching" on a Warmest-first view takes the first 1,000 by Recently added**, not warmest first. `orderFor` has no column for warmth; the filter itself is honoured. (`assign-actions.ts` is outside my files, so I left it.)
- **The ids behind Pulse stop at 12,000** (`PULSE_ID_CAP`). Two kinds of id list are capped:
  - inside Reached, the Warm and Cooling people (Cold is "the rest");
  - inside Won, whichever of won / owes is smaller;
  - among the people being tried, who has something late or booked.
  - Postgres takes about 32,000 values in one statement, and a preset's list (10,000) and Owes money's (10,000) can sit beside it. Past the cap the warmest are kept and the smaller pulses narrow a little less, like the presets.
  - Trying vs stalled is mostly stored columns (`lastTouchAt` against the first moment of the day Q days back), so it scales without ids.
- **Item 6 by migration.** Not needed: the SQL reads `StatusChange` when the list is asked, so nothing is stored and nothing is backfilled. `lastConnectAt` keeps meaning "a talk logged".

## API others can use

- `src/lib/health-sql.ts`:
  - `pulseRulesSql(source, clock)` — `source` is a SELECT giving `key, status, tries, talks, last_touch, last_connect, status_talk, since, next_on, late_n, paper (jsonb), owes_late` (timestamps are UTC `timestamp`).
    - It gives back `key, state, pulse, score, stalled, late, booked, warmth`.
  - `contactPulseInputs(orgId, clock, owner?)`.
  - `loadPulseSets(orgId, clock, owner?)` → `PulseSets`.
  - `pulseWhere(keys, sets)`, `pulseClause(key, sets)`, `pulseStateClause(state)`.
  - `PULSE_ID_CAP`, `STATE_OF_PULSE`, `PULSE_CLOSED`, `PULSE_REACHED`.
  - `clock` is `{ now, timeZone, quietDays }`.
- `src/lib/list-params.ts`:
  - `PULSE_KEYS`, `PULSE_LABELS`, `type PulseKey` (browser-safe);
  - `ListParams.pulses`;
  - `sortsFor(kind)`;
  - `LIST_SORTS` gains `"pulse"` ("Warmest first").
  - Links: `/dashboard/contacts?pulse=warm&pulse=cooling`, `?sort=pulse`.
- `src/lib/list-columns.ts`: `CONTACT_COLUMNS` gains `"activity"` and `"lastContacted"`.
- `<Pagination perPage={{ value, options: [{ size, href }] }} />`, `<PerPageSelect>` (`src/components/per-page-select.tsx`).
- `<ListHeader eyebrow title subtitle actions />` (`src/components/list-header.tsx`). It is PageHeader on desktop; on a phone, actions sit beside the search, so the page around it must be `relative`.
- `<ListFilters initialPhone />` picks the phone layout in the first paint.
- `<ImportCsvButton defaultAssignTo />` and `<CleanUpMenu importAssignTo />`.
- `planContactImport(text, mapped, { keepNotes })`:
  - `ContactImportPlan.noteColumns`;
  - `ImportContactRow.keptNote`;
  - `ImportBatchResult.notesKept`.
  - `importContactsBatch` rows take `keptNote`.
- `useExistingMatches(plan)` and `ImportCleanup({ plan, existing, onMap })` (`import-cleanup.tsx`).
- Test ids:
  - lists: `activity-chips`, `activity-calls|texts|emails|meetings`, `per-page`, `filter-pulse`, `list-header`, `list-search-row`, `list-chips`;
  - import dialog: `import-preview`, `import-preview-row`, `import-updates-badge`, `import-keep-notes-offer`, `import-keep-notes`, `import-notes-kept`.
  - `row-check` has `data-shown="1"` while forced visible.

## Suite results

`npx tsc --noEmit -p .` and `npx next build` are green. Run against `scb_lists2` on a production build:

| Suite | Result | New "Sprint:" steps |
|---|---|---|
| contacts-import-filters | PASS, 26 steps | the import preview; a Member's Import my list |
| companies-contacts | PASS, 26 | — |
| crm-reps | PASS, 16 | — |
| connected | PASS, 30 | — |
| health | PASS, 33 | Pulse filter and Warmest first against every person's own meter, plus `health-check.ts` |
| looks | PASS, 31 | — (desktop header unchanged) |
| overlay-readability | PASS, 16 | — |
| crm-data (email) | PASS, 58 | 8: seed; Not connected; Pulse filter; Warmest first and paging; Activity + Last Contacted By; Per page in the footer; row boxes; phone first card ≤ 200px |
| load-test | PASS, 12 steps | Warmest first 1.47s (Everyone), 1.42s (page 2,000), 1.07s (Mine); Pulse = Cold 0.87s; every pulse adds up to 200,000 of 200,000. Not connected in 30 days 0.94s, Never connected 0.63s, with item 6's SQL |

- `npx tsx scripts/health-check.ts`: PASS, 36 checks. The twin agrees on all 140 fixtures, on the batched loader, and on the where-clauses in every combination.

Fixed at their cause on the way (the suites, not the app, were stale after earlier merges):

- `contacts-import-filters` steps 2, 4, 5, 12 and 13. They now open the folded Details / More details, use Add deal under ⋯, and press Show all on Who to call. The company and contact page redesigns moved these one tap deeper.
- `connected` step 30. The numbers screen took Interested out of the Stats funnel on purpose; the step now checks the funnel's first three steps are Attempted, Connected, Meeting Set.
- `crm-data` step 44's Never connected / Not connected counts drop from 7 to 5: Spr Booked (Connected) and Spr Meet (Meeting Set) are item 6 working. The exact names are now checked.

## Files touched outside yours

- `src/components/list-parts.tsx`: `CleanUpMenu` passes `importAssignTo` through (3 lines).
- `src/components/list-header.tsx`, `src/components/per-page-select.tsx`, `src/lib/health-sql.ts`: new files.
- Suites: `contacts-import-filters`, `crm-data`, `health`, `load-test` (mine), and `connected.cjs` step 30 (stale funnel check).
- Not touched but worth knowing: `src/app/dashboard/assign-actions.ts` reads the new `pulse` filter correctly; its order for `sort=pulse` is Recently added.

## Notes for CLAUDE.md

- **Lists round 2 (Nov 11, 2026).** Columns brings back Activity (four count chips, from the page's health load) and Last Contacted By on Contacts. Per page is in the footer (`Pagination perPage`). Row boxes are see-through until hover / focus / a tick / Select mode, and never leave the tab order.
- **The import preview** is Person · Reach · Company with "Updates \<name\>" and the duplicate summary above the table. It offers to keep Notes / Lead Source as one note a person, unticked, never doubled on a re-import. A Member's `?import=1` starts Assign on themselves.
- **Not connected / Never connected** leave out Connected, Interested, Not interested and Meeting Set → Won with no talk logged. Their date is the latest move into a talk status (`StatusChange`), read when the list asks; there is no migration and `lastConnectAt` still means a talk logged.
- **Pulse** (`?pulse=`, `?sort=pulse` "Warmest first", Contacts only) comes from the SQL twin in `src/lib/health-sql.ts`. **Any change to leadHealth()'s state, score, stalled or owes rules must be made in `pulseRulesSql` too**; `scripts/health-check.ts` fails if they drift (every fixture is run through both). The state and Trying/stalled are stored-column clauses. Bands and Won/owes use id lists capped at 12,000 in all (Postgres takes ~32,000 values a statement). Inside a band, Warmest first is most recently touched first.
- **On a phone** the list header is the search with ⋯ and + beside it, then one sideways row of scope, Filters, Select and presets. The first card is ~185px down. `ListHeader` keeps the title for screen readers; the page around it must be `relative`.
- **Postgres plans with JIT above a cost, and a per-row subquery over JSON can price a 200,000-row statement into it** (2s of compiling for a 0.5s query). `SET LOCAL jit = off` inside a `$transaction` turns it off for one statement.
- **Prisma refuses an `in` list of ~32,000+ values** (P2029, "query parameter limit"). Anything that would hand Prisma a big id list needs a cap or a stored-column clause.
