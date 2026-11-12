# Integration C: lists + numbers (Stats, Quote → Contract, My day)

On branch `claude/sprint-lists`, Nov 12, 2026. Taylor approved the merge in this session.

## What happened
- `git merge origin/claude/sprint-numbers` (at 9b0f4f6) went through with **no conflicts**. That branch had already merged `claude/sprint-lists` (50346a3) and done the three asks:
  - list prefs moved onto namespaced `uiPrefs` (`contacts.*`, `companies.*` via `saveUiPref`), reading the old top-level dotted keys as a fallback (`src/lib/list-prefs.ts`); `user-prefs-actions.ts` is gone;
  - `/dashboard/contacts?import=1` opens Import CSV (`ImportCsvButton startOpen`, `CleanUpMenu`);
  - My day's "Import my list" links there (`my-day/jump-in.tsx`).
- The local database needed the merged branch's migrations (`setup.sh` re-applied them).

## The one fix
- `calendar-v2.cjs` step 10 clicked a Save button inside the quote-details form. The quote editor has had a single Save bar since Round 2 (`quote-save`), so the step now clicks that. The checks are unchanged: "Quote details saved" and Quote due moving to the new day.

## Results
`npx next typegen && npx tsc --noEmit -p . && npx next build` green. All against a production build on the local Postgres:

| Suite | Result |
|---|---|
| reports | PASS, 48 |
| crm-pipeline-stats | PASS, 35 |
| quotes-improvement | PASS |
| contracts | PASS, 25 |
| deal-tracker | PASS, 45 |
| money-payments | PASS, 28 |
| calendar | PASS, 46 |
| calendar-v2 | PASS, 42 (after the fix) |
| looks | PASS, 31 |
| overlay-readability | PASS, 16 |
| myday | PASS, 23 |
| companies-contacts | PASS, 29 |
| contacts-import-filters | PASS, 24 |
| crm-reps | PASS, 16 |
| crm-data | PASS, 50 |
| email-marketing-users | PASS |
| load-test | PASS, 11 (slowest page 0.94s at 200,000 contacts) |

## Notes for CLAUDE.md
- A suite that saves anything on a quote's page clicks `quote-save` (the one Save bar), never a Save inside a card's form.
