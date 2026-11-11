# Audit: money (paperwork, stats and email)

Branch `claude/audit-money`, from the finished sprint (d7d77b0). Database `scb_audit_money`.

**How it ran**
- **Find:** a workflow of 12 independent reviewers, one per sub-area and lens:
  - sub-areas: the public pages and the paperwork state machine; paperwork inside the dashboard; Stats and reports; the one-to-one email and the label script;
  - lenses: correctness and money math; data safety and security; performance, plan conformance and phone/accessibility.
- **Dedupe:** one deduper merged the findings.
- **Verify:** two skeptics were told to refute each finding. One read the cited code and the plan. The other traced the scenario from its entry point.
- **Tie-breaks:** M11 and M14 split 1–1, so each went to a third skeptic. Both came back REAL.
- **Fix and prove:** I fixed every confirmed bug in my area. Each fix has an "audit fixes: …" suite step. Each step was run on the old code with the other new steps taken out, and fails there. It passes on the fixed code.

## Findings

| | Count |
|---|---|
| Flagged by the reviewers | 48, plus the known funnel bug = 49 |
| Distinct | 25 (24 from the reviewers + the funnel bug) |
| Confirmed | 17 |
| Refuted | 8 |
| Fixed here | 16 |
| For another area | 1 (M16) |

## Confirmed bugs, fixed

Each entry gives the cause, the fix and the suite step that proves it. "Before the fix" is what the step reported when run on d7d77b0.

### Public pages

**M1 · A cancelled or declined contract could still be signed, and a double tap could award it twice.** (high)
- **Cause:** `signContract` (`contracts/actions.ts`) refused only Draft and Signed. It then wrote Signed with no status in the WHERE. So a tab opened before Cancel or Decline could still post, and the deal was won, a PRJ was made and the quote accepted. Two posts at once both wrote Signed and both ran `awardFromContract`.
- **Fix:** only a contract that is still Sent can be signed. The write is now an `updateMany` WHERE status is Sent; a count of 0 means someone else won. So only one request runs the award.
- **Step:** contracts, "audit fixes: a contract cancelled or declined after the customer opened it can't be signed from that tab". Before the fix the contract was signed.

**M2 · After Pull back to draft, an edit and a re-send on the same link, the customer's old tab signed wording they never read.** (medium)
- **Cause:** the sign form posted only the token, so nothing told the server which version the customer had read.
- **Fix:** the form carries the `sentAt` of the copy on screen. `signContract` refuses a stale one ("changed and sent again since you opened it. Reload…") and writes WHERE `sentAt` matches.
- **Step:** contracts, "audit fixes: pulled back, edited and sent again on the same link…". Before the fix the stale tab signed.

**M4 · A quote could be accepted online after its Valid until day.** (medium)
- **Fix:** `quoteExpired()` in `src/lib/quote-accept.ts` counts in the workspace's calendar, and the quote is good through the end of its last day.
  - `acceptQuoteByCustomer` refuses an expired quote.
  - `/q` shows "This quote expired on <day>. Contact <business> for an updated one." in place of the form.
- **Step:** quotes-improvement, "audit fixes: a quote past its Valid until day…". It covers the page, a tab opened before the quote lapsed, and its last day still working. Before the fix the lapsed quote was accepted.

**M6 · "Accepted online by <name>" outlived that answer.** (medium)
- **Cause:** after Back to draft, Declined, or Accepted by the team or by a signed contract, the quote, the customer's page and the contact feed still credited the earlier online acceptance.
- **Fix:** `changeQuoteStatus` clears `acceptedByName` on any change of status, and so does `acceptSourceQuote`.
- **Step:** quotes-improvement, "audit fixes: the name a customer accepted under online goes…". Before the fix: "the old online name was kept".

### Money math and the deal journey

**M10 · The Deposit step could never finish.** (medium)
- **Cause:** a signed contract with no payment rows, or a $0 first row, sat on "Send deposit invoice" for good. The button either errored or looped back to the same page.
- **Fix:** in `deal-journey-load.ts` the deposit is now the first row with money on it. A signed contract with nothing to collect counts the step as done.
- **Step:** deal-tracker, "audit fixes: a signed contract with nothing to collect finishes the journey…". The $0 first row is skipped and the $100 row is stamped. Before the fix the strip "sits on Deposit for good".

**M13 · A finished journey pinned an empty opaque bar to the foot of a phone.** (low)
- **Cause:** the pages always pass a `<JourneyNext>` element, even when it renders nothing.
- **Fix:** `DealJourney` draws the slot only while `journey.next` is set.
- **Step:** the same deal-tracker step, on a phone.

### The quote editor

