@AGENTS.md

# Working with Taylor on this project

Taylor owns this product and is building software for the first time. These
rules exist because each one was learned the hard way in an earlier session.
Read them before doing anything else.

## How to talk — three gears, in this order

He asked for this explicitly. Most answers use gear 1 and 2; gear 3 is how
the work gets done, not how it gets narrated.

**Gear 1 — say what it is, like he is in 5th grade.** One or two sentences,
no jargon. "A database is where the app keeps its lists." Lead with this
every time, even on a technical question. Not "environment variable" — "the
setting in Vercel called DATABASE_URL". Not "deployment" — "the live
website".

**Gear 2 — then the trade-off, like he is in 12th grade.** What is good
about it, what is bad about it, and what it costs him if it goes wrong.
He is a founder making business calls: he wants the consequence, not the
mechanism. "This is free now but locks us in later" beats a paragraph about
architecture.

**Gear 3 — then build it like the best engineer he could hire.** Take the
idea and execute. Do not ask permission for judgment calls that are yours to
make: file layout, library choice, error handling, test strategy, naming
inside the code. Those are the "minor silly questions" he does not want.
Bring him decisions that are genuinely his — pricing, who gets access,
business rules, anything that changes what the product *is*.

The posture is business partner, not contractor waiting on a ticket. Disagree
when he is wrong, say so once with the reason, then do what he decides.

- **Don't make him feel stupid.** He has said so directly. Explaining too
  much is as bad as explaining too little; say the thing, then stop.
- **Answers, not menus.** Recommend one option and say why. Don't lay out
  five alternatives and ask him to pick unless the choice is genuinely his.
- **When walking him through a screen, go one step at a time** and let him
  tell you what he sees. Do not guess at what a UI looks like or bounce him
  between screens. If you cannot see it, ask.
- **Own mistakes in one sentence and move on.** No paragraphs of apology.
- **He likes being asked good questions.** Sharp ones that change what gets
  built are welcome. Trivial ones are not.

## The release workflow, in order

Taylor set this and it is not to be reordered:

1. Build and hammer out the issues on the working branch, tested against
   the local Postgres in a real browser.
2. When it is ready, ask him: **"Ready to go live. Push to production? Yes
   or No."** Nothing goes to the live branch until he says yes.
3. He says yes. Push to the live branch (`claude/first-app-creation-cdtbrb`).
4. Only then ask, exactly this and nothing more elaborate:

> Would you like me to run your CTO Development Breakdown and Next Steps
> Report? Yes or No.

Never ask for the report before the work is live. That happened once
(Sept 9, 2026) and it confused everything.

If yes, produce it as an artifact he can keep, with three parts: what was
done this session, in plain words; the database tables and pick lists the
work touched, before and after; and a "CTO Think Tank" of five AI-centric,
forward-looking items that could still be built in the module just worked
on, each judged by whether it helps a small service business fold another
software package into their white-labeled workstation and save headcount,
time or headaches. The first one (Sept 9, 2026, Products + Ratesheets) is
the model to follow.

## Hard rules

- **There is exactly ONE website: `softwareconnectbrands.com`.** No staging
  site, no preview site, no second address. He asked for this explicitly
  after a testing site created a third URL and confused everything. Never
  hand him a `*.vercel.app` link as somewhere to go.
- **Never change what a thing is called or where it lives** without asking.
  "Are you going to keep moving this shit around" is a direct quote.
- **Show the plan before building anything substantial.** He approves, then
  you build. He calls unrequested work "willy nilly freelancing".
- **Test before pushing.** Every change gets run against a real Postgres
  database in a real browser first. A push is what makes it live to
  customers — there is no safety net between the two.
- **Never paste a secret into chat** — connection strings, `AUTH_SECRET`,
  API tokens. If one is needed, tell him where to put it, don't ask to see
  it.

## The setup, in one place

| Thing | Where |
|---|---|
| Live website | `softwareconnectbrands.com` (domain bought on Squarespace) |
| Hosting | Vercel, team `Software Connect`, project `software-connect-brands` |
| Branch that is live | `claude/first-app-creation-cdtbrb` — pushing to it deploys |
| Database | Neon Postgres. One database, shared by everything |
| Code | GitHub `taylor-SCB/Software-Connect-Brands` |
| Owner account | taylor@softwareconnectbrands.com |

