# Release A: Sales and calendar

Branch: `claude/ai-release-a` (from `claude/ai-release`). Suite: `scripts/browser-tests/ai-release-a.cjs`. Database: `scb_a`.

Where it came from: the "Sales and AI enhancements" session (Oct 2, 2026; Taylor approved all five, never pushed), Calendar v2 (Sept 28; Taylor approved an AI pre-call card that was silently dropped) and the BDR think tank (Nov 11). The Oct 2 build is on `claude/ecstatic-keller-6hu3sk` (`git fetch origin claude/ecstatic-keller-6hu3sk`, then `git show origin/claude/ecstatic-keller-6hu3sk:src/lib/forecast.ts` and so on: `briefing.ts`, `forecast.ts`, `call-list.ts`, `duplicates.ts`, `components/before-you-call.tsx`, `components/duplicate-pair.tsx`). **Read it for ideas and rules; never merge it.** My day, the log sheet, the contact page and the duplicate finder all changed since.

Already approved and built, don't redo: Draft a follow-up, Suggest from meeting notes, the My day greeting, the rule-based Find duplicates.

## A1. Brief me (kind `BRIEF`)

Five lines before a call or meeting: who they are, every company they're part of (main plus `ContactAccount`), the last three touches with their outcomes, open opportunity (stage, label, value), open quotes and money owed, a meeting coming up, and one thing to ask. Built only from what's on file.

- **Facts first, by rules** (a `src/lib/brief.ts` loader, batched, workspace-scoped): the card shows the facts even without the key. With the key, Claude writes the lines and the "ask" from those facts only. Every number must pass `inventedNumbers`; a name or company it mentions must be in the facts; on any failure show the facts alone with "Couldn't write the brief this time."
- Notes go in fenced (`notesForPrompt`); marketing sends are never a touch; Do Not List people are left out of an opportunity's people.
- **Kept**: store the written brief with a fingerprint of its facts (a small table is fine) and reuse it until the facts change; "Rewrite" asks again.
- **Where** (add, don't move): the contact page (a "Brief me" control near the header band's main button that opens the brief inline or as a sheet), Call and Meeting entries with a contact on the calendar (Agenda row and the week/month entry: this is the Sept 28 pre-call card), each Up next row on My day, and the Pipeline panel's People (the Primary POC, before a meeting).

## A2. Drafted opener on Up next (kind `CALL_OPENER`)

On each Up next row (`src/app/dashboard/my-day/up-next.tsx`, ranking in `src/lib/up-next.ts`): a tap shows one line to open the call and a short text to send, written for that person from the brief's facts, with Copy. Only on a tap, never for every row on load. Opening the text uses the row's existing Text button (`sms:`); logging stays How did it go?. Taylor's call 1: this is the Call List; there is no separate page.

## A3. Say it, don't type it (kind `VOICE_LOG`)

In How did it go? (`src/components/how-did-it-go/`), everywhere it opens:

- A mic button. The phone turns speech into words in the browser (`SpeechRecognition` / `webkitSpeechRecognition`; words appear in the notes box as they come). No audio is recorded, stored or sent anywhere by us. Where the browser has no speech recognition, the mic says "Use your keyboard's mic to dictate" and focuses the notes box.
- "Fill it in from my words": Claude reads the notes (and the touch type, the person, any meeting waiting on an answer) and returns an outcome from `OUTCOMES_BY_TYPE` for that type, a next step from the options the sheet offers at that point, a follow-up day if one was said, and tidied notes. The sheet pre-picks them; the person changes anything and taps the sheet's one Save. Anything outside the offered options is dropped.
- Works on typed words too. Under 1 cent; cap 400 a day.

## A4. Forecast on Stats (kind `FORECAST_NOTE`)

A Forecast section on Stats (`src/app/dashboard/stats/page.tsx`, numbers in a new `src/lib/forecast.ts`): what's likely to sign this month and next, by rep, from open deals in Quote Sent and Contract Sent, the workspace's own step-to-signed rates and typical days from `StatusChange` (from Sept 30, 2026), deals running past their usual time flagged. It follows Stats' period and rep filters where it makes sense, and Members open on Me like the rest of Stats.

- The numbers are rules. Claude writes one plain sentence behind each rep's number from the numbers only (`inventedNumbers`); otherwise a rules sentence.
- **Marked "Low confidence" until the workspace has 90 days of status history** (and say why in plain words). Store the sentences by a fingerprint of the numbers, like report write-ups.

## A5. Looks like the same person (no AI)

On a contact's page: another contact in the workspace with the same email (either of their two), the same phone digits (phone, second phone or mobile, last 10) or the same name at a different company, with "Merge these" (opens Merge Contacts with both picked) and "+ Additional Account" (links the other record's company to this person) and "Not the same person", which is remembered for the pair (a small table) and also hides that pair in Find duplicates (`src/lib/duplicates.ts`, `src/components/duplicates-view.tsx`). Batched, one query per page view, fast at 200,000 contacts (`load-test.cjs` seeds that; time it).

## Not in Release A

Suggest fields needs nothing built: the key switched it on; the coordinator has Taylor click it once on the live site.

## Suites to run

`"ai:ai-assist,ai-release-a"` plus at least `plain:how-did-it-go,myday,health,company-page,connected,crm-accounts,crm-data,calendar-v2,round2-pages,pipeline-opportunities,crm-pipeline-stats` and `load`. `crm-data` runs in the `email:` group. Add whatever else your files touch.
