# Round 2 — contact page and company page

Branch `claude/round2-pages`. All eight items built, each with a "Sprint:" step in the new suite `scripts/browser-tests/round2-pages.cjs` (10 steps).

## Built

1. **Edit on your own history lines.** `updateActivity` server action (contacts/actions.ts). It changes the body, outcome and when. A line logged on several people at once is changed on every copy, and its calendar copy (`auto: true`) follows. A booked meeting that the line ticked done keeps its own day. Who can edit: whoever logged the line, or an Owner or Admin (the same check as Delete). It is workspace-scoped. It refuses a marketing send, a day in the future, and an outcome that doesn't fit the kind of touch. A blank body takes the outcome's words. The inline editor is `ActivityEdit` (src/components/activity-edit.tsx), shown by `ActivityFeed` when an item carries `edit`. It is on the contact page's history and the company page's feed. **Undo on an edit:** "Saved · Undo" sits on the line for 10 seconds, and Undo writes the previous values back through `updateActivity`. It does *not* call undoLog, because undoLog takes the whole save away (it would delete the line). The pending Undo survives the line moving to another day's group. **Statuses the original save moved are not replayed.** For example, editing Talked to Voicemail does not take back Connected. The edit corrects the record, nothing more.
2. **Coming up rows each get Held / No-show / Move** (contact page). `loadUpcomingActions` in contact-data.ts maps each row to its OpportunityMeeting (by eventId, batched). "Answered" uses `answerOf` from meeting-rule.ts, and an answered meeting offers Move only. Rows render through `ContactUpcoming` → `UpcomingCard`'s new `rowActions`, using the shared `useMeetingActions` / `MoveButton` / `EarlyConfirm`. Non-meeting rows (a site walk, a call) get Move only.
3. **Phone meter: All steps in a bottom sheet.** The header-size `LifecycleMeter` gets an "All steps" button (44px) under the phone line. It opens the shared `Sheet` with all seven steps, their dates, who moved them, the next step's hint and the reason. The contact page, company page and opportunity panel all get it. The `lifecycle-phone` text is unchanged.
4. **Meeting Set by hand offers "Book it" first.** `StatusPanel` / `StatusPicker` take an optional `onBook`. With it, picking Meeting Set shows "Book it" (opens the shared Book meeting sheet), "Just set the status" (the old path) and Back. Wired on the contact page's ⋯ More (`page.openBook`) and the company page's ⋯ More (`CompanyStatusPicker`, which books the warmest person). Without `onBook`, nothing changes.
5. **+ Event from a lead's page.** Sales types come first (`salesFirst` in src/lib/event-order.ts: Call, Meeting, Email, Text, quote and contract milestones, then the rest, nothing dropped). The default type is **Call while the meter's next step is to reach them (action key `call`), Meeting after that**. This applies on both the contact and company pages, through `UpcomingCard`'s new `typeOrder`.
6. **Company Add person is a bottom sheet on a phone** (below 640px). `AddPersonSearch` uses the shared `Sheet` with the same search inside. It keeps the testid `add-person-panel` (now a role=dialog), so the existing phone checks still apply. Desktop is unchanged (FloatingMenu).
7. **One toast slot on the contact page.** `ContactShell` passes `onToast` / `onChanged` to the How did it go? and Book meeting sheets, so their "Saved · Undo" lands in the page's one `UndoToast`. The newest toast replaces the older one. Undo refreshes the page.
8. **Company Book / Reschedule pass the right opportunityId.** `bookingTiles` (companies/[id]/load.ts, two statements for the page) picks the no-show's tile (`missed`, from waitingMeetings), else the person's latest-touched open tile. `BookPerson.opportunityId` carries it, and `shell.book()` hands it to the sheet. The header's Reschedule after a no-show is the `book` action, so it is covered too.

## Not built, and why

All eight items are built. Judgement calls that someone may want revisited:
- An edit doesn't re-run status moves (see item 1). Re-running them would mean replaying the original save, which is undoLog's job.
- "Call or Meeting" follows the meter's action key. An untouched or attempted lead gets Call; everyone else gets Meeting.

## API others can use

