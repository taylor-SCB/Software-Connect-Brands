# Audit: TODAY (My day, Daily Rundown and Team today, calendar, navigation, goals)

Branch `claude/audit-today`. Final audit of the BDR sprint, run as `AUDIT.md` sets out.

- **Find:** six independent reviewers, one per lens: correctness, data safety, security, performance, plan conformance, and phone / accessibility / looks.
- **Verify:** every finding went to two independent skeptics told to refute it. One skeptic per group checked in a real browser where that was cheap.
- **Fix:** every confirmed finding in this area's files was fixed at its cause. Each fix has an `audit fixes:` suite step, and each step was proven to fail on the code before its fix:
  - the `myday` steps by running a soft-assert copy of the suite against a build of the stashed, unfixed `src`;
  - the `ai-assist` step by building `actions.ts` without each fix in turn.

## Findings

| | Count |
|---|---|
| Flagged | 35 (security 3, data safety 4, phone/looks 8, performance 6, correctness 5, plan 9) |
| Distinct | 34 (data safety #3 is the same bug as security #1) |
| Confirmed | 32 |
| Refuted | 2 |
| Fixed here | 26 |
| Confirmed, for another area | 6 (D4, F2, F3, F4, F6, L6), plus two follow-ups for bugs fixed here (C1's read side, F1's fingerprint) |

Some findings were only partly refuted. The confirmed part was fixed and the refuted part is noted against each one.

## Confirmed and fixed

Every proving step is in `scripts/browser-tests/myday.cjs` unless it says otherwise.

### Calendar meetings

**C1 (high). A meeting saved with the calendar form was stamped at midnight UTC.**
- *Cause:* `saveEvent` passed `on: data.startOn`, the bare day, to `markMeetingSet`. In US zones that is the evening before. The one meeting rule then treated a 4pm meeting as "already happened" from about 7pm the night before:
  - Up next said "Met … how did it go?";
  - the Meetings card offered Held / No-show.
  
  Editing a meeting booked from the Book meeting sheet also overwrote its correct moment.
- *Fix:* `calendar/actions.ts` stamps `zonedMoment(startOn, startTime ?? "12:00", tz)`, the same as `bookMeetingCore`.
- *Step:* "audit fixes: a meeting saved on the calendar is its time in the workspace's clock, and moving it moves the meeting".

**C2 (high). Moving a meeting's calendar entry left its meeting on the old day.**
- *Cause:* `moveEvent` only changed the entry. A meeting moved to next week was "waiting for an answer" from its old time.
- *Fix:* `moveEvent` restamps the unanswered meetings tied to that entry, then revalidates `/dashboard` and the Pipeline.
- *Step:* the same step as C1.

**C5 (medium). A meeting whose entry is on a teammate's calendar showed a day early.**
- *Cause:* the Meetings card fell back to the meeting's own stamp (C1's midnight UTC) when the entry wasn't on this rep's calendar.
- *Fix:* `my-day/load.ts` fetches the booked meetings' own entries and takes the day and time from them. "Waiting" and "past" are judged on that moment.
- *Step:* "audit fixes: the Meetings card still lists this week's meeting … on its own day when a teammate holds the entry".

### My day's meetings and Take 10

