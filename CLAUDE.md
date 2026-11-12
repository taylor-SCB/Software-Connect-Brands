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
  **Before rolling back past the BDR release (Nov 11, 2026), first run
  `scripts/before-rollback-to-pre-bdr.sql` in the Neon console's SQL editor
  on the live database. Never skip it** (see Known gaps): without it the
  older build can't open the lists, the record pages, the Pipeline or
  Stats.
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
Favorites / With deals / Missing info toggles (Needs attention until Nov 11, 2026; all three now in the Filters panel), a favorite star, and
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
links at `/r/<token>`, uploaded distributor price lists, and **Import
Ratesheet** — see below), quotes (Simple +
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
picker; the company view — Mine | Team (Just me / Everyone until Nov 11,
2026) and, under Filters, a multi-select of Users with Unassigned — plus multi-select Companies, Contacts and Projects
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
company logos and contact photos, **job photos and videos** (Oct 17,
2026; reworked Oct 21, 2026: photos belong to the job and carry tags —
Photo Type, General Project when none, and Location / Area, both
workspace lists with "+ Add"; square tiles with who, when and tags;
stacking filter chips; a Main folder and mini folders with Move and Clone;
**Grant access** per folder to the job's accounts, CRM contacts or a new
email, View only or Editor, each person their own emailed link, owners
and admins only, nobody outside deletes; a **crew photo link** per job
for installers; files in Vercel Blob, see `DEPLOY.md`),
and an operator console at `/admin` where signups
are approved, paused or deleted.

**Users vs Company (Sept 30, 2026).** The sidebar is Overview, Calendar,
**CRM** (Contacts with Favorite / Interested / with Deals, Companies with
the same three), **Closer's Club** (Pipeline, Quotes, Contracts with
Contract Coordinator, Products with Ratesheets), Projects (Properties,
Budgets, Crews), **Stats / Reporting**, Settings. Every deal has a **rep**
(`Deal.ownerId`, whoever made it, changeable in its Pipeline panel). Contacts and
Companies show who last touched each row, and when, in its Pulse caption
(**Last Contacted By** is a Columns choice on Contacts since Nov 11, 2026). Contacts carry a
second email and phone, each **Personal / Work**. **Delete** sits at the
foot of ⋯ More in a contact's and a company's page header. A contact can belong to more
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
Actioned → Contacted, shown as **Attempted** (first logged touch,
automatic) → **Connected** (first talk, reply or held meeting, automatic;
Nov 11, 2026) → Not Interested / Interested (by hand or from the log
sheet) → Meeting Set (first meeting booked with that *contact*,
automatic) → Meeting Completed (automatic when the meeting is logged Held,
or by hand) → Quote Sent → Contract Sent → Signed / Won → Lost, plus
Archived (**a Status
multi-select on the Contacts and Companies filter bars, Oct 4, 2026**);
every move is a
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

**Follow-up after a logged touch (Oct 4, 2026).** Logging a call, text,
email or meeting on a contact or company opens "Want to set a
follow-up?" under the form: tick any of the four, each with its own day
(three days on by default, today or later) and optional time, and each
becomes an open calendar entry "Follow up · Name" with the same people,
under whoever logged it (`scheduleFollowUps` in
`src/app/dashboard/contacts/actions.ts`, `FollowUpPrompt` in
`src/components/follow-up-prompt.tsx`). Its Meeting tick reads
"Try to book a meeting" and writes a Call reminder "Try to book a meeting ·
Name" that moves no status; booking goes through the Book meeting sheet
(decision 5, Nov 11, 2026). No thanks writes nothing; scheduling ahead
opens no box. Since Nov 11 the box is inside the How did it go? sheet (an
outcome chip picks the next step instead), so the calendar's Done box,
the same sheet, offers it too.

**An activity on the company page is with a person (Oct 4, 2026).**
Nobody ticked is refused (typed fields handed back via `kept`) unless
"I'm choosing not to link a contact for these activities" is ticked
(`bypass=1`) or the log sheet's Front desk / main line chip is picked
(always an attempt; Nov 11, 2026); then it lands on the company alone and reads "<who>
Bypassed" in the feed. Those sit behind an amber "N calls not linked to a
person yet" line on Who to call (**Other Contacts** on the People card
until Nov 11, 2026), grouped by who bypassed, with Claim / Claim all and
an Undo
(`claimActivities` in `src/app/dashboard/companies/actions.ts`,
`OtherContacts` in `src/components/other-contacts.tsx`): the activity
moves onto the person (contactId set, companyId cleared, the same shape
as a touch logged on them), their status follows, the calendar entry
follows. Pre-rule company-only activities are claimable the same way.
Notes are not under the rule; the company page's Notes tabs split All ·
Company · People · Personal. The favorite star is deliberately not
linked between a person and their company.