- **Every branch builds against the one live database.** Vercel builds a
  preview for any branch pushed, with the same `DATABASE_URL` as the live
  site. Until Sept 10, 2026 the build script ran migrations on every
  branch, so pushing a working branch changed the live database a day
  before the code went live and broke the live site in between. The build
  now runs `prisma migrate deploy` only when `VERCEL_ENV` is `production`
  (`scripts/migrate-if-production.cjs`), so **only a push to the live
  branch changes the live database**. Any migration must still be safe for
  rows that already exist.
- **Pushing to the live branch from a session trips the "production
  deploy" safety check** even after Taylor says yes, and a session cannot
  grant itself the permission (that is blocked as self-modification, Sept
  13, 2026). Two ways through: Taylor adds
  `Bash(git push origin HEAD:claude/first-app-creation-cdtbrb)` to the
  allow list in `.claude/settings.json` himself, or the session opens a
  pull request from the working branch into the live branch and Taylor
  clicks Merge on GitHub, which deploys the same way.
- Vercel keeps every past deployment. A bad release is undone with **Instant
  Rollback** in the Deployments tab — ten seconds, doesn't touch data.
- **You cannot change Vercel settings from here.** No tool exists for
  environment variables, domains or the production branch. Those are things
  Taylor has to click, so walk him through them.

## What is already built

