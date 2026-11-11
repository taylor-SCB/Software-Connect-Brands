# Pipeline groups: BDR / Closer / Closed (Nov 11, 2026)

Branch `claude/pipeline-groups`. Taylor's call: Won and Lost stay two columns, with a group heading over the columns instead of a merged "Closed" column.

## Built

- **Desktop board** (`src/app/dashboard/deals/pipeline-board.tsx`): a heading row above the column headers.
  - **BDR** sits over Meeting Set + Meeting Completed, **Closer** over Quote Sent + Contract Sent, and **Closed** over Signed / Won + Lost.
  - Each pair is a `role="group"` named by its heading (`aria-labelledby`), so a screen reader hears "BDR, group".
  - Each group is a CSS subgrid spanning its two columns, so the heading lines up with them exactly.
  - The heading is small uppercase text in `--text-dim`, with a 1px `--hairline-3` rule under it. It reads at 4.5:1 or better in Dark and Light (the suite checks).
  - The heading sits inside the board's own scroll box, so it moves with both scrollbars, the one on top included.
  - Nothing on the columns changed: names, counts, health bars, values, drag, the stage menu and the testids are all as they were.
- **Widths.**
  - At 1440 all six columns fit: Lost ends at 1408 of 1440, with nothing to scroll. The ux-gaps note about Lost being cut off at 1440 no longer applies.
  - At 1280 the board is 88px too wide and scrolls inside its box, as it did before this change. The top scrollbar brings Lost fully on screen, and the page itself never scrolls sideways.
  - I tried 152px columns so six fit at 1280. The tiles' "Reschedule" / "It did happen" pair clipped and names cut to three letters, so I kept the 176px minimum.
- **Phone.**
  - The stage tabs are unchanged.
  - A row of small group names sits inside the sticky tab strip, in the same five-column grid: BDR over Set + Met, Closer over Quote + Contract, Closed over Closed.
  - The names are hidden from screen readers, so the tabs read as before.
  - Tabs stay 44px tall, and nothing scrolls sideways at 390px.
- **Gone quiet got faster** (`src/lib/gone-quiet.ts`).
  - The Pipeline's 40,000-tile timing step was failing: +166 to +180 ms against a 140 ms budget.
  - Cause: `goneQuietOpportunities` joined touches and meetings onto a CTE that Postgres estimated at 1 row, so it nested-looped once per tile (133 ms in EXPLAIN).
  - Rewritten as one UNION ALL grouped per opportunity. It returns the same rows in the same order: identical over 25,541 seeded rows mixing open, lost, meetings ahead and behind, hidden and listed people.
  - With 40,000 tiles it now takes about 70 ms instead of 156, and the step passes (+97 ms).
  - A tie on the last-touch time is now broken by id, so the order is stable.

## Not built, and why

- Six columns fitting at 1280: see Widths above. Fitting them would have made the tiles worse.

## API others can use

None new. `PIPELINE_GROUPS` (desktop) and `PHONE_GROUP_SPANS` (phone) are module-local in `pipeline-board.tsx`. Test hooks:
- `pipeline-group-bdr` / `-closer` / `-closed` (the group)
- `pipeline-group-heading` (its label)
- `pipeline-phone-group` (the phone labels)

`goneQuietOpportunities` keeps its signature.

## Suite results

`npx tsc --noEmit -p .` and `npx next build` are clean. Run against `scb_groups`:

| Suite | Result |
|---|---|
| pipeline-opportunities | 53/53 (new step 44) |
| crm-pipeline-stats | 37/37 |
| looks | 31/31 |
| overlay-readability | 16/16 |
| reports (also uses gone quiet) | 49/49 |
| ai-assist (also uses gone quiet) | 28/28 |

Two suites were already failing on this branch before my change, because of fixes merged from the other audits. I updated their tests to match the new behaviour:

- **Logged meetings are now Held.** After audit-data's decision-4 fix, a meeting logged as having happened completes its tile.
  - `pipeline-opportunities` steps 2–3 now assert that rule: Meeting Completed, with Opportunity Created on both people. Then they set those meetings back to "not recorded" with SQL (`unanswer()`), the state the later steps were written for. The same is done for Pat's second opportunity in step 18.
  - `crm-pipeline-stats` does the same for Ben. It also asserts his history reads Meeting Set, then Meeting Completed.
- **No Undo on Not moving forward.** audit-pages removed Undo from a "Not moving forward" toast on purpose, because a Lost move can't be taken back. Step 40 now asserts there is no Undo and the Held stays.

## Files touched outside yours

- `src/lib/gone-quiet.ts` (the query above)
- `scripts/browser-tests/crm-pipeline-stats.cjs` (Ben, decision 4)

## Notes for CLAUDE.md

- The Pipeline has group headings: BDR (Meeting Set, Meeting Completed), Closer (Quote Sent, Contract Sent), Closed (Won, Lost). Won and Lost stay separate columns (Taylor, Nov 11, 2026). On a phone the group names sit above the stage tabs.
- The board fits all six columns from about 1400px wide (1096px of columns, the 240px sidebar and the page padding) and scrolls inside its box below that. Columns are at least 176px, because narrower clips a tile's two decision buttons.
- A browser suite step that needs an unanswered past meeting can't log one through the form any more (decision 4 makes it Held). It logs it, then clears the outcome with SQL, as `unanswer()` in `pipeline-opportunities.cjs` does.
- A CTE that Postgres can't size (a left join filtered with `d.id IS NULL OR …`) gets estimated at 1 row, and every join onto it becomes a per-row loop. Aggregate with a UNION ALL grouped once instead (`gone-quiet.ts`).
