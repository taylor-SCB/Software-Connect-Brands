# Screen: numbers — final report

Branch `claude/sprint-numbers`. Stats funnel and leaderboard, the Overview Activity report, and the one-to-one email from a contact's page.

## Built

**Stats (`/dashboard/stats`)**
- Headline tiles: **Tries · Talks · Connect rate · Meetings booked · Show rate · Won $** (`data-testid=stats-tile`, `data-id` tries / talks / connect-rate / booked / show-rate / won). Show rate shows "N held of M that came due" under it. A rate moves in points ("▲ 12 pts").
- Tries and talks count each save once (`COALESCE(batchId, id)`). A try is any non-marketing touch that has happened and isn't a no-show; a talk uses the isConnect rule (TALKED / REPLIED / HELD, or a MEETING with no outcome that has happened). This is the same SQL as `health-load.ts`.
- Meetings: booked = `OpportunityMeeting` rows created in the period. Due = their `on` falls in the period and is not in the future. Held = marked HELD (on the meeting or its logged line), or unmarked with a past meeting line logged, or dated before `outcomesSince` ("old meetings count as held"). Credit goes to `bookedById`, then the meeting line's logger, then the opportunity's rep for older rows (decision 13).
- Funnel: **Attempted → Connected → Meeting Set → Meeting Completed → Quote Sent → Contract Sent → Won**, each with its rate from the step before (`funnel-step` with `data-step` / `data-rate`, `funnel-rate`). Interested is still counted (Columns has the people steps) but sits outside the funnel.
- "Talks counted from <date>" (`stats-talks-since`) shows only when the period starts before `Organization.outcomesSince`.
- Leaderboard defaults to Rep · Tries · Talks · Connect rate · Meetings booked · Held · Won $. **Columns** (a FloatingMenu) adds Show rate, Calls, Texts, Emails, Meetings logged, Attempted, Connected, Mtg set, Mtg completed, Quotes, Contracts, Won and Close rate, and has "Back to the usual columns". Each person's pick is saved in `User.uiPrefs.statsColumns`, merged in with jsonb `||` so other keys survive.
- Phone: the funnel is a vertical list with the number and rate on each step, and the leaderboard is one card per rep (`stats-rep-card`). No sideways scroll at 390px.
- The persona chips (VP / BDR / CRO / AE) are gone. The per-day numbers (tries, talks and each kind) sit behind **Show numbers**.
- Members open on **Me** (`stats-me`), with **Everyone** one tap away. `?reps=all` means Everyone picked on purpose, and it survives a period change. Owners and Admins open on Everyone, as before.
- The day chart is now stacked tries (grey `--health-none`) and talks (green `--health-good`). "Activity by rep" is stacked the same way.

**Overview → Activity report**
- Tiles: Tries (id stays `touches`), **Talks**, **Connect rate**, People reached, Calls, Meetings, Marketing emails, Not touched. With 8 tiles the grid is 4 across.
- "Tries and talks by day/week" (`activity-tries-talks`) and "Tries and talks by rep / group" (`activity-groups-chart`) are stacked grey and green. The old chart by kind of touch is one tap down under **By kind** (`activity-by-kind`). Marketing keeps its own chart.
- Counting matches Stats: one save is one try, and no-shows and touches dated ahead are left out (people touched and not touched too). Marketing is still counted per email.
- The table gains a Talks column after Tries. The write-up adds "N of them were talks (X%)", and the AI write-up gets the talks numbers.
- "Talks counted from …" (`activity-talks-since`) uses the same rule as Stats.
- The report tab "Pipeline" is now **"Pipeline report"** (`REPORT_LABELS`), so report email subjects and My report emails read "Pipeline report" too.
- In every report, the duplicate table under a chart (`ChartAndTable`) sits behind **Show numbers** (`report-show-numbers`).

**One-to-one email (decision 16)**
- `ContactEmailButton` (in `src/components/email-composer.tsx`) opens a portal dialog: To (a select when the contact has two addresses), Subject, Message, Send.
- It sends a plain email with no template, no merge fields, no unsubscribe footer and no List-Unsubscribe header. It writes no `EmailSend` row, so it isn't in the 40-a-day allowance. From reads "<Rep> · <Business>", and replies go to the rep.
- After the send it logs through `logActivity` as EMAIL, outcome SENT, marketing false. So it lands on the calendar, makes the person Attempted, sets lastTouchAt, and offers "Want to set a follow-up?" when `today` is passed.
- With no address the button becomes a link, "No email on file · Add one", to the edit form.
- A person who unsubscribed can't be emailed: the window says to call or text instead, and the server refuses too (see Follow-up).
- "Use a marketing template instead" opens the unchanged marketing window with them on the To line.
- New page `/dashboard/email/to/<contactId>` opens the same window directly. It's a link-anywhere "Email this person", and it's where the suite tests the sender without touching the contact page.
- The marketing window (`EmailButton` / `EmailComposer`) is unchanged apart from now drawing through a portal on `document.body`.

