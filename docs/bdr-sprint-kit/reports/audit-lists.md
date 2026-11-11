# Final audit — lists

Branch `claude/audit-lists`. Area: the Contacts and Companies lists, filters, presets, the Pulse sort, import, bulk assign and duplicates (AUDIT.md, "lists").

How it ran: one workflow. Eight independent reviewers each read the area with one lens: correctness of the filters and presets; correctness of import, assign and duplicates; data safety; security and SQL built from the address bar; performance at 200,000 contacts; plan conformance; phone, accessibility and looks; and what each row shows. A merge step folded the duplicates. Then two skeptics per finding were told to refute it, one reading the code itself and one tracing how real input reaches it. A finding was kept only when neither could refute it. On a 1–1 split I read the code myself and decided.

## Findings

| | Count |
|---|---|
| Flagged | 40 |
| Distinct | 34 |
| Confirmed by both skeptics | 24 |
| Split 1–1, decided by me | 4, all refuted |
| Refuted by both | 6 |
| **Confirmed, total** | **24 from the workflow + 1 found while proving a fix = 25** |
| Fixed here | 21 |
| For another area | 4 |

## Confirmed bugs, fixed

Each fix has an `audit fixes:` step in its module's suite. Every one of those steps was run against a build of the pre-fix branch, and each failed there (see "Suite results").

**L-new — Bulk Assign "all matching" dropped most of the list's filters** *(high; found while proving L4, and on the live site too for some filters)*
- **Cause:** `assignRecords` reads the list's address back with every key as a list. `parseListParams` compared single-valued keys as `raw.fav === "1"`, which is false for `["1"]`. So Favorites, With deals, Missing info and Owes money were ignored, and so were the sprint's Mine, preset and sort. `act` came through as an array, and `act.startsWith` threw.
- **What went wrong:** with Favorites on, "all matching" assigned records the list didn't show. With an Activity window on, the assign failed outright. On Mine, the scope was dropped.
- **Fix:** `one()` in `src/lib/list-params.ts` reads the first value of every single-valued key, so every caller gets the same answer.
- **Step:** crm-data "bulk Assign 'all matching' keeps every filter on the list". 12 favorites and 5 others, with `fav=1&act=never`: exactly the 12 are assigned.
- The live base had this for Favorites, With deals, Missing info, Owes money and Activity. It goes live with the sprint.

**L1 — Meetings this week put opportunity meetings on the wrong day** (`list-query.ts`)
- **Cause:** `om."on" AT TIME ZONE tz` on a UTC `timestamp` shifts the wrong way.
- **What went wrong:** in Chicago, a Saturday 8 PM meeting dropped out of the week, last Saturday's showed up, and the sort keys were 12 hours off.
- **Fix:** `AT TIME ZONE 'UTC' AT TIME ZONE tz`, the form health-sql.ts uses, for the meeting's day and both sort keys.
- **Step:** crm-data "Meetings this week reads an opportunity meeting on the workspace's own day".

**L3 — Going quiet counted rolling 24-hour days** (`list-query.ts`)
- **What went wrong:** a company touched exactly Q days ago, earlier in the day, was listed while its row read "8d" and its health said not quiet.
- **Fix:** the cutoff is local midnight of `today − Q` (`zonedMidnight`), which is the health rule "more than Q calendar days".
- **Step:** crm-data "Going quiet counts whole days on the workspace's calendar".

**L4 — "All matching" took the first 1,000 by Recently added, not in the list's order** (`assign-actions.ts`)
- **What went wrong:** Warmest first, My call list's late-first order and Meetings this week were all ignored.
- **Fix:** the targets come from the list's own pager, `pageIds(kind, org, todo, params with per = 1,000)`. The same params object goes to the where-builder, so the presets' per-view caches line up.
- **Step:** crm-data "takes the first 1,000 in the list's own order". 1,001 new leads and one tried lead added 30 days ago: the tried one, top of Warmest first, is in the 1,000.

**L6 — A kept import note could land on a different contact than the one its row updated** (`import-actions.ts`)
- **Cause:** the update match and `keepNotes` broke ties the opposite way when two people share an email. Separately, rows that were skipped still got a note.
- **Fix:** the update match takes the oldest contact. The batch records which contact each landed row became, and `keepNotes` uses exactly that. Skipped rows get nothing.
- **Step:** contacts-import-filters "a kept note lands on the person its row updated".

**L7 — A Member's "Import my list" default outlived its dialog** (`import-csv-button.tsx`)
- **What went wrong:** close the dialog, then Clean up → Import CSV on the same page started on the Member, not Unassigned.
- **Fix:** the default is state that clears on close.
- **Step:** contacts-import-filters "a Member's Import my list default ends with that dialog". The existing step navigated away between the two opens, which is why it missed this.

