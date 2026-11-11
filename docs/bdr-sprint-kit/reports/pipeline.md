# Pipeline — sprint report

Branch `claude/sprint-pipeline`. The first coder's WIP (81fb5dd) built the loader, tiles, columns, Coming up / Happened, the convert prompt and the phone tabs. This session checked it against `screens/pipeline.md`, finished the panel, brought the suites in line and ran everything green.

## Built

- **Bar:** [Mine | Everyone] comes first. Members open on Mine (decision 17); the choice is in the address bar (`?scope=`) and saved as `User.uiPrefs.pipelineScope`. Then Search, Gone quiet (its count is `goneQuietOpportunities`, inside Mine when Mine is on), **Needs a decision** (`?decide=1`: Meeting Set tiles whose meeting has passed with none ahead) and Lead label. The header's ⋯ (`pipeline-more`) holds Show archived, Contract Coordinator and New quote.
- **Tile:**
  - A 3px top edge in the health colour.
  - Titled by the Primary person, with the company faint under it.
  - The mini meter.
  - One next-step line (`tile-line.ts`): "Meeting Tue 10:00 AM", "Met Nov 6 — how did it go?", "Quote $11.8k · sent 3d", "Quiet 14d — call", and so on.
  - Rep initials and a ⋯ menu (Move to…, Lead label…, Draft follow-up with AI on, Contract Coordinator for a deal, Open).
  - The label chip shows only when a label is set; otherwise "+ label" shows on hover or focus.
- **Meeting Set:**
  - Split into "Happened — how did it go?" (Held / No-show / Reschedule, each with Undo) and "Coming up" (sorted by meeting date).
  - A move forward out of Meeting Set marks the meeting Held. A meeting still ahead first asks "This meeting is Tue Nov 17. Did it happen early?".
- **Column header:** name, one count, and a 6px health-mix bar, with one shared legend above the board. The money total for deal columns is kept.
- **Panel:**
  - The full meter, its reason and the one next-step button on top.
  - People rows with Call / Text / Email / Log and the Primary / Associated / Do Not List switch.
  - Meetings with time, place and note, upcoming first, each answerable.
  - Quotes and the Contract Coordinator.
  - Save shows only when something changed, and the Stage menu saves first.
  - **This session:** Log and Book meeting (and the meter's call / book action) now open the shared `<HowDidItGo>` and `<BookMeetingSheet>` instead of the panel's own forms. The Book meeting sheet offers this tile first ("Add to the open … opportunity?"). The panel uses `useHowDidItGo({ dial: true })`, so coming back from a Call or Text tap opens How did it go? on its own (`data-contact-id` is on each row).
- **Convert prompt:** "What happened after the meeting with <person> (<company>)?" with four cards. They signed requires the amount; Not moving forward asks why (optional chips). Build Quote and Manual Input are both kept. Build Quote makes the deal at Meeting Completed (decision 19); Manual Input moves it straight away.
- **Phone:** sticky stage tabs with counts (Set · Met · Quote · Contract · Closed) above one stage's cards. Each card ends with a full-width 44px next-step button, and the panel is full screen.

## Not built, and why

- **A single "Closed" column on desktop** (ux-gaps): not built. It changes the column layout and names, which needs Taylor's OK. Columns are flexible (`minmax(176px,1fr)`) and the phone already has a Closed tab.
- **The suggested-label chip on tiles:** shown in the panel only, as the plan's hiddenNotRemoved section says.

## API others can use

- `src/app/dashboard/deals/opportunity-actions.ts`:
  - `setPipelineScope('mine'|'all')` merges `pipelineScope` into `User.uiPrefs`.
  - `markMeetingHeld`, `markMeetingNoShow`, `rescheduleMeeting` and `saveLostReason` are registered, used by the board and panel.
  - `moveOpportunity(id, column, { early? })` → `{ success, batchId? } | { confirmEarly: day } | { convert: true } | { error }`.
  - `convertOpportunity({ id, stage, mode, title, valueCents, on, reason?, early? })`.
- `tile-line.ts` (pure): `meetingFocus`, `groupOf`, `tileLine`, `tileAction`, `meetingSortKey`, `compactDollars`.
- `/dashboard/deals?scope=mine|all&decide=1&quiet=1&q=&label=` addresses a filtered board.

## Suite results

All against a production build (`npx tsc --noEmit -p .` clean, `npx next build` green):

- pipeline-opportunities: 37/37
- crm-pipeline-stats: 25/25
- deal-tracker: 43/43
- ai-assist: 26/26
- Extra runs, for suites that reach the board: see "Extra suites" below.

## Files touched outside yours

- `scripts/browser-tests/pipeline-opportunities.cjs`, `crm-pipeline-stats.cjs`, `crm-reps.cjs` and `ai-assist.cjs`: steps moved to the new controls (WIP plus this session).
- `scripts/browser-tests/companies-contacts.cjs` (this session): Move to… is reached through the tile's ⋯; QUO-1000 and the person's link are checked in the panel. Nothing it checks was dropped.

No shared components or migrations were changed.

## Notes for CLAUDE.md

- The Pipeline (Nov 11, 2026, BDR R1 tiles + R7):
  - Mine | Everyone is remembered as `uiPrefs.pipelineScope`; Members default to Mine.
  - Needs a decision = Meeting Set tiles whose meeting has passed with none ahead (`decisionOpportunityIds` in `deals/page.tsx`, the same rule as `meetingFocus`).
  - A move out of Meeting Set marks the meeting Held, asking first when it is still ahead.
  - Build Quote leaves the deal at Meeting Completed until the quote is sent.
  - The panel's Log and Book meeting are the shared sheets.
- Suites: the tile's stage menu is `tile-more` → `tile-move-menu`; the rep is `tile-rep` (`data-owner-id`), edited in the panel's `panel-rep`; the quotes are listed in the panel, not on the tile.