## Not built, and why
- **The Email button on the contact page itself isn't switched over.** That page belongs to `claude/sprint-contact`. To mount it there, in `src/app/dashboard/contacts/[id]/page.tsx` on that branch, replace the `<EmailButton … recipients={[…]} />` inside `data-testid="contact-actions"` (right after `<TextButton phones={phones} />`) with:
  ```tsx
  import { ContactEmailButton } from "@/components/email-composer";
  …
  <ContactEmailButton
    className="btn btn-ghost btn-sm pointer-coarse:min-h-11"
    contact={{
      id: contact.id,
      name: contact.name,
      email: contact.email,
      email2: contact.email2,
      optedOutOn: contact.emailOptOutAt ? formatDate(contact.emailOptOutAt, timeZone) : null,
    }}
    today={today}            // the page's todayIso(timeZone), for the follow-up box
    onSent={({ message }) => showToast?.({ message })}   // optional, inside ContactShell
  />
  ```
  `email-marketing-users.cjs` step "Email from a contact: template, file, one person, the counter" clicks the contact page's Email button and expects the **marketing** window. After the swap, that step should start with `click('[data-testid="contact-email-button"]')` then `click('[data-testid="one-to-one-use-marketing"]')`. Everything after it stays the same. The PhoneBar's Email (if it uses `EmailButton`) wants the same swap.
- **"A zero baseline reads 'new this period'"** (plan). I kept "▲ up from 0". It's the shipped rule from the Nov 10 UX review (CLAUDE.md lesson), `changeSize` is shared by every report and Stats, and `reports.cjs` asserts it. It's a one-line change in `changeSize` if Taylor wants the plan's words.
- ~~One-to-one to an unsubscribed contact is allowed with a note~~ — replaced; see Follow-up.
- **No per-day cap on one-to-one emails.** The spec says they aren't in the 40. Resend's plan limit is still shared by every workspace (a known gap).
- **Who sees whom is unchanged:** a Member can still pick any teammate or Everyone (decision 17: everyone sees everyone).

## API others can use
- `src/lib/stats.ts`
  - `loadTouches(orgId, from, to, timeZone, userIds|null)` → rows `{user_id, day, type, tries, talks}` (per save).
  - `loadMeetingCredit(orgId, from, to, outcomesSince|null)` → rows `{user_id, booked, due, held}`.
  - `RepRow` gains `tries, talks, connectRate, booked, due, held, showRate`; `StatsSnapshot` gains `talksSince` and `daily[].talks`.
  - Team today / My day rings can use these two loaders directly, scoped to today or this week.
- `src/lib/stats-columns.ts`: `LEADERBOARD_COLUMNS`, `DEFAULT_LEADERBOARD_COLUMNS`, `readLeaderboardColumns(uiPrefs.statsColumns)`, `LeaderboardRow`.
- `src/app/dashboard/stats/actions.ts`: `saveLeaderboardColumns(keys: string[])` (server action).
- `src/lib/reports/format.ts`: `TRY_TALK_COLORS` (`["var(--health-none)","var(--health-good)"]`), `TRY_TALK_SERIES` (`["Attempts","Talks"]`).
- `src/app/dashboard/reports/charts.tsx`: `HBars`, `Columns` and `Legend` take an optional `colors` prop. `stats/charts.tsx` `RepActivityBars` does too.
- `ActivityReport` gains `talks, previousTalks, talksSince` and `series[].talks` / `groups[].talks`. Headline ids `talks`, `connect-rate`.
- `src/components/email-composer.tsx`: `ContactEmailButton({ contact: {id, name, email, email2?, optedOutOn?}, label?, className?, addEmailHref?, today?, onSent?({message, batchId}), defaultOpen?, testId? = "contact-email-button" })`.
  - Testids: `contact-email-button`, `contact-email-button-missing`, `one-to-one-email`, `-to`, `-subject`, `-body`, `-send`, `-sent`, `-sent-message`, `-follow-up`, `-opted-out`, `-use-marketing`, `-done`.
- `src/app/dashboard/email/actions.ts`: `sendContactEmail({contactId, to, subject, body})` → `{error}` | `{success, batchId?, followUp?, logError?}`.
- `src/lib/email-marketing.ts`: `sendOneToOneEmail(session, {contactId, to, subject, body})`, `renderPlainHtml(body)`, `oneToOneLogBody(subject, body)`.