**M12 · On a phone, edits to Quote details and the Payment table could not be saved.** (medium)
- **Cause:** both cards joined the one Save, whose bar is hidden on phones. Their text pointed at "Save at the foot of the page", where there was none.
- **Fix:** `PhoneSaveHere` in `quote-save.tsx` adds a full-width Save under each card on a phone while it has unsaved edits. It runs the same Save as the bar.
- **Step:** quotes-improvement, "audit fixes: on a phone, Quote details and Payment table edits each get a Save in reach". Before the fix no Save appeared.

**M11 · Send quote waited only for unsaved lines.** (medium; tie-broken REAL)
- **Cause:** an unsaved payment table or Quote details went out as the old version while the screen showed the new one. The same gap was on the live site before the sprint, but the one Save made it easier to miss.
- **Fix:** `SendQuoteButton` also reads `useQuoteSaveAll().unsaved` and says which card to save first.
- **Step:** quotes-improvement, "audit fixes: Send quote waits for an unsaved payment table or Quote details too". Before the fix the share sheet opened.

**M14 · The Contract Coordinator card's "Change" link was about 16px tall on a phone.** (low; tie-broken REAL)
- **Cause:** it is the only way to the card's template, direction, terms and title.
- **Fix:** 44px tall on a phone (`min-h-11`).
- **Step:** the deal-tracker audit step measures it on a phone. Run on the old code, that step stopped at its earlier journey check, so the 44px check was not run there on its own.

### Stats and reports

**Known · The Stats funnel showed step rates above 100% ("120% from Attempted").**
- **Cause:** each step counted only moves into that step. A person booked straight from a first call was in Meeting Set but in neither Attempted nor Connected.
- **Rule chosen:** the funnel shows "People reaching each step", and the leaderboard's columns say "People who reached Attempted". So a step now counts everyone who reached it or a later one in the period (`rollUpReached` in `src/lib/stats.ts`).
  - Interested is a side step: it implies Attempted and Connected, and nothing later implies it.
  - Lost implies nothing.
  - The same rule applies to the team line, to each rep and to the period before.
  - As a result, no step can exceed the one before it, and Meeting conversion and Contract conversion stay at or under 100%.
- **Steps:** crm-pipeline-stats, "audit fixes: the funnel counts everyone who reached a step or a later one". Before the fix it read "step 2 has 4 people, the step before 2".
  - The existing Stats step now expects 3 people at Meeting Set and Meeting Completed, because Cara reached both on her way to Won.

**M15 · Meetings booked counted the Pipeline's backfilled rows as booked today, and counted a meeting on two tiles twice.** (medium)
- **Cause:** `loadMeetingCredit` dated a booking by when the `OpportunityMeeting` row was written.
- **Fix:** a meeting is booked at the earliest of the row, the meeting line it came from, and its own day. It is counted once per meeting (`DISTINCT ON` the save or the line).
- **Step:** crm-pipeline-stats, "audit fixes: Meetings booked counts a meeting when it was put down, once…". Before the fix: "6 !== 4".

**M17 · The Activity report's "Talks counted from" was the UTC day.** (low)
- **Cause:** it read a day late for an evening start in the US, and disagreed with Stats.
- **Fix:** `localIso(since, timeZone)`.
- **Step:** reports, "audit fixes: 'Talks counted from' is the day in the workspace's zone…". Before the fix it said Jan 2 for 8pm on Jan 1 in Chicago.

### The one-to-one email

**M23 · Loading `/dashboard/email/to/<id>` directly returned a server error (500).**
- **Cause:** the window opened during server rendering and portalled into `document.body`.
- **Fix:** it draws once it is in the browser.
- **Step:** email-marketing-users, "audit fixes: /dashboard/email/to/<id> loads straight from the server…". Before the fix: "the page answered 500".

**M20 · A contact with only a second email was offered the marketing window, which then refused them.**
- **Fix:** the marketing window is handed `Contact.email` only, and "Use a marketing template instead" is hidden when there isn't one.
- **Step:** the same email-marketing-users step.

**M18 · Escape closed the marketing window in the middle of a send.**
- **Cause:** the one-to-one window's capture-phase Escape listener stayed live after switching to the marketing window. That threw away the result, which invited a second send and used another slot of the 40-a-day allowance.
- **Fix:** the listener stands down once the marketing window is showing.
- **Step:** email-marketing-users, "audit fixes: Escape while the marketing window … is sending leaves it open with its result".

**M19 · A lost answer said "Nothing was sent" when the email had gone.**
- **Fix:** it now says "Couldn't hear back from the server, so this may or may not have been sent. Check <name>'s activity before sending again." and refreshes the page.
- **Step:** email-marketing-users, "audit fixes: when the answer is lost after the server sent it…". It lets the server answer, then cuts the connection.