**L8 — CSV status "Spoke to gatekeeper" imported as Connected** (`contacts-csv.ts`)
- **Fix:** front desk, receptionist, wrong number, busy, left a message and no-show are attempt words, checked before the talk words (decision 1).
- **Step:** the import step above (Gina Gate → CONTACTED).

**L12 — A NUL character in a Notes cell truncated the kept note, and every re-import added it again**
- **Fix:** NUL is stripped where the note is built and again in the server's schema. The note body travels beside its key instead of being split back out of it.
- **Step:** the import step above.

**L14 — The Companies list loaded the top people's health only after the whole company roll-up** (`companies-list.tsx`)
- **Fix:** it now runs alongside the other loads.
- **Step:** none can fail on a timing this small. load-test's Companies pages are the check. The larger half of L14, the 100-people-a-company cap, is in `health-load.ts` and listed below for data.

**L20 / L26 — The bulk bar on a phone** (`bulk-assign.tsx`)
- **What went wrong:** the bar slid under the fixed tab bar (it ended at 832px, the tabs start at 787px), and its buttons were 25–28px tall.
- **Fix:** it now sits above the tab bar below `lg` (`bottom-[calc(3.5rem+safe-area+0.75rem)]`), and every control is 44px on a phone.
- **Step:** crm-data's audit phone step.

**L21 — Clean up wasn't keyboard reachable** (`list-parts.tsx`)
- **Fix:** it walks like the filter menus. Enter goes to the first item, Tab from the button goes in, FocusGuard stops sit at both ends, and Escape returns to the button. `tabStops` and `FocusGuard` are now exported from list-filters.
- **Step:** crm-data "Clean up is walked from the keyboard".

**L22 — The bulk bar dropped keyboard focus to the page** (on the question, Cancel, Yes and Undo)
- **Fix:** the question's Yes takes focus once it is enabled, Cancel goes back to Assign to me, and Yes and Undo go to the message (`role=status`, `tabIndex=-1`). The question is `aria-describedby` its text.
- **Step:** crm-data "the bulk bar keeps the keyboard".

**L23 — Escape in a filter menu on the phone sheet closed the whole sheet**
- **Fix:** the sheet ignores Escape while a floating menu (a `body > [role=dialog]`) is open.
- **Step:** crm-data audit phone step.

**L24 — The phone Filters sheet didn't take, trap or return focus**
- **Fix:** focus goes into the sheet, Tab wraps inside it between two FocusGuards, and focus returns to Filters on close.
- **Step:** crm-data audit phone step.

**L25 — Filter choices in the phone sheet were 28–32px tall**
- **Cause:** FilterGroup's 44px rule can't reach a menu drawn on the page body.
- **Fix:** the Dropdown panel carries the rule itself.
- **Step:** crm-data audit phone step.

**L27 — Phone cards had no side padding, so the Select box hung off the card**
- **Fix:** `px-5` on both lists' cards.
- **Step:** crm-data audit phone step.

**L28 — Every filter chip's ✕ was a 10px box named "Remove filter"**
- **Fix:** it is named after its chip ("Remove filter State: TX") through `aria-labelledby`, and is 44px on a phone. The Products list shares this Chip.
- **Step:** crm-data "a filter chip's ✕ says which filter it removes", plus the phone step.

**L29 — The page links were 28px on a phone**
- **Fix:** 44px on a phone, and the pager now wraps. Without the wrap, 13 pages of Products scrolled sideways, which `products-scale` caught.
- **Step:** crm-data audit phone step: the size, and page 50 of a long list not widening the page.

**L30 — A number with an extension dialled a wrong 13-digit number**
- **Fix:** `dialNumber()` in `list-cells.tsx` splits the extension off. Call is `tel:5125550100,204` (dial, wait, then the extension). Text is `sms:5125550100`.
- **Step:** crm-data "a number with an extension…" (desktop) and the phone step.

**L33 — Last Contacted By counted a no-show** (`src/lib/last-contacted.ts`)
- **Fix:** `outcome IS DISTINCT FROM 'NO_SHOW'`, the touch rule used everywhere else.
- **Step:** crm-data "Last Contacted By leaves out a no-show".
- That file isn't on any area's list, and only the lists read it, so I took it.

**L34 — A phone card said "Not tried yet" for people already reached by status**
- **Fix:** "Not tried yet" only when the health state is NEW. Otherwise the card uses the same caption as the desktop Pulse.
- **Step:** crm-data audit phone step (an Interested contact with no activity).