Contacts (title, company, birthday, city/state, labeled notes with a
Personal view, log one note or call on many contacts at once, an Activity
overview box), companies (people, roll-ups of everything their people do),
**Industry + Company Type** pick lists on companies, shown and edited from
the contact form too, with "+ Add new industry / company type" and
Individual / Personal for a contact with no company (Sept 13, 2026),
**Contacts and Companies lists** that page at 10 / 50 / 100 with a search
bar, stacking multi-select filters (State, Industry, Company Type, Company),
Favorites / With deals / Needs attention toggles, a favorite star, and
Favorite Contacts / Companies and Contacts / Companies with Deals sub-panes
in the sidebar, plus **Import CSV** on both lists (one file of any size,
batched with a progress bar, companies auto-created from a bare name,
re-import updates instead of doubling, template download; Sept 13, 2026;
Sept 27, 2026: Mailing / Home / Person / Google "Address 1" City and
State headers and "Organization Title" are recognised, Job Title beats
Outlook's Mr./Ms. Title, a single Location column like "Austin, TX" is
split into City and State, and the preview shows Title and City, State
and names every column it is leaving out;
a 26-finding bug audit the same day was fixed in full and its cases are in
the browser suite),
pipeline (Lead → Contacted → Quote Sent → Contract Sent → Won/Lost; every
quote lives on a deal, a deal can hold many quotes, deal value comes from
its quotes, sending paperwork moves the deal on its own), "how I got there
is how I go back" back links, products (with manufacturer, COGS, unit of measurement,
distributor and contacts; clone / delete / active toggle on the list),
ratesheets (a sub-module under Products: publish a selection of products to
partners with an expiry and a respond-by window, partner approve/decline
links at `/r/<token>`, uploaded distributor price lists, CSV import of
products with a preview and SKU-based updates), quotes (Simple +
Modern templates, tagged line items, tag totals grid), contracts
(templates with a per-workspace type pick list and "+ Add new type",
"Who can send?", merge-field chips grouped by screen, a two-column
Agreement | Customer Information layout with Preview, e-signature;
Sept 10, 2026; six preloaded templates: Service Agreement, Change Order,
Purchase Order, Sales Order, Invoice, Compliance Agreement), the **Contract
Coordinator** (Pipeline → Contract Coordinator and Contracts → Contract
Coordinator, same page; called the Deal Tracker until Sept 16, 2026:
split a quote's rows into up to five contracts, each to its own company
and contact with a template, payment terms and a payment preset; rows read
Open / Sent / Signed / Cancelled; contracts get line items, a payment
schedule that autocalculates, a "Your Company Signer", cancel/reopen and
copy-and-log reminders; Sept 10, 2026; **reworked Sept 20, 2026**: the
quote's rows run across the top with editable quantity / price / line
discount that save straight back to the quote, each contract is a card
below with a whole-contract discount and a payment schedule written row
by row — % or $ or balance, its own date — with quick fills named as in
Settings (One payment, Deposit + balance, Installments) plus From the
quote; a **Job** card
above the rows names PRJ-n or offers **Award without paperwork** as a
full form with rows, discount and schedule), **discounts** (Sept 20,
2026: per line on the quote, copied onto contract rows; per contract on
the contract only; printed as Subtotal / Discount / Total everywhere and
flowing into Awarded; **Sept 27, 2026: a discount on the whole quote**,
typed under the lines on the quote page or in the Contract Coordinator's
footer, read by the customer's copy, the quotes list, the pipeline value,
the dashboard and `{{quote_total}}`, re-pricing the quote's payment
table, and the discount every new money-in contract and handshake award
starts from — a purchase order never carries it, and a contract's own
discount is still never written back to the quote), PDF export for both,
**Owes you** under every Companies and Contacts row with a Balance card on
their pages and an Owed to you tile on the dashboard, **invoices** (Send as
invoice stamps INV-n and mints the page a customer opens at `/i/<token>`,
with how-to-pay from Settings → General; nothing is emailed),
**Projects** (Sept 14, 2026: a signed agreement makes PRJ-n on its own,
a budget of Awarded / Spent / Committed / Left that is always derived from
paperwork, scopes of work per service type with their own bars and award
history, Projects → Budgets, `npm run recompute-projects` to prove the
numbers tie out), the job's **Money** tab (bills by supplier, Order
materials into a distributor's purchase order at cost, change orders and
credits, Files including the other side's signed contract), **Crews** (your
own people or a subcontractor who bills you, people with their own rates,
time logged in hours and/or days with the rate snapshotted, unpaid time as
Committed and paid as Spent, Mark paid through, and a warning when a sub's
hours and their purchase order are both on one job), the **Calendar**
(month and week, events of any type from a per-workspace pick list, day
plus optional times, crews and attendees, Copy this week into next, a
crew double-booking note) with **Schedule install** per scope on a job's
Schedule tab that flips Awarded → Active, and a things-to-do checklist;
**Calendar v2** (Sept 27, 2026: three layouts — Calendar, Log with a
Previous Activity Log and an Upcoming Log side by side, and Calendar +
Log on one screen; every day has an owner and a **Whose calendar**
picker; the company view — Everyone / Just me / a multi-select of Users
with Unassigned — plus multi-select Companies, Contacts and Projects
filters that stack; activity types Call, Meeting, Email, Text, Quote
sent / due / follow up, Contract sent / follow up / closed with "+ Add
new activity"; a call logged from a contact or company lands on the
calendar on the day it happened with a **When** date and optional time,
one dated ahead is scheduled instead of logged; marking a quote sent
writes Quote sent, a follow-up three days on and Quote due, sending a
contract writes Contract sent and its follow-up, signing writes Contract
closed, and an answer takes the open follow-up off; **Sept 28, 2026**: an
Overdue strip at the top of Upcoming, Done opens a "How did it go?" box
that logs the touch into the contact's history, a Team view with a row
per teammate and crew and the week's load, the follow-up rhythm as day
lists in Settings → General, one Email entry per marketing send, and
"No time set" on untimed activities),
**Properties** (a building at a time, rolling up the jobs at it, with stage
chips deciding what counts and cancelled work left out by default) and
**Close out** (one button, with the loose ends listed beside it and none of
them blocking), per-workspace
branding and time zone, Settings → My Account (title, mobile, avatar,
change password) and Company Information (General, Branding with logo
upload, Company Users, Compliance and Marketing file uploads), **Company
Users** (Sept 27, 2026: an owner or admin adds a teammate as Admin or
Member and they get an emailed link to set their own password; role
change, Resend invite, Remove and Restore — a removed user is kept, not
deleted, because deleting a user cascades to their notes and activity,
and cannot log in; a Member cannot manage users, settings, company files
or templates), **email marketing** (Sept 27, 2026: one Email window
opened from a contact, the Contacts list, any marketing file or any
**Marketing Template** under Settings → Marketing; search and multi-pick
contacts or "+ Add new contact", pick a template, attach marketing
files; one individually addressed copy each, sent as the tenant's
business name with replies to the sender, {{merge}} fields filled per
person, the business address and an unsubscribe link at the foot, every
send logged on the contact's Activity; **40 emails per user per day** in
the workspace's time zone, with a counter in the window and on Company
Users; unsubscribes at `/u/<token>` mark every contact with that address),
company logos and contact photos, and an operator console at `/admin` where signups
are approved, paused or deleted.

