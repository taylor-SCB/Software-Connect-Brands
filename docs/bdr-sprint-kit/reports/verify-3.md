# Verify-3: final test pass at c76fde8

Machine 3 of 3, Nov 11, 2026. Database `scb_v3`, production build (`next build` clean, `next typegen` clean). No app code changed.

## Results

| Suite | Result | Steps |
|---|---|---|
| health-check (`scripts/health-check.ts`) | PASS | 37 checks |
| up-next-check (`scripts/up-next-check.ts`) | PASS | 6 checks |
| crm-data | PASS | 68 / 68 |
| email-marketing-users | PASS | all (the suite prints no count) |
| password-reset | PASS | all (the suite prints no count) |
| account-types | PASS | 34 / 34 |
| job-photos | PASS | 28 / 28 |
| reports | PASS | 50 / 50 |
| ai-assist | PASS | 28 / 28 |
| template-import | PASS | 22 / 22 |
| **load-test** | **FAIL, twice** | stopped at step 8 both runs |

## load-test: real regressions, not a flake

Both failures are in step 8 ("audit fixes: My day, the Daily Rundown and the Agenda timed after the calendar seed"). That step and its seed were added in 2f780d2 / 955e459 today. Both pages are slow on every load with this data (probed 3× each: Agenda 2.9–3.1 s, My day 2.0–2.2 s). Which one trips the 2 s budget first varies by run.

- Run 1: **Calendar Agenda 2.45 s** (budget 2 s), the slowest page. My day was 1.95 s, just under.
- Run 2 (alone): **My day 2.14 s**. The Agenda wasn't reached.
- Every other page in steps 1–7 was under budget. The slowest of those was Companies Lead Label = Client at 1.41 s. Before the step-8 seed, the same two pages took 0.42 s (My day) and 0.28 s (Agenda).

### 1. My day: Up next query takes 1.9 s (3.8 s under EXPLAIN ANALYZE)

`src/app/dashboard/my-day/load.ts:142` defines the `ahead` CTE, which lists people with an open entry after today. It is used by `NOT EXISTS (SELECT 1 FROM ahead a WHERE a.cid = m.id)` at lines 154, 158, 162 and 167. Postgres estimates the materialised CTE at 1 row, so it plans a Nested Loop Anti Join. After the seed `ahead` holds 427 rows, and the loop rescans them for every row of `mine`. That is 20,000 loops on the 'talked' branch (1.2 s) and 40,000 on the 'trying' branch (2.5 s).

**Fix (not applied):** at lines 154/158/162/167, write `m.id NOT IN (SELECT cid FROM ahead WHERE cid IS NOT NULL)` instead. Postgres then hashes the subplan once. On the same data the query drops from **3,812 ms to 133 ms**. Line 174's `EXISTS (… ahead …)` only runs for the ≤200 picked rows and can stay as it is. A `LEFT JOIN` onto a deduplicated `ahead` would work equally well.

### 2. Calendar Agenda draws every entry in its 8-day window

`src/app/dashboard/calendar/page.tsx:109` calls `loadEvents` (`src/lib/calendar-data.ts:167`, `findMany` with no `take`) for today + 7 days. `AgendaView` (`src/app/dashboard/calendar/calendar-views.tsx:805–819`) draws every row for Today and each later day.

With the seed that is 1,144 open entries in the window plus 1,000 done entries today: **2,204 `agenda-row`s and a 4.38 MB page**. The server answers in 0.54 s; the rest is the browser parsing and hydrating the rows. The slow part is the window's own rows, not the Overdue read, which uses `CalendarEvent_open_startOn_idx` as intended.

**Fix (not applied):** cap rows per day in the Agenda. For example, 60 per section, sorted the same way, with a "Showing 60 of N — open the day" line like `agenda-overdue-more`. Do the capping server-side so the payload shrinks too: a per-day limit in `loadEvents` for `view === "agenda"`, or a windowed SQL query using `row_number() OVER (PARTITION BY "startOn")`. Hiding done entries from Today, or folding them like the Rundown's "Done today", would also cut most of the 1,000.

Logs: `/tmp/v3.txt`, `/tmp/v3-load-test.run1.log`, `/tmp/v3r-load-test.log` (on the verify-3 machine).
