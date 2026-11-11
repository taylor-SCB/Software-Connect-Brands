# Screen: pipeline

## What to build (approved)

THE PIPELINE (plan: Pipeline board, tile and panel; Release 1 tiles + Release 7). Bar: [Mine | Everyone] first (Mine for Members, approved decision 17), Search, Gone quiet, "Needs a decision" (meetings that have passed), Lead label; ⋯ holds Show archived, Contract Coordinator, New quote. Tile: three lines plus a 3px health top edge — the person in bold with the company faint under it (tile titled by the Primary person), the mini meter, one next-step line ("Meeting Tue 10:00 AM" · "Met Nov 6 — how did it go?" · "Quote $11.8k · sent 3d" · "Quiet 14d — call"); rep initials and ⋯ (Move to…, Lead label, Draft follow-up, Open); label chip only when set ("+ label" on hover/focus). Meeting Set column split into "Coming up" (by meeting date) and "Happened — how did it go?" with Held / No-show / Reschedule (the data coder's meeting actions); moving a future meeting to Completed asks "This meeting is Tue Nov 17. Did it happen early?". Column header: name, one count, a thin 6px health-mix bar with one shared legend. Panel: full meter and reason on top, people rows with Call / Text / Email / Log and the Primary / Associated / Do Not List switch, meetings with time and note upcoming first, Save only when something changed, a stage move saves first. Convert prompt reworded "What happened after the meeting with <person> (<company>)?" with four cards (Building them a quote / Sending a contract / They signed — amount required / Not moving forward — asks why); every option kept. Approved decision 19: Build Quote leaves the deal at Meeting Completed (the paperwork coder moves it to Quote Sent when the quote is sent); Manual Input still moves straight away. The Gone quiet toggle and count still agree with goneQuietOpportunities. Phone: sticky stage tabs with counts above one stage's cards, each ending with a full-width 44px next-step button, the panel full screen.

## Files you own

src/app/dashboard/deals/* except deals/tracker/*, src/components/lead-label-chip.tsx

## Suites to run (runner groups)

plain:pipeline-opportunities,crm-pipeline-stats,deal-tracker and ai
