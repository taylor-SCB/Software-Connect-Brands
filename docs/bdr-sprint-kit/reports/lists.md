# Lists (Contacts + Companies) — sprint report

Branch `claude/sprint-lists`. Plan: Release 6, "Lists that read like a call list".

## Built

**One filter bar on both lists** (`src/components/list-filters.tsx`)
- `[Mine | Everyone | Unowned]`, search, `Filters (n)`, `Sort`, `Columns`, per page; the presets under it.
- Presets. Contacts: My call list · Never touched · Talked — no meeting · Meetings this week. Companies: My accounts · Going quiet · Talked — no meeting · Never touched.
  - **My call list** = Not Actioned / Attempted / Connected / Interested with nothing booked ahead (open calendar entry today or later, a touch dated ahead, or a meeting ahead on an opportunity they're listed on — the health loader's rule). Its order is the follow-ups gone late (oldest late first), then never touched, then the oldest touch.
  - **Talked — no meeting** = Connected / Interested with nothing booked ahead.
  - **Meetings this week** = a Meeting on the calendar, an opportunity meeting, or a logged meeting Sunday–Saturday in the workspace's clock, soonest first.
  - **Going quiet** = last touch more than `Organization.quietDays` ago, not Not Interested / Lost / Archived, oldest first.
  - **My accounts** = mine, not Not Interested / Lost / Archived.
  - Presets sit on top of the scope, so My call list on Unowned is the call list of leads nobody owns (gap fix). Picking My call list from Everyone, or My accounts from anywhere, switches to Mine.
- **Filters panel** grouped Who (Rep with "Me" first, Added by) · Stage (Status, Activity, Lead Label, With deals, Favorites, Owes money) · Where (State, Company, Industry, Company type, Job title) · Data quality (Contact info, Missing info, Added, Auto-filled on companies). Every old filter is kept; active ones are removable chips.
- Activity gains **Not connected in 7 / 30 days** and **Never connected** (from `lastConnectAt`; "not connected" includes never).
- "Needs attention" reads **Missing info**; Lead Label's N/A reads **On a deal, no label yet**.
- **Sort**: Oldest touch first · Recently touched · Recently added · Name · Recently edited ("Meeting time" shows on Meetings this week).
- On a phone the Filters panel, Sort and Per page are a **bottom sheet** with a sticky "Show 27 people"; the presets scroll sideways.

**Contacts list** (`contacts-list.tsx`): checkbox + ☆ · **Person** (pinned while the table scrolls; name, "title · company", deals, Owes) · **Pulse** (mini meter + "4 tries · 1 talk · 6d", plus the toucher's first name when it isn't the rep) · **Next step** (red "Follow-up 3 days late", "Meeting Tue 10:00 AM", or "Nothing booked") · **Best phone** (mobile first, tap to call) · **Rep** (hidden on Mine). **Columns** brings back Email, Phone 2, Location, Industry · Type, Notes, Marketing, Added, Added by, Status.

**Companies list** (`companies-list.tsx`): Company (pinned; "City · Industry", Owes) · Pulse · **Reached** ("2 of 7 talked to") · **Last touch** ("3d · Marcus") · Next step · Rep. Columns: Phone, Website, Industry · Type, People, Marketing, Open pipeline, Status, Added. A **row expand** shows the top three people (most recently reached, then touched; warmest first) with mini meters, Call and Log.

**Header**: + Add (main), Email, **Clean up ▾** (Import CSV, Merge, Find duplicates, Fill in missing on companies). On a phone the header is + Add and ⋯ (Email moves into it). The four old buttons are mounted hidden and pressed by the menu, so their dialogs are unchanged.

**Phone (below 768px)**: a card list — name + health dot, "title · company" (companies "City · 7 people"), mini meter + "6d ago · 4 tries" (companies "Last touch 3d · Marcus"), and a row of 44px **Call · Text · Log** (companies: Call the main line). Log, and coming back from a tel:/sms: tap, open the shared **How did it go?** sheet (`useHowDidItGo({ dial: true })`). Checkboxes only in **Select** mode (a Select button at the start of the presets row). Only one version (cards or table) is ever in the page: the server picks by user agent, the screen width decides after load (`ResponsiveList`).