### Suite drift fixed along the way

Round 2 made the Overview tiles whole dollars, but two suites still expected cents:
- `quotes-improvement` ("the dashboard's quoted and open-deal figures follow");
- `money-payments` ("Owed to you").

Both now read whole dollars and still check the same figure.

## Refuted (one line each)

- **M3:** Pull back to draft can overwrite a just-signed contract. `setContractStatus` is unchanged by the sprint and refuses Signed. The race is the base's, and narrow.
- **M5:** an online acceptance isn't tied to the figures seen. Quotes stay editable after Sent and Accepted by design (the Coordinator prices them).
- **M7:** a sent contract's schedule and signer can still be edited. This is deliberate ("amended after award") and not touched by the sprint.
- **M8:** Pull back to draft is shown to members outside "Who can send". The same control was already on the base page; the sender list governs sending only.
- **M9:** the contract page loses Send for signature. The Sending card always offers it.
- **M21:** the one-to-one email has no rate limit. Decision 16 puts it outside the 40-a-day limit on purpose. It is signed-in only, goes to the workspace's own contacts, and refuses anyone unsubscribed.
- **M22:** label-old-attempts writes to any workspace slug. It is an operator script: a dry run unless both `--apply` and `--org` are given, and it needs the database secret.
- **M24:** label-old-attempts' patterns catch real talks. The plan specifies these words, and those calls already count as attempts, so no number changes.

## For another area

- **data (`src/lib/meetings.ts`) · M16, confirmed, not fixed here:**
  - **Cause:** a meeting logged for later today and then rescheduled leaves its old `OpportunityMeeting` row. `rescheduleMeetingCore` books a new one because the event has an `activityId`, and removes the old row only when `!meeting.activityId` (around line 359).
  - **Effect:** once the old time passes, Stats counts it as held, as a try and as a talk, and the rep is credited with two bookings.
  - **Fix needed:** the reschedule should move or delete the stale row, or the attached activity.
- **pipeline (`src/lib/opportunities.ts`, `reconcileOpportunities`):**
  - **Cause:** it writes `OpportunityMeeting` rows with `createdAt` = now for meetings long past, one per tile, including meetings an earlier, closed opportunity already carries.
  - **Here:** Stats no longer miscounts them (M15).
  - **Still open:** anything else that reads `OpportunityMeeting.createdAt` as "booked" would.

## Suite results

All of these ran on a production build of the fixed code (`npx tsc --noEmit -p .` clean, `npx next build` green), port 3460, database `scb_audit_money`:

| Suite | Result |
|---|---|
| quotes-improvement | PASS (58 steps) |
| contracts | PASS (27) |
| deal-tracker | PASS (46) |
| money-payments | PASS (28) |
| projects-core | PASS (26) |
| project-money | PASS (23) |
| crm-pipeline-stats | PASS (37) |
| email-marketing-users (email group) | PASS |
| reports (reports group) | PASS (49) |

Before the fixes: every new "audit fixes:" step was run alone on a build of d7d77b0, and each failed, with the one exception noted at M14.

## Notes for CLAUDE.md

**Rules for the code:**
- **A public link's action re-checks state in the write itself.** Hiding a form on the page stops nothing: a tab opened earlier, or a replayed post, still arrives. Sign and accept write WHERE status = the state they expect and treat a count of 0 as "someone else won". That also makes a double tap run the award once.
- **A link that survives a re-send needs a version on the form.** `/c` carries the `sentAt` of the copy the customer read; a stale one is refused with "Reload".
- **A quote's Valid until is honoured online:** `quoteExpired()` in `src/lib/quote-accept.ts`.
- **`acceptedByName` belongs to one answer.** Any other status change clears it.
- **A Stats funnel step is everyone who reached it or a later one** (`rollUpReached`). Interested implies only Attempted and Connected. No step exceeds the one before.
- **Never count "booked" by a row's `createdAt`.** The Pipeline's reconcile writes rows today for meetings long past. Use the earliest of the row, its meeting line and its day, and count each meeting once.

**Rules for the screens:**
- **A "use client" component that opens by default still renders on the server.** Anything it portals into `document.body` must wait until it is mounted.
- **A capture-phase key listener must stand down when a child window takes over.** Otherwise the outer window closes the inner one mid-action.
- **A thrown server action doesn't mean nothing happened.** The answer can be lost after the work is done, so never say "nothing was sent".
- **A card that joins the quote's one Save needs its own Save on a phone,** because the foot bar is hidden there.

**Testing:**
- **The Overview tiles are whole dollars** (round 2), so a suite reading them must not expect cents.
