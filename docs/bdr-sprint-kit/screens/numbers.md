# Screen: numbers

## What to build (approved)

STATS, REPORTS AND ONE-TO-ONE EMAIL (plan: Stats / Reporting and Overview → Activity report; Release 2/8 parts; approved decision 16). Stats: funnel Attempted → Connected → Meeting Set → Meeting Completed → Quote Sent → Contract Sent → Won with the rate between steps; headline tiles Tries · Talks · Connect rate · Meetings booked · Show rate (held ÷ booked meetings that came due) · Won $; "Talks counted from <Organization.outcomesSince>" when a period starts before it; leaderboard defaults Rep · Tries · Talks · Connect rate · Meetings booked · Held · Won $ with the rest under Columns, held meetings credited to OpportunityMeeting.bookedById (decision 13); tries/talks counted once per batch; persona chips hidden; tables behind "Show numbers"; Members default to Me; phone: vertical funnel list, one card per rep. Overview Activity report: tries (grey) and talks (green) stacked by day and by rep, marketing separate. Rename the Overview report tab "Pipeline" to "Pipeline report". One-to-one email: the Email button on a single contact's page sends a plain one-to-one email (no template, no unsubscribe footer, not counted in the 40-a-day marketing limit) logged as EMAIL with outcome SENT and marketing=false; "No email on file · Add one" when there is none; the marketing sender, its templates and the Contacts-list Email stay exactly as they are.

## Files you own

src/app/dashboard/stats/**, src/lib/stats.ts (beyond the funnel lists the data coder owns), src/lib/reports/* except daily.ts, src/app/dashboard/reports/*, src/components/email-composer.tsx, src/lib/email-marketing.ts, src/app/dashboard/email/**

## Suites to run (runner groups)

reports plus plain:crm-pipeline-stats and email:email-marketing-users? (use the runner group "email:email-marketing-users")
