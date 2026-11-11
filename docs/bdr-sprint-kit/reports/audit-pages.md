# Audit: pages (the log sheet, Book meeting, the contact page, the company page)

Branch `claude/audit-pages`, Nov 11, 2026. Done the way AUDIT.md says. **Find:** six reviewers worked independently, one per lens (correctness, data safety, security, performance, plan conformance, phone / accessibility / looks), all over this area's files, using `git diff origin/claude/first-app-creation-cdtbrb...HEAD`. **Dedupe:** one agent merged duplicates. **Verify:** two skeptics per finding, each told to refute it by reading the code and running it where that was cheap. All of this ran as one workflow of 29 agents.

## Findings

| Flagged | Distinct | Confirmed | Refuted | Dropped as nits |
|---|---|---|---|---|
| 12 | 11 | 11 | 0 | 0 |

Two flags were one bug (the data-safety and security lenses both found undoClaim). Both skeptics upheld every distinct finding. The performance lens found nothing.

## Confirmed bugs, each fixed with a proving step

Each new suite step was run against the code from before the fixes. Each one failed there, and each passes now. The suites stop at their first failure, so I made scratch copies that each kept one audit step, to see every step fail on its own. The copies were deleted afterwards.

1. **The log sheet opened a second time for a call that was already logged.**
   - *Cause:* tapping a phone number (`tel:`) or text link (`sms:`) is remembered (`pending` in `dial-return.ts`). Only the "page hidden, then shown again" path ever cleared it. On a desktop the sheet opens another way (the 1.5-second timer, focus coming back, Who to call, Log), so the tap stayed remembered. The next time the rep switched tabs and came back, the sheet opened again.
   - *Fix:* `clearDialReturn()`, called whenever the sheet opens, however it was opened.
   - *Step:* how-did-it-go, "a dial tap answered by a sheet opened another way never opens the sheet again". Before the fix the sheet reopened (`1 !== 0`).

2. **Undo after "Not moving forward" left the tile Lost but said "Undone".**
   - *Cause:* the Lost move makes a deal (`convertOpportunity` / `moveOpportunity`) and writes no batchId. `undoLogCore` skips any opportunity that has a deal. The toast still offered Undo for the Held save, and the sheet promised "the one Undo takes both".
   - *Fix, inside this area:* the toast after Not moving forward has no Undo. It links "Pipeline →" to the tile so it can be moved back. A note under the choice says so, `notMovingForward` returns the tile's id, and the sheet's header comment is corrected.
   - *Still open:* the full fix (Undo that really takes back the Lost move) sits in the data and pipeline files; see "For another area".
   - *Step:* how-did-it-go, "Not moving forward moves the tile to Lost with no half-true Undo". Before the fix the Undo was there (`1 !== 0`).

3. **Rescheduling dropped a timed meeting's time.**
   - *Cause:* the company header's Reschedule started its time box empty, so changing only the day saved the meeting with no time. The sheet's Rescheduled chip and No-show → Reschedule did the same.
   - *Fix:*
     - `meetingFor` now returns `aheadTime`, and `MainAction.meeting` carries `time`.
     - Reschedule starts at the booked time and is keyed on the meeting, so a refresh resets it.
     - The sheet's `movedBooking()` fills in the meeting's own time.
   - *Steps:*
     - company-page, "Reschedule opens on the booked time … moving only the day keeps 9:30";
     - how-did-it-go, "Rescheduled keeps the meeting's time". Before the fix the 9:00 chip wasn't on.

4. **`undoClaim` trusted ids sent from the browser.** Any signed-in user could forge a call and move a person's touches onto a company, and delete Pipeline meetings and tiles.
   - *Cause:*
     - the activity ids, companyId and batchId came from the client;
     - the only ownership check read StatusChange rows of that batchId;
     - the "since" time was parsed from the client's value.
   - *Fix:*
     - `claimActivities` now returns a `claimToken`. It is signed with HMAC (a tamper-proof signature made with `AUTH_SECRET`) by the new `src/lib/claim-token.ts`. It records the batch, the workspace, who claimed, the person, the activity ids per company they came from, and the server's own time. It is good for 30 minutes.
     - `undoClaim({ token })` acts only on those rows, puts each back on the company it came from, and checks who claimed it.
   - *Step:* company-page, "undoClaim acts only on what the claim moved". It replays the real action with the old arguments and with a bad token. Before the fix the forged call went through.

5. **A "Front desk / main line" log could be saved as a talk.**
   - *Cause:* the sheet ignored the picker's `frontDesk` flag, so Talked / Not interested / They replied / Held stayed on. The plan says a front-desk log is always an attempt.
   - *Fix:* the sheet tracks Front desk and turns off those chips (and Rescheduled), with a line saying why.
   - *Step:* how-did-it-go, "Front desk / main line turns off the talk chips". Before the fix Talked was enabled.

6. **"Try again in 30 days" was offered one try late.**
   - *Cause:* "park" was worked out when the sheet opened, before the save.
   - *Fix:* after a save, the sheet re-reads its context (`rereadContext`) before step 2 for every attempt chip (on the contact page and in the Done box).
   - *Step:* how-did-it-go, "with the try limit at 3, the third try offers 'Try again in 30 days' at once". Before the fix it was not offered.

7. **The park choice always said "6 tries".**
   - *Fix:* it now uses the lead's real count, which with the fix in 6 includes this try, so it agrees with the workspace's own limit ("3 tries, never reached").
   - *Proved by* the same step as 6.