## Refuted

- **L2:** booked-ahead ignores meeting outcomes. A no-show ahead of its date is refused, and a meeting held early moves everyone on it to Meeting Completed, which is outside every preset that reads this list. *(Split, refuted by me.)*
- **L5:** Import my list takes teammates' people. This is Taylor's recorded rule: an explicit assignee takes everyone in the file. The assignee box is on screen.
- **L10:** a forged undo payload. It can do nothing that `assignRecords` doesn't already let the same person do, and it stays scoped to the workspace and known users.
- **L11:** pulse id lists bound twice exceed Postgres's parameter limit. At the 200,000-contact seed they are about 8,400 values, not the ~32,000 limit. Worth hardening only if a workspace grows warm lists in the tens of thousands. *(Split, refuted by me.)*
- **L13:** `crm_touch_due` scans every activity. A partial index matches its predicate exactly.
- **L15:** the load test seeds no StatusChange rows. A coverage gap with no failure shown. The subqueries are correlated on an indexed `contactId`.
- **L16:** Everyone keeps My call list. The plan stacks presets on scope, and the load test times exactly "My call list (Everyone)". *(Split, refuted by me.)*
- **L17:** search stays inside Mine. That is decision 17 and the plan's bar.
- **L18:** phone cards don't show Owes. The plan's card contents leave it out, and the record page one tap away shows the balance. *(Split, refuted by me.)*
- **L19:** Companies lost its Location column. The plan's Columns list for Companies has none. City shows under the name.

## For another area

- **pages:** `src/app/dashboard/companies/[id]/claim-actions.ts:50` (L9). `undoClaim` trusts client-supplied ids:
  - a forged call can move any of a contact's own activities onto any company;
  - a Member can undo a teammate's claim that moved no status.
  - Cause: nothing server-side records what a claim moved. Fix: persist the claim (batch id, user, contact, company, activity ids) and undo only that.
- **data:** `src/lib/health-load.ts` (L14, the larger half). `COMPANY_PEOPLE_CAP = 100` loads full health for up to 10,000 people on a 100-company page, and the `raw` CTE aggregates every activity of everyone at those companies. Fine with a few people per company; heavy for an imported CRM of big firms. Fix: cap at about 10, ordered by `lastConnectAt` then `lastTouchAt` (the "n of m reached" count already counts everyone).
- **data:** `src/lib/health-load.ts:561` (L31). A company's own Next step ignores calendar entries on the company itself, so a company with no people always reads "Nothing booked", and its own late follow-up never turns red. Fix: run the same booking SQL keyed on `CalendarEvent.companyId`.
- **data:** `src/lib/health.ts:839` (L32). A company's Next step shows only its warmest person's booking, which hides another person's meeting tomorrow or late follow-up. Fix: in `rollUpCompany`, take the earliest next booking across all its people, and "late" if anyone is late.
- **today / money / pipeline:** the same extension bug as L30, in:
  - `my-day/up-next.tsx:29-34`
  - `quotes/[id]/mark-sent.tsx:68`
  - `deals/opportunity-panel.tsx:678`
  - `reports/report-views.tsx:195`
  - `calendar/calendar-views.tsx:57`
  - Reuse `dialNumber()` / `telHref()` / `smsHref()` from `src/components/list-cells.tsx`.
- **today or money:** `money-payments.cjs` step 22 fails on this branch *before and after* my changes. The dashboard's Owed to you tile reads "$2,550", and the step expects "$2,550.00". Either the tile or the step is stale.

## Suite results

`npx tsc --noEmit -p .` and `npx next build` pass.

**Baseline, before any change.** All pass: contacts-import-filters 26, companies-contacts 29, crm-reps 16, connected 30, crm-data 58, load-test 12 (slowest 1.31s).

**After the fixes, on a production build:**

| Suite | Result |
|---|---|
| contacts-import-filters | PASS, 28 steps (2 new) |
| crm-data (email) | PASS, 68 steps (10 new) |
| companies-contacts | PASS, 29 |
| crm-reps | PASS, 16 |
| connected | PASS, 30 |
| load-test | PASS, 12 |

Also run, because they use the parts I touched (Chip, the pager, the filter menus, bulk assign, the lists): health 33, overlay-readability 16, looks 31, products-scale 18, pipeline-opportunities 43, follow-ups-status-filter 17, company-enrichment 9, contacts-mobile 15, crm-accounts 22, account-types 34. All pass.

- products-scale first failed on my pager change, before the wrap (fixed, see L29).
- account-types first failed on a port clash with my side-by-side pre-fix run, and passed when rerun alone.
- money-payments fails at step 22 here and on the pre-fix build alike (see "For another area").

