# Screen: TODAY — final report (claude/sprint-today)

## Built

Picked up from WIP commit 73cdde4 (Up next ranking, its fixture check, My day's loader, Team today's data, uiPrefs). The data layer was sound; everything on screen was missing.

**My day** (`/dashboard`, a Member's first tab and landing page; decision 9)
- Report bar for Members: My day · Daily Rundown · Pipeline · Activity · Closing · Money Owed. Their Daily Rundown tab carries `?report=daily`, because a bare `/dashboard` is now My day for them. Owners and Admins see the same bar as before and land on the Daily Rundown.
- The greeting sentence ("Evening, Marcus · 1 follow-up late · 3 to call · Redbud quiet 17 days").
- Three week rings: Tries · Talks · Meetings booked. They fill toward the Owner's goals ("of 50"), or read "+3 vs last week" until a goal is set (decision 11). Each ring opens the Activity report for this week, filtered to the rep.
- **Up next**: the plan's order, via `rankUpNext`. Each row has the health ring around the avatar, the name, the company, the mini meter (md and up), the reason line, and real `tel:` / `sms:` Call and Text links plus Log. Log opens How did it go?, and coming back from the dialler opens it by itself. The list shows 8 rows, then "Show all n". On a phone, a sticky "Next: <name> · Call" bar sits above the tab bar and moves on after each log.
- "12 new leads nobody owns · Take 10", with a confirm and then Undo (decision 18).
- **Meetings**: today plus the next 7 days, and any past meeting still open. Past ones have one-tap Held / No-show with "Saved · Undo". Held goes through `markMeetingHeld` when there is an OpportunityMeeting, otherwise `completeEventWithLog` with outcome HELD.
- Done today is collapsed, one line per save. Jump in for Members has Log a call (asks "Who?" first) · Add contact · Book a meeting (Who? first, then the Book meeting sheet) · Import my list. "Team & money" (the money tiles and Recent activity) and "Reports ▸" are collapsed at the foot.
- Read-only view: `?view=myday&rep=<id>`. It has no Call/Text/Log, Take, or Held buttons, and a "← Team today" link.

**Daily Rundown for Owners and Admins**
- A Team today strip on top: one row per rep who owns records or logged in the last 30 days, so an owner with no book is left out.
- Each row has a last-logged dot (grey after 2h), today's tries · talks (connect rate) · booked, the week with goal rings, and a thin book-health bar. Clicking a row opens that rep's My day, read-only.
- A line underneath counts the unowned, untouched leads.
- Members' Jump in on the Rundown is the BDR shortcuts; Owners keep theirs.

**Settings → General**: a "Team goals" card (weekly tries / talks / meetings booked, each optional, plus the try limit `parkAfterTries`). Owners and Admins can edit it; Members can only read it.

**Calendar**
- Agenda view (`?view=agenda`): Overdue in red, then Today, then each of the next 7 days that has something on. Rows have Call / Text (`tel:` / `sms:` from the contact's mobile, else their phone) and Done, which opens How did it go? (the existing DoneBox) for anything with a person. Tapping the title opens the full card (Edit, Move, delete). Coming back from the dialler opens the sheet.
- A bare `/dashboard/calendar` opens a Member on the Agenda and an Owner on the Month. A phone always swaps to the Agenda. Any address that names a day, view or layout opens what it names, as before.
- Mine / Everyone is remembered per person in `uiPrefs.calendar.scope`. Defaults: Mine for Members, Everyone for Owners. It only applies when the address has no filters. Clear counts as Everyone.
- Month hides logged touches behind "n logged" per day, with a Show logged / Hide logged button that is remembered (`calendar.showLogged`).
- Week scrolls to today's card where the days stack.
- A Call entry's type pill is a real `tel:` button.

**Navigation**
- Phone: a fixed 56px bottom tab bar (Today · Contacts · Companies · Pipeline · More). More opens the whole sidebar tree in today's order and names (every sub-page shown), then Operator console when applicable, Dark/Light, and Log out with a confirm. The sideways strip is gone. The top bar shows workspace, search and avatar.
- Desktop sidebar: unchanged, plus a search icon by the workspace name (people and companies). A Member's Settings link opens My Account.

## Not built, and why

- **Calendar toolbar compaction** (View and Filters menus; Copy week, Calendar+Log and the crew controls moving into them) and the phone's one-week day strip and bottom-sheet New entry. These weren't in my screen's spec list, and moving those controls would have rewritten the calendar suites. The Agenda button is simply added to the Month/Week/Team tabs.
- **"Team & money" doesn't hold the write-up.** It links to the Daily Rundown, where the write-up is, instead of running the narrative a second time on every My day load.
- **The Daily Rundown is not defaulted to "Me" for Members.** ux-gaps flags this as conflicting with Taylor's "everyone sees everyone" rule. My day is already scoped to the rep, so I left the Rundown on the whole team.
- **"Import my list" goes to the Contacts list** (Import CSV is there) and doesn't open the dialog itself. The lists screen belongs to another coder.
- **The Rewrite button for the greeting (AI)** isn't built. The greeting is rule-written.
- **Up next at 200,000 contacts isn't timed.** That needs a load-test step (load group), which I didn't run.
- **Take 10 uses my own two guarded statements, not `assignRecords`.** It takes only leads still unowned, and Undo gives back only the ones this person still holds, so two reps tapping Take 10 at once can't take each other's leads.

## API others can use

- `src/lib/user-prefs.ts`: `type UiPrefs = Record<string, Record<string, unknown>>` (one object per screen), `cleanUiPrefs(value)`, `readUiPrefs(userId)`, `prefChoice(prefs, ns, key, allowed)`, `prefFlag(prefs, ns, key)`, `prefWords(prefs, ns, key)`, `PREF_NAME`.
- `src/app/dashboard/prefs-actions.ts`: `saveUiPref(namespace, key, value)`. It merges one key inside its namespace in one jsonb statement and replaces a malformed namespace. Values are a string ≤200, a number, a boolean, null or ≤40 short strings. Keys in use: `calendar.scope` ("mine"|"team") and `calendar.showLogged` (bool). The lists coder should use `lists.*`.
- `src/lib/up-next.ts`: `rankUpNext`, `upNextCategory`, `upNextReason`, `greeting`, `ringFill`, `connectRate`, `UP_NEXT_ORDER`, `UP_NEXT_SHOWN` (checked by `npx tsx scripts/up-next-check.ts`).
- `src/lib/reports/daily.ts`: `repNumbers(orgId, repIds, timeZone, now)` → Map of `{today, week, lastWeek: {tries, talks, booked}, lastLoggedAt}`. Touches are counted once per batch; a no-show and marketing are never counted. "Booked" is dated by when the meeting went on the calendar. Also `loadTeamToday(orgId, timeZone, now)`.
- `src/app/dashboard/my-day/load.ts`: `loadMyDay(orgId, {id, name}, now?)`.
- `src/app/dashboard/my-day/actions.ts`: `takeUnownedLeads(ids)` → `{taken}` or `{error}`; `giveBackLeads(ids)`.
- Settings: `updateTeamGoals` (useActionState) in `settings/general/actions.ts`.
- Components: `<GlobalSearch className testId/>` (`src/components/global-search.tsx`), `<PhoneTabBar member theme workspace operator/>` and `<SidebarNav member? open? onNavigate?/>` (`src/components/sidebar-nav.tsx`), `<AgendaView today days events overdue choices/>`, `isLoggedTouch(event)`, `wantsCall(event)` and `EventView.contactPhone?` (`calendar-views.tsx`).
- Test ids: my-day, my-day-greeting, week-rings, ring-tries/talks/booked, up-next, up-next-row[data-category], up-next-reason/call/text/log/all, unowned, unowned-take/confirm/undo, next-bar, meeting-row, meeting-held/noshow, done-today, team-money, reports-fold, jump-in-member, jump-log-call, jump-book, jump-who, team-today, team-row[data-rep], team-goals-form, goal-*, agenda, agenda-overdue/today/day/row/call/text/done, cal-view-agenda, cal-show-logged, month-logged, phone-tabs, phone-tab, phone-more, phone-more-sheet, phone-logout, logout-confirm, phone-top-bar, sidebar-search, phone-search, global-search-*.

## Suite results

Production build, local Postgres `scb_today`:

- calendar: 46/46
- calendar-v2: 42/42
- crews-time: 34/34
- looks: 31/31
- overlay-readability: 16/16
- login-case: passed
- **myday: 20/20 (new)**
- reports: 42/42 (run as a check, since the Daily Rundown and `daily.ts` changed)
- `tsc --noEmit` and `next build` are clean, and `up-next-check` passes.

Suite edits that don't weaken anything:
- `calendar.cjs`: after its "Just me" step, it puts Everyone back, because the scope is now remembered.
- `looks.cjs`: the phone's look switch is opened from More. The phone-bar line check reads the new top bar. The "one link marks the page" check reads the tab bar (Calendar is marked as More).

## Files touched outside yours

- `src/components/global-search.tsx` (new)
- `src/app/dashboard/calendar/phone-agenda.tsx` (new)
- `scripts/browser-tests/calendar.cjs` and `looks.cjs` (see above)
- `src/app/dashboard/settings/general/page.tsx` (in my folder; noted because the page is shared)

No migration, and no edits to `globals.css`, `calendar-data.ts` or the log sheet.

## Notes for CLAUDE.md

- **My day / Team today / Agenda / phone tab bar (Nov 11, 2026, release 5)**: everything described above. "Booked" counts OpportunityMeeting by bookedById, dated by the earlier of its own createdAt and its calendar entry's createdAt. Marking a calendar meeting Held can create the OpportunityMeeting on the spot, and that must not count as booked today.
- **uiPrefs is one object per screen** (`{calendar:{…}, lists:{…}}`), written only through `saveUiPref(ns, key, value)`.
- **The calendar's remembered Mine applies only to an address with no filters.** A suite that clicks Mine should click Everyone after it, or later bare visits show only that person's days.
- **A fixed bar inside a `.card` must be portalled to body.** The card's backdrop blur makes the card the containing block. A body portal loses the tenant's `--brand` (set on the shell), so copy it across, as `OnBody` in `my-day/up-next.tsx` does. The existing Sheet / UndoToast portals show the default indigo, not the tenant's brand. That's worth a shared fix.
- Two toasts (a log's and a Held) can show at once in the same spot for up to ten seconds.

## Follow-up

The sprint lead asked for the four calendar items from the plan that I had left out (ux-plan.txt, Calendar section). They are now built on `claude/sprint-today`.

1. **Calendar toolbar.** One row: [Mine | Team] [Agenda · Week · Month] [‹ Today ›] [View ▾] [Filters (n)] [+ New]. Nothing was removed.
   - The scope toggle now reads "Mine | Team" as the plan has it; the first report used Everyone. The Team week view moved into View as "Team week, a row each", so the two no longer share a name on the row.
   - **View** is a FloatingMenu holding the Team week, Calendar / Log / Calendar + Log, and Copy this week into next (shown in Week).
   - **Filters** is a sheet (a bottom sheet on a phone) holding Users, Companies, Contacts, Projects, crew and activity, with "Clear all" and "Done". Their pick lists open in place inside the sheet.
   - Every filter that is on shows as a chip under the row, crew and activity included, with "Clear". "Filters (n)" counts them.
   - The testids are unchanged (`cal-view-team`, `cal-layout-*`, `cal-copy-week`, `cal-users`…). New ones: `cal-view-menu`, `cal-view-panel`, `cal-filters-open`, `cal-filters-sheet`, `cal-filters-done`, `cal-filters-clear`.
2. **Phone.** The Agenda is the default (as before). On top of it sits a one-week day strip: today plus six days, each with its count, 56px tall, and a tap scrolls to that day. Month is hidden from the row below sm and sits in View (`cal-view-month-phone`).
3. **"+ New" opens a sheet** (`cal-new-sheet`; a bottom sheet on a phone, a dialog on a desktop). It starts on Call when the workspace has that type, with Title, Type, Day and Time showing (the time boxes are open). "More: who, where, job, notes" (`event-more`) reveals the rest of the form. The hidden fields still post with their defaults. Elsewhere `EventForm` is unchanged, because the `quick` prop is off by default.
4. **Load.** `load-test.cjs` has a new step that times three pages at 200,000 contacts, with the owner holding 60,000 of them and 140,000 owned by nobody:
   - My day (Up next): 0.44s
   - Daily Rundown with Team today: 0.41s
   - Calendar Agenda: 0.29s

   The budget is 2s, and the slowest page in the run was still Contacts page 2,000 at 1.03s.

Also fixed: the calendar's count line no longer says "with the filters on" when it is only showing Mine.

**Suite edits that don't weaken anything:**
- `calendar.cjs` and `calendar-v2.cjs` open View or Filters before reaching a moved control, close the new-entry sheet with its close button, and open More before filling attendees, location, notes or the owner. calendar.cjs's "two forms share no ids" step opens the day panel's form before the "+ New" sheet, because the sheet now covers the page. calendar.cjs also checks the new filter chip.
- `companies-contacts.cjs`: the calendar's form now opens in a roughly 470px sheet, so it checks the columns the form can hold there (title and type side by side, day and start time side by side, owner and crew side by side) instead of four across.
- `myday.cjs` (22 steps) gained the toolbar, the + New sheet and the phone strip.

**Results** (production build): calendar 46, calendar-v2 42, crews-time 34, looks 31, overlay-readability 16, login-case, myday 22, companies-contacts 26 and load-test 10 all pass. tsc and next build are clean.

**Files touched outside mine:**
- `src/app/dashboard/calendar/event-form.tsx` (the optional `quick` prop)
- `scripts/browser-tests/calendar-v2.cjs`, `companies-contacts.cjs` and `load-test.cjs`

**Note for CLAUDE.md:** a calendar filter other than Users ignores the remembered Mine. Adding a type or company filter shows the whole team's matches, so a link someone sends keeps meaning the same thing.

## Round 2

Built on `claude/sprint-today`, after fast-forwarding onto `claude/sprint-final` (c1f64d0) and applying its migrations. The numbers are the sprint lead's.

1. **The one meeting rule.**
   - Up next asks `waitingMeetings(orgId, {contactIds})`. A row is "Met <day> — how did it go?" only when `due` names a meeting, and anything booked `ahead` takes the row off.
   - Each row carries `opportunityId` (toAnswer, else ahead, else last), and the log and booking sheets are handed it.
   - The Meetings card lists the booked meetings (OpportunityMeeting) on the rep's tiles or booked by them. "Held / No-show" shows only on the tile's `toAnswer` (`waitingMeetings({opportunityIds})`) and goes through `markMeetingHeld` / `markMeetingNoShow`. A bare Meeting entry with no booked meeting behind it is still ticked through `completeEventWithLog`.
   - Every tile link uses `pipelineHref`.
2. **Book on Up next rows.** Each row has a Book button that opens the shared Book meeting sheet (`useBookMeeting`, offered the row's tile). The Up next action buttons are now Call · Text · Book · Log.
3. **Daily Rundown rows.**
   - Every calendar, overdue and gone-quiet row links to its person (or company) and has a Call button (`tel:`, mobile else phone).
   - Done entries fold into a collapsed "Done today (n)" under the open ones (`DailyReport.calendar.doneItems`).
   - Gone quiet names the Primary POC, with company · rep under it (`quiet.items[].person/company`). Its "See all" opens `/dashboard/deals?quiet=1`.
   - Overdue's "See all n" opens the calendar's Agenda (Overdue on top).
4. **Money tiles.** Four tiles in whole dollars: Owed to you, Quoted & sent, Awaiting signature, Open pipeline. Awaiting signature is now a dollar figure: a contract's own rows, or its quote when it has none; purchase orders are left out. Active jobs, Contacts and Signed sit behind "More numbers". The grid is 2×2 on a phone.
5. **The Rundown write-up** is one headline sentence plus "Read more" (`NarrativeCard fold`). All the words are still in the page.
6. **The Rundown on a phone.** Overdue sits above Today (`max-md:-order-1`). The report tabs are one sideways segmented strip with 44px targets.
7. **A Member's Rundown opens on Me.** "Whole team" is `rep=all` in the address bar (the rep picker's value for Members). Owners and Admins are unchanged.
8. **Only teammates who sell.** `sellingReps()` in `src/lib/reports/daily.ts` returns those who own records or logged a touch in the last 30 days. Team today and the Activity report's Rep rows use it, so a teammate with neither gets no zero row and the write-up never calls them "the fewest".
9. **Recent activity is one line per save** (`COALESCE(batchId, id)`, touches dated now or earlier). The line names the people, then the company and who logged it ("Mia Meeting, Tom Talked · Redbud Dental · Marcus Reed"), and the words go under it.
10. **My day's "Team & money"** holds the Daily Rundown's full write-up (not folded), the tiles and Recent activity.
11. **Remembered choices.**
    - `uiPrefs.calendar.view` (agenda / week / month): a bare `/dashboard/calendar` opens on it. The Team week isn't remembered, and a phone only swaps to the Agenda when nothing is remembered.
    - `uiPrefs.myday.teamMoney`: whether "Team & money" is open (`RememberedDetails`).
12. **Greeting Rewrite (AI).** Shown only when `ANTHROPIC_API_KEY` is set, on your own My day. It calls `rewriteGreeting()` in `my-day/actions.ts`, which goes through `askClaude` as `MY_DAY_GREETING` (200 a day, added to `AI_DAILY_CAPS`). Claude is given only the facts, as JSON. Any number in the answer that isn't in the facts gets the answer thrown out. The reworded sentence is shown in place, never stored, and "Use the plain one" puts the rule-written sentence back.

**Suites.**
- `myday.cjs` is 29 steps. The Round 2 steps are titled "Sprint R2: …". Its seed now books Mia's meeting as a real OpportunityMeeting, because the one rule ignores bare calendar entries.
- `reports.cjs`: the calendar card's done entries are checked under "Done today", and Recent activity is counted per save.
- `ai-assist.cjs` gains a greeting step: Rewrite, a made-up number refused, the plain one back, and the AI request counter.

**Files touched outside mine:**
- `src/app/dashboard/reports/report-views.tsx` (the Daily view)
- `src/app/dashboard/reports/narrative-card.tsx` (`fold`)
- `src/lib/reports/activity.ts` (rep rows)
- `src/lib/ai-assist.ts` (one cap)
- `scripts/browser-tests/reports.cjs` and `ai-assist.cjs`

**Notes for CLAUDE.md:**
- A Member's Daily Rundown is "Me" unless the address says `rep=all`.
- "Awaiting signature" is dollars now.
- `sellingReps()` is the one definition of who counts as a rep on the reports.

**Results** (production build): all pass, and tsc and next build are clean.

| Suite | Result |
|---|---|
| myday | 29 steps |
| calendar | 46 |
| calendar-v2 | 42 |
| crews-time | 34 |
| looks | 31 |
| overlay-readability | 16 |
| login-case | passed |
| companies-contacts | 26 |
| reports | 47 |
| ai-assist | 27 |
| load-test | 11 |

Load test at 200,000 contacts: My day 0.48s, Daily Rundown with Team today 0.39s, Agenda 0.19s. The slowest page in the run was 0.98s, inside the 2s budget.
