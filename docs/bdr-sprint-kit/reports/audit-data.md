# Final audit: data (the database and the rules)

Branch `claude/audit-data`. Area files: `prisma/schema.prisma` and the `20261111*` migrations; `src/lib/health*.ts`, `meeting-rule.ts`, `meetings.ts`, `status.ts`, `undo-log.ts`, `constants.ts`, `user-prefs.ts`, `pipeline-link.ts`; `src/app/dashboard/prefs-actions.ts`; and the logging, outcome, meeting and reason actions in `src/app/dashboard/contacts/actions.ts`. `logEventDone` in `src/lib/calendar-auto.ts` (the calendar Done box's logging path, owned by no other area) was taken in too.

How it ran:
- **Find:** five independent reviewers ran in parallel, one per lens: correctness, data safety and migrations, security, performance (measured at 200,000 contacts and 400,000 activities through an 8–16 ms proxy), and plan conformance. The phone, accessibility and looks lens has no surface in this area; no file here draws a screen.
- **Verify:** two independent skeptics were told to refute every finding. One worked forward and one in reverse order.
- **Fix:** each confirmed finding was fixed at its cause.
- **Prove:** each fix has an `audit fixes:` step in `connected.cjs`. Those steps were run against a build of the code before the fixes, on its own database, with `AUDIT_SOFT=1`.

## Findings

| | Count |
|---|---|
| Flagged by the five reviewers | 29 |
| Distinct after dedupe | 22 |
| Confirmed (both skeptics, 6 of them only in part) | 22 |
| Refuted | 0 |
| Fixed | 21 |
| Left open, with the reason | 1 (D12) |

## Confirmed bugs, their causes, fixes and proving steps

Step numbers are the `connected.cjs` steps. "Old code" means the build before these fixes, run with `AUDIT_SOFT=1`. Each of steps 31–47 except 45 fails on the old code; step 45 is explained under D18.

**Undo** (`src/lib/undo-log.ts`, `src/lib/meetings.ts`)

- **D1. A Member could undo a teammate's Held or No-show.**
  - Cause: the owner was read from the rows carrying the save's batchId. A No-show writes none, so the owner was empty and the check was skipped. A made-up `m:<meetingId>:x` passed the same way.
  - Fix: a meeting answer now keeps who made it, in the new `OpportunityMeeting.outcomeUndo`. A save with nobody on record can only be undone by an Owner or Admin.
  - Proving step: 31. On the old code Nic's Undo answered `{"success":"Undone"}`.
- **D3. An older Undo cleared a later answer.**
  - Cause: "already undone" was judged only by whether the meeting had any outcome at all.
  - Fix: a meeting action can be undone only while `outcomeUndo.batchId` is that save's. A later answer replaces it, so an older Undo finds nothing of its own and is refused.
  - Proving step: 33. On the old code the no-show's Undo still answered "Undone".
- **D2. Undoing or deleting an old save took back later work on its tile.** It removed people added since, sent the tile back to Meeting Set and deleted it with its Opportunity Created lines.
  - Cause: "made by this save" was judged as "created at or after the save began", with no upper bound.
  - Fix: a save's writes are those between when it began (the time stamped in its batchId) and two minutes after its last row. A meeting the save stashed counts as existing before it.
  - Proving step: 34. On the old code the result was "Nic's Held stands" failed.
- **D10. Undoing a Pipeline Held that wrote no rows left the tile at Meeting Completed.**
  - Cause: with no rows there was no save time, and the tile loop skipped.
  - Fix: the time stamped in the batchId is used instead.
  - Covered by step 33.
- **D11. Undo left four changes in place.** A No-show's calendar tick; a Held line's moved time; the meeting's day, which `attachMeeting` overwrites; and a meeting that was No-show before a Held went back to "not recorded" instead of No-show.
  - Cause: Undo only knew the save's own rows, not what the save had changed on rows that already existed.
  - Fix: `stashMeeting` records the meeting's outcome, day, linked line, calendar tick and history lines before the first change. It runs in Held, No-show, a meeting logged on its booked day, and the Done box. Undo puts back exactly that.
  - Proving steps: 32 and 33. On the old code, step 32 fails only as a knock-on of step 31: Nic's Undo had already run. The old Undo had no code that touches the tick at all.
- **D19. A big Undo could pass its own 20-second limit.**
  - Cause: one UPDATE per person inside the transaction.
  - Fix: one `UPDATE … FROM unnest(…)` per table, guarded by "still where the save left them".
  - Through the 8 ms proxy, undoing a 100-person save took 2.2 s before and 0.28 s now.

**Status ladder** (`src/lib/status.ts`)

- **D15. Two saves at once could move a status backwards.**
  - Cause: the status was read, then written with no check on what it was.
  - Fix: `moveRecords` moves only rows still at the status they were read at, and writes the StatusChange rows for exactly the rows it moved, all in one statement.
  - Proving step: 43. On the old code a held lock let CONNECTED overwrite MEETING_SET.
- **D18. A talk logged on many people moved them one at a time.** Each person cost about 11 round trips, and the new Connected step doubled it.
  - Fix: the same `moveRecords`, which costs one statement per starting status, however many people.
  - Through the 8 ms proxy, 100 people took 22.4 s before and 0.22 s now.
  - Step 45 checks that the result is correct (60 people, their order, the ladder, Undo). It passes on both builds by design; the timing above is the before-and-after proof.
- **D8. Any logged call or talk lifted a Lost person to Attempted or Connected.** This went against the code's own comment and `constants.ts`. The Attempted half was already on the live site; this sprint added the Connected half.
  - Fix: Contacted and Connected never lift Lost. A new meeting or new paperwork still do.
  - Proving step: 39.

**Logging and meetings** (`contacts/actions.ts`, `calendar-auto.ts`)

- **D5. A meeting logged with no outcome counted as held, yet kept asking "Did the meeting happen?"**
  - Fix, new saves: a meeting logged as having happened is Held and completes its tile (decision 4).
  - Fix, older rows: the migration's catch-up marks the *meeting row* Held where its line is a past MEETING with no outcome (decision 1). The line itself stays "not recorded" (decision 10). The catch-up is safe to run twice.
  - Proving step: 38.
- **D4. A meeting ticked done a day early with no chip wrote a line dated ahead.** Nobody was asked, the tile was never completed, and the line was counted as held anyway once its time came.
  - Fix: a ticked meeting is Held with or without the chip, and asks "Did it happen early?" when its day is still ahead.
  - Proving step: 37.
- **D6. A talk logged for later today never made the person Connected.**
  - Fix: an outcome or a mark means it happened, so its time becomes now. This matches the Done box.
  - Proving step: 35.
- **D7. A touch dated ahead with "Meeting booked" dropped the booking silently.** Only a crafted request could reach this.
  - Fix: an implied outcome or any next step on a touch dated ahead is refused in words.
  - Proving step: 36.
- **D9. A booked meeting logged on its day was held on the person's newest tile instead of its own.**
  - Fix: both logging paths pass the tile the booking is on. The root cause is in `opportunities.ts`; see "For another area".
  - Proving step: 40.
- **D13. Editing a meeting line to Held left its tile stuck at Meeting Set.** Separately, clearing a line's time kept the old time on its calendar copy.
  - Fix: the edit runs the same Held as everywhere else, and the calendar copy follows a cleared time.
  - Proving step: 41.
- **D22. The insert for one log on many people timed out.** It was an array `$transaction` with the default 5-second limit and one trigger run per row. This was already on the live site.
  - Fix: one `createManyAndReturn`, put back in the order given.
  - Covered by step 45.

**Other**

- **D14. Two preference saves at once lost one key.**
  - Cause: the UPDATE merged against a `FROM` subquery, which Postgres does not re-read after waiting for a row lock.
  - Fix: merge against `u."uiPrefs"` itself.
  - Proving step: 42.
- **D16. A meeting booked with no time read "12:00 PM".**
  - Fix: `om_next` carries whether the meeting has a time.
  - Proving step: 44.

**Migrations and the rollback**

- **D20. A migration locked sign-ins while it ran.** `ALTER COLUMN … SET DEFAULT` on Organization held its lock through both backfills: 7.6 s of blocked reads at 200,000 contacts.
  - Fix: the two Organization statements moved to the end of `20261111120000`. Only their order changed; the live database has not run this file, and `migrate deploy` passed over the already-applied copy.
- **D21. The touch and connect triggers read a record's whole history on every write.** That was 10 ms a write on a record with 20,000 lines.
  - Fix: the new migration `20261111170000_audit_data` adds three partial indexes and rewrites the functions so each reads one index row. Results are identical.
  - Proving step: 47, which checks the index plan and recounts every contact against the functions.
- **D17. Instant Rollback would break once anyone is Connected.** The pre-sprint build cannot read the CONNECTED value, so lists, contact and company pages, the Pipeline and Stats would fail to open.
  - Fix: `scripts/before-rollback-to-pre-bdr.sql` moves CONNECTED back to CONTACTED. Nothing is deleted, the history keeps the dates, and it is safe to run twice. It must be run before a rollback past this release.
  - Proving step: 46.

**What the new migration does** (`20261111170000_audit_data`):
- adds the `outcomeUndo` column (JSONB, nullable);
- runs the D5 catch-up;
- adds three partial indexes on Activity (each was about 0.3 s on 400,000 rows in the performance measurements);
- replaces the two touch functions.

It drops nothing and works on rows that already exist.

## Left open

- **D12. A meeting logged Held on a different day from the one it was booked for writes a second meeting, and the booking stays open.**
  - The duplicate was already on the live site. The sprint fixed the same-day case.
  - Matching a log to a booking on another day needs a rule only Taylor can set: was it that booking, early or late, or a different meeting?
  - Today the open booking asks "how did it go?", which is the right question while that is unknown.

## Refuted

None. Both skeptics narrowed six findings:
- D7: reachable only by a crafted request.
- D8, D9, D12: partly already on the live site.
- D18: slow rather than a likely timeout.
- D19: latent until D22 was fixed.

All were kept.

## For another area

- **pipeline**, `src/lib/opportunities.ts` `attachMeeting`:
  - The cause of D9 is still there. With no tile named, it picks the person's most recently updated open tile, and it looks for the booked meeting (`same`, by `eventId`) only on that tile.
  - I routed around it on the two logging paths (`logActivity`, `logEventDone`). Other callers that pass an `eventId` without a tile still can land a meeting on the wrong tile, such as the calendar event form and claim.
  - Fix: look up `same` by `eventId` across the workspace first and use its tile.
- **pages**, `undoClaim` in `src/app/dashboard/companies/[id]/claim-actions.ts`:
  - The data-safety reviewer flagged the same "nobody on record" hole as D1.
  - It goes through `undoLogCore`, so it is closed now: a save with no owner on record needs an Owner or Admin.
  - Worth a regression step in `company-bypass.cjs`.
- **DEPLOY.md / CLAUDE.md:** the Instant Rollback paragraph should name `scripts/before-rollback-to-pre-bdr.sql` (D17). Those files are not mine to edit.

## Suite results

All of these ran against a production build of the fixed code (`npx tsc --noEmit -p .` and `npx next build` are clean):

| Suite or check | Result |
|---|---|
| `connected` | 47/47 (30 existing + 17 audit fixes) |
| `health` | 33/33 |
| `how-did-it-go` | 18/18 |
| `crm-data` (email group) | 58/58 |
| `load` | 12/12; slowest page 1.41 s (Contacts, Warmest first, page 2,000) |
| `npx tsx scripts/health-check.ts` | 36 checks passed |
| `npx tsx scripts/up-next-check.ts` | all passed |

Against the old code (`AUDIT_SOFT=1`), 16 of the 17 audit steps fail. Step 45 is the exception, as explained under D18.

A flaky existing step was also fixed: `connected.cjs` step 11 read the meeting row while its save was still running. The status is written before the meeting row, so the step failed on the base. It now waits for the row. Committed separately.

## Notes for CLAUDE.md

- **An Undo must record what it changed, not guess it from time.**
  - `OpportunityMeeting.outcomeUndo` (`stashMeeting` in `src/lib/undo-log.ts`) holds what a save found on a meeting. Only that save's Undo restores it, and only its owner (or an Owner or Admin) can run it.
  - A save's own writes are those between its batchId's stamp and two minutes after its last row; nothing later on a tile is undone.
  - A save with nobody on record can only be undone by an Owner or Admin.
- **Status moves go through `moveRecords` in `src/lib/status.ts`.**
  - It moves a set in one statement per starting status, only rows still at that status, and writes the StatusChange rows for exactly the rows moved.
  - Never read a status and then `updateMany` it without that guard.
  - Contacted and Connected never lift Lost.
- **In Postgres, an `UPDATE … FROM (SELECT … FROM same_table)` merge loses writes under concurrency.** After a row-lock wait only the target row is re-read, not the subquery. Merge against the target row itself.
- **`ALTER TABLE … SET DEFAULT` (and anything else taking ACCESS EXCLUSIVE) holds the lock until the migration file commits.** Put it last, after the backfills.
- **A new enum value breaks Instant Rollback once a row uses it:** Prisma refuses to read the row. Before rolling back past the BDR release, run `scripts/before-rollback-to-pre-bdr.sql` in the Neon console.
- **One log on many people is one `createManyAndReturn`**, never an array `$transaction` of creates (5 s limit, and one trigger run per row).
- **A meeting logged as having happened is Held (no chip needed), on every path.** Meetings logged before the release are marked held on their meeting row by `20261111170000_audit_data`; their lines stay "not recorded".
- **An index-plan check on a small test table needs `enable_seqscan`, `enable_sort` and `enable_bitmapscan` off**, or the planner scans the table and the check fails for no reason.
- **`connected.cjs` with `AUDIT_SOFT=1`** runs every audit step even after one fails and lists the failures. That is how each fix was shown to fail on the old code.
