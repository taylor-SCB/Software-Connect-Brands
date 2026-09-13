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
Purchase Order, Sales Order, Invoice, Compliance Agreement), the **Deal
Tracker** (Pipeline → Deal Tracker and Contracts → Deal Tracker, same page:
split a quote's rows into up to five contracts, each to its own company
and contact with a template, payment terms and a payment preset; rows read
Open / Sent / Signed / Cancelled; contracts get line items, a payment
schedule that autocalculates, a "Your Company Signer", cancel/reopen and
copy-and-log reminders; Sept 10, 2026), PDF export for both, per-workspace
branding and time zone, Settings → My Account (title, mobile, avatar,
change password) and Company Information (General, Branding with logo
upload, Company Users, Compliance and Marketing file uploads), company
logos and contact photos, and an operator console at `/admin` where signups
are approved, paused or deleted.

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

- **No email is sent, ever.** No approval notice, no receipts, and **no
  password reset** — a forgotten password today means editing the database
  (a logged-in user can change their own under My Account). Everything else
  waiting on email is blocked behind this. That includes ratesheets:
  "Send to partner" makes a link to copy and text or email by hand, and
  the Deal Tracker's "Copy reminder", which copies a nudge with the signing
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
  and the **New quote, New contract and Deal Tracker pages still ship the
  whole contact list to the browser** for their pickers. Fine at demo
  scale; the next thing to fix for a workspace that has imported a big
  CRM.
- **The import runs in the browser tab.** Any size works, but the tab
  has to stay open (about 5 to 10 minutes for 200,000 rows). A
  background job is the answer when a customer needs to walk away or
  schedule syncs; it needs file storage (Vercel Blob) and a queue.
- **A signed contract records only the name typed and the time.** Enough for
  ESIGN/UETA, thin if one is ever disputed — no IP address, no email
  confirmation.
- **"Who can send?" on a template can only list the workspace's one user.**
  There is no way to invite a teammate yet, so the list is one name long
  until team logins exist. The setting and its enforcement are built.

## Testing

**Bug audit of a session:** `/session-auditor`
(`.claude/skills/session-auditor/SKILL.md`). Finders per area, dedupe,
one quick skeptic per distinct defect, then fix everything confirmed with
a regression step each, tie it out, and only then the release question.
Built after the Sept 13, 2026 audit took an hour; the short form finds
the same bugs in about ten minutes.

Three browser suites live in the session scratchpad, not the repo (they
should be moved in): the 21-step CRM regression, the approval/operator
suite, and the delete-confirmation suite. Four more are checked in at
`scripts/browser-tests/` with run instructions at the top of each file:
the 27-step products + ratesheets suite, the 21-step companies +
contacts suite (Sept 9, 2026), the 21-step contracts suite and the
27-step deal tracker + settings + uploads suite (both Sept 10, 2026),
the 17-step contacts import + filters + favorites suite and the
200,000-row load test (both Sept 13, 2026; the load test seeds in SQL,
takes several minutes, and must stay under its 2-second page budget).
Each signs up its own workspace and scopes its lookups to it, so they can
run back to back; still run them one at a time. All of them run against a local Postgres
on port 5433 and must pass before anything is pushed. That local database
is the only safety net between a change and paying customers.

Standing up that Postgres in a fresh session: the binaries are at
`/usr/lib/postgresql/16/bin`; `initdb` into a short path such as
`/tmp/scbpg/data` as the `postgres` user, start it on port 5433, create
`scb_test`, then put `DATABASE_URL=postgresql://postgres:postgres@localhost:5433/scb_test`
and an `AUTH_SECRET` in `.env` (git-ignored) before `npm install`.