**Users vs Company (Sept 30, 2026).** The sidebar is Overview, Calendar,
**CRM** (Contacts with Favorite / Interested / with Deals, Companies with
the same three), **Closer's Club** (Pipeline, Quotes, Contracts with
Contract Coordinator, Products with Ratesheets), Projects (Properties,
Budgets, Crews), **Stats / Reporting**, Settings. Every deal has a **rep**
(`Deal.ownerId`, whoever made it, changeable on its tile). Contacts and
Companies open on **Last Contacted By** (who, when). Contacts carry a
second email and phone, each **Personal / Work**. **Delete** sits in a
contact's and a company's page header. A contact can belong to more
companies than their main one (**+ Additional Account**, the
`ContactAccount` table; the main `companyId` stays the one paperwork is
filed under, and a linked company does not roll up their paperwork).
Add person on a company page searches existing people with email and
phone first; a new contact's name is checked for duplicates as typed; the
contact form's company box posts the exact `companyId` picked, because
two companies can share a name. **Merge Contacts / Merge Companies** on
the lists (up to five, one transaction). **Custom industry / company
type** with **Save for Future Use** (unticked: on that company only,
marked Custom). A company page's activity form can tick its people or
add a new contact. The **status ladder** on contacts and companies: Not
Actioned → Contacted (first logged touch, automatic) → Not Interested /
Interested (by hand) → Meeting Set (first meeting booked with that
*contact*, automatic) → Meeting Completed (by hand) → Quote Sent →
Contract Sent → Signed / Won → Lost, plus Archived; every move is a
`StatusChange` row with the day it happened, and skipping a pipeline
step by hand asks each skipped step's date, prefilled with the meeting
day. Status is set from the button on the record's page, no longer the
edit form. **The Pipeline starts at Meeting Set: its first two columns
are contacts, not deals** (Taylor, three times: deals are for quotes and
contracts); deals join at Quote Sent. A contract unanswered 90 days is
Archived (off the board, "Show archived"), at 180 Lost — swept when the
Pipeline or Stats is opened. **Stats / Reporting** counts people per
funnel step, money per deal, rates, days between steps and a
leaderboard, with period and rep filters; everyone sees everyone.

**CTO Think Tank (Oct 2, 2026).** The AI layer (`src/lib/ai.ts`): the app
*finds* with rules and counting and the AI only *writes*, so every list
works with no key; nothing the AI writes is saved or sent until a person
applies it. Claude Opus 5.5 through the official SDK, **100 drafts per
user per day** (`AiUsage`, counted in the workspace's zone like email's
40), words kept in `AiDraft` until the facts they came from change.
**Call List** (sidebar between Overview and Calendar, top 5 on Overview):
follow-ups due, meetings not marked held, met with no quote, quotes out 3+
days and contracts 7+ days with no touch, Interested a week with no
meeting; a rep's own plus a shared **Nobody's**, owners and admins can
open anyone's or Everyone; an opener drafted per row after the page draws;
Log it / Mark held take a row off. **Meeting notes** (contact header, the
calendar's "How did it go?" on a Meeting, a held row on the Call List):
typed or dictated lines read into a checklist — log, Meeting Completed,
follow-up call, a **Draft** quote whose lines and prices come only from
the catalog — applied with one click. **Duplicate radar** (Contacts /
Companies → Possible Duplicates, an "N possible" count beside Merge from
the radar's last check (`DuplicateScan`; the full check reads every row,
~1.2s at 200,000, so a list never runs it — the radar page and the end of
an import do), a note after an import): same phone however written, same email in either
slot, Matt/Matthew at one company, same name; companies by name without
Inc/LLC, phone or website; "Not the same person" is remembered
(`DuplicateDismissal`); Merge opens with the pair picked. **One person,
every company** (contact page): "Looks like the same person" and **Before
you call**, the facts across every company they're part of plus an AI
paragraph on request. **Forecast** on Stats: open quotes and contracts ×
this workspace's own step-to-signed rate, bucketed by month and rep, every
number with its sentence, deals past twice their usual time flagged and
halved, "Low confidence" until 60 days of history and 5 closed deals per
step, "Read it to me" on request.

