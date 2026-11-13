# Release A report: sales and calendar

Branch `claude/ai-release-a`, made from `claude/ai-release` (eecf676). Suite: `scripts/browser-tests/ai-release-a.cjs`, 30 steps.

## Built

- **A1. Brief me.** A button that opens a card about one person before a call or meeting. The card always shows the facts on file, worked out by rules with no AI:
  - who they are, with every company they belong to (their main one, then each Additional Account)
  - their last three touches and how each went (marketing sends and no-shows are left out)
  - the open opportunity: stage, label, value, and its people (Do Not List left out)
  - quotes that are out, money owed (through their company if they have one), and the next meeting
  
  With the key set, opening the card asks Claude for five plain lines and one thing to ask, written from those facts only. The written brief is kept until the facts change, and Rewrite asks again. Before anything is shown, every number and every name Claude used is checked against the facts. If one fails, the card shows the facts with "Couldn't write the brief this time." The button sits in four places:
  - the contact page header, as the last button in the actions row after ⋯ More
  - Call and Meeting entries on the calendar that have a person and aren't done: the entry card in week and month view, and the open Agenda row
  - each Up next row on My day
  - the Pipeline panel, on the Primary POC's row
  
  Files: `src/lib/brief.ts`, `src/lib/ai-writing.ts`, `src/app/dashboard/brief-actions.ts`, `src/components/brief-me.tsx`.
- **A2. Drafted opener on Up next.** "Draft an opener" on each row, AI only. It runs only when tapped, never when the page loads. It gives one line to open the call and a short text, each with Copy, and Rewrite asks again. It is written from the brief's facts and the row's reason. It is kept per person, per rep and per reason, so a teammate never gets an opener that introduces somebody else. Sending still goes through the row's own Text button, and logging through How did it go?. There is no separate Call List page. File: `src/app/dashboard/my-day/opener.tsx`.
- **A3. Say it, don't type it.** Added to How did it go? everywhere it opens: the contact page, the company page, the calendar's Done box, Up next and the Pipeline panel.
  - **Say it** uses the browser's own speech recognition to put words in the notes box as they are spoken. Nothing is recorded or sent by us. Where the browser has no speech recognition, the button says "Use your keyboard's mic to dictate" and puts the cursor in the box. Typing, or tapping Fill it in, stops the mic.
  - **Fill it in from my words** (AI only) suggests an outcome from the sheet's own chips for that kind of touch, a next step from the ones the sheet offers after that chip, a day if one was said, and tidied notes. The chip shows as picked, and a banner reads "From your words: Talked · then book a meeting Thu" with Save and "Use my words". Nothing is saved until the person saves.
  - After the save, step 2 opens with the suggested next step and day already picked, using the sheet's existing flow. That makes it two taps, not one; see Questions.
  - Anything outside the options is dropped. Tidied notes containing a number nobody said are dropped too.
  
  Files: `src/components/how-did-it-go/mic.tsx`, `voice-actions.ts`, `voice-options.ts`, and changes in `how-did-it-go.tsx`. `logContext` now also returns `ai`.
- **A4. Forecast on Stats.** A Forecast panel at the foot of Stats.
  - It shows what's likely to sign this month and next, by rep. The numbers come from open deals at Quote Sent and Contract Sent, using this workspace's own rates (how deals that reached each step ended) and its usual days to sign.
  - The rates lean on a starting guess until real history builds up.
  - A deal past its step's usual time is listed under "Running past the usual time". Past twice that time, its chance is halved.
  - It reads "Low confidence" in plain words until the workspace's deals have 90 days of history.
  - It follows the rep filter, so Members open on Me. It looks ahead, so the period filter doesn't apply, and the panel says so.
  - Each rep has one sentence under their numbers. The rules write it; with the key, Claude may write it from that rep's numbers only, and a sentence with a number that isn't there keeps the rules one. Sentences are kept by a fingerprint of the numbers, like the report write-ups.
  - It reads the newest 5,000 open deals and says how many older ones were left out.
  
  Files: `src/lib/forecast.ts`, `src/app/dashboard/stats/forecast.tsx`, `forecast-actions.ts`.