- `updateActivity({ activityId, body, outcome, on, time }) → { success?, error?, previous? }` and the types `ActivityEditValues` and `UpdateActivityResult`, all in `src/app/dashboard/contacts/actions.ts`.
- `<ActivityEdit activityId type body outcome on time today />` (src/components/activity-edit.tsx). `ActivityItem.edit?: { on, time, today } | null`.
- `UpcomingCard` new optional props: `rowActions?: (event) => ReactNode` and `typeOrder?: string[]`.
- `StatusPanel` / `StatusPicker` new optional prop `onBook?: () => void`.
- `salesFirst(types)` in `src/lib/event-order.ts`.
- `loadUpcomingActions(org, events, today)` and the type `UpcomingMeeting` (contacts/[id]/contact-data.ts). `ContactUpcoming` (contacts/[id]/contact-upcoming.tsx).
- `bookingTiles(org, ids, now, timeZone)` (companies/[id]/load.ts). `CompanyStatusPicker` (companies/[id]/header-actions.tsx).
- New testids:
  - Editing a line: activity-edit, activity-edit-form, activity-edit-body, activity-edit-outcome, activity-edit-on, activity-edit-time, activity-edit-save, activity-edit-cancel, activity-edit-saved, activity-edit-undo, activity-edit-undone.
  - Coming up rows: upcoming-held, upcoming-no-show, upcoming-move (plus -menu, -day, -save).
  - Phone meter sheet: lifecycle-steps-open, lifecycle-steps-sheet, lifecycle-sheet-step, lifecycle-sheet-date, lifecycle-sheet-reason.
  - Book it offer: status-book-offer, status-book-it, status-set-anyway.

## Suite results

Run against a production build on scb_pages:

| Suite | Result |
|---|---|
| health | PASS, 32 steps |
| company-page | PASS, 22 steps |
| how-did-it-go | PASS, 17 steps |
| companies-contacts | PASS, 26 steps |
| crm-accounts | PASS, 22 steps |
| company-bypass | PASS, 12 steps |
| contacts-mobile | PASS, 15 steps |
| overlay-readability | PASS, 16 steps |
| follow-ups-status-filter | PASS, 17 steps |
| calendar-v2 | PASS, 42 steps |
| round2-pages (new) | PASS, 10 steps |
| connected | **FAIL at step 30**, not caused by this branch |

**Why `connected` fails.** Step 30 expects Interested in the Stats funnel. `src/app/dashboard/stats/page.tsx` leaves Interested out of the funnel on purpose (`FUNNEL_STEPS`, with a comment saying so), merged before this branch from claude/sprint-numbers. This branch touches nothing in Stats. Whoever owns Stats or connected.cjs needs to decide which one is right; I didn't change either.

`npx tsc --noEmit -p .`, `npx next build` and eslint on the changed files are all clean.

**One check I changed in companies-contacts.cjs.** It asserted that + Event starts on Meeting for a brand-new contact. Under item 5 an untouched lead now starts on Call. The step now asserts Call, plus the sales-first order and that Install comes after the sales types. round2-pages asserts Meeting for someone already reached.

## Files touched outside yours

- New: `src/components/activity-edit.tsx`, `src/lib/event-order.ts`, `src/app/dashboard/contacts/[id]/contact-upcoming.tsx`, `scripts/browser-tests/round2-pages.cjs`.
- `scripts/browser-tests/companies-contacts.cjs`: the + Event assertion (see above).
- `src/app/dashboard/companies/[id]/load.ts`, `company-shell.tsx`, `header-actions.tsx`: in the owned company-page directory.

## Notes for CLAUDE.md

- History lines have **Edit** (body, outcome, when) for whoever logged them or an Owner/Admin. It goes through `updateActivity`, across the whole batch and its auto calendar copy. Its Undo writes the old values back; it is never undoLog. An edit never re-runs status moves.
- Picking Meeting Set by hand offers "Book it" first wherever `onBook` is passed (the contact and company ⋯ More). A suite that sets Meeting Set by hand there must click `status-set-anyway`.
- "+ Event" from a contact or company page lists sales types first and starts on Call while the next step is to reach them, Meeting after that.
- The contact page has one toast slot. The sheets there hand their toasts to it.
- The company page's Book offers the person's own tile: the no-show's, else their open one (`bookingTiles`).
- connected.cjs step 30 disagrees with the Stats funnel (Interested left out on purpose). It needs reconciling.