See `README.md` for how those work and `DEPLOY.md` for anything to do with
the live site.

**Read `STRATEGY.md` before proposing or arguing about a feature.** It carries
who the customer is, what they do daily in priority order, the revenue target
and the arithmetic behind it, and the guardrails a feature has to clear. It
was written with Taylor and it settles most "should we build X" questions
without asking him again.

## Where this is in its life

Pre-launch, roughly a month or two out from real customers (as of Sept 2026).
Nobody is paying yet and there is no customer data to lose, which is why
pushing straight to the live site is acceptable for now — he was told the
trade-off and accepted it. **Revisit before launch**: at that point a broken
push costs real money and a way to preview changes is worth having again.

The same clock applies to the gaps below. They are not urgent this week; they
are all blocking before the first paying customer.

## Known gaps — say so rather than implying otherwise

- **Email goes out for three things only:** password reset, Company Users
  invitations and email marketing (Sept 27, 2026). No approval notice, no
  receipts, no invoices. Everything else waiting on email still is. That
  includes ratesheets:
  "Send to partner" makes a link to copy and text or email by hand, and
  the Contract Coordinator's "Copy reminder", which copies a nudge with the signing
  link and logs it; the app says so on the screen.
- **"Link Distributor / Partner" is Coming Soon.** Public and
  Invite/Approve ratesheets are stored with their visibility but nobody in
  another workspace can search for them yet; every send today is a link.
- **Uploaded files live in Postgres** — ratesheets, compliance and
  marketing documents (4 MB cap), logos and photos (2 MB). Fine at this
  scale; object storage is the real answer when files get bigger. Logo and
  photo links (`/files/<token>`) are public by design so they render on the
  customer's copy of a document; documents need a login.
- **"Receive in-app messages" is a stored switch only.** There is no
  in-app messaging yet.
- **No billing.** Nothing charges anybody.
- **`AUTH_SECRET` was exposed in chat and still needs rotating.**
- **The GitHub repository is public.**
- Operator access (`isSuperAdmin`) is deliberately unreachable from the app.
  It is only ever set with SQL or `npm run promote-admin`.
- **Contacts and Companies page; the other lists still load every row.**
  Contacts, Companies, their pickers and the company page's People list
  are paged and searched in the database (Sept 13, 2026, proven at
  200,000 contacts by `scripts/browser-tests/load-test.cjs`). Pipeline,
  Quotes, Contracts, Products and the dashboard still load everything,
  and the **New quote, New contract and Contract Coordinator pages still ship the
  whole contact list to the browser** for their pickers. Fine at demo
  scale; the next thing to fix for a workspace that has imported a big
  CRM. The Sept 14, 2026 pickers (crews, the event form, properties) cap
  themselves at 200–300 rows rather than paging, which is the same
  shortcut and will need the same fix.
- **Nothing on a job is scheduled for a crew across jobs.** The calendar
  flags a crew double-booked on one day, but there is no "what is this
  crew's week" view and no capacity planning. Worth building once a
  customer runs more than two crews.
- **A day has one owner, not a team.** "Whose calendar" is one teammate;
  two teammates at the same meeting is one owner and the other not on
  it. A many-to-many is the fix if a customer asks.
- **The calendar's Projects filter and form pickers are capped at 200
  open jobs, and the Contacts / Companies filters search the server
  past their first 200.** The Log columns show the 60 closest rows each
  way (and up to 60 overdue) and say so at the foot.
- **A changed follow-up rhythm applies to the next thing sent.**
  Follow-ups already on the calendar stay where they are; re-sending the
  quote or contract rewrites its open ones on the new rhythm.
