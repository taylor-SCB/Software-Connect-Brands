# BDR sprint kit (temporary — removed before the release)

You are one coder in a fast sprint building a redesign Taylor (the non-technical founder) has APPROVED for his white-label CRM (Next.js 16, Prisma 7, Postgres). Speed matters, and so does working code: no reviews happen during the sprint, a full audit comes at the end, so leave nothing half-wired.

Your screen is in `screens/<your screen>.md`: what to build, the files you own, the suites to run.

## Read first

- `AGENTS.md` at the repo root: this Next.js has breaking changes; check `node_modules/next/dist/docs` when unsure.
- `CLAUDE.md`: rules, lessons, and the 19 approved decisions under "Taylor approved every recommendation".
- `ux-plan.txt` (this folder): bdrFlow, connected, healthScore, lifecycleMeter, principles, every screen section, dataChanges, hiddenNotRemoved, renamesOrMovesNeedingTaylor (all approved), and releases.
- `bdr-plan.html` (this folder): the approved page; the look of the meter, health words and outcome chips.
- `ux-gaps.txt` (this folder): the completeness critic's gaps. Treat them as requirements where they touch your part.
- `foundation-api.md`: what the two foundation coders built (health, meter, look, outcomes, server actions). Use it; don't rebuild it.
- `api-log-sheet.md`: the "How did it go?" sheet and Book meeting sheet. They are on this branch: mount `<HowDidItGo>` / `<BookMeetingSheet>` (or their hook) wherever your screen logs a touch or books a meeting, instead of building another form.
- `api-contact-page.md`, `api-company-page.md`: the contact and company pages. These are finished on their own branches and NOT on yours yet; they get merged at integration. Don't edit those pages. Link to them as they are.

## Database groundwork already here

enum ActivityOutcome (NO_ANSWER, VOICEMAIL, GATEKEEPER, BAD_NUMBER, TALKED, REPLIED, SENT, HELD, NO_SHOW); Activity.outcome; Contact.lastConnectAt and Company.lastConnectAt (kept by triggers); StatusChange.reason; OpportunityMeeting.bookedById and .outcome; Organization.weeklyTryGoal / weeklyTalkGoal / weeklyMeetingGoal / parkAfterTries (default 6) / outcomesSince; User.uiPrefs (JSON); ContactStatus.CONNECTED (between CONTACTED and INTERESTED). Add a migration only if your part truly needs another column. Never edit an existing migration. Name a new one with a timestamp after every existing one plus your screen name, so two coders can't collide.

## Rules

- Never remove a feature. Move it one tap deeper, as the plan says.
- Keep white-label: the brand colour stays the tenant's; the health colours are the one fixed exception.
- Floating panels use FloatingMenu / `.popover`; dialogs render through a portal; one-sided separators use `--hairline-3`; grid items that hold truncating text or tables get `min-w-0`.
- Phones at 390px never scroll sideways, and touch targets are 44px. Keyboard focus is visible, `prefers-reduced-motion` is respected, and words are >= 4.5:1 in Dark and Light.
- Every query is scoped to the workspace and batched: no per-row queries in lists.
- Plain words in the UI, no jargon.
- Only edit the files your screen owns. If you truly must touch a shared file, keep the change small and list it in your final report.
- Never edit CLAUDE.md. Put notes for it in your final report instead.

## Setup (once per machine)

```
bash docs/bdr-sprint-kit/setup.sh scb_<screen>
```

This starts Postgres on port 5433, makes the database, writes `.env` if it's missing, then generates Prisma and applies all migrations. After adding a migration, run `npx prisma migrate deploy` and `npx prisma generate`.

## Tests are part of coding

- Keep `npx tsc --noEmit -p .` and `npx next build` green.
- Add browser-suite steps titled "Sprint: …" for what you build, following the patterns in `scripts/browser-tests/*.cjs`. Each suite seeds its own workspace with SQL.
- If you move a control, update the suites that used it without weakening what they check.
- Run: `npx next build && DB=postgresql://postgres:postgres@localhost:5433/scb_<screen> LOG=/tmp/sprint-<screen>.txt bash docs/bdr-sprint-kit/run-suites.sh <groups>`. Groups are `"plain:a,b,c"`, `"email:crm-data"`, `reports`, `ai`, `template` and `load`. The script starts the app on port 3400, runs the suites and stops the app. Read the LOG for PASS/FAIL, and `/tmp/sprint-<screen>-<suite>.log` for detail.
- Fix failures at their cause in the code, not by weakening a test.
- Kill only your own port (`fuser -k 3400/tcp`). Never pkill or pgrep by pattern.

## Finishing

Commit with clear messages as you go, and push only to your own branch (`git push -u origin <your branch>`). Never push to `claude/first-app-creation-cdtbrb` (the live site) or `claude/bdr-sprint`, and never open a pull request.

Leave a final report in `docs/bdr-sprint-kit/reports/<screen>.md` with these sections:

- **Built**
- **Not built, and why**
- **API others can use:** exact exports, props and server actions
- **Suite results**
- **Files touched outside yours**
- **Notes for CLAUDE.md**

Commit and push the report too.