- **A5. Looks like the same person** (no AI). A card under the contact page header lists other contacts who look like the same person:
  - the same email, in either email field, ignoring case
  - the same phone (phone, second phone or mobile, last 10 digits)
  - the same name at a different company
  
  Each row offers:
  - **Merge these**: opens Merge Contacts with both picked
  - **+ Additional Account**: adds the other record's company to this person; hidden when it's already linked or the other record has no company
  - **Not the same person**: remembered for the pair, with Undo; it also hides that pair in Find duplicates
  
  It is one statement per page view, each match going through an index first. At 200,000 contacts the page opens in 0.39 s, and Find duplicates with a dismissed pair in 0.24–0.61 s. Files: `src/lib/lookalikes.ts`, `src/app/dashboard/contacts/[id]/lookalikes.tsx`, `src/app/dashboard/contacts/lookalike-actions.ts`, and `src/lib/duplicates.ts`.

## Not built, and why

Everything in release-a.md is built. Two small departures from the brief:

- **Brief me on the Agenda is in the open row, not the row itself.** The Agenda row's own button bar was already full on a phone, so Brief me sits in the entry card that opens when the row is tapped. Week and month entries show it straight away.
- **Fill it in is two taps**, which Taylor confirmed on Nov 13.
- **The forecast doesn't show how it did over a past stretch**, because past forecasts aren't saved. See Questions, item 2.

## Questions for Taylor

All three were answered by Taylor on Nov 13, 2026, and the answers are built:

1. **Fill it in from my words stays two taps.** One Save logs the touch, and step 2 opens with the next step already picked. No change was needed.
2. **The forecast looks ahead, and a date filter narrows it.** Stats' period picker now also has a **Custom** From–To range (a plain form under the Custom button; the rep filter is kept).
   - The past part of the picked dates is counted like any period, and compared with the same number of days before.
   - The part still ahead narrows the forecast to just those dates, by rep. It is marked "Rough" past the end of next month, and the AI sentence is kept per set of dates.
   - Dates entirely in the past leave the forecast on this month and next, and say so.
   - The period buttons drop the custom dates; the rep filter keeps them.
   - Not built: "how the forecast did" over a past stretch. Yesterday's forecasts aren't saved, so comparing them with what signed would mean starting to save a snapshot each day. That's worth a word with Taylor if he wants it.
3. **Duplicate check on company pages: built.** A "Looks like the same business" card under a company's header, using Find duplicates' company rules:
   - the same name, ignoring case, spaces and punctuation
   - the same website domain
   - the same phone (last 10 digits)
   
   Each match offers Merge these (Merge Companies with both picked) and Not the same business (remembered, with Undo, and also hidden in Find duplicates).

## Database changes

Two migrations, both only adding things, so they are safe for existing rows: `20261112120100_ai_a_writings_and_pairs` adds the two tables below, and `20261113120000_ai_a_company_website_trgm` adds a trigram index on `Company.website`, for the company check.

| Table | Before | After |
|---|---|---|
| `AiWriting` | none | organizationId, key ("brief:<contactId>", "opener:<contactId>:<userId>", "forecast:<reps or all>[|from..to]"), fingerprint, body (JSON), createdAt, updatedAt. Unique (organizationId, key). |
| `DuplicateDismissal` | none | organizationId, kind ("contact" or "company"), aId < bId (byte order, compared with COLLATE "C"), userId, createdAt. Unique (organizationId, kind, aId, bId). |

No existing table or column was changed. `Organization` gains two relation fields, which don't touch the database.

## AI kinds used

All four already existed in `AI_DAILY_CAPS`; none were added. Every call runs at low effort and goes through `askClaude`. Prompt sizes were measured from the stand-in's requests; a token is about four characters.

| Kind | What it sends | Prompt size | Cap |
|---|---|---|---|
| BRIEF | The facts as JSON (names, companies, stage, label, money as text, dates) and the last three notes, each fenced in `<note>`. No email addresses, phone numbers or ids. | About 1,800–2,600 characters (500–700 tokens) plus a 450-character system prompt | 300 |
| CALL_OPENER | The same facts, the row's reason fenced in `<reason>`, and the rep's and the business's names | About 2,000–2,800 characters | 300 |
| VOICE_LOG | Today's date, the kind of touch, the person's name and company, the meeting waiting on an answer, the allowed chips and next steps, and the words fenced in `<words>` | About 1,200 characters plus the words (at most 4,000) | 400 |
| FORECAST_NOTE | Each rep's forecast numbers, formatted, with the rep's name. Nothing else from the CRM. | About 300 characters a rep (20 reps at most) | 60 |

## Suite results

Server built with `npx next build` and run through `run-suites.sh` against `scb_a`.

Final run, after the audit fixes, on one build:

| Group | Suite | Result | Steps |
|---|---|---|---|
| ai | ai-assist | PASS | 28 |
| ai | ai-release-a | PASS | 30 |
| plain | how-did-it-go | PASS | 24 |
| plain | myday | PASS | 43 |
| plain | health | PASS | 34 |
| plain | company-page | PASS | 24 |
| plain | connected | PASS | 59 |
| plain | crm-accounts | PASS | 22 |
| plain | calendar-v2 | PASS | 42 |
| plain | round2-pages | PASS on a solo rerun | 10 |
| plain | pipeline-opportunities | PASS on a solo rerun | 59 |
| plain | crm-pipeline-stats | PASS | 37 |
| plain | calendar | PASS | 47 |
| plain | overlay-readability | PASS | 16 |
| plain | looks | PASS | 31 |
| email | crm-data | PASS | 68 |
| load | load-test (200,000 contacts) | PASS | 14 |

In the group run, two suites failed on timing and passed when run alone:

- `round2-pages` step 10 measured a 44px button as 43.99997px while the page was still fading in, the known lesson in CLAUDE.md.
- `pipeline-opportunities` step 59 hit a 140 ms budget at 375 ms. This release doesn't touch the board's loading.

Both passed in the first full run too.

At 200,000 contacts in `load-test`: a contact page with three lookalikes opened in 0.44 s; Find duplicates with a dismissed pair took 0.65 s by email and 0.28 s by phone; the slowest page overall was 1.22 s.

The first full run, before the audit fixes, also passed every suite above except `load-test`. Its new step used ids that broke a later step's `right(id, 2)::int`; that was fixed.

`npx tsc --noEmit -p .` is clean. `npx eslint` is clean on every file this release touches, apart from `up-next.tsx:308` (`set-state-in-effect` in `OnBody`), which fails on the base branch too and wasn't changed here.

**Audit (`/session-auditor`):** 17 flagged, 16 distinct, 16 confirmed, 0 refuted. All were fixed, each with an "audit fixes:" step in `ai-release-a.cjs`, and the Merge-button target is checked in its phone step. One more defect was found by its own regression step and fixed: in "Looks like the same person", rows with no email sorted ahead of real matches, because a NULL score sorts first. The `load-test.cjs` timings for that card are noted below.

| Finding | Fix | Step |
|---|---|---|
| A sentence's first verb ("Confirm Thursday") read as a name | `ai-writing.ts`: the first word is never checked | audit fixes: a verb before a name… |
| "I'm" / "I'll" read as names | `ai-writing.ts`: contractions stripped | same, plus the opener step |
| A name inside another ("Dan" in "Dana") passed | `ai-writing.ts`: whole words only | same |
| "one quote", "two calls" read as invented numbers | `brief.ts` `factCounts` | same |
| Opener kept per person only, so it was served to another rep | `brief.ts` `openerKey(contact, user)` and the reason in the fingerprint | audit fixes: an opener in the first person… |
| The client's reason not fenced, and allowed as a source of names | `brief.ts`: fenced in `<reason>`, numbers only | same |
| The mic overwrote typed or tidied words | `mic.tsx`: input or Fill stops it, nothing written after | audit fixes: typing while the mic listens… |
| Tidied words replaced the person's own when no outcome was picked | `how-did-it-go.tsx` | same |
| The words were lost after Back from the Book step, and Fill did nothing | `how-did-it-go.tsx` | same |
| The main Log button saved no outcome while one showed picked | `how-did-it-go.tsx` `onSubmit` | same |
| A deal won and then moved to Lost counted as a win | `forecast.ts`: how deals ended now | audit fixes: a deal won then moved to Lost… |
| History counted a contact's back-dated step | `forecast.ts`: deal rows only | same |
| Over 2,000 open deals kept the oldest, silently | `forecast.ts`: the newest 5,000, plus a left-out note | same |
| Status moves read oldest first | `forecast.ts`: newest first | same (code) |
| The expected day was counted from UTC | `forecast.ts` `zoneDay` | no screen shows it outside month edges; covered by reading the code |
| The lookalikes cap was applied before ranking | `lookalikes.ts`: ordered by score before LIMIT, NULL-safe | audit fixes: a record matching on email and phone… |
| Merge these was under 44px on a phone | `merge-button.tsx` | the phone step |

## Files touched outside your release