**Contracts v2 (Oct 7, 2026; Taylor's four-phase plan: 1 replace
wording, 2 upload + AI fields, 3 Google, 4 Adobe Sign + PDF designer).**
Phases 1 and 2 are built. A template page's Body has **Replace with my
own** (empties the editor in place, Undo puts it back), **Restore the
original** (the built-in wording, via `ContractTemplate.baseline`), **Upload
Word or PDF** (.docx via mammoth, text PDFs via unpdf, .txt in UTF-8,
Windows-1252 or UTF-16; a scan, a .doc or an empty file is refused in
words; a Google Doc comes in as its Word download) and **Suggest fields**
(Claude proposes `{{field}}` spots as tick boxes; a suggestion whose
snippet isn't in the body exactly once, names no real field, or changes
anything besides the one blank or value it fills is dropped; each says
"“[Client Name]” becomes {{client_name}}"; nothing changes until "Put
ticked fields in"; `src/lib/template-import.ts`). Nothing is saved until
Save. **The file is read in the browser** (`src/lib/template-file.ts`,
Oct 24, 2026), never posted: the readers unpack a whole file in memory,
and a 750 KB Word file built to unpack to 200 MB ran the server out of
memory for every workspace on it. Up to 20 MB; a Word file is fed to
the unzipper 16 KB at a time and refused once its parts (all but
pictures, embedded files and fonts, whatever they are named) pass 12
MB; a PDF is refused past 300 pages and read page by page. The editor
works in `\n` (a saved body's `\r\n` is turned back on load) and every
limit counts a line break as one character. Undo undoes the last swap;
a swap made on an empty editor keeps the snapshot before it, and a Save
clears it. **Suggest fields is 20 a day per workspace** (rolling 24
hours, counted from `AiRequest` rows; each request counts the rows up
to its own, so two clicks on the last one give it to exactly one); the
call is `messages.create` with the zod format, the stop reason checked
before the answer is read, a 90-second wait with one retry, and a
refusal, a cut-off answer or an unreadable one is its own message, not
a dead page. A contract body may run to 80,000 characters, so a
full-length template whose fields fill in longer can still be edited. Every type has exactly one template **in use**
(`ContractTemplate.isDefault`, kept by `setTemplateDefault` /
`repairTemplateDefault` in `src/lib/contract-templates.ts`): it is what the
Contract Coordinator, Award without paperwork, Order materials and change
orders reach for, where before they took whichever row came first. A
second template of a type says "You already have one", saves as an
Alternate, and takes over only when "Use this one" is ticked. Phases 3
and 4 are not built (no Settings → Connectors page exists yet; it is
where they are planned) and wait on the Google and Adobe app
registrations; Multi-Bids' Google admin trusting the app domain-wide is
what lets full Gmail run without Google's paid security review.

**Import Ratesheet (Oct 21, 2026).** Link Ratesheet → Import Ratesheet
replaced Import CSV, which read a supplier's "Price" as the contractor's
sell price and left COGS at $0. Taylor's rule: a ratesheet carries the
contractor's **cost** and the **MSRP**; the sender is a "Distributor,
manufacturer or software provider" (a *Vendor* is the Business that
receives it — never call the sender a vendor). His flow: upload, we read
it, show every product as it will land with tick boxes (all ticked to
start, Select all / Remove all), Import or **Decline** with "what was
wrong", which lands in /admin. The planner is `src/lib/price-list.ts`
(pure; the browser's preview and the server's import run it on the same
file, and the server only writes rows posted as ticked), files are read
by `src/lib/price-list-file.ts` (read-excel-file 9.3.10 universal build,
fflate to check an .xlsx's unpacked size and sheet dimension first,
Windows-1252 decoded by hand), the screen is
`src/app/dashboard/products/import-ratesheet.tsx`, the server is
`ratesheets/import-actions.ts`. Sell is never detected from a sheet,
only picked by hand. Matching: part number with case, spaces, dashes,
underscores and leading zeros ignored (a dot or slash counts: FUSE-1.5A
is not FUSE-15A; "N/A", "TBD", "-" are no part number); a name only when
the SKUs can't disagree and the name is unique; the supplier's own
product wins a tie. An existing product keeps its own name, description,
tag and unit. Cost up keeps the margin, cost down keeps the price, a 2×
move waits for a tick, a new product with no price can't be ticked, a
price at or below the new cost is re-priced by the rule. Products get
`listPriceCents`; a supplier remembers its rule (`priceRule`,
`priceRuleBasisPoints`) and columns (`ratesheetColumns`, by header
signature). LinkedRatesheet gains supplier, effective date and counts.
A Decline is a `RatesheetImportIssue` (bytes omitted by default; a file
over 4 MB comes as name and size only), listed in /admin with Mark
fixed, and emailed to operators when email is on. The products pages'
dialogs render through a portal on document.body: a long dialog was
being placed against the page column and ran off the top. The product
form links COGS, Markup %, Margin % and Unit price (a typed percentage
holds while the cost is retyped) and has a controlled MSRP box; the
Products list shows margin with markup under it.

**Products at full size (Release 1, Oct 25, 2026).** The Products list
pages at 10 / 50 / 100 with a search box (each word matched against
name, SKU, description and manufacturer) and stacking Supplier,
Manufacturer, Tag, Service type and Status filters, the Contacts
pattern (`src/lib/product-list-params.ts` for what the address bar
holds, shared with the browser's bar; `src/lib/product-list.ts` for the
queries; `products/product-filters.tsx`). `MultiSelect` in
`list-filters.tsx` is exported and takes `searchable` (off on Contacts).
The quote's **Add from catalog** is a search box (`quotes/[id]/
catalog-picker.tsx`: a typed part number first, arrows and Enter, the box
stays open for the next; Enter pressed before the search answers — a
barcode scanner — fetches that search and adds its first match, never
the last search's row; the Line items card sits above the cards after
it, because every `.card` is its own layer and the list was drawn under
the Payment table). The Create Ratesheet picker searches too, with
**Select all N** / **Select all matching** ticking every match up to the
2,000 a sheet holds, **Show 50 more**, and **Clear matching**; both ask
`/dashboard/products/search` (`skip`, `all=1`), and no page loads the
catalog. A delete on the Products list lands back on the same view
(`returnTo`, only ever `/dashboard/products…`). `cleanSearch` turns a
backslash into a space like % and _ (a trailing one made Postgres refuse
the match). The import's name matching is constant-time per row
(`buildCatalogIndex` keeps each name's products split by whether they
carry a part number): 8,000 rows all named Classic Tee against 8,000
carried took 17.5 s to plan, on every tick, and takes 0.15 s; "Style #"
and SanMar's "STYLE#" read as the part number (a bare "Style" doesn't).
`MAX_NEW_PRODUCTS` is the 25,000 rows a sheet can hold.
`products-load-test.cjs` proves it through the slow proxy: 25,000
products, every page under half a second and about 320 KB (was 44 MB
and 24 s at 8,600), the picker's search in 0.12 s, a 25,000-row sheet
imported in 9 s, and the 8,000 same-named tees previewed in 2.3 s and
imported in 4 s. **Order materials** prices a row at the catalog cost
when its contract captured $0 (Taylor, Oct 25, 2026); a real captured
cost is kept. The agreed next releases, in order (re-ordered Nov 5, 2026: 3b, then the apparel pack, then 4, 5, 6): 2 account types +
Admin Create Account (done Oct 25, below); 3 the deeper catalog (3a done Nov 4, below; 3b is the variation labels, custom units and images) (each ratesheet a row with
its own search and a See product list pop-out with COGS discount and a
required minimum markup and Cancel / Save and accept; per-supplier
sub-rows in a product, each with its own COGS, discount, MSRP and
minimum margin % shown in $; variation labels UoM / Colors / Sizes /
custom groups; images; custom labels); 4 AI upload of PDF, Word and
photos plus a decline queue that suggests its fix; 5 distributor
publishing; 6 inventory and pipeline quantities by stage; 7 the apparel
pack, with AI renderings at $2 an image on the account's monthly
invoice (no billing yet: meter per account per month, invoice by hand;
an image service with vector output for screen printers; famous logos
are refused, so a school uploads its own).

**Account types (Release 2, Oct 25, 2026).** Five: Admin (the platform;
Taylor — `User.isSuperAdmin`, not a type) and four a company picks at
signup, one per account (`Organization.accountType`; every account that
existed before is a Business / Vendor): Business / Vendor (picked to
start), Distributor, Hardware / OEM, Software Provider
(`src/lib/account-types.ts`). **Taylor, Oct 25: every account can do
everything; the type turns no button on or off.** It is what lets a
company pick a real supplier: the three supplier pickers — a product's
Distributor, Import Ratesheet's Who sent it?, a quote line's Supplier /
Contractor — have an **On Software Connect Brands** section listing every
approved Distributor, Hardware / OEM and Software Provider account but
your own, by name, city and state, automatically (Taylor's pick; a
Business / Vendor is never listed). Picking one links your own supplier
record to it (`Distributor.platformOrganizationId`, one per account per
workspace; `platformLinkedAs` / `platformLinkedAt` record how it read
when linked; `src/lib/platform-suppliers.ts`). Nothing else of theirs is
shared until Release 5 uses the link to deliver ratesheets. A supplier of
the same name already on file *is* that supplier — its people,
remembered columns and pricing, its products in the preview — and gets
linked, not doubled; one already linked to a different account of that
name makes "<name> (City, ST)". A quote line asks "Link <name> as a
supplier?" before writing anything (arrow keys walk a closed select one
change at a time). "+ Add new" with a listed account's exact name offers
"Use <name> (on Software Connect Brands)". A linked supplier reads "· on
Software Connect Brands" while its account is still listed. A change of
type is a request: Settings → General → Request a change (owners and
admins; one open per workspace, held by the unique
`AccountTypeRequest.openFor`), Cancel, and the answer shown for 30 days.
It lands in /admin → **Account type changes** with Approve / Decline,
counts in Waiting on you, and emails the operators (the first three a
workspace sends in an hour). The operator can also set any workspace's
type from its row, which answers a waiting request (approved if it asked
for that type, declined if not). **Create Account** on /admin makes a
customer's workspace already approved (`createWorkspace` in
`src/lib/workspaces.ts`, shared with signup) from the company name, type,
owner's first and last name and email, and an optional phone, city and
state; the owner gets "Your <Company> account is ready" from Software
Connect Brands, replying to the operator, with the 7-day, one-use
set-password link a Company Users invite uses, and the row offers
**Resend invite** (older links die) until they log in. Releasing a
ratesheet is Release 5, as decided Oct 21: Public (anyone can download),
Private (any account may request access; the distributor accepts or
declines), Customer Specific (pick a company or + Add New Company; a
company not on the platform gets one person — first, last, email; one
already on it, pick from its members), with an active date range; any
account may release (Oct 25). Taylor plans a subscription for vendors;
Claude recommended keeping a no-account link free and charging for the
full workspace — his call.

**The deeper catalog, part one (Release 3a, Nov 4, 2026).** Taylor's
four calls: a **starred** supplier sets a product's cost (only a person
moves the star; a cheaper one is a green hint), a price under a
supplier's minimum margin is **flagged in red and allowed**, variations
are labels now with their own prices later (3b, R6/R7), and 3a goes live
before 3b. A product is bought from any number of suppliers, one
`ProductSupplier` row each (price, `discountBp` COGS discount, MSRP,
`minMarginBp`, `linkedRatesheetId` = the sheet that last set it;
`@@unique([productId, distributorId])`); the star is `preferredFor`,
which holds the productId on the starred row only and is `@unique`, so
two stars can't exist. `Product.costCents` and `distributorId` mirror the
star (`syncProductFromStar` / `syncStarsFor` in
`src/lib/product-suppliers.ts`); everything that read them before
(Order materials, quotes, ratesheets for partners) still does.
`repairSupplierRows` writes the missing row for a product that has a
distributor and no rows (the migration backfilled every existing one),
and where a product was written *after* its starred row (code before 3a,
SQL by hand) trusts the product: the star follows its distributor, the
row takes its COGS (worked back through the row's discount) and MSRP,
and a product with no distributor loses its rows. A row written after
the product is 3a mid-save and is left alone (`updatedAt` decides). It
runs on the product page, before a product save, on an import's matches,
before an untick and before a sheet's discount changes, never after a
removal. A supplier row takes the discount the plan priced it with
(`PlanRow.costDiscountBp`). **Import Ratesheet**: a match whose star
is another supplier is a *second supplier* — that row is added or
updated beside it and the product's COGS and price stay (the preview
says "Bought from X (starred). Adds this supplier at $N…"); "Not on
this sheet anymore" only lists products that supplier alone sells.
Every row of an imported sheet is kept as a `RatesheetLine` (upserted
on its row key, so ids survive a re-import), and a sheet carries
`discountBp` (inherited from the supplier's last sheet,
`sheetDiscountFor`) and `minMarkupBp`. **Ratesheets page**: an imported
sheet is a row with "N of M products in Products", its own search box
(Enter opens the list on it) and **See product list**
(`ratesheets/ratesheet-product-list.tsx`): the sheet a page at a time
from `ratesheets/files/[id]/lines` (search, All / In Products / Not in
Products, `ids=1` for Select all), COGS discount % and Required minimum
markup %, Cancel / Save and accept top and bottom. "In Products" is never
stored: a line is in when its product carries the sheet's supplier.
Save and accept sends ticks in batches of 500
(`saveRatesheetLines` in `ratesheets/lines-actions.ts`, one save per
sheet at a time via `LinkedRatesheet.savingAt`, stale after 2 minutes):
a tick goes through the import's own planner (so the 2× hold and the
re-pricing rules apply) and turns the product on; an untick takes that
supplier's row off and turns a product with no supplier left off, never
deletes it. Then `finishRatesheetLines` saves the sheet's discount
(onto every row this sheet set, when it changed) and raises any product
whose starred row this sheet set to the minimum markup. A sheet imported
before 3a reads its lines from the stored file the first time it is
opened (`prepareRatesheetLines`). **Product page**: a **Suppliers** card
(star, their price, COGS discount %, your COGS, MSRP, min margin % with
the minimum price and "you make $X" beside it, remove, "+ Add a
supplier…"); the star and the Distributor box are the same choice; a
discounted star makes the COGS box read-only. **Products list**: the
starred supplier and "N suppliers" under each name opening a sub-row per
supplier (client state, so the table is one row per product until
asked), "Below minimum ($X)" in red under the price, and the Supplier
filter matching any supplier. A **quote line** shows the same flag, net
of its own discount (`starredMinimumCents`, also on
`/dashboard/products/search`). Math in `src/lib/supplier-math.ts`:
COGS = round(price × (1 − discount)), minimum = ceil(COGS ÷ (1 −
margin)), both capped at 95%. Proven by `catalog-suppliers.cjs` and the
25,000-line steps of `products-load-test.cjs`.

**Variation labels, units and pictures (Release 3b, approved Nov 5, built
Nov 6, 2026; plan: the "Release 3b Plan" artifact).** Taylor's calls:
labels are picked on the quote line and printed under the product name
on the customer's quote, the contract and the supplier's purchase order;
generic product pictures show small on the customer's quote, its PDF and
partner ratesheets, and a sent quote keeps the picture it went out with;
Add product lands on the new product's page ("Product added. Add
pictures below."); anyone adds a label or unit, only Owners and Admins
rename, retire, restore or reorder (`requireAdminSession().allowed`).
**Labels**: `VariationGroup` (Unit, Color, Size built in, fixed names,
seeded on first read with the 19 built-in units as Unit options; the
workspace's own groups such as Sleeve or Print location, up to 20) and
`VariationOption` (up to 300 a group, 40 characters, matched with
lower(), a retired one refused by name rather than quietly re-used);
`src/lib/variations.ts` (server) and `src/lib/variation-shared.ts`
(browser-safe). A product ticks the labels it comes in
(`ProductVariation`) on the **Variations** card
(`products/variations-card.tsx`), which posts only the chips clicked on
it (`added` / `removed` / new labels and groups) and only once one was
(`variationsPresent=1`): a price save, or a save after a refresh brought
in another tab's labels, never takes off a label it didn't click, and a
retired label the product has is drawn "(retired)". Units from another
tag's list come off when the product is saved (the server does it; the
card says so and unticks nothing, so changing the tag back loses
nothing). **Units**: a workspace's own unit
("Box of 12" contains 12 Each, display only until Release 6) is a Unit
option with `contains`, `baseUnit` and a tag, **Labor and Materials
only** (a Software product's rate and term need a built-in Software
unit). `Product.customUnitId` / `QuoteLineItem.customUnitId` count only
while `unitOfMeasure` is null — code from before 3b writes the enum and
it wins — and every new write sets one and clears the other. The Unit box
and a quote line's unit select carry "Your units" (`cu:<id>`) and
"+ Add custom unit…"; built-in units still print nowhere a customer sees,
a workspace unit does (`customUnitLabel`). **Quote lines**: one select per
group the product has (units never), plus any group the line already
has, a label no longer offered offered back "(no longer offered)". The
line keeps what it was written with (`variations` JSON of group, option
and both names, and `variationText` "Black · L"): picks are sent only
when changed in the editor, kept entries are copied as stored and new
ones take today's names, so a rename on Labels & Units never rewrites a
sent quote. Every check is a batched read before the save's transaction
(a 200-line quote saves in about a second through the slow proxy).
**Pictures**: `ProductImage`, up to six a product, positions 0..n-1 with
the lowest the main one; three copies made in the browser
(`src/lib/image-resize.ts`: display 1600 px and thumb 400 px as WebP, or
JPEG on white where Safari can't make WebP — checked after every encode
— and a 160 px JPEG for documents), sent straight to the private Blob
store with tickets (`purpose: 'product-image'`, a role each; job-photo
tickets read `purpose ?? 'job-photo'`), written by an idempotent finish
step (`src/lib/product-images.ts`, `products/picture-actions.ts`,
`products/pictures-card.tsx`). A picture can belong to a Color: a quote
line shows the one tagged with its Color, else the main one. Remove closes
the gap in one locked transaction; a picture a sent quote's line holds is
kept (position null, `removedAt`) and swept with its files once nothing
holds it; files go only when no row has the key (clones share them).
`/files/<token>` serves a picture publicly like a logo — `?v=thumb`,
`?v=doc` — **always streamed, never a redirect to Blob**, cached
`public, s-maxage=31536000, immutable` (a new picture is a new token). A
draft quote shows the product's pictures live; **leaving Draft writes
each line's picture onto it** (`freezeQuotePictures` in
`setQuoteStatus`, only on Draft → Sent / Accepted / Declined: an answer
never swaps a picture the customer has), **Back to Draft lets them go**
(`releaseQuotePictures`), and changing a sent line's product or labels
takes the new picture. A typed line that Save as product links to a
catalog product by name takes its picture too. Contract rows copy `variations`, `variationText` and the
workspace unit's name at the Coordinator, Award and Order materials
(`contractRowLabels`; a row with none stores an empty list, so a purchase
order fills labels from the quote line only for a row made before 3b,
which stores null — a row signed with no labels never takes a later
quote edit); the contract document, the Coordinator grid, the
job's scopes and Award show them; `{{line_items}}` adds " (Black · L)"
only when present. **Order materials now passes the purchase order's own
rows (at cost) to the merge fields**, so its body's ORDER TOTAL is what
the supplier is asked for — before 3b it read the customer's quote. A
PDF's session cookie is set for the site only, the bypass header goes on
same-site requests only, and a PDF over 4 MB is refused in words. The
**Labels & Units** tab (`/dashboard/products/labels`) lists every group
with its labels, how many products have each (ticked, or as the
product's own unit, each product once), and a Retired section with
Restore. A quote line takes up to 25 labels, one a group. The Products list shows each product's main picture and "4 colors
· 4 sizes". Supplier sheets' Color / Size / pack columns wait for Release
4; prices per label for Releases 6 and 7.
**The apparel pack moves up to right after 3b** (Taylor, Nov 5, 2026: his
main focus is acquiring Hauffs Sports, which prints schools' logos on team
gear): Artwork per customer company, proofs (a logo placed on a product,
color and print location, AI-rendered at about $2 an image, metered per
account), approval from a link like contract signing, and the approved
proof on the quote line and the printer's purchase order. **It is turned on
by a switch in Settings ("We do apparel / custom print"), not an account
type**, keeping the Oct 25 rule that the type turns no button on or off.
Releases 4 (AI upload), 5 (publishing) and 6 (inventory) follow it. **Built
Nov 12, 2026** ("The apparel pack" below), with exact proofs; the AI
renderings are the step after.

**Mobile on contacts (Oct 27, 2026).** `Contact.mobile` is its own
field, shown on the contact page and edit form, found by the list
search, kept by Merge Contacts, and never copied to a company's phone.
The import reads Mobile / Cell into Mobile only; Phone is the file's
Phone, or its **Other Number** when Phone is a placeholder; a placeholder
(blank, words, under 10 digits, one digit repeated, 123-456-7890) is left
blank and named in the preview's notes (`realPhone` in
`src/lib/contacts-csv.ts`, also used for Company Phone). Before this a
file with both Phone and Mobile kept Phone and dropped Mobile; Taylor
re-imports his two earlier files rather than deleting them, and the
re-import fills Mobile on the same contacts. The migration
`20261027120000_contact_mobile` blanked placeholder phones already saved
on contacts, and on companies only where the app had copied them up.
`scripts/browser-tests/contacts-mobile.cjs` (13 steps) covers it; the
import suites' sample numbers carry an area code since.

**The Pipeline as opportunities (Oct 27, 2026).** One tile per
`Opportunity` (rules in `src/lib/opportunities.ts`, board in
`src/app/dashboard/deals/`). A meeting with several people is one tile
with all of them (`attachMeeting`, called from `markMeetingSet` on every
meeting path); a later meeting with any of them joins it while it is
open; Won or Lost closes it and the next meeting starts a new one. One
deal per opportunity (`Opportunity.dealId`), and **no deal without one**
(`ensureOpportunityForDeal` in `resolveDeal` and "Add deal"). Only a
deal sits in Quote Sent or further — Taylor: converting is the only way
there, no "no deal yet" tiles. A move forward out of Meeting
Set marks its meeting Held, asking "Did it happen early?" when it is still
ahead (Nov 11, 2026). Into a deal column opens "What happened after the
meeting with <person> (<company>)?" with four cards (Building them a
quote, Sending a contract, They signed with the amount required, Not
moving forward with an optional reason); Quote and Contract keep Build
Quote — the deal plus a new quote on it, opened straight away — or Manual
Input with a value, then Save and Accept; Cancel is the way out. A Build
Quote deal stays a meeting tile (stage LEAD, in Meeting Completed) until
its quote is sent; moved by hand it goes through the same prompt, and its
phone button is "Send the quote →". A deal never goes back to a meeting
column; a deal moves between deal columns dated today. Drag, or Move to…
under the tile's ⋯. Click a tile for its panel: name, Lead Label,
rep, value (until it has quotes), meeting dates, quotes, and People with
Primary POC / Associated POC / Do Not List (one each, the other two grey
out, one Primary; ticking Primary moves the old one to Associated;
+ Add contact). The deal is filed under the Primary. A meeting's own
Activity rows are never changed by the panel. `OpportunityLog` writes
"Opportunity Created" (Meeting Completed or a deal) and "Deal Created"
(Quote Sent or further) once per listed person per opportunity, dated
when the tile got there; the Primary / Associated tag and the deal's
stage are read live on the contact's feed; Do Not List removes a
person's lines. Kept out of Activity so they never count as a touch.
Lead Labels per opportunity (`src/lib/lead-labels.ts`): N/A light gray
with red letters, Residential / Client / Vendor / Software Integration /
Reseller each a fixed colour, custom ones (`LeadLabelOption`) neon yellow
on a blank chip. Search (person, company or tile name) and a stacking
Lead Label filter, in the address bar. A second scrollbar above the
board. `reconcileOpportunities` runs when the board opens: every deal and
everyone in the pipeline by status without an open opportunity gets one
(people in the same latest meeting share it), with fixed ids so two tabs
write each row once, and no log lines back-written. A status moved by
hand on a contact's page moves their open opportunity only as far as
Meeting Completed (`followContactStatus`). Every floating menu that used
to be drawn inside its card is now `FloatingMenu`
(`src/components/floating-menu.tsx`): drawn on the body, kept on screen,
flipping up when there's more room — the status picker was cut off by
the first column and the sidebar. `pipeline-opportunities.cjs` (22
steps) covers it; `crm-pipeline-stats.cjs` was moved onto the tiles.

**Two looks: Dark and Light (Nov 10, 2026).** Taylor: "same layout and
design but one is a black backdrop and the other white." Dark is the
original glass and the default; Light is the same page on white. The
Dark / Light switch (`src/components/look-switch.tsx`) sits under the
workspace name in the sidebar (in the top bar on a phone) and in the top
right corner of the signed-out pages (home, login, signup and its
submitted page, forgot and reset password; `src/components/signed-out-look.tsx`,
rendered by `src/app/signup/layout.tsx` for the signup pages because the
signup page is a client component). It is fixed or in the sidebar on
purpose: **nothing in a page moves for it** — `looks.cjs` checks the
header lands where it always did. `setTheme` in
`src/app/dashboard/theme-actions.ts` remembers the pick in this browser
(the `scb-look` cookie) and, when signed in, saves it on `User.theme`, so
it follows the person to their phone. A saved look wins over the
browser's; someone who never picked inherits the browser's
(`themeFor` in `src/lib/theme.ts`); anything stored but "dark" or "light"
(an old "bright") reads Dark. The dashboard, /admin and the signed-out
pages carry `data-theme` in the server's HTML, and
`:root:has([data-theme="light"])` in `src/app/globals.css` lifts the Light
tokens onto `<html>`, so there is no flash and menus drawn on
`document.body` follow. **Every colour is a token in `globals.css`** — the
`:root` block (Dark) and the Light block under it: `--bg`, `--surface`,
`--overlay`, `--text*`, `--ok/--warn/--danger`, the `--tint-1..5` /
`--hover` fills and `--hairline` / `-2` / `-3` lines that replaced the
`rgb(255_255_255/0.0x)` classes, `--card-bg`, `--title-from/to`,
`--chart-grid`. A new screen uses those, never a white-at-n% class. A
status, tag or stage hue used as the colour of *words* goes through
`ink()` (`src/lib/ink.ts`; `Badge` does it), which mixes it toward the
text colour by `--ink` (100% in Dark, so Dark is unchanged; 40% in
Light, where the pastels were unreadable). The tenant's brand colour
applies in both. The customer's documents (/q, /c, /i, /r, /u, /p, the
PDFs) carry no `data-theme` and stay as they were. Proven by `looks.cjs`;
`overlay-readability.cjs` checks every overlay in both looks.

**Reports on Overview (Nov 10, 2026).** Overview (`/dashboard`) has a
report bar across the top: **Daily Rundown** (the default for Owners and Admins; a Member lands on My day; it is the old
Overview — welcome, the Owed to you / pipeline tiles, recent activity, Jump
in — with today's calendar for the team, overdue follow-ups, gone-quiet
opportunities, payments in yesterday, quotes and contracts sent yesterday
and new contacts yesterday inside it), **Pipeline report** (so named Nov 11, 2026, apart from the board; open value and count by
stage as the board reads it, days in stage, what moved in the period from
`StatusChange` — people for the meeting steps, deals for the paperwork —
conversions, new opportunities, the oldest open items), **Activity**
(touches by day / week, kind and rep, marketing sends as their own series
and never a touch, people and companies touched, who nobody touched by
contact owner / industry / job title / state), **Closing** (won and lost
value and count, win rate, average win, days from first meeting to signed,
biggest wins) and **Money Owed** (owed aged Not due / 0–30 / 31–60 / 61–90 /
90+ days late, top debtors, contracts waiting on a signature, collected in
the period; "owed" is `owedRowsSql` in `src/lib/money.ts`, the very rows
the Owed to you tile adds up). The report, period (Today … This year, plus
Yesterday and Last year), rep and "Break down by" (Rep, Industry — a
company's first one —, Job title, State, Lead label, where it makes sense)
are in the address bar; "this" periods are compared with the same days of
the period before, finished ones with the whole period before. The
numbers are pure functions in `src/lib/reports/` (one module per report,
aggregated in SQL; a deal's value is `dealValueCte`, `dealValueCents` in
SQL), read by the page, the email and the write-up alike. **The write-up**
(`src/lib/reports/narrative.ts`): with `ANTHROPIC_API_KEY` set, Claude
(`REPORT_NARRATIVE`, 60 a day per workspace) is given only the formatted
numbers as JSON and every number in its answer must be in them ("$12k" for
$12,345 is fine) or the answer is thrown out; without AI, over the
allowance, on any error or a failed check it is written by rules from the
numbers (biggest change, who's ahead and behind, what needs attention).
Stored in `ReportNarrative` by report, period with its dates, rep,
breakdown and a fingerprint of the numbers, so it is written once until the
numbers move; Rewrite asks again. The page never waits on the AI: it shows
the rules version and swaps the AI one in. **Email me this** on every report
(`ReportSubscription`; yourself, or any teammate for an Owner or Admin;
Daily / Weekly on Mondays for last week / Monthly on the 1st / Quarterly /
Yearly on Jan 1; the Daily Rundown is daily only) and **My report emails**
with Remove in Settings → My Account. **The clock**: `vercel.json` runs
`/api/cron/reports` every hour (Vercel Pro); each run sends, for every
active workspace whose clock has reached 6am, the subscriptions due today
not yet sent since 6am (claimed through `lastSentAt` before sending and put
back if the send fails, so a double fire sends nothing twice and a run that
runs out of time is finished the next hour; one made after 6am waits for
the next morning). **The route refuses everything unless `CRON_SECRET` is
set in Vercel** (Vercel then sends it as the Bearer header itself) — until
Taylor adds it, no report email goes out. Email uses `sendEmail` as the
business's name; with email off nothing is claimed. `reports.cjs` (33
steps) covers it; measured through the slow proxy every report opens in
0.25–0.7 s, and at 200,000 contacts in 0.45–0.7 s (Activity broken down by
industry, title or state over a whole year about 1 s).

**AI assist and gone quiet (Nov 10, 2026; the five AI items from the CTO
Think Tank plus "gone quiet").** Every AI answer is a suggestion a person
accepts; nothing is saved or sent on its own, and every AI control is
hidden while `ANTHROPIC_API_KEY` is unset. All calls go through
`askClaude` (`src/lib/ai.ts`) with a per-kind daily allowance per
workspace (`AI_DAILY_CAPS` in `src/lib/ai-assist.ts`: FOLLOW_UP_DRAFT 200,
MEETING_TO_OPPORTUNITY 150, QUOTE_DRAFT 100, IMPORT_HEADERS 50, LEAD_LABEL
200); meeting notes go in fenced as data. **Gone quiet** (no AI): a "Quiet
Nd — call" next-step line on Pipeline tiles and a "Quiet N days" badge in
the panel, from `goneQuietOpportunities`, a **Gone quiet** toggle on the filter bar
(`?quiet=1`), and the day count (`Organization.quietDays`, 1–365) on
Settings → General for Owners and Admins. **Draft a follow-up** under every
tile's ⋯ and in every panel: a text and an email (subject + body) to the
Primary POC from the latest meeting notes, the deal and its quote, shown
to edit and Copy; **Log as sent** writes a one-to-one TEXT or EMAIL
Activity on the person (a real touch: calendar entry, Contacted, the
badge goes). Nothing is emailed from the site. **Suggest from meeting
notes** in the panel: Primary POC (people on it only), Lead Label (the
built-ins and the workspace's own only), an estimated value and a next
step, as chips to Use or dismiss; Use fills the panel's form and nothing
is saved until Save (the value only fills a deal's value box; the next
step is copy-only — there is no field for it). **Draft lines from the
meeting** on a draft quote whose deal came from an opportunity, and run
on arrival when Build Quote is converted with its box ticked (`?draft=
meeting`, dropped from the address once run): the catalog is searched
for candidates from the notes' words (`catalogCandidates`, 40 at most),
Claude sees only those, each line must name a candidate's id with a
quantity (any other id is left out and counted) or be a typed line at $0
marked **Price needed**, which the save refuses until priced; lines land
in the editor unsaved and the quote stays a Draft; the AI's reason is
shown in the editor only, never in the line's project notes (those print
for the customer). **The contacts import cleans the file first**
(`src/components/import-cleanup.tsx`): likely duplicates inside the file
(same phone/mobile digits, same name at the same company;
`src/lib/import-duplicates.ts`) and against contacts on file (same email
— which the import updates — same phone digits, or same name at the same
company; `checkImportDuplicates`), counted and listed; with AI, "Suggest
where they go" for the headers the planner left out (header + 3 sample
values), ticked suggestions re-plan the preview through
`planContactImport(text, mapped)`; nothing saved until Import. **Lead
Label suggestion**: a faint dashed chip in the panel of an opportunity with
no label (off the tiles since Nov 11, 2026), from rules first (`src/lib/lead-label-rules.ts`: company type
Distributor/Manufacturer → Vendor; no company and a personal email domain
→ Residential; a WON deal under one of its people → Client), and "Suggest
label" asking Claude only when the rules say nothing; accepting calls
`setOpportunityLabel`. `ai-assist.cjs` (19 steps) covers all of it with
a stand-in Claude on :3995.

**Clean CRM data and sharper filters (Nov 10, 2026; Taylor's three
calls: marketing email is not a touch, no auto-assigning, everyone sees
everyone).** **Marketing** sends (`Activity.marketing`) stay on the
person's log with a Marketing badge and sit in their own **Marketing**
column on both lists (how many, the last one; a company's is its
people's, `marketingContacts` / `marketingCompanies` in
`src/lib/last-contacted.ts`); Last Contacted By, the lists' Activity
counts, the Activity overview box and Last touch on both pages, Stats
(`src/lib/stats.ts`) and the Activity filter all leave them out (the
filter reads `lastTouchAt` on Contact and Company, kept by statement
triggers on Activity and Contact in the migration — a company's is its
own and its people's — because "on it or its people" from Activity was
3.4 s a page at 200,000) (the
status ladder already did, from the base branch). **Rep** (`ownerId`) and
**Added by** (`createdById`) on contacts and companies: a Rep column on
both lists; on the pages a Rep picker that saves as it changes and "Added
by <name> · <date>"; a Rep box on the new and edit forms, Unassigned
first, that writes only when changed from what the form opened with
(`ownerOriginal`, `readRepField` in `src/lib/reps.ts`), and a removed
teammate stays offered, labelled, while they are the one saved. Every
place that makes a contact or company sets `createdById` (the forms,
`findOrCreateCompany`, Add person / + Add new contact, the Email window,
the Contract Coordinator, Order materials, crew/photo invites, supplier
companies from products, quotes, Import Ratesheet and On Software Connect
Brands) and nothing sets a rep on its own. **Import**: "Assign everyone in
this file to: Unassigned / <teammate>" (`AssignToSelect` in
`import-csv-button.tsx`, passed with every batch): picking a teammate
gives them every person in the file, new or already here, and every
company in it nobody owns yet; Unassigned leaves anyone already here with
the rep they have — an import never takes a rep away. **Bulk Assign** on
both lists (`src/components/bulk-assign.tsx`, `assignRecords` in
`src/app/dashboard/assign-actions.ts`): tick rows (the box sits in the
star's cell so the columns didn't move) or tick the page and "Select all
N matching these filters"; Assign to me / Assign to… / Unassign; "all
matching" re-reads the filter on the server from the list's own address
and takes the first 1,000 in list order in one UPDATE that leaves
`updatedAt` alone, and says how many still match. **Filters** (address
bar, stacking): Activity (touched / not touched in 7 / 30 / 90 days,
never; a company counts its people), Job title (contacts; a searchable
list with counts from `/dashboard/contacts/titles`, matched ignoring
case), Rep with Unassigned, Added by, Added (a date range in the
workspace's clock), Contact info (has / no mobile and email on contacts,
email and phone on companies), Lead Label (people on an opportunity with
it, not Do Not List; companies through their people). **CRM → Labels**
(`/dashboard/labels`, `src/lib/crm-labels.ts`): Industry, Company Type,
Lead Label and Job Title, every value in use or on the pick list with its
count, and for Owners and Admins Rename, Merge into… and Retire / Restore
(a Member reads it). A merge rewrites every record (company arrays keep
one of each ignoring case, in order), takes A off the pick list, and an
industry's company types move under the target; renaming onto a name in
use is refused with "use Merge into…". Retire is `retiredAt` on
IndustryOption / CompanyTypeOption / LeadLabelOption: off the pick lists
(`getIndustryPickList` hides it unless `includeRetired`; a company's own
edit form keeps the retired values it carries, `keep`), still offered by
the list filters, records keep it. Company types are one value however
many industries offer them, since a company stores the bare name. The
built-in lead labels can be merged into only; **Distributor** is locked
(the supplier pickers find suppliers by it); Job Title has no pick list,
so no Retire. **Find duplicates** on both lists
(`/dashboard/{contacts,companies}/duplicates`, `src/lib/duplicates.ts`,
`DuplicatesView`): contacts by the same email (either one, ignoring
case), the same phone (phone, second phone or mobile, last 10 digits)
or the same name at the same company; companies by name ignoring case
and punctuation, website domain, or phone; 25 groups a page from one
grouped statement; "Merge these" opens Merge Contacts / Companies with
the group picked, oldest kept by default, and stays on the finder. A
merge keeps the keeper's rep and Added by, filling them from the others
when blank. Migration `20261110171000_crm_data` (retiredAt columns,
`lastTouchAt` with its backfill and triggers, and indexes for Rep, Added
by, Added and last touch). `crm-data.cjs` (27 steps) covers it; `load-test.cjs` now seeds 110,000
activities, reps and 500 Client opportunities and times every new filter,
the Labels screen, the duplicate finder and a 1,000-record assign.

**The BDR redesign, built (Nov 11, 2026).** All nineteen of Taylor's calls
(under Testing) are built as one release, which goes live only after his
"Ready to go live?" yes. The plan's single Closed column is not built and
won't be: Taylor decided the Pipeline keeps Won and Lost as two columns
under group headings (his decision is under Testing, after the nineteen).
**Connected and outcomes**: `ContactStatus.CONNECTED` sits between Contacted
(shown **Attempted**; the value and CSV import stay CONTACTED) and
Interested. A touch can carry `Activity.outcome` (`OUTCOMES_BY_TYPE` in
`src/lib/constants.ts`); Talked, They replied and Held are a connect
(`isConnect`, the same rule as the triggers that keep
`Contact/Company.lastConnectAt` beside `lastTouchAt`), and a no-show is no
touch at all. Talks count from `Organization.outcomesSince`, the release
day. Status moves go through `moveRecords` in
`src/lib/status.ts`. Not interested and Lost take an optional reason
(`StatusChange.reason`). **Health and the lifecycle meter**: `leadHealth()`
/ `rollUpCompany()` in `src/lib/health.ts` (pure and never stored; loaders
in `src/lib/health-load.ts`) give New, Trying, Warm, Cooling, Cold, Won or
Closed, with a 0–100 score only once someone is reached, shown on hover or
long-press, in teal / amber / rose / grey on every tenant (`--health-*`).
`LifecycleMeter` (`src/components/lifecycle-meter.tsx`) is the seven steps
Attempted → Won: its length is the stage, its colour the health, and it
offers one next action. `src/lib/health-sql.ts` is the same rules in SQL
for the lists' Pulse filter and Warmest first. **The two sheets**: every
log is **How did it go?** (`src/components/how-did-it-go/`): one-tap outcome
chips, then a next step already picked (Try again, Try again in 30 days
after `parkAfterTries` tries with no connect, Book meeting, Try to book a
meeting, Start a quote, Reschedule, Not moving forward), one save with one
"Saved · Undo" (`undoLog`, `src/lib/undo-log.ts`). **Book meeting**
(`src/components/book-meeting/`) books onto a tile, offering the one it was
opened from first, and credits `OpportunityMeeting.bookedById`. How did it
go? opens by itself after a `tel:` / `sms:` tap (`dial-return.ts`). Both
take `opportunityId`, `onChanged` and `onToast`, so a screen can keep one
toast slot. Every screen that logs or books mounts them; never build
another form. **The ONE meeting rule**: which meeting waits for an answer
is `waitingOf` in `src/lib/meeting-rule.ts`, fed by `waitingMeetings` in
`src/lib/meetings.ts` (`ahead`, `due`, `missed`, `toAnswer`); every screen
reads it, never another query. A meeting logged as having happened is Held
and sets Meeting Completed. **Contact page**: a header band with one main
button by stage, the meter, a Next step strip (Held / No-show / Move),
history by day with paperwork lines read at render (Quote sent, Accepted
by <name>, Contract sent; never Activity rows) and Edit on your own lines
(`updateActivity`), Reach and Paperwork cards, and a phone bar. New quote,
Edit, Add deal, status and Delete are under ⋯ More. **Company page**: Who
to call first, the same header, one Opportunity card, Details folded, Book
/ Reschedule on the person's own tile (`bookingTiles`), and claims undone
by a signed token (`src/lib/claim-token.ts`). **Pipeline**: [Mine |
Everyone], Needs a decision (`?decide=1`), tiles titled by the Primary
person with the mini meter and one next-step line (`tile-line.ts`), Meeting
Set split into Happened and Coming up, the DealJourney strip in the panel,
and stage tabs on a phone (Set · Met · Quote · Contract · Closed; the
Closed tab shows Won and Lost, each under its own heading).
`/dashboard/deals?open=<id>` opens one tile's panel (`pipelineHref` in
`src/lib/pipeline-link.ts`); never link with `?q=<name>`. **My day** (a
Member's `/dashboard`; `my-day/load.ts`, `rankUpNext` in
`src/lib/up-next.ts`): a greeting (AI Rewrite with the key set,
`MY_DAY_GREETING`, 200 a day), week rings toward the **goals** (weekly
tries, talks and meetings booked plus the try limit, set by Owners and
Admins in Settings → General; "vs last week" until set), Up next with Call ·
Text · Book · Log, "N new leads nobody owns · Take 10" with Undo, Meetings
with Held / No-show, and Team & money folded. Owners and Admins keep the
Daily Rundown with **Team today** on top (`loadTeamToday`, `repNumbers`;
`sellingReps()` is the one definition of who counts as a rep; all in
`src/lib/reports/daily.ts`). A Member's Rundown is Me unless `rep=all`. The
Rundown's four money tiles are whole dollars (`wholeDollars`). The
calendar gains the **Agenda** (the default for a Member and a phone), a
[Mine | Team] toolbar with View and Filters, and "+ New" as a sheet. **The
phone tab bar**: Today · Contacts · Companies · Pipeline · More, 56px
(`PhoneTabBar` in `src/components/sidebar-nav.tsx`), with global search in
the top bar. **Lists**: [Mine | Everyone | Unowned], presets (My call list,
Never touched, Talked — no meeting, Meetings this week; My accounts, Going
quiet), Filters (n), Sort, Columns, Pulse and Next step columns, phone
cards with Call · Text · Log, Clean up ▾ holding Import CSV / Merge / Find
duplicates / Fill in missing, and Bulk Assign that asks before taking a
teammate's records and offers Undo (`resolveListView` in
`src/lib/list-prefs.ts`, `src/lib/list-query.ts`). **Paperwork**: the
**DealJourney** strip (Meeting · Quote · Contract · Signed · Deposit, one
Next; `loadDealJourney` in `src/lib/deal-journey-load.ts`) on the quote,
the Contract Coordinator, the contract and the panel. **Send quote** is a
share sheet (Copy link · Text · Email · Just mark it sent; nothing is
emailed). The customer **accepts on `/q`** with a typed name
(`acceptQuoteByCustomer`, `Quote.acceptedByName`; refused past Valid until
by `quoteExpired`). The quote editor has one Save (`quote-save.tsx`); a
sent contract is locked until pulled back to draft; the Coordinator
pre-ticks a first contract; Build Quote opens the new quote. **Stats**:
tries, talks, connect rate, meetings booked, show rate and won $; the
funnel Attempted → Won counts everyone who reached a step or a later one
(`rollUpReached` in `src/lib/stats.ts`); a leaderboard with Columns; Members
open on Me. The Activity report counts the same way, and a rise from zero
reads "new this period" (`changeSize`). **One-to-one email**: Email on a
contact's page (`ContactEmailButton`, `sendOneToOneEmail`) sends a plain
email as the rep, logs an EMAIL touch, writes no `EmailSend` row (so it
is outside the 40 a day) and refuses anyone unsubscribed. **uiPrefs**:
`User.uiPrefs` is one object per screen: `calendar` (scope, view,
showLogged), `myday` (teamMoney), `pipeline` (scope), `stats` (columns),
`contacts` and `companies` (scope, preset, sort, columns). Write it only
with `saveUiPref(ns, key, value)` (`src/app/dashboard/prefs-actions.ts`);
read it with `readUiPrefs`, or `readUiPrefsWithLegacy` where the first
build's top-level keys may still be stored (`src/lib/user-prefs.ts`). Schema:
the `20261111*` migrations.

**The AI release (Nov 12, 2026; plan: the "AI Release Plan" artifact,
claude.ai/artifact/NbGqNjF9vjCskNhPb9XKLd).** Taylor picked seventeen AI
items from earlier sessions and think tanks once `ANTHROPIC_API_KEY` was
set (Nov 11, 2026), built as three releases on `claude/ai-release-a`,
`-b` and `-c` and merged on `claude/ai-release-final`. The same rules as
"AI assist": every answer is a suggestion a person accepts, every AI
control hides without the key, every call is `askClaude` with its kind
and `AI_DAILY_CAPS` (fifteen new kinds), and every answer is checked
against what was sent (ids offered, labels on the lists, snippets found
in the source, numbers through `inventedNumbers`). Taylor's four calls on
the plan: openers go on My day's Up next (no Call List page); installers
send receipts through the crew link, held until an Owner or Admin
approves; site-walk photos are kept and move into the job; the compliance
watchdog covers his subs' COIs too. **Groundwork**: `askClaude` takes
`AiPart`s (pictures as base64 JPEG made small in the browser, PDFs, text
documents; at most 20 pictures and 24 MB of base64, refused in words
before the allowance is spent) and a `timeoutMs`; to a stand-in endpoint
(`ANTHROPIC_ENDPOINT`) it adds an `x-scb-ai-kind` header, never to
Anthropic. **Release A, sales and calendar**: **Brief me**
(`src/lib/brief.ts`, `BriefMeButton` in `src/components/brief-me.tsx`) on
the contact page header, Call and Meeting entries with a person (the
week/month entry card and the open Agenda row), Up next rows and the
Pipeline panel's Primary POC: facts by rules with no key, five lines and
an ask by Claude checked with `inventedNumbers` / `factCounts` and
`inventedNames` (`src/lib/ai-writing.ts`), "Couldn't write the brief this
time." over the facts on a failed check. Written words are kept in
`AiWriting` (`readWriting` / `storeWriting` / `fingerprintOf`; keys
`brief:<contactId>`, `opener:<contactId>:<userId>`,
`forecast:<reps or all>`). **Draft an opener** on Up next rows only
(`my-day/opener.tsx`), on a tap. **Say it, don't type it** in How did it
go? (`how-did-it-go/mic.tsx`, `voice-actions.ts`, `voice-options.ts`):
the browser's own speech recognition fills the notes box (nothing
recorded or sent by us); "Fill it in from my words" picks only from
`voiceChips(type)` / `voiceNextSteps(chip)` and the sheet re-checks
against `nextChoices`; it stays two Saves (outcome, then the next step
already picked), the coordinator's call. **The Stats forecast**
(`src/lib/forecast.ts`, `stats/forecast.tsx`): this month and next by rep
from open deals at Quote Sent and Contract Sent, the workspace's own
rates (deals Won or Lost now) and usual days, "Running past the usual
time", Low confidence until 90 days of history, the rep filter only (it
looks ahead), the newest 5,000 open deals. **Looks like the same person**
(`src/lib/lookalikes.ts`, no AI) under the contact header: same email,
phone digits or name at another company, with Merge these,
+ Additional Account and Not the same person (`DuplicateDismissal`,
smaller id first by byte order, `pairKey`; also hides that pair in Find
duplicates). **Release B, contracts**: the rules for every check are
pure in `src/lib/contract-checks.ts` (`scripts/contract-checks-check.ts`
runs them). **Price check before Create** in the Coordinator
(`check-actions.ts` under the tracker): under cost, under the starred
minimum, a different unit, a discount past the margin, a schedule that
doesn't add up, a purchase order row above catalog cost; "Create anyway".
**Read before send**: `checkBeforeSend` in `contracts/ai-actions.ts`;
**every Send for signature is `SendContractButton`**, never another send
form (it still posts `setContractStatus`). **The redline reader**
(`redline-reader.tsx`): Word read in the browser (tracked changes from
`<w:ins>` / `<w:del>`), PDF or photos sent as files, each change's
snippet found exactly once or listed "Couldn't place this one", Accept /
Reject into a draft; the copy kept in `ContractFile`, written in 2.5 MB
pieces by `addRedlineChunk`'s raw `||` append and omitted from every query
by default. **Dates in this contract** on a signed contract: duties with
their snippet, ticked into calendar entries of type "Contract date"
(`ensureEventType`). **The compliance watchdog**: `ComplianceInfo` beside
`Upload` (`src/lib/compliance.ts`, `compliance-shared.ts`), on Settings →
Compliance (the workspace's own, `crewId` null) and on a sub crew's card
(`crewId`; deleting the crew deletes them; a Member can't), flags on the
tile, the crews list and a job where that crew is scheduled. What PRICE_CHECK,
SEND_CHECK, REDLINE and CONTRACT_DATES wrote is kept in `AiAnswer` by
(organization, kind, key) with a fingerprint. **Release C, jobs**:
pictures are made small by `src/lib/ai-picture.ts` (`pictureForAi`,
`picturesForAi` under 3.6 MB a request), job photos read through
`/files/<token>?stream=1` (staff only, sandboxed by a
Content-Security-Policy), and checked server-side as JPEG
(`jpegFromBase64`, `readAiImages` in `src/lib/job-ai.ts`); workspace words
go in through `fenced()`. **Tags from the picture**: `PhotoTagSuggestion`,
one row per photo written before Claude is asked (the claim), dashed
chips on the tile, crew-link photos asked about on the next staff visit
(12 a visit, 30 days). **Punch list** and **Ask the job a question**
(`src/lib/job-facts.ts`; dates written as words because `withoutDates`
leaves ISO dates in) in an "Ask about this job" card on the job's Budget
page; the punch list also from Files → Select. **The close-out photo
report**: `PhotoReport`, edited at `/dashboard/projects/[id]/report`
beside Close out (which is unchanged), shared at **`/jr/<token>`** (never
`/p`, the crew link), its photos only through
`/jr/<token>/photo/<id>` while shared, in the report, never SVG, sandboxed.
**Site walk to quote**: "Draft from photos" on a draft quote, two asks
(what it sees and the words to search, then lines from
`catalogCandidates` under the rules of Draft lines from the meeting, now
shared in `src/lib/drafted-lines.ts`); the photos are Uploads with
`quoteId` (cascade) and `projectId` null, shown to the team only, moved
into the job's Main folder by `moveSiteWalkPhotos` inside
`awardFromContract` (all of the deal's quotes when the job is first made,
the signed paperwork's own quote after that). **Receipts**: Add receipt on
the Money tab makes a paid bill by `makeReceiptBill`
(`src/lib/receipts.ts`): a signed, payable Purchase Order titled "Receipt —
Store" on one scope (goods + Sales tax), one payment row settled on the
receipt's day, the store found or made as a supplier company (with a
"<Store> receipts" contact, since a contract needs one) inside that
transaction under an advisory lock, the photo in the job's "Receipts"
folder; so Spent ties out through paperwork. The crew link's **Send a
receipt** makes a `JobReceipt` PENDING (30 waiting a job at most) that
counts nowhere until an Owner or Admin approves it on the Money tab.
Migrations `20261112120100_ai_a_writings_and_pairs`,
`20261112120200_ai_b_contracts` and `20261112120300_ai_c_jobs` add new
tables, one new enum type and the nullable `Upload.quoteId` only; no
existing value changed, so Instant Rollback stays safe.
**Taylor's two follow-ups (Nov 12, 2026).** **A purchase order made on the
Contract Coordinator starts at the catalog cost**, without the customer's
line discount, the way Order materials does: `purchaseOrderPrice` in
`src/lib/po-pricing.ts` is read by Create (`deals/tracker/actions.ts`), the
price check (`check-actions.ts`) and the card (`tracker-grid.tsx`, which
gets `product.costCents` per row from `src/lib/tracker.ts` and says "At
your catalog cost" in `po-pricing-note`); so "above catalog cost" no longer
fires on Coordinator POs. **"Subcontractor insurance to check"** on the
Daily Rundown for Owners and Admins (`subInsuranceFlags` in
`src/lib/compliance.ts`, `SubInsuranceCard` in
`src/app/dashboard/reports/sub-insurance.tsx`, loaded beside Team today in
`src/app/dashboard/page.tsx`): active subcontractor crews whose newest
paper of each kind (by when it runs out) has run out or runs out within
30 days, expired first; a name mismatch stays on the crew card only; the
card shows only when there is something to check, and it isn't in the
report email.

**The apparel pack (Nov 12, 2026; plan: the "Apparel Pack Plan" artifact,
claude.ai/artifact/JCJqmooobKEuuBRnDApTpD).** Taylor's two calls: the proof
is the customer's own logo placed exactly by the app on the product's real
picture (AI photo-real renderings later), and a famous-looking logo is a
**warning only** (no block, no "we're licensed" tick). **The switch**:
Settings → General → "We do apparel / custom print" (Owners and Admins;
`updateApparel`) and the operator's Turn on / Turn off on a workspace's
/admin row (`setOrganizationApparel`); `Organization.apparelOn`. Off hides
the Artwork card, the proof chips and the Proofs card, refuses anything
new, and deletes nothing; /pf links keep answering. Turning it on makes the
**Print location** label group (Front, Back, Left chest, Full front, Full
back, Left sleeve, Right sleeve; `ensurePrintLocations` in
`src/lib/apparel.ts`), adopting one already named so and bringing it back
if retired; Labels & Units refuses to retire it while apparel is on.
**Artwork** (`Artwork`, `src/lib/artwork.ts`, `src/lib/artwork-file.ts`,
`src/components/artwork-card.tsx`): on a company page's Artwork card, or
from the proof sheet (on the quote's company, or the contact when they
have none); the file is read in the browser — PNG, JPEG, WebP, GIF, SVG
(drawn through an `<img>`, so its scripts never run), PDF and Illustrator
with a picture inside (unpdf, page one, at most 2,000 px) — into a preview
with its transparency kept (WebP, PNG where the browser can't), a thumb,
and a JPEG on **mid-grey** for the look-alike check; EPS, PSD, TIFF,
CorelDRAW and Illustrator saved without PDF content are kept as the
printer's file and ask for a PNG or JPEG of the logo. The **printer's
file** is kept byte for byte (octet-stream, up to 50 MB). Artwork pictures
and files are served **only to the workspace's own people**
(`/dashboard/artwork/<id>/picture`, `/print` as an attachment); customers
and printers only ever see proofs. Remove keeps artwork a proof uses
(`removedAt`); merges move it. The **look-alike check** (`ARTWORK_CHECK`,
100 a day) reads the stored grey copy, reuses an answer for the same
picture (`checkHash`), shows "Looks like X's logo. Make sure you're allowed
to print it." and is asked again for unchecked artwork when proofs are
sent. **Proofs** (`src/lib/proofs.ts`, `proof-shared.ts`, `proof-draw.ts`;
the quote's `proofs.tsx` and `proof-sheet.tsx`): a `Proof` is one design
on one garment colour on one quote, keyed by (product, Color option);
`ProofVersion` holds its picture and answer, `ProofPanel` one per print
location (up to four: location, artwork, base = a product picture or a
plain garment front/back in a colour, placement as fractions). A product
line shows "+ Proof" (saved lines only) or its proof's chip; the sheet ticks
the lines of that product and colour (sizes share a proof; a line on
another proof shows "On Proof 2"), offers "Use Proof n" for a second line of
the same garment, "Use an approved proof from an earlier order" (copied as
a **draft** that shares the files; `copiedFrom` says where it came from),
and draws the panels into one picture in the browser on Save (display and thumb like a product picture, plus an 800 px JPEG document copy that contracts and their PDFs print). A product
picture of another colour is captioned "Shown on White; printed on Navy";
with no picture in the line's Color it is drawn on a plain garment.
`QuoteLineItem.proofId` joins a line, and **counts only while the line's
product and Color still match** (every reader checks); a quote save drops
mismatches and joins a new or changed line to its garment's one proof when
the other lines of it agree (`syncLineProofs`). Editing a draft replaces its
picture (a second tab's save of the same draft is refused by its token); editing a sent one makes the next version, and the customer keeps
seeing the old one until **Send proofs** (its own share sheet — Copy link,
Text, Email, Just mark them sent — never marks the quote sent), which marks
the drafts SENT and every older version SUPERSEDED. **The approval page
`/pf/<token>`** (`Quote.proofToken`, one per quote): each sent proof big,
what it is for, no prices; Approve (typed name + "I've checked the
spelling, colors and placement") or Ask for changes (a note); every write
is guarded — only the newest version, still SENT, on this quote, while the
workspace is active; a proof with a newer draft reads "Being updated".
**Mark approved** by hand on the Proofs card (approved on the phone).
Calendar: "Proof changes · <who>" open for the rep while any answer is
"change it", "Proofs approved · <who>" done when the last one is approved
(`syncProofEvents`). The **customer's quote** shows a line's sent proof in
place of the product picture, captioned and linked to /pf. **Contracts**
carry picked proofs (`ContractProof`, with a "covers" snapshot of the
lines): the Coordinator card's "Include the proofs" (on for money in, off
for money out; warns when one isn't approved) and a draft contract's Proofs
card; the document's Proofs section shows each with "Approved by …" or a red
"Not approved yet: don't print from this"; a **money-out contract that is
out or signed** offers each panel's printer's file
(`/c/<token>/print/<versionId>?p=<panel>`), only for a version that was
approved, and a signed one keeps its file after a newer version, marked
"since replaced … check before printing". Order materials never adds
proofs (the blank-garment supplier). Deleting a quote keeps the proofs a
contract carries (quote-less) and sweeps the rest (`sweepProofs`).
Migration `20261113120000_apparel_pack` adds tables, one enum and nullable
or defaulted columns only, so Instant Rollback stays safe.
`apparel-pack.cjs` (37 steps) covers it.

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

- **Artwork, proofs and the printer's files went through the local driver
  only.** The Blob path is first exercised on the live site; check
  `[storage]` in the runtime logs after the first artwork upload.
- **The proof is exact, not photo-real.** The logo is laid flat on the
  product's picture or a plain garment; folds and fabric aren't drawn. AI
  renderings at about $2 an image are the next step (Taylor, Nov 12).
- **A plain garment is one t-shirt shape** (front and back); hoodies, hats
  and bags need a product picture to look right.
- **The look-alike check is a warning, by Taylor's call**, and only as good
  as one look at a small grey copy; it can miss a mark or flag a school's
  own.
- **A replaced artwork's tile is the new one.** The version a customer
  approved keeps its own artwork (download it from the quote's Proofs card).
- **Order materials and a cancelled purchase order:** a cancelled PO's rows
  still count as ordered, so a corrected printer's order is made on the
  Coordinator, not Order materials (found in the apparel critique; not
  changed).
- **Nobody is emailed when a customer answers a proof.** The calendar entry
  and the Proofs card are the signal; the coach's link is shared by hand.
- **Proof answers aren't counted against anything.** The coach's link has
  no rate limit; every write is guarded and repeats change nothing.

- **Report emails need `CRON_SECRET` in Vercel.** The hourly clock is
  refused without it, by design. Add it (any long random value) under
  Settings → Environment Variables, all environments, then redeploy. Email
  itself (`RESEND_API_KEY`, `EMAIL_FROM`) must be on too.
- **`ANTHROPIC_API_KEY` is set in Vercel, Production only (Nov 11,
  2026, by Taylor, with a monthly spend limit on the Anthropic account as
  the backstop).** Every AI feature is on in the live site. Each was tested
  only against a stand-in Claude; the first real answers are on the live
  site. Report write-ups cost about a cent each and are written only when
  a report's numbers change, capped at 60 a workspace a day; without the
  key they fall back to rules-written prose.
- **Reports count from what is recorded.** A deal's win or loss is dated
  by `Deal.stageChangedAt` (a deal won and then moved out of Won is not a
  win); the Pipeline's "what moved" only knows `StatusChange` rows (from
  Sept 30, 2026); an opportunity lost before any deal has no date and is
  left out of Closing; a company in two industries counts under its first.
- **A report email that fails to send is retried at the next hourly run
  that day**, not after midnight: a workspace whose send fails all day
  misses that day's email.
- **The Daily Rundown is always today and yesterday** in the workspace's
  zone; its period picker is hidden. The gone-quiet list uses the real
  clock, so the cron's test clock does not move it.

- **Suggest fields runs on the site's key** (`DEPLOY.md`).
  Without the key the button simply isn't shown. It sends the agreement's
  text to Claude (claude-opus-5-5, server-side fallback on) and costs
  about a cent on a short agreement, up to about 40 cents on a
  60,000-character one, on the site's own key. 20 a day per workspace
  caps it at roughly $8 a workspace a day; a spend limit on the
  Anthropic account is the backstop.
- **The Pipeline, quote and import AI helpers run on the same key**
  (Nov 10, 2026). Without it, Draft a follow-up,
  Suggest from meeting notes, Draft lines from the meeting, the import's
  "Suggest where they go" and "Suggest label" don't show; Gone quiet, the
  import's duplicate flags and the rule-based label chips need no key.
  Roughly 2 cents a follow-up or meeting read, 5 cents a quote draft and
  under a cent a label or header guess, on the site's own key, capped per
  workspace per day (200 / 150 / 100 / 200 / 50). The import's header
  suggestions send the headers and three sample values of the unplaced
  columns to Claude, which can be personal data.
- **A drafted quote's prices are only as good as the catalog search.** It
  matches words from the notes against product names, SKUs and
  descriptions; a product the notes describe in other words isn't a
  candidate, so it comes back as a typed "Price needed" line. A catalog
  of tens of thousands narrows to the 300 first word matches before the
  best 40 are picked.
- **AI release costs sit on Taylor's key for every workspace** (Nov 12,
  2026), capped per workspace per day in `AI_DAILY_CAPS`; if one workspace
  used every cap of the three releases in a day it would cost about $48 on
  top of about $20 for the AI before them. Photos cost most (a punch list
  or a close-out report about 15 cents, a tag about a cent a photo).
- **A Coordinator purchase order row with no cost on file keeps the
  quote's price** (a typed line, or a product nobody priced): the card says
  "No cost on file … at the quote's price. Check the supplier's price."
  Every row with a catalog cost is at that cost (Taylor, Nov 12, 2026).
- **A site-walk photo's file stays in Blob when its contact or deal is
  deleted** (the rows cascade; only Delete quote removes the files), the
  same gap as deleting a workspace or a job.
- **Contract dates count business days without holidays**, the redline
  reader sees a Word copy's tracked changes but not its comments, and the
  compliance flags compare UTC days (as the compliance list always has).

- **The meeting suggestion's next step is copy-only**, and its value only
  fills a deal's value box: an opportunity with no deal has nowhere to
  keep either until it is converted.
- **Gone quiet counts a logged touch with anyone on the opportunity**,
  so a call with the Associated POC about something else still resets it.
- **A booby-trapped Word or PDF file can still freeze the uploader's own
  tab.** It is read in their browser, so nobody else is affected and the
  limits above stop the common ones, but one page of a PDF built to
  unpack to gigabytes is not caught before the reader opens it.
- **Contract templates are not limited to Owners and Admins.** The
  template actions only check for a signed-in user, so a Member can edit
  or replace one despite the Company Users rule. Found Oct 7, 2026; not
  changed without asking.
- **An uploaded agreement keeps its words, not its look.** Bold, tables,
  columns and logos from the Word or PDF file don't come across; the
  Phase 4 PDF designer is where formatting lives.
- **Email goes out for a handful of things only:** password reset, Company
  Users invitations, email marketing (Sept 27, 2026), the operator, account
  and report emails described above, and the one-to-one email from a
  contact's page (Nov 11, 2026). Send quote's Text and Email open the rep's
  own messages or mail app. No approval notice, no
  receipts, no invoices. Everything else waiting on email still is. That
  includes ratesheets:
  "Send to partner" makes a link to copy and text or email by hand, and
  the Contract Coordinator's "Copy reminder", which copies a nudge with the signing
  link and logs it; the app says so on the screen.
- **A ratesheet is read up to 25,000 rows.** Past that the rest are
  left out and the preview says so; a bigger catalog comes in as two
  sheets. A sheet's Unit column is read against the built-in units only:
  a workspace's own units (Box of 12) are picked by hand until Release 4.
- **PDF ratesheets aren't read.** Excel and CSV only; a PDF is refused in
  words and can still be saved with Upload File or declined.
- **Only Order materials falls back to the catalog cost.** A contract
  row that captured $0 still reads $0 on the contract itself and in the
  job's Expected cost on file; the purchase order made from it is priced
  right (Oct 25, 2026).
- **Open quotes aren't re-priced when a ratesheet moves a cost.** A
  quote's lines keep the price they were written at; a line under its
  product's starred-supplier minimum is flagged in red (Nov 4, 2026).
- **Order materials follows today's star.** A purchase order goes to
  whoever is starred when it is made, at that supplier's COGS, and a
  product with no supplier left isn't ordered from anyone. Who a job
  bought from is on its purchase orders, not the product.
- **The minimum margin is a warning.** Nothing stops a quote going out
  under it, by Taylor's call; the red flag on the product, the list and
  the quote line is all there is.
- **A required minimum markup belongs to one sheet.** It is applied when
  Save and accept runs on that sheet; the next sheet from the same
  supplier inherits the COGS discount but not the markup.
- **A discount typed on a product's supplier row is overwritten when
  that sheet's discount is changed** in its product list (it goes onto
  every row the sheet set). A row a newer sheet set is left alone.
- **Product pictures went through the local driver only.** The Blob path
  (client upload, `head`, the streamed read) is first exercised on the
  live site, like job photos; check `[storage]` in the runtime logs after
  the first upload. **The first iPhone / Safari upload is checked on the
  live site too**: Safari can't make WebP, which the suite fakes in
  Chromium; a Safari upload should land as `.jpg`.
- **A picture upload abandoned part-way leaves its files in Blob** (tab
  closed between the copies and the finish), and deleting a workspace
  leaves its pictures, as with job photos. A sweep by the
  `org/<id>/products/` prefix is the fix when it matters.
- **Pictures are public by link, like logos**: anyone holding a picture's
  `/files/<token>` address can open it. They are generic product photos;
  nothing private belongs there.
- **Quotes sent before 3b show no pictures**: they went out with none. A
  draft shows them as soon as the product has one.
- **Pictures print on quotes, their PDFs and partner ratesheets only**,
  not on contracts or purchase orders (labels do). The apparel pack's
  proofs are where a picture reaches the printer.
- **The quote editor's label select shows today's names**, while the
  sent quote, its PDF and its contracts keep the names they went out with.
  A rename is meant to show on new lines; a line only takes it when its
  pick is changed.
- **A workspace unit's "contains" is printed, never calculated** (Release
  6): 3 Box of 12 is 3 on the quote and the purchase order.
- **Built-in units still don't print on a customer's quote or contract**
  (they never have); a workspace's own unit does.
- **Ticking a line in See product list prices from that sheet, except
  over a newer one.** A line whose product a newer sheet of the same
  supplier priced is linked to it and left alone ("already priced from a
  newer sheet of theirs"); otherwise a tick re-prices the product from the
  sheet at the sheet's COGS discount (the "Your COGS" the list shows), as
  Import prices would. A cost that more than doubles or halves is
  held there with no tick to force it: Import prices is where it goes in
  on purpose, with the warning beside the row.
- **Products changed by the code before 3a are trusted over their rows
  only when they were written after them.** During the deploy's overlap,
  or after an Instant Rollback to before 3a and back, a product whose
  COGS, MSRP or distributor the old code changed has its starred row
  brought into line (a COGS worked back through the row's discount) the
  next time it is opened, imported, saved or its sheet's discount changes;
  one the old code set to "None" loses its supplier rows, as None does on
  the form. Rows written after the product (3a mid-save) are left alone.
- **Import Ratesheet refuses a typed new supplier name, or an account
  picked from On Software Connect Brands, that lands on a supplier already
  on file other than the one previewed** (through a renamed company): the
  preview showed its products as someone else's. Pick it from the list
  instead. The account pick still links that supplier to the account.
- **Any signed-in user can import a ratesheet**, like every other
  Products action.
- **A rep picked on an import is a DistributorContact, not a CRM
  Contact** on the supplier's Company.
- **A Decline sends one email per operator and has no throttle.** Fine
  while declines are rare.
- **"Link Distributor / Partner" is Coming Soon.** Public and
  Invite/Approve ratesheets are stored with their visibility but nobody in
  another workspace can search for them yet; every send today is a link.
- **A listed supplier's name, city and state are its own.** An approved
  Distributor can rename itself in Branding and no operator sees it, so a
  name under On Software Connect Brands is self-asserted, and a workspace
  that picks it links its same-named supplier to it. Nothing travels over
  a link yet, and `platformLinkedAs` keeps the name each link was made
  under. Before Release 5 delivers ratesheets over links, Taylor decides
  whether a rename takes a supplier off the list until it is reviewed.
- **A supplier spelled differently from its account can't be linked by
  hand, and nothing unlinks.** "ADI" on file and "ADI Global" on the
  platform: picking the account makes a second supplier and company. A
  suppliers screen with Link / Unlink is the fix.
- **The On Software Connect Brands list stops at 200 accounts a picker**,
  alphabetical, in a native select with no search, and the typed-name
  match only knows those 200. A searched box once the platform has that
  many suppliers.
- **A Hardware / OEM or Software Provider picked as a supplier is filed in
  the CRM as Company Type "Distributor"**, like every supplier.
- **Nobody is emailed when a type request is answered**; the requester
  sees it on Settings → General. **Create Account needs email switched
  on**, and refuses before making anything without it.
- **Uploaded files live in Postgres, except job photos and videos** —
  ratesheets, compliance and marketing documents (4 MB cap), logos and
  photos (2 MB) are in the database. Logo and photo links
  (`/files/<token>`) are public by design so they render on the
  customer's copy of a document; documents need a login. Job photos and
  videos (Oct 17, 2026) are in Vercel Blob, private, up to 1 GB.
- **Job photos are in Vercel Blob only, not the customer's Google or
  Microsoft account yet.** Taylor wants OAuth to Google Drive and
  OneDrive per customer next; `src/lib/storage.ts` is the one place a
  new driver goes (tickets, stat, delete, a short-lived view address).
- **The Vercel Blob path could not be tested from a session.** The
  browser suite runs the identical flow against the local driver; Blob
  itself (client upload, `head`, presigned private reads, the streaming
  fallback) is first exercised on the live site. Check the runtime logs
  for `[storage]` after the first real upload.
- **Deleting a workspace or a job leaves its photos in Blob.** The rows
  cascade away; the files don't. Deleting one photo does remove it.
  A sweep by the `org/<id>/` prefix is the fix when it matters.
- **A crew link or an Editor's link has no upload limit.** Anyone holding
  one can send photos and videos (1 GB each) to that job until it is
  turned off or replaced.
  Fine for a link texted to installers; a per-link daily cap is the fix if
  one leaks.
- **A grant is one folder.** Access to the Main folder does not include
  the job's mini folders; each is granted on its own. A photo's copies in
  other folders are separate rows, so tagging one doesn't tag the others.
- **Deleting a mini folder isn't built.** Folders are made from the bar or
  from Move / Clone and stay; the schema drops a deleted folder's photos
  back into the Main folder (SetNull) and its grants with it (Cascade)
  for when it is.
- **An invited person's link is a password.** Anyone they forward the
  email to can open it at the same level, until it is turned off. Fine
  for property managers and subs; a sign-in step is the fix if a customer
  needs proof of who looked.
- **"Receive in-app messages" is a stored switch only.** There is no
  in-app messaging yet.
- **No billing.** Nothing charges anybody.
- **`AUTH_SECRET` was rotated Nov 5, 2026** (Taylor, in Vercel, all three
  environments, then a redeploy) after the old one was exposed in chat.
  The old value no longer signs anything.
- **`BLOB_READ_WRITE_TOKEN` reads "Needs Attention" in Vercel**: it is
  stored as a readable value rather than a Sensitive one. Re-saving it as
  Sensitive is a Vercel click for Taylor; nothing in the app changes.
- **The GitHub repository is public.**
- Operator access (`isSuperAdmin`) is deliberately unreachable from the app.
  It is only ever set with SQL or `npm run promote-admin`.
- **Contacts and Companies page; the other lists still load every row.**
  Contacts, Companies, their pickers and the company page's People list
  are paged and searched in the database (Sept 13, 2026, proven at
  200,000 contacts by `scripts/browser-tests/load-test.cjs`), and so are
  Products and every product picker (Oct 25, 2026, proven at 50,000 by
  `products-load-test.cjs`). Pipeline, Quotes, Contracts and the
  dashboard still load everything,
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
  has to stay open. Measured Nov 4, 2026 through `slow-db-proxy.cjs`
  (`ROWS=200000 node scripts/browser-tests/import-slow-db.cjs`), every row
  at its own company: 200,000 new rows in 8½ minutes, the same file
  re-imported in 3¼; 3,200 rows in 8 s new and 3 s re-imported. Existing
  contacts and the company fill-ins are written a batch at a time
  (`updateContacts` in `contacts/import-actions.ts`, the three statements
  in `enrichCompanies`); before that a 3,200-row re-import took 61 s. The
  earlier "5 to 10 minutes" was measured without the proxy. A
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
- **The Pipeline loads up to 1,000 opportunities** (newest first) and
  every one of them is a tile; search and the Lead Label filter narrow
  it. Paging per column is the fix when a workspace outgrows that.
- **Stats' time-between-steps skips the steps a conversion jumps.**
  Converting straight to Contract or Won dates only that stage; Quote
  Sent in between gets no date.
- **The 90 / 180-day contract rule runs when the Pipeline or Stats is
  opened.** A workspace nobody opens for a month catches up on the next
  visit, all at once.
- **An import never unassigns, and an explicit assignee takes everyone in
  the file** (Nov 10, 2026; Taylor confirmed Nov 11: "you can takeover
  people and also fill people with no rep"): with a teammate picked, a
  person already owned by someone else is handed over and an unowned one
  is filled; a company already owned keeps its rep. Unassigned leaves
  every existing rep alone.
- **Bulk "all matching" takes 1,000 at a go, in list order, of the ones
  that don't already have that rep.** Past that the bar says how many are
  left; running it again does the next 1,000 (before the Nov 10 audit it
  picked the same 1,000 every time).
- **The Job title filter matches ignoring case, not spaces.** A title
  saved with stray spaces ("Sales  Manager", which the form and import
  allow) is its own choice in the filter; the Labels screen groups it
  with the rest (outer spaces and inner runs ignored), and a rename or
  merge there tidies it.
- **Search matches word by word, so it can find more than a phrase
  would** ("Property Manager" also finds a Community Manager at a "…
  Property Group"). A run of 4–6 digits typed across a dash isn't
  compared digits-only, and digit matches stop at 1,000 per word.
- **The Companies list (12 columns) scrolls sideways inside its card at
  1440**, like Contacts; its scrollbar is at the bottom of the table.
- **The Overview page's recent-activity list leaves marketing sends out**
  (Nov 10, 2026); the contact and company feeds show them with the badge.
- **The Pipeline's Lead Label filter and the opportunity panel no longer
  offer a retired label** (an opportunity carrying one still shows it,
  and the CRM lists can still filter on it).
- **The duplicate finder looks at one rule at a time** (email, phone or
  name), shows ten records a group and merges five at a go, as Merge does.
- **A person linked to a second company is not rolled up there.** Their
  deals, quotes and notes stay with their main company; the linked one
  lists them under People with an "Additional account" tag only.
- **Before any Instant Rollback past the BDR release (Nov 11, 2026), you
  must run `scripts/before-rollback-to-pre-bdr.sql` in the Neon console
  first.** Every time; it is not optional. The release added Connected to
  the status list, and a build from before it can't read a contact or
  company at Connected, so the Contacts and Companies lists, their pages,
  the Pipeline and Stats would all fail to open. The script moves everyone
  at Connected back to Contacted (shown Attempted), on contacts and
  companies, in one transaction. Nothing is deleted: `StatusChange` still
  dates each connect, rolling forward again needs nothing, and it is safe
  to run twice. In order: open the Neon console's SQL editor on the live
  database, paste the script in, run it, and only then click Instant
  Rollback in Vercel. Connected is the only change that needs this (final
  audit D17).
- **A meeting logged Held on a different day from its booking is a second
  meeting.** The booking stays open and keeps asking "how did it go?". Taylor
  has to set the rule: was it that booking, early or late, or a different
  meeting? The same-day case is handled (final audit D12, left open).
- **Talks are counted from the release day.** Calls before it are attempts
  and meetings before it are held (`Organization.outcomesSince`); Stats and
  the Activity report say "Talks counted from <day>". Old lines stay "not
  recorded". `scripts/label-old-attempts.cjs` labels old voicemail and
  no-answer calls from their notes. It is a dry run unless given
  `--apply --org <slug>`, and is for the demo only, with Taylor's yes. A
  missed meeting rebooked counts as two bookings.
- **Pulse and Warmest first are Contacts only.** A company's health is a
  roll-up of its people, and its SQL twin isn't built. Inside a band,
  Warmest first orders by most recent touch, not the exact score. Bulk
  "all matching" on a Warmest-first view takes the first 1,000 by Recently
  added. The Pulse id lists stop at 12,000 (`PULSE_ID_CAP`); past that, the
  smaller pulses narrow a little less.
- **An edited history line never re-runs status moves.** Changing Talked to
  Voicemail fixes the line and leaves the person Connected; Undo on the
  original save is what takes a move back.
- **My day has no single toast slot.** The log sheet, the Book meeting
  sheet and the Meetings card each draw their own "Saved · Undo", and two
  can show in the same spot for up to ten seconds. The contact page and the
  Pipeline have one slot each (`onToast`).
- **The one-to-one email has no daily cap of its own.** Decision 16 keeps it
  out of the 40 a day, so only Resend's plan limit, shared by every
  workspace, stands behind it.
- **The phone lists have no long-press**: a Select button starts Select
  mode. **Contacts has no row expand**: the Pulse meter's popover shows
  every step's date, the counts and the score instead.

## Testing

**Bug audit of a session:** `/session-auditor`
(`.claude/skills/session-auditor/SKILL.md`). Finders per area, dedupe,
one quick skeptic per distinct defect, then fix everything confirmed with
a regression step each, tie it out, and only then the release question.
Built after the Sept 13, 2026 audit took an hour; the short form finds
the same bugs in about ten minutes.

Three browser suites live in the session scratchpad, not the repo (they
should be moved in): the 21-step CRM regression, the approval/operator
suite, and the delete-confirmation suite. **Fifty** (Nov 12, 2026, `apparel-pack.cjs` the fiftieth; `slow-db-proxy.cjs` beside them is a helper, not a suite; among them `looks.cjs`, 17 steps, Nov 10, 2026: Dark and Light from the sidebar switch, the page not moving for it, kept after a reload and a second login, no flash with JavaScript off, seven pages photographed and their text contrast-checked in each, the signed-out pages following the browser's cookie and a saved look winning over it, the phone, the brand colour, the customer's copy untouched) are checked in at
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
Meeting Set, skipped-step dates, the 90/180 rule, Stats), and from Oct
4, 2026 `follow-ups-status-filter.cjs` (17: the Status filter on both
lists and the follow-up box after a logged touch) and
`company-bypass.cjs` (12: the company-page rule, the bypass box, Other
Contacts and claiming, the Notes split), from Oct 7, 2026
`template-replace.cjs` (18: Replace with my own, Restore the original,
the one template in use per type and the Coordinator following it; the
Oct 24 audit fixes — a refused save keeps Type, the in-use box and the
name, Undo after two swaps, an existing workspace's Compliance
Agreement, a newly added type after Save) and `template-import.cjs`
(22: Word / PDF / scan / .doc uploads and Suggest fields; the Oct 24
audit fixes — nothing posted, a 6 MB Word file, Word bombs (also one
not named .xml) and a 301-page PDF refused, ANSI and UTF-16 .txt, line
breaks at the 60,000 limit, a saved full-length agreement checked after
reopening and its contract saved, a cut-off answer, a refusal, a
reworded suggestion dropped, Undo after putting fields into an upload,
the 20-a-day allowance and two clicks on its last one; needs `ANTHROPIC_API_KEY=test-key` and
`ANTHROPIC_ENDPOINT=http://localhost:3998` in `.env`, and answers as
Claude itself, so nothing leaves the machine), from Oct 17, 2026
`job-photos.cjs` (28 since Oct 21, 2026: tag lists and General
Project, tiles, + Add from the uploader, a tile and a phone, stacking
filters, mini folders, Move and Clone and a clone's own tags, deleting
copies and the last one taking the file, the crew link, Grant Access with
the job's accounts, Select all, CRM search and email invites, View only
vs Editor on a person's link, a grant opening its own folder only,
switching level, re-granting, turning off, Members, a paused workspace,
forged tickets; **it needs `STORAGE_DRIVER=local`** and no
`BLOB_READ_WRITE_TOKEN` in `.env`, plus the fake email settings
`password-reset.cjs` uses, because it catches the grant emails on :3999;
without storage every upload is refused as "Photo storage isn't switched on"), and from Oct 21, 2026
`import-ratesheet.cjs` (the Excel fixture with title rows, a Call row,
a unit change and a Discontinued tab; ticks, a typed price, the
import's costs, prices, MSRP, supplier switch and rep; Not on this sheet
anymore; remembered columns; Decline into /admin; + Add New Distributor
with a contact and MSRP less 10%; the product form; the Margin column;
a 3,000-row sheet, 1.5 s through slow-db-proxy; the Sept-14-style audit
fixes of Oct 21 in their own steps; the phone layout), and from Oct 25,
2026 `products-scale.cjs` (18: the Products list's pages, search and
stacking filters, the quote's Add from catalog box, the Create Ratesheet
picker, Order materials at catalog cost after a $0 capture, the phone;
the Oct 25 audit fixes — Enter before the search answers, an early arrow
key, the list above the Payment table, a backslash, a delete keeping the
view, Select all / Show 50 more / Clear matching) and
`products-load-test.cjs` (25,000 products, a 25,000-row import and an
8,000-row same-name apparel sheet, timed; **run it through the slow
proxy**, like `import-slow-db.cjs`), and `account-types.cjs` (34, Oct
25, 2026: the four types at signup and a refused signup keeping them, a
taken email in other capitals, the operator console's pending type,
Approve, Create Account with a duplicate refused and kept, the owner's
email and password, Resend invite killing the old link, the type
select, Settings → General's Request a change / Cancel / two tabs
racing / Decline / Approve / a direct change answering it / a Member,
who is listed in the three supplier pickers and who never is, linking
from the product form, Import Ratesheet onto a same-named supplier with
its rule and contact, a quote line that asks first, forged ids, a
bridge not moved, a merge keeping the link, a paused account losing the
mark, the email throttle, a removed operator, the product form without
JavaScript, the phone; **it needs the fake email settings
`password-reset.cjs` uses**), and from Nov 4, 2026 `catalog-suppliers.cjs`
(38: a second supplier's sheet, the sheet row and its search, See
product list's counts, Cancel, the discount and a bad one, a second tab
saving, Save and accept's adds / take-offs / discount / minimum markup,
a turned-off product ticked back, an older sheet read from its file, the
Suppliers card's star, minimum margin, remove and add, reps kept and
dropped, the list's sub-rows and Below minimum, the any-supplier filter,
the quote line flag, clone, forged ids, the phone; eight steps for the
Nov 4 audit — a $3,000 item and a minimum markup over it (int overflow),
a supplierless product's COGS and MSRP kept, the hold naming the
discounted COGS, an older sheet never re-pricing a newer one's product,
the 2x hold and 62 held lines counted and named, a save cut off part-way,
a returning star's reps, COGS typed without JavaScript, an account picked
by a supplier's own name, "+ Add new" with an existing name, quote-line
rounding, a typed line linked on save, a product changed outside 3a, the
beside count, the new index; and eight for the fixes' own review — a
standing discount kept on new and repaired rows, a page opened mid-save,
None outside 3a, a typed name refused, a lost save re-read, Excel-damaged
part numbers, the newest sheet's tick, a quantity under one, a typed
markup after a save, a sheet's discount after an outside write; and one
for the last review — an outside switch onto a supplier already on the
product, None with a new COGS, a discounted quote line exactly at the
minimum), and from Nov 6, 2026 `variations-pictures.cjs` (30, Release
3b: Add product landing on its page with labels typed and a Box of 12
unit, a price save leaving labels alone, an untick taking only that one,
a retired label kept and refused by name, a tag change dropping units and
Software offering no workspace unit, pictures made small in the browser,
Make main, a Color, Safari's missing WebP faked so a cut-out lands as JPEG
on white, the six cap, Remove closing the gap, the list's thumbnail and
counts, clone and delete with shared files, a quote line's labels / unit
/ picture, the customer's copy, Send quote (Just mark it sent) freezing pictures, a rename
and another line's edit leaving a sent quote alone, a label offered back,
a removed picture kept for the sent quote and dropped from a draft, an
enum unit written by older code winning, the draft PDF with its picture,
the Coordinator and the contract printing labels, Order materials' purchase
order carrying them with its body at cost, Labels & Units as a Member and
as an Owner; three steps for the Nov 6 audit — Mark accepted keeping the
picture a sent quote went out with, the editor showing pictures after
the quote is sent, Back to draft letting go, another tab's label kept through a
refresh, a tag changed back keeping units, twelve labels on one line, a
typed line linked by name taking the picture, a row signed with no labels
staying that way on the purchase order, per-product counts; **it needs
`STORAGE_DRIVER=local`** like `job-photos.cjs`).
From Nov 11, 2026 (the BDR redesign): `connected.cjs` (59: outcomes,
Connected on the ladder, the lastConnectAt triggers, Held / No-show /
Reschedule, reasons, next steps and Undo; twenty-nine "audit fixes"
steps), `health.cjs` (34: every health state, the main button per stage,
⋯ More, the history by day, Pulse and Warmest first against each person's
own meter, and `health-check.ts`), `how-did-it-go.cjs` (24: the log sheet
and the Book meeting sheet, the dial return, the Done box, the phone
sheet), `company-page.cjs` (24), `myday.cjs` (43: My day, Team today,
goals, the Agenda and the calendar toolbar, the phone tab bar) and
`round2-pages.cjs` (10: history Edit, Coming up rows, the phone meter
sheet, Book it, + Event, Add person on a phone, one toast slot, the
company's Book tile). **`calendar.cjs` steps
29 and 30 read the Coming up card and pick the roofing day by its date**
(Nov 6, 2026): a seeded November day now behind us sits under Already
been. Since Nov 10, 2026 the suite is built around **August 2027** (moved
from November 2026 once that month was no longer ahead; both start on a
Sunday and the months before them line up). Move it again, keeping that
alignment, before August 2027.
`products-load-test.cjs` also opens, searches, clears and re-ticks the
25,000-line sheet through the slow proxy (open 1.2 s, all off 25 s, all
back 81 s; the 25,000-row import is 26 s, up from 9 s, for the supplier
rows and the kept lines), and from Nov 6, 2026 every product with eight
labels and a picture (the list and its 100-row page inside budget) and a
200-line sent quote with labels, a workspace unit and pictures opened and
saved through the proxy. That page is about 1.4 MB before compression
(1.0 MB before 3b: every row carries the supplier list), so it has a 2 MB
budget where every other page has 1 MB. Saving it takes about 5 s end to
end through the proxy (4.9 s without 3b's labels), of which the
all-or-nothing transaction — one write per line — is 3.8 s; **that
transaction now has 20 s** (`saveLineItems`), and the load test fails if
it ever holds more than 5. **`calendar.cjs` no longer assumes November
2026 is in the future** (Nov 4, 2026): it clears the Contract sent /
closed entries its seed contract writes on the real today, and paging
into its month may land on today.
`reports.cjs` (Nov 10, 2026, 33 steps: the five reports' numbers against
the seed and SQL, the pickers, the write-up and its cache, a stand-in Claude
on :3994 through a second server it starts itself on :3113, Email me this,
My report emails, the cron's secret and a forced Monday-6am run caught on
:3993, the phone; `LOAD=200000` adds the at-scale timings) **needs, in
`.env`, `RESEND_API_KEY`, `EMAIL_FROM`,
`RESEND_ENDPOINT=http://localhost:3993/emails`, `CRON_SECRET=test-cron-secret`,
`REPORTS_TEST_CLOCK=1` and `APP_URL` set to the server's own address**, and
no `ANTHROPIC_API_KEY`. `REPORTS_TEST_CLOCK=1` lets the cron take a `now`
for the test (never honoured on Vercel's production, and only with the
secret).
`overlay-readability.cjs` step 6 (the deal picker on a new quote) used
to pass one run in three: it photographed the panel while the page was
still fading in. It waits for the fade now (Oct 25, 2026); **a pixel
check on anything right after a page opens has to wait for
`document.getAnimations()` to settle.**
**A suite that logs on a
company page with nobody ticked must tick `company-bypass-tick` first**
or the log is refused. A suite that
seeds and sends paperwork now gets calendar entries written for it, so
**scope any `CalendarEvent` lookup to the type it means** — the old
calendar suite's first-row read picked up "Contract sent" instead of the
install it booked.

**The AI release's suites (Nov 12, 2026)**: `ai-release-a.cjs` (30),
`ai-release-b.cjs` (34; runs `scripts/contract-checks-check.ts` first) and
`ai-release-c.cjs` (29) answer as Claude through
`scripts/browser-tests/fake-claude.cjs` (a helper, not a suite) on :3995,
which picks each reply by the request's `x-scb-ai-kind` header, never by
prompt text: `claude.reply(kind, value)`, `refuse`, `cutOff`, `garbage`,
`fail(kind, status)`, `last(kind)` (its `text`, `images`, `documents`).
**`reply()` sends any object with a string `text` field as a raw reply**,
so an answer whose own JSON has a `text` key goes as
`{ text: JSON.stringify(value), stop: "end_turn" }`. Each starts its own
keyless server from the same build for its "AI off" steps (`NOAI_PORT`
3116, 3117 and 3127). Run them with `run-suites.sh "ai:ai-assist,ai-release-a,ai-release-b,ai-release-c,apparel-pack"`.
Release A's suite fakes speech with an init script defining
`window.webkitSpeechRecognition` (`FAKE_SPEECH`). A suite that sends a
contract waits for the send to land (Mark signed, or the database), never
for the word "Sent": the send reads the contract over first. A suite that
creates contracts on the Coordinator gets the price-check list whenever a
rule fires: assert it (`price-check-item` `data-code`), then
`price-check-create-anyway`. `load-test.cjs` seeds contact ids as `lp`
plus 8 digits because a later step reads `right(id, 2)::int`.

`apparel-pack.cjs` (Nov 12, 2026, 37 steps; seven "audit fixes" steps) starts the stand-in
Claude on `FAKE_CLAUDE_PORT` (default 3995) for the look-alike check, so it
runs in the runner's `ai` group, and needs `STORAGE_DRIVER=local`. **A suite
that presses keys on the proof sheet's logo box waits for the sheet's own
focus first** (`nudge()`): the sheet focuses its first button a frame after
it opens and took the key press.

The apparel audit (Nov 12, 2026): 18 flagged, 15 distinct, 13 confirmed and
fixed, 2 refuted. Lessons worth keeping:
- **Compare stored JSON through the same reader on both sides.** Postgres
  jsonb hands an object's keys back in its own order (shortest first), so
  `JSON.stringify(raw) !== JSON.stringify(readSnapshot(raw))` is always true
  and every labelled line looked "changed".
- **A draft edited in place keeps its id**, so a stale-tab guard on the id
  alone lets the second save win; guard on what changes per save (the
  token).
- **Anything printed into a PDF uses a JPEG copy.** Headless Chrome
  re-encodes WebP losslessly at full size, and a few proofs passed the 4 MB
  cap.
- **A component kept mounted across a refresh keeps its state**: a
  "thanks" that replaces the form hid the proofs still waiting.
- **Dates in a client component go through `formatDate(..., timeZone)`**,
  never `toLocaleDateString`: the server and the browser disagreed and React
  threw a hydration error.

`ai-assist.cjs` (Nov 10, 2026) answers as Claude on :3995 (set
`ANTHROPIC_API_KEY=test-key` and `ANTHROPIC_ENDPOINT=http://localhost:3995`
in `.env`); its "AI off" step needs a second server started with an empty
`ANTHROPIC_API_KEY=` passed as `NOAI_BASE`, and is skipped without one.
`quotes-improvement.cjs` step 25 picks the rep straight after a reload and
can beat hydration on `next dev`; it passes on a production build.

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

`crm-data.cjs` (Nov 10, 2026) is the thirty-seventh: marketing never a
touch, reps and Added by, the import's assign-to, bulk assign with the
1,000 cap, every new list filter, the CRM Labels screen, the duplicate
finder and the phone. It needs email switched on like
`email-marketing-users.cjs`; both now take `CATCHER_PORT` so two
sessions can each catch their own mail. **`crm-pipeline-stats.cjs` step
13 is flaky** (Nov 10, 2026, seen on the base branch too): the
full-page screenshot right before the second Save sometimes closes the
status dates panel; a rerun passes.

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
`src/lib/forms.ts`). The product form goes further (Oct 25, 2026): it
keeps `action` for a post before the JavaScript loads, but its onSubmit
prevents the default and sends the same FormData in a `startTransition`,
which React does not follow with a reset. The reset had been putting
every controlled `<select>` back on the option the page loaded with —
tag, unit and distributor showed old values after a save and the next
Save wrote them back. A form full of controlled selects should do the
same.

The Nov 10, 2026 audit of the combined CRM release found 22 confirmed
defects (28 flagged, 23 distinct, 1 refuted); each has an "audit fixes:"
step in its module's suite. Five lessons worth keeping:
- **An edit form that stays open after a save needs its uncontrolled
  selects keyed by the saved value** (`RepField` keys on the rep): React
  resets the form after the action, and a select goes back to the option
  it was mounted with while hidden "original" inputs move on.
- **Prisma's `mode: "insensitive"` applies to `not` as well.**
  `{ equals: "VIP", mode: "insensitive", not: "vip" }` excludes "VIP" too;
  compare "everything but this exact spelling" in SQL.
- **`history.replaceState` must be passed `null`, not
  `window.history.state`** (Next's own state makes its router skip the
  sync, and the next server action puts the old address back).
- **A portal still bubbles React events to the component that rendered
  it**, so a dialog opened from a clickable tile must stop clicks, and an
  Escape listener on a dialog above a panel must listen in the capture
  phase and stop there.
- **"6am" is a wall-clock time, not midnight plus six hours** — on the
  spring-forward day that's 7am. Use `zonedHour` in
  `src/lib/reports/period.ts`.
Also: a "last touch" stored on the row leaves out activities dated ahead
(`crm_touch_due` puts them on once their time comes), "gone quiet" never
includes an opportunity with a meeting still to come, and "all matching"
bulk Assign only picks records that don't already have that rep.

The Nov 10, 2026 UX review walked a seeded sales team (demo workspace
"Summit Low Voltage", slug demo-summit, in scb_test) through the BDR day
on phone and desktop, Dark and Light: 128 findings, 34 distinct confirmed
bugs, all fixed with "audit fixes (UX review): …" steps in their module's
suite (the step counts quoted elsewhere in these notes predate it; the
suites are the source). The redesign it proposed (Connected, the
lifecycle meter, health) was approved and built on Nov 11, 2026 ("The BDR
redesign, built" under What is already built). What the fixes taught:
- **Anything with a transform, filter or backdrop-filter is the box its
  position:fixed children are placed against, and so is an animation that
  keeps a transform after it ends.** `.fade-up` ran with fill-mode `both`
  and every in-place dialog opened in the middle of the whole page column,
  far below the screen. Entrance animations use `backwards`; in Dark,
  `.card:has(.modal-backdrop)` drops the glass blur while a dialog is open
  in it. A new dialog should still render through a portal on
  document.body. overlay-readability.cjs checks every in-place dialog.
- **Light outlines clear 3:1** (`--border` slate at 0.5, `--border-strong`
  0.6). **A line that only separates uses `--hairline-3`**, never
  `--border`: one-sided borders, `divide-*`, card and dialog header
  underlines, table header lines. Chart gridlines use `--chart-grid`.
  A focused field in Light gets the darkened brand edge; a disabled
  `.btn-primary` in Light is grey with `--text-dim` words, not faded.
- **A grid item holding a `truncate` line, a wide table or a form needs
  `min-w-0` (or the grid `grid-cols-1`)**, or the page widens on a phone.
  Test phone layouts with `isMobile: true`: a phone browser widens the
  layout viewport instead of showing a sideways scrollbar.
- **Anything that hangs off a button is a FloatingMenu** (filter menus,
  Add person). Its panel is hidden the frame it takes to place itself, so
  `autoFocus` inside does nothing: focus in a requestAnimationFrame. The
  filter menus steer the keyboard with FocusGuard stops; menus are reached
  in tests by their `<button testid>-menu` testid, not as DOM siblings.
- **A form that can sit in a narrow column lays out by its own width**
  (Tailwind container queries, `@container` + `@sm:`), as EventForm does.
- **SVG charts draw at their real pixel width** (`useBoxWidth` in
  stats/charts.tsx), never a fixed viewBox scaled by `w-full`, so labels
  stay 11px on a phone.
- **"N days ago" is counted on the workspace's calendar**:
  `daysSince(date, timeZone)` takes the zone.
- **A rise from zero reads "new this period"** (plan R0, Nov 11, 2026;
  "▲ up from 0" before), through `changeSize()` in reports/format.ts:
  Stats tiles, report tiles, the report email and the write-up alike;
  never "100%" or "vs 0". A fall below zero on a net figure reads
  "▼ down from $0".
- **One touch logged on several people is one row each with a shared
  batchId**: anything counting or listing touches across people counts
  `COALESCE(batchId, id)`.
- **Search is word by word** (`searchTerms`, up to 6 words); a search
  that is a phone number (7+ digits) is also compared digits-only on the
  last 10 (`phoneSearchDigits`, `contactIdsByPhone`) using the hand-made
  trigram expression indexes in `20261110231500_list_search_phone`.
  **`prisma migrate dev` will offer to drop them; take those lines out.**
  The lists' `q` keeps `% _ \` (`cleanListSearch` + `likeText`); the
  pickers still use `cleanSearch`.
- **Signing a contract, Mark as signed and Award without paperwork accept
  the source quote** (`acceptSourceQuote` in src/lib/quote-accept.ts, kept
  out of "use server" files). The catch-up for deals signed before
  it is the migration `20261111140000_paperwork_accept_signed_quotes`,
  which runs on release by itself and touches only quotes still Sent, so
  a second run changes nothing. The hand-run script is gone.
- **Send quote** (Mark as sent until Nov 11, 2026) is refused with no
  saved line items, and waits while any card on the quote (lines, payment
  table, details) has unsaved edits. Delete quote and the calendar's trash ask
  first, with Yes away from where the trash was. The opportunity panel's
  Stage menu saves the panel's edits first.
- Lead label fills are Taylor's; built-in chips use black letters, N/A
  #991b1b on #d4d4d8, and a hue used as words goes through
  `leadLabelInk()`, never opacity.
- A component that copies a prop into state (OwnerSelect, RepField) is
  keyed by that prop wherever something else can save it.

**The BDR redesign: Taylor approved every recommendation (Nov 11, 2026).**
The plan is the "BDR Flow Redesign" page (claude.ai artifact
YTVnpnoQPVMcUeE4cKseiW, source in that session's scratchpad). What he
said yes to, so later work doesn't ask again:
1. Connected = a live talk, a reply by text or email, a held meeting, or
   booking one. Voicemail, no answer, busy, front desk, wrong number, an
   unanswered text or email and a no-show are attempts. One-tap outcome
   chips; old history is never guessed (old calls are attempts, old
   meetings held; Stats says "Talks counted from <launch day>").
2. Connected becomes a real status (CONNECTED between CONTACTED and
   INTERESTED), in its own small release after the outcome chips ship.
3. "Contacted" is shown as "Attempted" (label only; the value and CSV
   import stay CONTACTED).
4. Meeting Completed is set automatically when a meeting is logged Held or
   ticked done (asking first when the date is still ahead).
5. The follow-up box's "Meeting" tick becomes "Try to book a meeting", a
   reminder that moves no status; booking goes through a Book meeting sheet.
   (This replaces the Oct 4 rule.)
6. Health shows as a word and colour; the 0–100 number only on hover or
   long-press, as a breakdown.
7. Health colours are fixed on every tenant (teal / amber / rose / grey),
   not the partner's brand.
8. People never reached are "Trying": grey, amber when stalled, never red,
   no number.
9. Members land on a new "My day" tab; Owners and Admins keep Daily
   Rundown with a Team today strip on top.
10. Old activities stay "not recorded"; the voicemail-labelling script runs
    on the demo only.
11. Optional team goals (tries, talks, meetings booked) set by Owners and
    Admins in Settings → General; until set, the rings show "vs last week".
12. Suggest parking a lead after 6 tries with no connect; parking only books
    "Try again in 30 days".
13. The rep who booked a meeting gets credit for it being held (needs a
    bookedById on the meeting); the deal and its money stay with the deal's
    rep.
14. Not interested and Lost ask for an optional one-tap reason (Price ·
    Timing · Has a vendor · No budget · Other).
15. A Member can bulk "Assign to me" a teammate's records, with a confirm
    naming the owner and an Undo.
16. The Email button on one contact's page becomes a one-to-one send that
    counts as a touch (no template, no unsubscribe footer, not in the 40-a-day
    limit); the marketing sender stays exactly as it is.
17. Members open lists, the Pipeline and the Calendar on "Mine", with
    Everyone one tap away; everyone still sees everyone.
18. Up next offers unowned leads ("43 new leads nobody owns · Take 10"):
    a manual claim with confirm and Undo, never automatic.
19. Build Quote leaves the deal at Meeting Completed until the quote is
    sent; Manual Input still moves it straight away.
The renames and moves listed per release in the plan are approved with
it. Each release still goes live only after his "Ready to go live?" yes.
All nineteen were built together on Nov 11, 2026 (decision 2's Connected
shipped with the outcome chips, not in a release of its own) and wait on
that yes as one release; see "The BDR redesign, built".

**Taylor's decision on the Pipeline's columns (Nov 11, 2026).** The
Pipeline keeps Won and Lost as two columns. Group headings sit above the
columns: **BDR** over Meeting Set and Meeting Completed, **Closer** over
Quote Sent and Contract Sent, **Closed** over Won and Lost. Never merge
Won and Lost into one column. This replaces the plan's single Closed
column; on a phone the Closed tab already shows Won and Lost, each under
its own heading.

The BDR sprint and its final audit (Nov 11, 2026): six area audits
(data, money, pages, pipeline, today and lists) found 142 distinct
problems, confirmed 119 and fixed 107 in their own areas, each fix with an
"audit fixes:" step in its module's suite. Most of the ones that lived in
another area's files were fixed after the merge, with steps of their own;
what is still open is in Known gaps. Lessons worth keeping:

- **Never wait on every animation's `finished`.** The header meter's
  current step breathes forever (`lmBreathe`), so
  `Promise.all(document.getAnimations().map(a => a.finished))` never
  resolves, and `page.evaluate` has no timeout: pipeline-opportunities sat
  for 11 minutes. Use `settle()` from `pipeline-opportunities.cjs`:
  networkidle, then every animation finished or infinite.
  `deal-tracker.cjs` and `quotes-improvement.cjs` still use the old wait,
  on pages with no meter; move them over when touched.
- **Settle before measuring.** The dashboard's `.fade-up` moves every page
  6px as it opens, so a box measured mid-fade has float edges: a 44px
  button reads 43.99997px. Any size or pixel check right after `goto`
  calls `settle()` first.
- **The shared sheets cover the page.** After a plain log, How did it go?
  stays open on its next step: press Escape or click `follow-up-skip`
  before touching anything under it. A toast's words change ("Booked"
  becomes "Undone"), so find Undo by its words.
- **Where the redesign moved things, for suites.** Contact page: New quote,
  New contract, Edit, Add deal, Additional Account, the status picker and
  Delete are under `record-more`. From Meeting Completed, Add deal is under
  `paperwork-more` → `paperwork-add-deal-open`. Industry · Type, Title,
  Birthday, City and State are under Reach → `more-details`. Setting
  Meeting Set by hand there needs `status-set-anyway` past the Book it
  offer. Email is `contact-email-button`, the one-to-one window; the
  marketing window is `one-to-one-use-marketing` after it, and only for a
  contact with an email. Company page: tags, phone, email, website and
  address are in the folded `company-details` (`company-details-toggle`;
  open only when the app auto-filled them). People are Who to call
  (`person-row`, then `who-show-all`, 50 a page). On both pages
  `page.locator("dl").first()` now reads the wrong list.
- **More moved controls.** Pipeline: Move to… is `tile-more` →
  `tile-move-menu`. The rep is `tile-rep` (`data-owner-id`), changed in
  `panel-rep`. Quotes are in the panel. The journey strip is
  `panel-journey` → `deal-journey`, with `journey-next`. Lists: Import CSV,
  Merge and Fill in missing are `cleanup` then
  `cleanup-import|merge|fill` (Find duplicates is `find-duplicates` in the
  same menu; on a phone, Email is `cleanup-email` there too). A filter is reachable only after
  `filters-toggle` (`openFilters`). Quote: `send-quote` then
  `send-quote-mark`. There is one `quote-save` (`quote-save-phone` on a
  phone). Wait for a details save by the exact text "Quote details saved"
  ("Unsaved changes" contains "saved"), and for the whole bar by "All
  changes saved" in `quote-save-status`. Coordinator: a first contract
  starts with every row ticked (Contract A's Clear for a subset), and its
  template, direction, terms and title are behind `column-change`.
- **Read a money tile by its label, exactly.** The Overview's tiles are
  whole dollars ($13,234.50 shows as $13,235), so match
  `[data-testid=stat-tile][data-label="Owed to you"] p.num`, never page
  text with cents.
- **Only one of the phone cards and the desktop table is in the page**
  (`ResponsiveList`). The server picks by user agent and the width decides
  after load: at a narrow viewport without `isMobile`, wait for
  `contact-card` / `company-card`.
- **The calendar remembers Mine** (`calendar.scope`) for a bare address
  only. A suite that clicks Mine clicks Team after it, or later bare visits
  show one person's days. A filter other than Users ignores the remembered
  Mine, so a shared link means the same thing to everyone.
- **A "Search people and companies" button is on every page**, so
  `getByLabel("Search people…")` needs `{ exact: true }`.
- **The Agenda draws at most 60 entries a day** (`loadAgenda` in
  `src/lib/calendar-data.ts`), with "Showing 60 of N · Show all" opening
  that day in Week, and folds done entries behind "n done". Drawing every
  entry of a busy team day (2,204 rows, 4 MB of HTML) took 3 s in the
  browser at 200,000 contacts.
- **A CTE the planner sizes at 1 row is read with `IN` / `NOT IN`, not
  `EXISTS` / `NOT EXISTS`** (`my-day/load.ts`, 3.8 s → 0.13 s), or
  aggregated once with a UNION ALL (`gone-quiet.ts`). Otherwise every join
  onto it becomes a per-row loop.
- **pipeline-opportunities step 19 (a drag to Quote Sent) can time out once**
  with "element is not stable": the board scrolls sideways under the
  drag. It passes when run again; a person's drag isn't affected.
- **A fresh machine:** `bash scripts/browser-tests/setup-db.sh <db name>`
  starts Postgres on 5433, makes the database, writes `.env` if it's
  missing, generates Prisma and applies every migration.
- **After a merge, check the suites both sides edited.** Run `node --check`
  on every suite and look for a helper defined twice in one scope. The same
  name inside separate `page.evaluate` bodies is fine (`looks.cjs`' colour
  maths).
- **A full run is one production build and six server starts, through
  `scripts/browser-tests/run-suites.sh`.** Run `npx next build` first, then
  `DB=<database url> bash scripts/browser-tests/run-suites.sh <group…>`.
  `DB` is required. `PORT` (default 3400) is where each group's server
  starts, and the runner stops whatever already holds that port, so give
  each session its own. `LOG` (default `/tmp/sprint-run.txt`) gets one
  PASS or FAIL line per suite, with a failure's last 30 lines; each
  suite's full output lands beside it as `<log>-<suite>.log`, and the
  server's as `<log>-server.log`. Every server gets
  `STORAGE_DRIVER=local`; each group adds its own stand-ins. Suites are
  named without `.cjs`, separated by commas:
  - **`plain:a,b`**: the suites named, on a plain server. List every suite
    not in another group, `round2-pages` included.
  - **`email:a,b`**: fake Resend on :3999 for `password-reset`,
    `account-types`, `email-marketing-users` and `job-photos`, plus
    `crm-data` (the runner gives it `CATCHER_PORT=3999`).
  - **`reports`** (`reports.cjs`), **`ai`** (`ai-assist.cjs`, :3995) and
    **`template`** (`template-import.cjs`, :3998) take no list; the runner
    starts their server with the settings described above.
  - **`load`**: `load-test.cjs`.

  `products-load-test.cjs` and `import-slow-db.cjs` run through the slow
  proxy, outside the groups. After round 2 the 44 grouped suites,
  `npx tsx scripts/health-check.ts` (leadHealth's 140 fixtures through the
  SQL twin, the loader and the list filters) and
  `npx tsx scripts/up-next-check.ts` all passed.
- **The try / talk rule is written in several places**: `isConnect` in
  `src/lib/constants.ts`, the triggers, `health-load.ts`, `health-sql.ts`,
  `stats.ts`, `reports/activity.ts` and `reports/daily.ts`. A try is a
  non-marketing touch that has happened and isn't a no-show. One save is
  one try (`COALESCE(batchId, id)`). Change them together;
  `health-check.ts` fails if the SQL twin drifts from `leadHealth()`.
- **An Undo records what it changed and never guesses from time**
  (`OpportunityMeeting.outcomeUndo`, `stashMeeting` in
  `src/lib/undo-log.ts`). A save's writes are those between its batchId's
  stamp and two minutes after its last row. Only whoever made it, or an
  Owner or Admin, runs it, and a save with nobody on record needs an Owner
  or Admin.
  - What Undo acts on comes from the server: the batch's own rows or a
    signed record (`src/lib/claim-token.ts`), never ids from the browser.
  - An Undo takes back everything its toast names, or isn't offered.
  - Its toast is keyed per action, expires, and lives outside anything its
    action can unmount.
- **Status moves go through `moveRecords`** (`src/lib/status.ts`): one
  statement per starting status, only rows still at it, and StatusChange
  rows for exactly those. Never read a status and then `updateMany` it.
  Contacted and Connected never lift Lost.
- **A public link's action re-checks state in the write itself.** Sign and
  accept write WHERE status is what they expect, and treat a count of 0 as
  "someone else won", so a double tap awards once. `/c` carries the
  `sentAt` of the copy the customer read, and a stale one is refused.
- **Postgres, learned this sprint:**
  - An `UPDATE … FROM (SELECT … FROM the same table)` merge loses writes
    under concurrency; merge against the target row.
  - Anything taking ACCESS EXCLUSIVE (`ALTER … SET DEFAULT`) holds it until
    the migration file commits, so it goes last.
  - One log on many people is one `createManyAndReturn`, never an array
    `$transaction`.
  - Prisma refuses an `in` list past about 32,000 values (P2029).
  - A per-row JSON subquery can price a big statement into JIT; use
    `SET LOCAL jit = off` inside a `$transaction`.
  - An index-plan check on a small test table needs `enable_seqscan`,
    `enable_sort` and `enable_bitmapscan` off.
  - A new enum value breaks Instant Rollback once a row uses it.
- **Dates and times.** A booked meeting's moment is its entry's day and
  time in the workspace's zone: `zonedMoment(day, time ?? "12:00", tz)`
  wherever a meeting entry is written or moved, never a bare day (midnight
  UTC is the evening before in the US). Never count "booked" by
  `createdAt`: use the earliest of the row, its line and its day, and count
  each meeting once.
- **Fixed things on a phone.** The tab bar shows below `lg`. A bar or toast
  at the foot sits on top of it with `bottom: var(--phone-tabbar-h, 0px)`
  (set by the dashboard layout); test with `elementFromPoint` on the tab
  bar. The phone top bar scrolls away with the page, so sticky headers can
  use `top-0` (the Pipeline's stage tabs still measure it).
  - A position:fixed child is also trapped by a `.card` (its blur), a size
    container (`container-type`) and a still-running `.fade-up`. Pinned
    buttons go outside the card or through a body portal.
  - The dashboard layout puts the tenant's `--brand` on `<body>`, so a
    portal needs nothing extra.
  - The brand colour is never the colour of small words: mark the active
    thing with a bar or an icon, and keep the words `--text-strong`.
- **The keyboard on floating panels.** A FloatingMenu opened from a button
  uses `usePanelFocus` (`src/components/panel-focus.ts`). A menu of buttons
  uses `useMenuFocus` (`lead-label-chip.tsx`): focus two frames after
  opening, arrows / Home / End, and focus back on close.
  - A panel with menus over it ignores Escape and Tab while another
    `[role=dialog]` or `.modal-backdrop` is open outside it.
    `stopPropagation` can't help, because FloatingMenu listens on document
    too.
  - A capture-phase key listener stands down when a child window takes
    over.
- **Server rendering.** A "use client" component that opens by default
  still renders on the server, so anything it portals into `document.body`
  waits until mounted: `/dashboard/email/to/<id>` answered 500, and the
  panel opened by `?open=` waits through `useSyncExternalStore`. React also
  mounts a closed `<details>`' children, so My day's Team & money is built
  only while its remembered state is open. A `"use server"` export no
  client imports has no action id; harden it anyway.
- **State in the sheets and panels:**
  - State set after an `await` inside `start(async …)` isn't part of the
    transition. Wrap it in `start(() => …)`, or the next step draws with
    `pending` still true ("Saving…").
  - A callback that needs something loaded in the background reads it from
    a ref (`ctxNow`).
  - A count shown after a save is read after the save; the park offer was
    one try behind.
  - A remembered dial tap is spent when the sheet opens by any route.
  - A panel that re-reads after a sheet's save merges into its form:
    untouched fields follow, and new people join.
  - A panel writes the rep only when it was changed there
    (`ownerOriginal`).
- **A thrown server action doesn't mean nothing happened.** The answer can
  be lost after the email went, so never say "nothing was sent".
- **A card that joins the quote's one Save**
  (`useQuoteSaveSection(key, { label, order, dirty, pending, save })`) also
  needs its own Save on a phone, where the foot bar is hidden
  (`PhoneSaveHere`).
- **Numbers tables on a phone:** put `table-stack` on the table and
  `data-label` on every cell after the first.
- **A suite that clicks a button whose label changes while pending**
  ("Sign contract" → "Signing…") waits for that label to go, or for the
  database, before reading.
- **"audit fixes" steps can collect failures and throw once at the end**,
  so one run against the old code shows every step failing (`AUDIT_SOFT=1`
  in `connected.cjs`).

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
