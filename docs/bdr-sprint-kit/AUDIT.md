# BDR sprint: final audit and bug check

This is the audit Taylor asked for, run once all 8 releases are built and before anything goes live. You are one of six auditors. Each auditor has one AREA (below) and its own branch. You audit, verify, fix, prove and push. Nothing goes live from here.

The sprint's whole change set is `git diff origin/claude/first-app-creation-cdtbrb...HEAD`; the live site runs that base. Read `docs/bdr-sprint-kit/README.md` (rules), `CLAUDE.md` (rules, lessons, the 19 approved decisions, the Testing section), the plan `docs/bdr-sprint-kit/ux-plan.txt`, the gaps `ux-gaps.txt`, and the reports in `docs/bdr-sprint-kit/reports/`.

## How to run it

1. **Find.** Fan out several independent reviewers over your area's changed files. Use a Workflow, or parallel Agent subagents, one per lens. Lenses:
   - **Correctness:** wrong logic, edge cases, races, double submits, timezone and date bugs, stale state after a save, broken Undo.
   - **Data safety:** workspace scoping on every query and action (an id from another workspace must do nothing), role checks (Member / Admin / Owner as CLAUDE.md says), input validation, anything that writes the wrong row. Also the migrations, which must be safe for rows that already exist on the live database, re-runnable where they claim to be, and must never drop data.
   - **Security:** public pages (`/q`, `/c`, `/i`, `/u`, `/files`), tokens, injection (SQL in `$queryRaw` templates, email headers), XSS in rendered user text, server actions callable with forged input, rate limits on anything that sends or calls AI.
   - **Performance:** per-row queries in lists (N+1), unbounded reads, missing indexes on new filters and sorts, and anything that would break the 200,000-contact budgets.
   - **Plan conformance:** does it do what the approved plan and the 19 decisions say, with nothing removed (only moved one tap deeper)?
   - **Phone, accessibility and looks:**
     - 390px with no sideways scroll, 44px targets;
     - focus visible, keyboard reachable, `prefers-reduced-motion`;
     - text at least 4.5:1 in both Dark and Light;
     - floating panels opaque (`.popover`), dialogs portalled, `min-w-0` on grid items;
     - the tenant brand kept, health colours fixed.

   Every finding needs `file:line` evidence and a concrete failure scenario (inputs leading to the wrong result). No style nits.
2. **Verify.** Check every finding with at least two independent skeptics told to REFUTE it by reading the code (and running it where that's cheap). Keep a finding only if most can't refute it. Drop duplicates.
3. **Fix.** Fix every confirmed finding at its cause. Each fix gets an `audit fixes: …` step in the suite for its module that fails before the fix and passes after. Never weaken an existing check. Stay inside your area's files. If a confirmed bug lives in another area's files, don't fix it: list it in your report under "For another area".
4. **Prove.** Run `npx tsc --noEmit -p .` and `npx next build`, then your area's suites with `docs/bdr-sprint-kit/run-suites.sh`. All must pass.
5. **Report.** Write `docs/bdr-sprint-kit/reports/audit-<area>.md` with these sections:
   - findings: flagged / distinct / confirmed / refuted, with counts;
   - every confirmed bug with its cause, fix and proving step;
   - refuted ones, with one line each;
   - for another area;
   - suite results;
   - notes for CLAUDE.md (lessons worth keeping).

   Commit and push to your branch only. Never push to `claude/first-app-creation-cdtbrb` or `claude/sprint-final`, and never open a pull request.

Setup: `bash docs/bdr-sprint-kit/setup.sh scb_audit_<area>`, then `npx next typegen`. Kill only your own port. Never pkill or pgrep by pattern.

## Areas

- **data:** the database and the rules.
  - Files: `prisma/schema.prisma` and every migration from `20261111*` on (triggers, backfills, the accept-signed-quotes catch-up, `acceptedByName`, `lastConnectAt`);
  - `src/lib/health.ts`, `health-load.ts`, `health-journey.ts`, `meeting-rule.ts`, `meetings.ts`, `status.ts`, `undo-log.ts`, `constants.ts`, `user-prefs.ts`, `pipeline-link.ts`;
  - `src/app/dashboard/prefs-actions.ts`;
  - the logging, outcome, meeting and reason server actions in `src/app/dashboard/contacts/actions.ts`.
  - Suites: `connected`, `health`, `how-did-it-go`, `crm-data` (email group), `load`, plus `npx tsx scripts/health-check.ts` and `npx tsx scripts/up-next-check.ts`.
- **pages:** the log sheet, Book meeting, the contact page and the company page.
  - Files: `src/components/how-did-it-go/*`, `src/components/book-meeting/*`, `src/app/dashboard/contacts/[id]/*`, `src/app/dashboard/companies/[id]/*`, `activity-feed.tsx`, `upcoming-card.tsx`, `status-picker.tsx`, `lifecycle-meter.tsx`, `add-person-search.tsx`, `other-contacts.tsx`.
  - Suites: `health`, `company-page`, `how-did-it-go`, `companies-contacts`, `crm-accounts`, `company-bypass`, `contacts-mobile`, `overlay-readability`, `follow-ups-status-filter`.
- **pipeline:**
  - Files: `src/app/dashboard/deals/*` (not `tracker/`), `src/lib/opportunities.ts`, `lead-labels.ts`, `lead-label-rules.ts`, `src/components/lead-label-chip.tsx`.
  - Suites: `pipeline-opportunities`, `crm-pipeline-stats`, `deal-tracker`, `crm-reps`, `ai`.
- **today:** My day, the Daily Rundown and Team today, the calendar, navigation and goals.
  - Files: `src/app/dashboard/page.tsx`, `my-day/*`, `src/lib/up-next.ts`, `src/lib/reports/daily.ts`, `report-views.tsx` (DailyView), `narrative-card.tsx`, `src/app/dashboard/calendar/*`, `sidebar-nav.tsx`, `global-search.tsx`, `dashboard/layout.tsx`, `settings/general/*`.
  - Suites: `myday`, `calendar`, `calendar-v2`, `crews-time`, `looks`, `login-case`, `reports`, `load`.
- **lists:** the Contacts and Companies lists, import, assign and duplicates.
  - Files: `src/components/list-filters.tsx`, `src/lib/list-*.ts`, `contacts/page.tsx`, `contacts-list.tsx`, `companies/page.tsx`, `companies-list.tsx`, `bulk-assign.tsx`, `assign-actions.ts`, `pagination.tsx`, `import-csv-button.tsx`, `import-cleanup.tsx`, `contacts-csv.ts`, `import-actions.ts`.
  - Suites: `contacts-import-filters`, `companies-contacts`, `crm-reps`, `crm-data` (email group), `connected`, `load`.
- **money:** paperwork, stats and email.
  - Paperwork files: `src/app/dashboard/quotes/**`, `contracts/**`, `deals/tracker/**`, the public `/q`, `/c` and `/i` pages, `src/lib/deal-journey-load.ts`, `quote-accept.ts`, `payment-table.tsx`, `quote-document.tsx`.
  - Stats and reports files: `src/app/dashboard/stats/**`, `src/lib/stats*.ts`, `src/lib/reports/*` (except `daily.ts`).
  - Email files: `src/components/email-composer.tsx`, `src/lib/email-marketing.ts`, `src/app/dashboard/email/**`, `scripts/label-old-attempts.cjs`.
  - Suites: `quotes-improvement`, `contracts`, `deal-tracker`, `money-payments`, `projects-core`, `project-money`, `reports`, `crm-pipeline-stats`, `email-marketing-users` (email group).