- `src/components/how-did-it-go/how-did-it-go.tsx`, `actions.ts`, `types.ts` (the shared log sheet)
- `src/app/dashboard/calendar/calendar-views.tsx` (EventCard gets Brief me)
- `src/app/dashboard/deals/opportunity-panel.tsx` (Brief me on the Primary POC)
- `src/app/dashboard/my-day/up-next.tsx`, `my-day.tsx` (the links row and the `ai` prop)
- `src/app/dashboard/contacts/[id]/page.tsx` (the Brief me button, the lookalikes card)
- `src/app/dashboard/stats/page.tsx` (the Forecast panel)
- `src/lib/duplicates.ts` (the dismissed-pair filter)
- `src/lib/list-query.ts` (`likeText` exported)
- `src/components/merge-button.tsx` (a 44px target on touch)
- `scripts/browser-tests/load-test.cjs` (a step timing the lookalikes card and Find duplicates at 200,000)

## Notes for CLAUDE.md

**Release A, sales and calendar (Nov 12, 2026).**

- **Brief me** (`src/lib/brief.ts`, `BriefMeButton` in `src/components/brief-me.tsx`):
  - The facts are rules and show with no key.
  - Claude writes five lines and an ask from them only. `answerProblems` checks numbers with `inventedNumbers` (plus `factCounts`, so "one quote" is fine) and names with `inventedNames` in `src/lib/ai-writing.ts`: whole words, contractions stripped, a sentence's first word skipped.
  - A failed check shows "Couldn't write the brief this time." over the facts.
- **Kept AI writing lives in `AiWriting`** (`readWriting` / `storeWriting` / `fingerprintOf`):
  - keys are `brief:<contactId>`, `opener:<contactId>:<userId>` (the reason is in the fingerprint) and `forecast:<rep ids or all>`
  - nothing calls Claude on page load except the forecast, which asks once per set of numbers, as report write-ups do
- **Draft an opener** lives on Up next rows only (`my-day/opener.tsx`). Taylor: this is the Call List.
- **The log sheet's mic and Fill it in** (`how-did-it-go/mic.tsx`, `voice-actions.ts`, `voice-options.ts`):
  - Fill only picks from `voiceChips(type)` and `voiceNextSteps(chip)`, and the sheet re-checks against `nextChoices`.
  - The picked chip is what the main Log button saves.
  - Typing, or dispatching `MIC_STOP` on the notes box, stops the mic.
  - Suites fake speech by defining `window.webkitSpeechRecognition` in an init script (`ai-release-a.cjs` `FAKE_SPEECH`).
- **The Stats forecast** (`src/lib/forecast.ts`):
  - rates come from deals that are Won or Lost now (a deal won and then lost is lost)
  - history counts from the first StatusChange with a dealId; Low confidence lasts until 90 days
  - the expected day is counted in the workspace's zone
  - it reads the newest 5,000 open deals and says how many it left out
- **Looks like the same person** (`src/lib/lookalikes.ts`):
  - It is one statement. A missing email is NULL, so every match score is `coalesce(…, false)`.
  - "Not the same person" is `DuplicateDismissal` with the smaller id first, compared byte by byte (`pairKey`; SQL uses COLLATE "C").
  - `findDuplicateGroups` hides a contact group of up to ten in which every pair was dismissed, and skips the check while the workspace has none.
- **Suites:**
  - fake-claude's `reply()` treats any object with a string `text` field as a raw reply, so an answer with a `text` key (the opener's) must be sent as `{ text: JSON.stringify(value), stop: "end_turn" }`
  - `load-test.cjs` seeds contact ids as `lp` plus 8 digits because a later step reads `right(id, 2)::int`
- **Stats' Custom dates (Nov 13, 2026)** come in as `?from=&to=` (`readCustomRange` in `stats/page.tsx`; at most three years, From on or before To).
  - `loadStats` takes `range`, counted up to now and compared with the same length before.
  - `forecastWindow(today, from, to)` narrows the forecast to the part still ahead, marked `rough` past the end of next month; `forecastKey` carries the dates.
  - A period button drops the dates; a rep link keeps them.
- **Looks like the same business (Nov 13, 2026)** is `findCompanyLookalikes` in `src/lib/lookalikes.ts`, using Find duplicates' company rules (name, website domain, phone), and `DuplicateDismissal.kind` "company".
  - `dismissedFilter` in `duplicates.ts` covers both kinds.
  - `Company_website_trgm_idx` is in the Prisma schema, so `migrate dev` won't try to drop it.
