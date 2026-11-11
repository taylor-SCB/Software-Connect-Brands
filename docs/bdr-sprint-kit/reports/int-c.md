# Integration C: + lists

On branch `claude/sprint-numbers` (which already holds numbers, paperwork and today from int-b). I merged `origin/claude/sprint-lists` (at d4aa5dc).

## What conflicted
- **No text conflicts.** The merge went through cleanly.
- **No duplicate helpers.** I checked every suite after the merge:
  - `node --check` passes on all of them;
  - `openFilters` and `cleanUp` are each defined once per file;
  - the names that do appear twice (`looks.cjs` colour maths, `pipeline-opportunities.cjs`, `projects-core.cjs` `now`, `quotes-improvement.cjs` `field`, the load tests' `seconds`) were already like that before the merge and live in separate scopes.
- **One conflict in meaning: where list choices are stored.** The lists coder stored them at the top level of `User.uiPrefs` under dotted keys (`"contacts.scope"`, `"companies.columns"`). That was written by its own `saveListPrefs` in `src/app/dashboard/user-prefs-actions.ts` and read by `src/lib/list-prefs.ts`. Everything else uses the namespaced shape now.

## How I resolved it
- **List prefs moved onto namespaces**, `contacts.{scope,preset,sort,columns}` and `companies.{…}`, with each kind as its own namespace.
  - **Writing:** `ListFilters` (`src/components/list-filters.tsx`) saves one key at a time with `saveUiPref(kind, key, value)`, one after another, so each merge sees the one before.
  - **Reading:** `resolveListView` reads through `readUiPrefsWithLegacy`. A key present in the namespace wins, even when it's `null`. Otherwise the old top-level dotted key is read, so nobody loses a saved choice.
  - **Checking:** values are still checked on read against what the lists offer (scopes, presets, sorts, columns). Anything malformed falls back to the role's default.
- **`src/app/dashboard/user-prefs-actions.ts` is deleted**; nothing uses it any more.
- **Import my list opens Import CSV directly** (from the sprint lead).
  - `/dashboard/contacts?import=1` opens Import CSV on arrival, through `CleanUpMenu openImport` → `ImportCsvButton startOpen`.
  - Closing the dialog takes `?import=1` off the address (`history.replaceState(null, …)`), so a refresh doesn't reopen it. `import` isn't a view key, so the list still opens on the person's saved view.
  - My day's "Import my list" (`jump-in.tsx`) links there.

## Suite changes
- `crm-data.cjs`: the remembered scope, sort and columns are read from `uiPrefs.contacts.*`, and the test now checks nothing is written at the top level.
- The old top-level fallback is proven by the seeds in `company-enrichment.cjs`, `looks.cjs` and `load-test.cjs`. They still write `{"contacts.columns": …}` directly, and those suites pass with the columns shown. Stats' own fallback step is in `crm-pipeline-stats.cjs` from int-b.
- `myday.cjs` has a new step, **"Sprint (integration): Import my list opens Import CSV straight away …"**:
  - the link reads `/dashboard/contacts?import=1`;
  - the dialog opens on arrival with the file picker;
  - Close removes `?import=1`, and a reload doesn't reopen it;
  - Clean up → Import CSV still opens it.

## Suite results
`npx next typegen && npx tsc --noEmit -p . && npx next build` is green. Every suite ran against a production build on the local Postgres:

| Suite | Result |
|---|---|
| reports | PASS, 47 steps |
| crm-pipeline-stats | PASS, 34 |
| quotes-improvement | PASS |
| contracts | PASS, 25 |
| deal-tracker | PASS, 45 |
| money-payments | PASS, 28 |
| projects-core | PASS, 26 |
| project-money | PASS, 23 |
| calendar | PASS, 46 |
| calendar-v2 | PASS, 42 |
| crews-time | PASS, 34 |
| looks | PASS, 31 |
| overlay-readability | PASS, 16 |
| login-case | PASS |
| myday | PASS, 23 |
| companies-contacts | PASS, 26 |
| variations-pictures | PASS |
| contacts-import-filters | PASS, 24 |
| crm-reps | PASS, 16 |
| crm-data | PASS, 50 |
| email-marketing-users | PASS |
| ai-assist | PASS, 25 |
| load-test | PASS, 11 (slowest page: Companies touched in the last 7 days, 0.89 s at 200,000 contacts) |

## Notes for CLAUDE.md
- **`User.uiPrefs` namespaces in use:** `calendar`, `myday`, `stats` (`columns`), `contacts` and `companies` (`scope`, `preset`, `sort`, `columns`).
  - Write only with `saveUiPref`.
  - Read with `readUiPrefs`, or `readUiPrefsWithLegacy` where a pre-namespace top-level key (`statsColumns`, `"contacts.scope"` and so on) may still be stored.
- **`/dashboard/contacts?import=1`** opens Import CSV.