**Bulk Assign** (`bulk-assign.tsx`, `assign-actions.ts`): the bar sits at the foot of the screen; taking records a teammate owns asks first — "12 of these belong to Priya. Take them?" (or "…Unassign them?") — and nothing is written until Yes; every assign returns an **Undo**, which puts each record back only while it still has the rep the assign gave it. Your own and nobody's records are never asked about. "All matching" now takes the first 1,000 in the list's own order.

**Remembered view** (`src/lib/list-prefs.ts`, `src/app/dashboard/user-prefs-actions.ts`): `User.uiPrefs` keys `contacts.scope|preset|sort|columns` and `companies.*`, merged with jsonb `||`, checked when read. A bare address opens on the saved choice, else the role default (Members: Mine + My call list on Contacts, Mine on Companies; Owners/Admins: Everyone). An address carrying any filter, search or page opens as written, and without `scope` reads Everyone — every old link and bookmark works as before. Sub-panes (Favorites, With deals, Interested) never open on a saved preset.

## Not built, and why

- **Long-press for Select mode**: a Select button does it (long-press on a scrolling list fights the scroll). Said once, easy to add.
- **Row expand on Contacts** (full counts and dates): the Pulse cell's mini meter already opens every step with its date, the counts by type and the score on hover / long-press / focus, which is what the plan's expand held.
- **"First card ~180px down" on a phone**: it's ~430px. The shared page header (eyebrow, title, count, buttons) is ~200px of it and isn't mine; search, scope and presets are one row each.
- **Health sort as its own Sort choice**: the plan's Sort list doesn't have one. "The health sort" timed in the load test is My call list's order (late follow-ups first, then never touched, then oldest touch), which is what Oldest touch first does everywhere.
- **Default order when no preset is picked** is **Recently added** (stable: rows don't jump while you work, and a record you just added is on top). Recently edited, today's old order, stays one pick away.
- **Unowned count on the owner's Team today strip / "Take 10"** belongs to the My day screen.

## API others can use

- `src/lib/list-params.ts`: `LIST_SCOPES`, `SCOPE_LABELS`, `LIST_SORTS`, `SORT_LABELS`, `CONTACT_PRESETS`, `COMPANY_PRESETS`, `PRESET_LABELS`, `presetsFor(kind)`, `effectiveSort(params)`, `VIEW_KEYS`; `ListParams` gains `scope`, `preset`, `sort`, `me`. Links: `/dashboard/contacts?scope=mine&preset=call`, `?scope=unowned`, `?act=nc7|nc30|nconn`, `?sort=touch|recent|added|name|edited`.
- `src/lib/list-query.ts`: `contactWhere` / `companyWhere` honour scope and preset (set `params.me` to the user's id for Mine); `orderFor(sort)`; `pageIds(kind, orgId, where, params, { skip })` — one page of ids in the list's order.
- `src/lib/list-prefs.ts`: `resolveListView(kind, rawSearchParams, parsed, { userId, role }, lock?)` → `{ params, columns, member }`.
- `src/lib/list-columns.ts`: `CONTACT_COLUMNS`, `COMPANY_COLUMNS`, `COLUMN_LABELS`, `columnsFor(kind)`.
- `src/app/dashboard/user-prefs-actions.ts`: `saveListPrefs({ kind, scope?, preset? ("none" clears), sort? (null clears), columns? })`.
- `src/app/dashboard/assign-actions.ts`: `assignRecords({ kind, to, ids? | query?, interested?, confirmed? })` → `{ confirm: { count, total, owners[] } }` (nothing written) | `{ assigned, matching, left, repName, undo }`; `undoAssign(undo)` → `{ restored }`. For My day's "Take 10": call `assignRecords({ kind: "contacts", to: "me", ids })` (unowned records never ask).
- Components: `<CleanUpMenu kind reps/>`, `<ListLogProvider>` + `<LogButton contactId name/>`, `<RowExpand target label/>`, `<ResponsiveList phone desktop initialPhone/>` (`src/components/list-parts.tsx`); `<PulseCell health repId/>`, `<NextStepCell health/>`, `<PhoneLink number contactId?/>`, `<CardActions number contactId? log?/>`, `bestPhone()`, `cardCaption()`, `lastTouchText()` (`src/components/list-cells.tsx`); `<CardCheck/>`, `<SelectToggle/>` (`bulk-assign.tsx`).
- Test ids: `scope-mine|all|unowned`, `preset-<key>`, `filters-toggle`, `filters-panel`, `filters-sheet`, `filters-show`, `sort`, `columns`, `column-<key>`, `cleanup`, `cleanup-import|merge|fill|email`, `find-duplicates`, `pulse`, `pulse-caption`, `next-step`, `reached`, `last-touch`, `row-expand`, `company-people`, `company-person`, `contact-card`, `company-card`, `card-call`, `card-text`, `row-log`, `card-check`, `select-mode`, `bulk-confirm`, `bulk-confirm-yes|no`, `bulk-undo`.

## Suite results

Run against `scb_lists` on a production build (`npx tsc --noEmit -p .` and `npx next build` green):

- `crm-data` 50/50 (11 new "Sprint:" steps: scope and saved scope; a Member's defaults; My call list's members and order with the late follow-up's red Next step; Never touched / Talked — no meeting / Meetings this week; Not connected filters, Missing info, the N/A wording; Sort and Columns remembered; the assign confirm, Cancel and Undo; Clean up; Companies Reached / Last touch / row expand / Going quiet; phone cards, 44px buttons, the sheet's "Show 8 people", Log opening How did it go?)
- `contacts-import-filters` 24/24, `companies-contacts` 26/26, `crm-reps` 16/16
- `load-test` 10/10 at 200,000 contacts: every preset 0.29–0.69s (My call list on Everyone, the health sort, 0.57s; page 50 0.69s), every sort 0.43–0.64s, Unowned 0.42s, Not connected 0.70s, all nine extra columns at 100 rows 1.03s; budget 2s.
- Also run because their steps used the lists: `account-types` 34, `ai-assist` 25, `money-payments` 28, `overlay-readability` 16, `company-enrichment` 9, `follow-ups-status-filter` 17, `contacts-mobile` 15, `crm-accounts` 22, `connected` 30, `looks` 31, `import-slow-db` 3 — all pass.
- Baseline before any change: the four listed suites all passed.

## Files touched outside yours

All source changes are inside the files this screen owns plus new files (`list-cells.tsx`, `list-parts.tsx`, `list-columns.ts`, `list-prefs.ts`, `user-prefs-actions.ts`). `pagination.tsx` is unchanged.

Suites outside my four were edited only where a control moved (Import CSV / Merge / Fill in missing under Clean up, filters in the Filters panel, Last Contacted By into Pulse, optional columns, the assign confirm, phone cards), each with an `openFilters` / `cleanUp` helper and a dated comment: `account-types`, `ai-assist`, `company-enrichment`, `connected`, `contacts-mobile`, `crm-accounts`, `follow-ups-status-filter`, `import-slow-db`, `looks`, `money-payments`, `overlay-readability`. Watch for merge conflicts there with other screens' suite edits.

## Notes for CLAUDE.md

- **The lists (Nov 11, 2026, Release 6).** [Mine | Everyone | Unowned] + search + presets + Filters (n) + Sort + Columns on both lists; scope, preset, sort and columns in `User.uiPrefs` (`contacts.*`, `companies.*`; `resolveListView` in `src/lib/list-prefs.ts`, `saveListPrefs`). A bare address opens on the saved view or the role default (Members: Mine + My call list); any address with a filter, search or page opens as written and, without `scope`, reads Everyone. Default order with no preset is Recently added. My call list = Not Actioned / Attempted / Connected / Interested, nothing booked ahead; late follow-ups first, then never touched, then oldest touch (`pageIds` in `list-query.ts`; the late and booked-ahead id lists stop at 10,000).
- Contacts columns: Person (pinned) · Pulse · Next step · Best phone · Rep (not on Mine); Companies: Company · Pulse · Reached · Last touch · Next step · Rep, row expand to the top three people. Everything else is in Columns. Last Contacted By is the Pulse caption's name.
- Import CSV, Merge, Find duplicates and Fill in missing are under **Clean up ▾**; the real buttons are mounted hidden and pressed by the menu. **A suite reaches them with `cleanup` then `cleanup-import|merge|fill|email`, and a list filter only after `filters-toggle`** (`openFilters`).
- Bulk Assign asks before taking a teammate's records (`confirmed`), and returns an Undo that only rolls back records still holding the assigned rep.
- **Only one of the phone cards and the desktop table is in the page** (`ResponsiveList`): the server picks by user agent, the width decides after load. A test at a narrow viewport without `isMobile` must wait for `contact-card` / `company-card` before reading cards.