**Load test (200,000 contacts).**

On a fresh database (`scb_audit_lists_load`), the fixed code passes all 12 steps. Slowest pages:

| Page | Time |
|---|---|
| Warmest first, page 2,000 | 1.49s |
| Warmest first, 100 a page, page 600 | 1.10s |
| Warmest first (Everyone) | 1.08s |

The baseline on a fresh database was 1.31s for the same page.

On the database every other suite had been running in, the load test went over budget for the code before the fixes and the code after alike. I ran them back to back on the same database:

| Run | Before the fixes | After the fixes |
|---|---|---|
| A company page | 2.83s / 2.95s / 3.97s | 3.60s / 3.84s |
| Warmest first (Everyone), once the stuck query below was cancelled | 2.25s | 2.04s |

Two causes, neither of them the fixes:
- An ad-hoc `NOT IN` count that one audit reviewer ran by hand had been running for over an hour on a full core. I cancelled it.
- A database reseeded at 200,000 contacts many times over is slower than a fresh one.

My changes don't touch the Warmest-first query (`pulsePageIds`); only the address parsing in front of it changed.

Warmest first is the page closest to the 2s budget on every run. Whoever changes it next should time it on a fresh database.

**Each new step against the pre-fix code.**
- Method: a separate build of this branch before the fixes, its own database, and the new steps wrapped so every check reports.
- What failed:
  - Member default: "a later Import CSV starts Unassigned".
  - Kept note: "the oldest … is the one updated".
  - Gatekeeper: "a front desk is an attempt".
  - NUL: "the whole note, without the NUL" and "a re-import adds nothing".
  - Meetings this week, Going quiet, and bulk order: wrong names, and "the top of the list was in the 1,000".
  - Filters dropped in bulk: a timeout waiting for "12 records".
  - No-show: "Nic Rivera" shown.
  - Extension: `tel:5125550100204`.
  - Chip: no button named for its chip.
  - Clean up: focus stayed on the button.
  - Bulk bar: focus on body four times.
  - Phone: "the bar ends at 832, the tabs start at 787", the bulk buttons 25–28px, the Select box outside the card, Next page 25px.
- The rest of the phone step comes after those checks and only ran after the fix: the sheet's focus and Escape, 44px choices, the card's call links and caption, and the pager wrap.

## Notes for CLAUDE.md

- **`parseListParams` takes either shape**: a string, or a list per key, as `URLSearchParams` gives when read back. Bulk Assign's "all matching" reads the address back as lists, and `raw.fav === "1"` silently dropped Favorites, With deals, Missing info, Owes money, Mine, presets and sort, and threw on Activity. Read a single-valued key through `one()`.
- **"All matching" takes the list's own order through `pageIds`** with `per` set to 1,000. The same params object must go to `contactWhere` / `companyWhere` and `pageIds`, because the per-view caches (Meetings this week's order, Pulse sets) are keyed on it.
- **A UTC `timestamp` column goes to the workspace's clock with `AT TIME ZONE 'UTC' AT TIME ZONE tz`.** A single `AT TIME ZONE tz` shifts it the wrong way (12 hours in Chicago). A range test against `local midnight AT TIME ZONE tz` is fine under a UTC session.
- **"More than Q days" is a calendar cutoff**, `lastTouchAt < zonedMidnight(today − Q)`, never `now − Q×24h`.
- **Anything dialled or texted goes through `dialNumber()`** (`list-cells.tsx`). An extension is split off: `tel:` waits for it with a comma, and `sms:` never carries it.
- **A sheet or dialog that listens for Escape on `document` must leave it to a floating menu open above it** (`body > [role=dialog]`). A modal sheet takes focus in a requestAnimationFrame, wraps Tab between FocusGuards, and gives focus back to its opener.
- **A control that unmounts the button the keyboard was on must place focus**: on the next thing, or on the `role=status` message. A disabled button can't take focus, so wait until it is enabled.
- **A rule scoped to a container (`[&_.btn]:max-md:min-h-[44px]`) never reaches what that container portals.** Put touch sizes on the menu panel itself.
- **A pager of 44px links must wrap** (`flex-wrap`), or a phone scrolls sideways once there are many pages.
- **Time the load test on a fresh database, with nothing else running.** A database reseeded at 200,000 many times over, or a stray hand-run query, put pages that take 1.3s fresh over 2s for the old code and the new alike.
- `tabStops` and `FocusGuard` are exported from `src/components/list-filters.tsx` for any menu that has to be walked from the keyboard.