- **Activity Rules are not built yet** (Sept 28, 2026). Taylor's four
  answers are on record: rules create the entry and fill the template
  but a person sends; no external clock, the app's own scheduler runs
  when the calendar is opened and untimed items read "No time set" at
  the bottom of the day; Members edit their own entries and not an
  Owner's or Admin's; social posts are reminders only, ticked or moved
  like a follow-up.
- **A subcontractor's hours default to tracked-only.** Their money comes
  from their purchase order, which is right, but a sub genuinely paid by
  the hour needs the per-entry tick each time — there is no per-crew
  setting for it yet.
- **A property is one level deep.** A building rolls up its jobs; there is
  no portfolio rolling up buildings. A manager with forty towers will
  want one.
- **The Properties list is capped at 200 buildings, not paged**, and has
  no search box. A building is typed in by hand so a workspace has tens
  of them; the cap is what stops one render pulling every job through the
  nested read. It needs the same paging the Contacts and Companies lists
  got when a customer has more.
- **"Owes money" considers at most 10,000 customers.** The filter is a
  grouped aggregate rather than a where-clause, because "owes" is the
  rows less the payments against them and a credit nets off. Only
  customers with signed paperwork are ever in that set, so the cap is far
  above a real workspace (0.20s at 200,000 contacts), but past it the
  filter narrows silently.
- **The import runs in the browser tab.** Any size works, but the tab
  has to stay open (about 5 to 10 minutes for 200,000 rows). A
  background job is the answer when a customer needs to walk away or
  schedule syncs; it needs file storage (Vercel Blob) and a queue.
- **A supplier and its Company can end up unbridged, with no screen to
  repair it.** They are matched by name, so renaming a company after the
  pair was made leaves the next supplier of that name pointing at nothing.
  Nothing breaks — a purchase order still goes to the right company, and
  the Sept 16 audit fix stopped it crashing "Order materials" — but the
  two records stop being one business until someone renames them to match.
  A proper fix is a picker that links an existing supplier to an existing
  company by hand.
- **A contract's own discount is never written back to the quote, by
  design.** One quote can split into a customer's Sales Order and a
  supplier's Purchase Order with different discounts, so a discount typed
  only on a contract card stays on that contract, and a deal's pipeline
  value (from the quote) then reads higher than that Sales Order. When the
  discount is for the customer as a whole it belongs on the quote — the
  whole-quote discount (Sept 27, 2026) — and every money-in contract starts
  from it.
- **"Contract signer" on a quote is recorded but nothing downstream reads
  it.** It is stored on the quote and shown back on the form; the
  Contract Coordinator still fills its signer from the workspace owner.
  Wiring it through is small and worth doing the next time contracts are
  touched.
- **A signed contract records only the name typed and the time.** Enough for
  ESIGN/UETA, thin if one is ever disputed — no IP address, no email
  confirmation.
- **Marketing email is sent from our address with the tenant's name on
  it.** The From line reads the tenant's business name but the address
  behind it is `EMAIL_FROM`, because only a domain verified with Resend may
  send. Per-tenant sending domains are the future build Taylor agreed to.
- **The email provider's own daily cap is shared by every tenant.** The
  40-per-user allowance is ours; Resend's plan limit sits behind it and
  covers every workspace plus resets and invitations. Check the plan
  before a third or fourth sender goes live.
- **A marketing send runs while the window is open.** Forty emails take
  about half a minute, spaced for Resend's rate limit, inside a 60-second
  route. Closing the tab mid-send can leave some sent without their
  Activity line; a held slot frees itself after 15 minutes. A queue is the
  answer for bigger lists, the same one the import needs.
- **No opens, clicks or bounces are tracked,** and a template is plain
  text (no images or layout). Attachments are the marketing files, at most
  five and 10 MB together.
- **Stats' "time between steps" only knows dates from Sept 30, 2026 on.**
  Before that nobody recorded when a status changed; the migration moved
  existing records onto the ladder without dates.
- **The Pipeline's meeting columns show 100 people each** and say "and N
  more" past that; the deal columns still load every deal.
- **The 90 / 180-day contract rule runs when the Pipeline or Stats is
  opened.** A workspace nobody opens for a month catches up on the next
  visit, all at once.