8. **On a phone, the contact and company action bars covered the app's tab bar.**
   - *Cause:* nothing set `--phone-tabbar-h`, and the company bar was `bottom-0`.
   - *Fix:* both bars sit on top of the 56px tab bar (plus the phone's safe-area inset at the bottom).
   - *Steps:* health's phone step and company-page's phone step. Before the fix the bar ended at 844 with the tab bar's top at 787.
   - These two steps used to assert "on the bottom edge", which was the bug itself. They now assert "right on top of the tab bar" and that a tap on the tab bar reaches it. That is stricter, not weaker.

9. **The Move, Set follow-up, company Reschedule and Call ▾ panels couldn't be reached with the keyboard.**
   - *Cause:* FloatingMenu is drawn at the end of the page body and never moves focus into itself.
   - *Fix:* a new `src/components/panel-focus.ts` (`usePanelFocus`) does what MoreMenu does. It focuses the panel's first control one frame after opening, and hands focus back to the button on close.
   - *Steps:*
     - health, "Reschedule, Call ▾ and Set follow-up take the keyboard into their panels";
     - company-page's Reschedule step.
   - Before the fix focus never entered the panels.

10. **From 640 to 1023px, "Saved · Undo" sat on the tab bar and the company bar.**
    - *Fix:* the toast drops to `bottom-6` only from `lg` up, which is when those bars go away.
    - *Step:* how-did-it-go, "from 640px to 1023px 'Saved · Undo' sits above the tab bar". Before the fix the toast ended at 976 with the tab bar at 943.

11. **The phone bar's main button spilled its words over Log and ⋯** ("Tomorrow 10:00 AM", "Reschedule", "Signing link").
    - *Fix:* in the bar the button wraps onto two short lines (`whitespace-normal`, 0.7rem, `px-1`, `min-w-0`) inside its 44px target.
    - *Step:* the end of the same health step. Before the fix the text was 92px wide in a 70px button.

## Refuted

None. Every distinct finding survived both skeptics.

## For another area

These were not fixed here:

- **data and pipeline: make Undo take back "Not moving forward" (finding 2).**
  - `notMovingForward` should pass the Held save's batchId into `moveOpportunity` / `convertOpportunity` and their StatusChange rows (`src/app/dashboard/deals/opportunity-actions.ts`).
  - `undoLogCore` (`src/lib/undo-log.ts`) should then delete a deal that the batch made (no quotes or contracts) or put back the stage of one that was moved, and clear the opportunity's `dealId`.
  - Then the sheet can offer Undo again. Today it honestly offers none.
- **data: the server also lets a front-desk log be a talk (finding 5).**
  - `logActivity` (`src/app/dashboard/contacts/actions.ts`, around line 412) accepts TALKED / REPLIED / HELD, or `mark=NOT_INTERESTED`, on a company-only row with `bypass=1`.
  - The sheet no longer sends that, but a forged form can. Refuse a connect outcome or a mark when `onCompanyOnly`.
- **pipeline or data, seen while writing a test and not verified by skeptics:** booking a meeting with `opportunity: "auto"` for a new person at a company whose open tile is already in Meeting Completed joins that tile, and the person goes straight from Meeting Set to Meeting Completed, although their own meeting is still ahead (health suite seed: a Connected person at the same company as the Held one). Worth a look in `syncOpportunity` / the auto-join rule.
- **money (a flaky test, now hardened here):**
  - `companies-contacts.cjs` step 23 read the deal right after "Sign contract" went away.
  - That button turns into "Signing…" while it saves, so the test sometimes read the deal mid-save (one failure in three runs).
  - The step now waits for "Signing…" to go and for the deal to read WON. The check itself is unchanged.

## Files touched outside this area's list

- `src/app/dashboard/companies/actions.ts`: `claimActivities` also returns `claimToken` (a few lines).
- New `src/lib/claim-token.ts`: sign and read a claim's record.
- New `src/components/panel-focus.ts`: `usePanelFocus`, used by the four panels.
- `scripts/browser-tests/companies-contacts.cjs`: the signing wait above.

## Suite results

- `npx tsc --noEmit -p .`: clean.
- `npx next build`: clean.
- eslint on the changed files: clean.
- `run-suites.sh plain:health,company-page,how-did-it-go,companies-contacts,crm-accounts,company-bypass,contacts-mobile,overlay-readability,follow-ups-status-filter` on the final build:

| Suite | Result |
|---|---|
| health | 34/34 |
| company-page | 24/24 |
| how-did-it-go | 23/23 |
| companies-contacts | 29/29 (flaked once at step 23, the signing race above; passed three runs after the wait was fixed) |
| crm-accounts | 22/22 |
| company-bypass | 12/12 |
| contacts-mobile | 15/15 |
| overlay-readability | 16/16 |
| follow-ups-status-filter | 17/17 |

The baseline before any fix was also 9 of 9 green, so none of the old steps caught these bugs.

## Notes for CLAUDE.md

- **Anything fixed at the foot of a phone screen sits on top of the tab bar**: `bottom: calc(56px + env(safe-area-inset-bottom, 0px))`. The tab bar shows below `lg`, not just below `sm`, so a toast or bar that moves for `sm` still covers it on a tablet. Test with `elementFromPoint` on the tab bar.
- **An Undo must take back everything its toast names, or not be offered.** A step that writes outside the save's batchId (a deal made by converting) can't hide behind that save's Undo.
- **Anything Undo acts on comes from the server**, either the batchId's own rows or a signed record (`src/lib/claim-token.ts`). Never ids the browser hands back.
- **A FloatingMenu opened from a button needs `usePanelFocus`** (`src/components/panel-focus.ts`), or keyboard users can't get into it.
- **A count shown after a save is read after the save**, not when the sheet opened. "Park" was one try behind.
- **A remembered tap (dial-return) is spent when the sheet opens by any route**, not only the one that watches for it.
- **A suite that clicks a button whose label changes while pending** ("Sign contract" → "Signing…") must wait for the pending label to go, or for the database, before reading.