## Suite results
Production build, `npx tsc --noEmit -p .` clean (apart from `LayoutProps`, which only `next build`'s typegen supplies), `npx next build` green.
- `reports`: **PASS, 47 steps.** Updated: the tab name, the Pipeline report email subject and My report emails line, the group table's Not touched column moving to index 7, and the Activity chart selector. New Sprint steps:
  - tries vs talks
  - one batch = one try, a no-show is no touch
  - grey and green in both charts, By kind folded away
  - Talks counted from
  - Show numbers
- `plain:crm-pipeline-stats`: **PASS, 32 steps.** Step 18 onward was rewritten for the new tiles, funnel and columns (Nic's bookings checked against SQL). New Sprint steps:
  - persona chips gone, Show numbers
  - per-batch counting with a voicemail and a no-show
  - show rate with a no-show credited to the booker
  - Columns saved and remembered, then reset
  - Talks counted from
  - a Member opens on Me, Everyone sticks
  - phone cards and funnel list
- `email:email-marketing-users`: **PASS, 28 steps.** New Sprint steps:
  - one-to-one at 40 of 40, with no footer, merge, header or EmailSend row
  - logged as EMAIL / SENT / not marketing, with Attempted, lastTouchAt and the follow-up box
  - no send to anyone unsubscribed, on screen and on the server (see Follow-up), and "No email on file · Add one"
  - "Use a marketing template instead"

## Files touched outside yours
- `src/app/dashboard/stats/charts.tsx` (owned) and `src/app/dashboard/reports/charts.tsx` (owned): optional `colors` props only.
- New files `src/lib/stats-columns.ts` and `src/app/dashboard/email/to/[contactId]/page.tsx`. Both are mine, just outside the exact globs.
- `scripts/browser-tests/reports.cjs`, `crm-pipeline-stats.cjs`, `email-marketing-users.cjs`: updated and extended as above.
- No migration, no shared component edits. `src/app/dashboard/email/actions.ts` imports `logActivity` from contacts/actions without changing it.

## Notes for CLAUDE.md
- Stats and the Activity report count **tries and talks per save** (`COALESCE(batchId, id)`), with the touch and connect rules copied from `health-load.ts`. Change all three together.
- **Show rate** = held ÷ `OpportunityMeeting` rows dated in the period that came due, credited to `bookedById` → the meeting line's logger → `Opportunity.ownerId`. An unmarked meeting with a past meeting line counts as held (the isConnect rule), and so does one dated before `outcomesSince`. An unmarked meeting with no line after launch counts as not held.
- Meetings booked counts every `OpportunityMeeting` row, so a missed meeting rebooked is two bookings (one a no-show).
- The leaderboard's columns are per person in `User.uiPrefs.statsColumns`. Write other screens' prefs with jsonb `||` too, never replace the whole object.
- Stats: a Member opens on Me. `?reps=all` is Everyone picked on purpose.
- The report tab and email subjects read **"Pipeline report"**.
- One-to-one email (`ContactEmailButton`) writes **no EmailSend row** (that table is the marketing allowance). It logs through `logActivity` as EMAIL / SENT / marketing false, and is refused for anyone with `emailOptOutAt` (window and server).
- The marketing `EmailComposer` now renders through a portal.

## Follow-up (sprint lead, Nov 11, 2026)

A one-to-one sales email is still commercial email, so **a contact who unsubscribed is never emailed from the app**:
- **In the window:** `ContactEmailButton` / `OneToOneDialog` shows "<Name> unsubscribed from your emails on <date>. Call or text instead." (`one-to-one-opted-out`). Send stays disabled with a subject and message typed, and "Use a marketing template instead" is hidden.
- **On the server:** `sendOneToOneEmail` reads `emailOptOutAt` and returns "<Name> unsubscribed from your emails. Call or text instead." before anything is sent or logged. So a stale tab or a crafted call can't get through.
- **Suite:** the `email-marketing-users.cjs` Sprint step proves both.
  - The disabled Send for Eve, who unsubscribed.
  - The server refusal: the window is opened for Alice while she can still be emailed, then she is unsubscribed in the database, and Send is refused with nothing caught and nothing logged. (A forced click on a disabled button doesn't work because React ignores clicks on buttons it rendered disabled, so it never reaches the server action.)
- **Second fix:** the earlier Sprint send went to Ben, who unsubscribed in an earlier step of the same suite. It now goes to Alice.
- **Results:** reports 47 steps PASS, crm-pipeline-stats 32 PASS, email-marketing-users 29 PASS. tsc and next build are green.