**C4 (medium). A busy rep's Meetings card dropped this week's meetings.**
- *Cause:* one list from 30 days back, oldest first, capped at 60. It filled with last month's answered meetings. The skeptics partly refuted this: the rep's own calendar entries still showed.
- *Fix:* `load.ts` reads upcoming meetings (from a day before today's window) and unanswered past ones (newest first) separately, all four reads at once.
- *Step:* the same step as C5. It seeds 65 answered meetings.

**C3 (medium). Take 10's Undo disappeared, or never came back.**
- *Cause:* in `up-next.tsx`:
  - the toast lived inside the row that unmounts when a take empties the pool;
  - `undone` was never reset, so a second take showed "Given back" with no Undo;
  - it never expired.
- *Fix:*
  - the row stays mounted while a toast is showing;
  - the toast is keyed per take;
  - it expires after 60 s;
  - Undo reports what it really gave back ("Gave back 9 · kept 1 you've worked").
- *Steps:* "audit fixes: Take 10 keeps its Undo when it empties the pool …" and "… a second take has its own Undo".

**D2 (medium). Undo could unassign leads the rep had already worked.**
- *Cause:* `giveBackLeads` only checked `ownerId = me`. A worked lead lost its rep and dropped out of every Up next, because it no longer counts as an unowned new lead either.
- *Fix:* the give-back also requires `status = 'NOT_ACTIONED' AND "lastTouchAt" IS NULL`, and the toast expires (C3).
- *Step:* "audit fixes: Take 10's Undo keeps the leads she has worked …".

**D3 = S1 (low). Take 10 claimed a lead a teammate had touched since the page loaded.**
- The security angle was refuted: Bulk Assign already lets anyone "Assign to me" an unowned record.
- *Fix:* `takeUnownedLeads` re-checks `NOT_ACTIONED` and never touched.
- *Step:* "audit fixes: Take 10 keeps its Undo when it empties the pool, and skips a lead touched since the page loaded".

### Team & money and the AI greeting

**F1 (medium-high). My day built "Team & money" on every load, even shut.**
- *Cause:* the whole team's overview and the Daily Rundown were built on the server every time. The write-up inside also asked Claude when the page opened, closed `<details>` or not. Every logged touch changes the write-up's fingerprint, so with AI on, the workspace's 60 write-ups a day went on a section nobody had opened.
- *Fix:*
  - `page.tsx` builds `TeamMoney` only when the remembered state is open;
  - `RememberedDetails` saves the choice, then refreshes when opened empty;
  - `readUiPrefs` now runs alongside `loadMyDay` (F5).
- *Step:* "audit fixes: Team & money isn't built while it is shut …".

**S2 (low). Rewrite ran all of My day before checking the AI allowance.**
- The AI-off half was refuted: the button is hidden then.
- *Fix:* `rewriteGreeting` returns early when the allowance is used up. `askClaude` still takes the allowance itself, so the race is unchanged.
- *Step (`ai-assist.cjs`):* "audit fixes: the greeting's numbers come from the counts …". Postgres's counters on Contact show 14 reads per refused tap before the fix and none after.

**S3 (low, cosmetic). The greeting's number check accepted digits from a person's name or reason.**
- *Fix:* only the count fields and the plain sentence's own numbers are allowed.
- *Step:* the same `ai-assist.cjs` step, with a contact named "Studio 54".

### Calendar toolbar and Agenda

**D1 (medium-high). "Copy this week into next" copied the whole team's week while a Member saw Mine.**
- Part refuted: "nothing shows Mine is on". The Mine button does show pressed.
- *Fix:*
  - the toolbar sends Mine, users, companies, contacts and projects;
  - `copyWeek` applies them as the calendar's own filter does, with the ids validated.
- *Step:* "audit fixes: Copy this week into next copies only what Mine shows".

**L1 (medium, narrowed by the skeptics). Clear wrote "team" over a Member's remembered Mine.**
- *Cause:* clearing a company or type filter isn't choosing Team.
- *Fix:* `clearAll` saves Team only when it is clearing a users scope.
- *Step:* "audit fixes: Clear after a company filter keeps a Member's remembered Mine".

**L3 (medium-low). The Rundown's Overdue "See all n" opened a different list.**
- *Cause:* the link carried no rep, and the Agenda's Overdue is capped at 60 with no word of more.
- *Fix:*
  - `DailyReport.repId`;
  - the link carries `users=<rep>`, or `scope=team` for the whole team. `scope=team` is a new address-only calendar parameter and is never saved;
  - a full Overdue says "Showing the 60 oldest".
- *Step:* "audit fixes: the Rundown's Overdue 'See all' opens the Agenda on the same people; a full Overdue says so; Log works on the Agenda; Done today names the rest".

**L4 (medium-low). The Agenda had no way to the history (the plan's "History is a tab").**
- *Fix:* the Agenda takes Calendar / Log / Calendar + Log like the other views. Its Overdue reuses the Log's read when both are on.
- *Step:* the same step as L3.

### Daily Rundown and Team today

**L8 (cosmetic). "Done today (14)" opened on 8 rows with no word of the rest.**
- *Fix:* "and 6 more on the calendar".
- *Step:* the same step as L3.

**L7 (low). Team today's "See them" listed every unowned contact, not the ones it counted.**
- *Fix:* the link is `?rep=none&status=NOT_ACTIONED&act=never`.
- *Step:* "audit fixes: Team today's 'See them' lists the same people its count is".

**L9 (cosmetic). Team today on a phone wasn't the plan's compact card.**
- *Fix:* today's three numbers are larger on a phone. The week's rings are hidden there; they are one tap away on the rep's My day.
- *Step:* the phone step below.

### The phone

**P1 (high). The phone tab bar was covered on a contact's page and a company's page.**
- *Cause:* the contact's Call / Text / Log bar sits at `bottom: var(--phone-tabbar-h)`, and nothing set that variable.
- *Fix:*
  - `layout.tsx` sets `--phone-tabbar-h` below lg (56px plus the safe-area inset);
  - `main` gets room for two stacked bars (`pb-36`).
- The company page's bar (`companies/[id]/sections.tsx`, the pages area's file, fixed here at Taylor's request on Nov 12) now sits at `bottom: var(--phone-tabbar-h, 0px)` like the contact bar, and leaves the home-indicator room to the tab bar. `company-page.cjs` had asserted the bar sat on the very bottom edge, which was the bug; it now checks the bar sits right on top of the tab bar, and the tab bar on the bottom edge.
- *Step:* "audit fixes: the phone — …" checks every tab is the topmost element on a contact's page and on a company's page (which waits for the page's fade-in to finish first), and that the company bar sits above the tab bar. On the old company bar it failed with "5 tabs are covered on a company's page".

**P2 (medium) and P3 (medium). The new sticky phone top bar covered other sticky headers.**
- *Cause:* the top bar covered the Pipeline's sticky stage tabs and the day heading the week view scrolls to.
- *Fix:* the top bar scrolls away with the page, as the pre-sprint phone bar did. The plan doesn't ask for it to stick; the tab bar stays fixed.
- *Step:* the phone step: the stage tabs at 900px down, and today's heading on the week view.

**P4 (medium). The active tab's words were the raw brand colour.**
- *Cause:* 3.98:1 in Dark and 4.47:1 in Light with the default indigo.
- *Fix:* words in `--text-strong`, with the brand on the icon and a 2px bar.
- *Step:* the phone step measures the contrast at 4.5:1 or more.

**P5 (low-medium). Jump in's "Who?" rows scrolled sideways instead of shortening.**
- *Fix:* `items-stretch`.
- *Step:* the phone step: the list's `scrollWidth` is no more than its `clientWidth`.

**P6, P7, P8 (low). Small or overflowing calendar controls on a phone.**
- *Fix:*
  - ‹ › get `pointer-coarse:min-w-11`;
  - tap-to-call gets `pointer-coarse:min-h-11`;
  - filter chips truncate inside `max-w-full`, and their × is a 44px target.
- *Step:* the phone step.

### Speed

**F5 (low).** Independent reads now run together:
- the four meeting reads;
- `readUiPrefs` with `loadMyDay`.

### Changes to existing suite steps (none weakened)

- `myday.cjs`, the Member's Rundown step: the Overdue "See all" link now asserts the corrected `…&users=<rep>`.
- `calendar-v2.cjs` step 10 failed on the base audit branch before any fix. The quote editor's details card joined the one Save at the foot of the page in the money area's Round 2. The step now presses `quote-save` and still checks Quote due moved.

## Refuted

- **L2.** "A phone opens the Month when Month was remembered" is documented as intended (today.md: the phone swaps to the Agenda only when nothing is remembered). Month is reachable through View.
- **L5.** "No-shows are left out of Tries" is a deliberate rule, written down and applied the same way in `constants.ts`, `stats.ts`, `reports/activity.ts`, `health-load.ts` and `health-sql.ts`. Changing it in `daily.ts` alone would make Team today disagree with Stats.

## For another area

| Area | Finding | Where | What to do |
|---|---|---|---|
| pages | **L6:** the log sheet's park caption hard-codes "6 tries, never reached" | `how-did-it-go.tsx:1094` | Owners can now set the limit from 1 to 50; use `ctx.tries` / `ctx.parkAfterTries` |
| data | **D4:** `logEventDone` never checks `doneAt`, so Held tapped in two tabs writes two meeting activities (two tries and talks) and books a next step twice | `src/lib/calendar-auto.ts:~728` | Claim the row with `updateMany({ where: { id, doneAt: null } })` first |
| data | **C1 / C5 read side:** `waitingMeetings` uses `at: row.on` even when the meeting has a calendar entry. Rows the calendar form wrote before this fix hold midnight UTC | `src/lib/meetings.ts:~461` | Use the entry's zoned moment (as `whenOf` already does) or backfill those rows from their entries. My Meetings card already reads the entry; Up next's "Met … how did it go?" still follows `waitingMeetings` |
| data | **F2:** My day's overdue lookup (`due_ev`) and the Rundown's overdue scan every past calendar entry; every logged touch writes one | `CalendarEvent` indexes | Hand-written partial index `("organizationId","startOn") WHERE "doneAt" IS NULL`. The load test times My day before its calendar seed, so this was never measured |
| data | **F3:** `repNumbers`' "last logged" and `sellingReps` filter Activity on `userId` and `createdAt`, which have no index | `Activity` indexes | An index on `("organizationId","userId","createdAt")`. A scaling note: it is inside budget at 110,000 activities |
| pipeline / lib | **F4:** `goneQuietOpportunities` applies its LIMIT across the whole workspace before My day keeps the rep's own. Past 300 quiet opportunities, a rep's own can drop out of the greeting | `src/lib/gone-quiet.ts` | Add an `ownerId` option applied in SQL |
| money | **F1, second half:** the daily write-up's fingerprint includes every calendar entry's done flag, so any logged touch re-keys it and the Owner's Rundown asks Claude again | `src/lib/reports/narrative.ts:73-84` | My day no longer triggers it while shut. Leave per-entry done flags out of the daily facts |
| calendar-data | **F6 (low):** the Agenda runs the full `loadLogs` (three 60-row reads) for its Overdue | `src/lib/calendar-data.ts` | An overdue-only loader. The rest of F6 (Month first, then Agenda, on a phone) is documented as intended |

## Suite results

Production build (`npx next build`) against `scb_audit_today`; `npx tsc --noEmit -p .` is clean.

Every suite passes.

| Suite | Result |
|---|---|
| myday | 39 / 39, nine of them new audit steps (re-run Nov 12 with the company bar check) |
| calendar | 46 / 46 |
| calendar-v2 | 42 / 42 (failed at step 10 on the base branch; see above) |
| crews-time | 34 / 34 |
| looks | 31 / 31 |
| login-case | all steps pass |
| overlay-readability | 16 / 16 |
| companies-contacts | 29 / 29 |
| company-page | 22 / 22 (Nov 12, after the company bar fix) |
| pipeline-opportunities | 43 / 43 |
| reports | 48 / 48 |
| ai-assist | 28 / 28, one of them a new audit step |
| load-test | 12 / 12. Slowest page: Contacts "Warmest first", page 2,000, at 1.21 s (budget 2 s) |

The new checks were run against the unfixed code, and every one failed there:

- **The nine `myday` audit steps:** a soft-assert copy of the suite ran against a build of the stashed, unfixed `src`. Every check failed. The failure messages included "5 tabs are covered on a contact's page", "the active tab's words read 3.98:1", "cal-prev is 28px wide", "a long company chip widens the page to 536px", "the Who? list scrolls sideways (836 > 356)" and "only what was on screen was copied: Copy me (Marcus), Not mine (Taylor)".
- **The `ai-assist` audit step:** built twice against the unfixed `actions.ts`, once without each fix:
  - without the number check, the "54" sentence was accepted;
  - without the early allowance check, "My day was read 14 times for a refused rewrite".

## Notes for CLAUDE.md

- **A booked meeting's moment is its entry's day and time in the workspace's zone, never the bare day.** `OpportunityMeeting.on` is what the one meeting rule compares with now. Anything that writes or moves a meeting entry must stamp `zonedMoment(day, time ?? "12:00", tz)`: the calendar form, Move and the Book meeting sheet. A bare `isoToDate(day)` is midnight UTC, the evening before in the US.
- **Don't build what a shut `<details>` holds.** React mounts a closed `<details>`'s children, so their server reads run and their mount effects fire. My day's Team & money is built only when its remembered state is open; opening it saves the choice and refreshes.
- **`--phone-tabbar-h` is set by the dashboard layout below lg.** Any phone bar that sits on the tab bar uses `bottom: var(--phone-tabbar-h, 0px)`. The phone top bar is not sticky, so sticky headers can use `top-0`.
- **A brand colour is never the colour of small words.** Mark the active thing with the brand (a bar, an icon) and keep the words in `--text-strong`.
- **An Undo toast is keyed per action, expires, and lives outside anything its own action can unmount.** The server side re-checks the row is still in the state the action left it in.
- **Calendar `?scope=team`** opens the whole team without saving it, the way the Rundown's whole-team links need it.