- **A person linked to a second company is not rolled up there.** Their
  deals, quotes and notes stay with their main company; the linked one
  lists them under People with an "Additional account" tag only.

- **The AI has only been tested against a stand-in.** No real key exists
  yet; the first real call happens after Taylor adds `ANTHROPIC_API_KEY`
  in Vercel (DEPLOY.md). Check one briefing on the live site then.
- **AI cost sits with Taylor, for every workspace.** Opus 5.5: an opener
  batch is about 2 cents, a meeting-notes reading about 5–10 (the catalog
  goes in, capped at 300 products), a briefing about 1. A busy rep is a
  few dollars a month; the 100-a-day cap bounds the worst case near $8 a
  user a day.
- **The Call List's rules each read at most 300 rows,** oldest first, and
  the radar shows 200 pairs and ignores any phone or email shared by more
  than six records (an office line, info@).
- **The forecast's history starts Sept 30, 2026** and leans on a starting
  guess (30% of quotes and 60% of contracts sign, in 30 and 14 days) until
  a step has five closed deals.

## Testing

**Bug audit of a session:** `/session-auditor`
(`.claude/skills/session-auditor/SKILL.md`). Finders per area, dedupe,
one quick skeptic per distinct defect, then fix everything confirmed with
a regression step each, tie it out, and only then the release question.
Built after the Sept 13, 2026 audit took an hour; the short form finds
the same bugs in about ten minutes.

Three browser suites live in the session scratchpad, not the repo (they
should be moved in): the 21-step CRM regression, the approval/operator
suite, and the delete-confirmation suite. **Twenty-four** are checked in at
`scripts/browser-tests/` with run instructions at the top of each file:
the 27-step products + ratesheets suite, the 21-step companies +
contacts suite (Sept 9, 2026), the 21-step contracts suite and the
40-step deal tracker + settings + uploads suite (both Sept 10, 2026; the
tracker half rewritten Sept 20, 2026 for the card layout, inline pricing,
discounts and written schedules, and seven whole-quote discount steps
added Sept 27, 2026), the 44-step quotes suite (Sept 15, 2026; line ids,
Save as product, suppliers, software terms, the payment table, the
customer's copy, the sales rep, and from Sept 27, 2026 the discount on
the whole quote end to end),
the 18-step contacts import + filters + favorites suite and the
200,000-row load test (both Sept 13, 2026; the load test seeds in SQL,
takes several minutes, and must stay under its 2-second page budget),
from Sept 14, 2026 the 9-step company enrichment suite, the 28-step
money + payments suite, the 26-step projects core suite (its handshake
award now starts from the quote's own discount), the 22-step
project money suite, the 34-step crews + time suite, the 43-step calendar
suite and the 28-step properties + close out suite, the login-case and
password-reset suites (Sept 18, 2026), the 11-step overlay
readability suite (Sept 20, 2026), the 23-step email marketing +
Company Users suite (Sept 27, 2026; needs the same fake email settings
as `password-reset.cjs`; from Sept 28, 2026 it also checks the one
Email entry a marketing send leaves on the calendar), and the 37-step
Calendar v2 suite (`calendar-v2.cjs`, Sept 27, 2026: logged and
scheduled calls, quote and contract milestones, the three layouts, the
company view and the stacking filters, the owner picker, and the phone
layout; Sept 28: the follow-up rhythm, the Overdue strip, tick-to-log
and untick, the Team view), and the three Sept 30, 2026 "Users vs
Company" suites: `crm-reps.cjs` (16 steps: sidebar, rep on deals, Last
Contacted By, second email/phone, header Delete), `crm-accounts.cjs`
(20: additional accounts, Add person search, duplicate check, same-name
companies, custom industries, company activity people, merge) and
`crm-pipeline-stats.cjs` (20: the status ladder, the Pipeline from
Meeting Set, skipped-step dates, the 90/180 rule, Stats), and
`ai-think-tank.cjs` (23 steps, Oct 2, 2026: the radar, twins and Before
you call, the Call List, Meeting notes, the Forecast, the 100-a-day cap
and an AI outage). It stands up a fake AI on :3998, so the server needs
`ANTHROPIC_API_KEY=fake-local` and `ANTHROPIC_BASE_URL=http://localhost:3998`
— on the **command line** in a cloud session, whose shell already exports
`ANTHROPIC_BASE_URL` and wins over `.env`. A suite that
seeds and sends paperwork now gets calendar entries written for it, so
**scope any `CalendarEvent` lookup to the type it means** — the old
calendar suite's first-row read picked up "Contract sent" instead of the
install it booked.

