# Final audit — pipeline

Branch `claude/audit-pipeline`. Area: the Pipeline board, its tiles, its panel, the convert prompt, opportunities and lead labels. That covers `src/app/dashboard/deals/*` (not `tracker/`), `src/lib/opportunities.ts`, `lead-labels.ts`, `lead-label-rules.ts` and `src/components/lead-label-chip.tsx`.

How it ran:

- **Find:** six independent reviewers, one per lens: correctness, data safety, security, performance, plan conformance, and phone / accessibility / looks.
- **Dedupe:** one merge pass over their findings.
- **Verify:** two skeptics per distinct finding, each told to refute it. One focused on whether the code really says that and whether the plan intends it; the other on whether the scenario can really happen end to end. A third skeptic broke the one 1–1 tie inside my area (#6).
- **Tooling:** all of it ran as one Workflow (39 agents).

## Findings

| | count |
|---|---|
| Flagged | 17 |
| Distinct | 16 |
| Confirmed | 12 (one latent; see #4) |
| Refuted | 4 (one of them a 1–1 split with no majority, in another area's file) |

## Confirmed, with cause, fix and proving step

Every proving step is an "audit fixes:" step at the end of `scripts/browser-tests/pipeline-opportunities.cjs`.

- **Isolation:** each step seeds its own `op_a_…` rows and opens a fresh page.
- **Failures are collected, not thrown:** a failed step is recorded and the run reports all of them at the end. That way one run on the old code shows every step failing.
- **Before the fixes:** with `src/` stashed and rebuilt, all 9 steps failed.
- **After the fixes:** all 9 pass.

**#3 (high): Save in the panel overwrote the deal's rep.**
- **Cause:** `loadOpportunity` returned the opportunity's `ownerId`, but the tile shows the deal's. `saveOpportunity` then wrote that rep onto the deal on every save.
- **Failure:** rep A books the meeting and rep B makes the deal. Anyone who changed only the label silently moved B's deal, and its money, to A.
- **Fix:**
  - The panel reads the rep the tile shows: the deal's once there is one.
  - Save sends `ownerOriginal`, the rep the panel opened with.
  - The rep is written to the opportunity and the deal only when it was changed in the panel.
- **Step:** "saving only a label in the panel keeps the deal's own rep".

**#0 (medium): a Build Quote deal skipped the convert prompt.**
- **Cause:** decision 19 leaves a Build Quote deal at `LEAD`. The board opened the convert prompt only for a tile with no deal. `moveOpportunity` moved a LEAD deal straight through `updateDealStage`.
- **Failure:** a drag, Move to… or the phone's "Start a quote →" put the deal and the contact at Quote Sent while the quote was still a draft. It also allowed Won at $0, and moved the tile out of Meeting Set without holding the meeting.
- **Fix:**
  - `moveOpportunity` answers `{ convert: true }` for any tile that isn't converted yet. The board checks `isDeal()` instead of `tile.deal`.
  - The convert prompt's Build Quote opens the deal's existing quote rather than making a second one (`existingQuote`). It doesn't ask for AI-drafted lines on an existing quote.
  - The phone card of a tile with a draft quote reads **"Send the quote →"** and links to that quote (`tileAction(column, focus, draftQuoteId)`, new action kind `link`).
- **Step:** "a Build Quote deal whose quote is a draft goes through the convert prompt…".

**#1 (medium): the panel's People list never took in what a sheet added.**
- **Cause:** a reload of the same tile replaced `detail` but kept the form as it was.
- **Failure:** a person added by Book meeting was missing from People. A phantom Save appeared, and Save and the Stage menu were refused with "someone was added meanwhile".
- **Fix:** a reload merges into the form.
  - A field nobody edited follows the new read.
  - A person's role follows unless it was ticked here.
  - New people are added.
- **Step:** "a person a sheet adds while the panel is open joins People, with no phantom Save, and Save still works".

**#2 (low): converting from Meeting Set held the meeting with no Undo, and a lost race left it held.**
- **Fix:**
  - The convert prompt passes the `batchId` back. The board says "Converted to a deal · the meeting is marked Held", and its Undo takes the Held back.
  - A convert that loses the race to another tab undoes its own Held (`undoLogCore`) before it reports the error.
- **Step:** "converting from Meeting Set holds the meeting and says so with Undo".

**#6 (medium, upheld 2–1 after a tiebreak): Needs a decision read every Meeting Set opportunity on every load.**
- **Cause:** `decisionOpportunityIds` ran `findMany` with no cap, then `waitingMeetings` with all of those ids.
- **Failure:** an import that leaves 20,000 people at Meeting Set makes 20,000 tiles with no meeting, and each was read and passed through on every open, filter click and refresh.
- **Fix:** only tiles with a meeting are read (`meetings: { some: {} }`). That is a necessary condition for a passed meeting, so the result is identical.
- **Step:** "Needs a decision skips tiles with no meeting".
  - It times the board, with a search that matches nothing, alone and then with 40,000 meetingless tiles, and checks the difference is under 140 ms.
  - Old code: +173 ms. New code: +57 to +81 ms. What is left comes from the board's other counts.

**#10 (medium): Escape in a menu inside the panel closed the whole panel and lost unsaved edits.**
- **Fix:** the panel ignores Escape while anything is drawn over it: a menu, a sheet or a dialog. The menu closes only itself.
- **Step:** "Escape in the panel's Stage menu closes the menu only".

**#15 (low): the panel was `aria-modal` but never took focus or kept it.**
- **Fix:**
  - On open, focus moves to the panel's Close button.
  - Tab and Shift-Tab stay inside the panel, except while something sits over it.
  - Focus goes back to the opener on close.
- **Step:** "opening a tile from the keyboard puts focus in the panel and Tab stays inside it".

**#12 (medium): the tile's ⋯ menu, the keyboard alternative to dragging, couldn't be reached by keyboard.**
- **Fix:** a new `useMenuFocus(open, testId, anchor)` in `lead-label-chip.tsx`, used by the tile's ⋯ menu, the Stage menu and the Lead label menu.
  - It focuses the current or first choice, two frames after opening, because the panel is hidden for the frame it takes to place itself.
  - Up, Down, Home and End walk the choices.
  - Focus returns to the button on close.
- **Step:** "the tile's ⋯ menu is reached by the keyboard".

**#11 (medium): on a phone the sticky stage tabs slid under the sticky top bar.**
- **Fix:** the tabs stick at the top bar's measured height (a `ResizeObserver` on `[data-testid=phone-top-bar]`).
- **Step:** "on a phone the stage tabs stick below the top bar…". On the old code they sat at y=0, under a bar 61px tall.

**#13 and #14 (low): touch targets under 44px on the phone board, the panel and the convert prompt.**
- **Fix:** `[@media(pointer:coarse)]:min-h-11` (and `min-w-11`) on the controls that were too small: panel Save / Cancel / Close, meeting Held / No-show / Reschedule, the Stage and Lead label chips and their options, role ticks, quote links, the convert prompt's buttons and cards, the early dialogs, the toast's Undo / reasons / Skip, and the filter bar.
- **Step:** the same phone step measures panel-save, panel-cancel, tile-move, lead-label-picker, a role row, convert-save and convert-cancel.

**#4 (low, latent): `updateDealStage` accepted LEAD, CONTACTED and ARCHIVED.**
- **Status:** both skeptics upheld it. On closer reading it can't be called from a browser today: no client component imports it (`stage-select.tsx` is unused), so Next registers no action id for it. Its only caller was `moveOpportunity`, which #0 has taken off this path.
- **Fix, as hardening:** it accepts only the four board deal stages, and refuses a LEAD or CONTACTED deal with "Convert it from its tile on the Pipeline first".
- **Step:** none that can fail before the fix, since nothing reachable called it with those stages. The reachable path is covered by #0's step.

## Refuted

- **#5: meeting notes not escaped inside `<meeting>` fences** (`src/lib/ai-assist.ts`, another area's file). The skeptics split 1–1, so it is not confirmed. The fence is a hint, not a boundary, and every AI answer is a suggestion a person accepts.
- **#7: full LeadHealth on every tile is too heavy.** Both skeptics refuted it: the tile's hover breakdown (decision 6) reads nearly all of it.
- **#8: "They signed" with Build the quote first skips the amount.** Both refuted it: the option was approved and kept, and the dialog says where the deal lands.
- **#9: Meeting Set → Completed with no recorded meeting writes no Held.** Both refuted it: moving by hand is approved, and there is no meeting to record (decision 1, never guess history).

## For another area

- **today / money:** `quotes-improvement` fails at step 42, "the dashboard's quoted and open-deal figures follow". It fails the same way on this branch with my fixes stashed, so it was there before this audit. The quotes list and the Pipeline parts of that step pass.
- **data (`src/lib/ai-assist.ts`):** #5 above is unconfirmed (1–1). If that area wants to close it, it is cheap: escape `<` in `notesForPrompt`.

## Suite results

Against a production build: `npx tsc --noEmit -p .` is clean and `npx next build` is green.

- pipeline-opportunities: **52/52**, 9 of them new "audit fixes:" steps. All 9 fail on the old code.
- crm-pipeline-stats: 35/35
- deal-tracker: 45/45
- crm-reps: 16/16
- ai-assist: 27/27
- Extra suites that reach the board:
  - companies-contacts: 29/29
  - quotes-improvement: fails at step 42, the same on the old code (see "For another area")

## Notes for CLAUDE.md

- **A Build Quote deal (stage LEAD) is still a meeting tile.** Into any deal column it goes through the convert prompt. Nothing moves it to Quote Sent except sending the quote. Its phone button is "Send the quote →" to its draft.
- **Write a panel's rep only when it was changed there** (`ownerOriginal`). The rep a tile shows is the deal's once there is one, and a save that writes it back blindly moves deals between reps.
- **A panel that reads again after a sheet's save must merge, not skip.** Fields nobody touched follow the new read, and new people join.
- **A panel with menus over it ignores Escape and Tab while anything else is drawn over it.** FloatingMenu listens on document in the bubble phase like the panel, so `stopPropagation` can't help; ask whether another `[role=dialog]` / `.modal-backdrop` is open outside the panel.
- **`useMenuFocus` (lead-label-chip.tsx) is the keyboard for any FloatingMenu of buttons.** Focus two frames after opening, arrows / Home / End, and focus back on close.
- **Something sticky on the phone sits under the phone's own sticky top bar.** Read its height; don't use `top-0`.
- **A "use server" export no client imports has no action id**, so it can't be called from a browser. Harden it anyway; it becomes reachable the day someone imports it.
- **A suite's "audit fixes" steps can collect failures and throw once at the end,** so one run against the old code proves every step fails before the fix.
