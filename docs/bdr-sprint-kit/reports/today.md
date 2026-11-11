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