**The local database is too fast to show timing bugs.** An 1,800-row
import stopped after 500 on the live site (Sept 27, 2026) because one
step ran a thousand writes in a single transaction and Prisma gives a
transaction five seconds; locally that took a fraction of one. The live
database is a few milliseconds away per round trip.
`import-slow-db.cjs` runs the server through `slow-db-proxy.cjs`, which
adds 8 ms each way (run instructions at the top of each). Anything that
loops over hundreds of rows against the database gets run that way too,
and never goes in one `$transaction` unless it truly must be
all-or-nothing.

`password-reset.cjs` and `email-marketing-users.cjs` are the suites that need more than a database:
the login screen only offers the link when email is switched on, so the
**server** has to be started with `RESEND_API_KEY`, `EMAIL_FROM` and
`RESEND_ENDPOINT=http://localhost:3999/emails` in `.env`. Fake values are
right — the suite catches the message on :3999 and nothing leaves the
machine. Without them the suite fails on the first step, which looks like
a bug in the app and is not one.

Each signs up its own workspace and scopes its lookups to it, so they can
run back to back; still run them one at a time. **Scope every SQL lookup
in a suite to its own workspace** — an unscoped count read another suite's
seeded rep as a duplicate of its own (Sept 14, 2026). And a suite that
seeds budget numbers by hand must **delete its workspace when it
finishes**: `properties-closeout.cjs` does, because every other suite
asserts `recompute-projects --check` finds no drift anywhere, and
hand-seeded totals have no paperwork to back them up. A contract seeded
with SQL must also bump `Organization.nextContractNumber`, or the next
real one collides.

All of them run against a local Postgres on port 5433 and must pass before
anything is pushed. That local database is the only safety net between a
change and paying customers.

**Clear the test workspaces before a full run** when a fix changes how a
stored number is derived: `DELETE FROM "Organization" WHERE slug LIKE
'test-%'`. Leftovers from a run made *before* the fix carry the old
numbers, and the global `recompute-projects --check` in three suites
correctly reports them as drift — which reads as a new bug and is not one.

The Sept 14, 2026 audit found 27 confirmed defects in one session's work
(35 flagged, 30 distinct, 3 refuted). Four of them were one root cause
worth remembering: **a `<select>` whose saved value is not among its
options falls back to the first one, and saving the form then writes
that.** A finished job, a retired crew, an archived company — each was
silently unlinked by an unrelated edit. Any picker that filters its list
(active only, open only, capped at 200) must offer the currently-linked
record back, labelled for what it is. Two more were one pattern: a form
that closes or resets by comparing `state.success` **as a message** never
fires twice, because two saves in a row report the same words — compare
the state object instead. And React empties a form whose action is a
server function, including when that function refuses, so an action that
can refuse has to hand the typed values back (`keepFields` in
`src/lib/forms.ts`).

**Anything that floats over other content must be opaque.** The app's
look is glass — `.card` is about 4% white with a blur behind it — which
is right for a panel sitting on the page background and wrong for
anything covering words. Every search dropdown, filter menu and dialog
was drawn on `.card`, so the fields underneath read straight through the
panel and neither layer could be made out (Sept 20, 2026). They now also
carry `.popover`, which paints the solid `--overlay` colour. A new
floating panel gets that class; a one-off hex on a single dialog is how
the app drifts back apart, and `overlay-readability.cjs` fails if one
appears.

Standing up that Postgres in a fresh session: the binaries are at
`/usr/lib/postgresql/16/bin`; `initdb` into a short path such as
`/tmp/scbpg/data` as the `postgres` user, start it on port 5433, create
`scb_test`, then put `DATABASE_URL=postgresql://postgres:postgres@localhost:5433/scb_test`
and an `AUTH_SECRET` in `.env` (git-ignored) before `npm install`.
