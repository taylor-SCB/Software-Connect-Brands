# White-Label CRM

A CRM that small service businesses can put their own name and colors on.
Each business gets its own workspace ("organization") with its own
contacts, products, quotes, contracts and branding — nobody else can see
their data.

## Stack

- **Next.js** (App Router) + **TypeScript** — pages and backend logic in one project
- **Prisma** + **PostgreSQL** — the database
- **NextAuth (Auth.js)** — login/signup, using email + password
- **Tailwind CSS** — styling

## Running it locally

**Just want it on the internet?** See [DEPLOY.md](./DEPLOY.md) — a
click-by-click guide that needs no terminal.

To run it on your own machine you need Node.js 20+ and a PostgreSQL
database:

```bash
npm install
cp .env.example .env      # fill in DATABASE_URL and AUTH_SECRET
npx prisma migrate dev    # creates the tables
npm run dev
```

Open http://localhost:3000, click "Create your workspace," and sign up.
Signing up creates a new organization, makes you its owner, and seeds your
two starter contract templates.

## What's in it

**Contacts** — a person: name, title, company (picked from or added to the
Companies list as you type), email, phone, website, birthday, city and
state. The list shows the company, a notes counter and a counter for each
activity type (text, email, phone call, meeting). The contact page is the
hub: log activity, add notes, open deals, and see every quote and contract
for that customer. Notes take an optional label (General, Personal,
Birthday, Hobbies, Family); the **Personal** switch on the notes feed
gathers the personal ones. **+ Include multiple contacts** on the note and
activity forms logs the same entry on several people at once. The
**Activity overview** box on the right counts every touch, shows the last
one, the open pipeline and the quotes out.

**Companies** — a business you sell to, with the people who work there.
Name, phone, email, website, city, state and status. A company page rolls
up notes, activity, deals, quotes and contracts from its people (each
entry names the person) and takes notes and activity of its own. A
residential customer is a contact with no company; nothing downstream
requires one. Typing a company name on a contact creates the company.

**Pipeline** — deals by stage (Lead → Contacted → Quote Sent → Contract
Sent → Won / Lost) with per-stage value totals. A deal is one job you are
trying to win. Every quote belongs to a deal (a deal can carry several,
say a per-hour and a per-day labor option), a contract may. Sending a
quote or a contract moves the deal forward on its own, a signed contract
wins it, and a deal's value is read from its quotes — the accepted one,
else the latest one the customer hasn't declined. The typed estimate only
counts until a quote exists.

**Back links** follow the rule *how I got there is how I go back*: the
link at the top of a record points to the page you came from (a quote
opened from a contact goes back to that contact; the same quote opened
from the Quotes list goes back to the list). The trail lives in the
browser tab (`src/lib/trail.ts`); form pages are skipped, so creating a
quote from a contact still lands back on the contact.

**Products** — the catalog you quote from. Each product carries a
description, SKU, default tag, OEM / manufacturer, COGS (cost, shown on the
owner's list but never to customers or partners), unit price and a unit of
measurement. The unit list follows the default tag — a Labor product picks
from the Labor list, Materials from Materials, Software from Software;
Project Services, Shipping and Taxes carry no unit — and a software unit
adds a rate and term with the total worked out on screen. A product can
name its distributor and the people there — name, email and phone — picked
from per-workspace lists that grow from the form itself. The list page can
clone, delete, and flip a product between active and inactive in place.
**Link Ratesheet → Import CSV** turns a spreadsheet into products: it
previews the rows and the columns it matched, then creates new products
and updates existing ones by SKU (or name) so a refreshed price list never
duplicates the catalog.

**Ratesheets** — a sub-module under Products. A ratesheet is a named
selection of your products published for partners: **Public**,
**Invite/Approve**, or **Partner Specific** (sent to one email address),
with an *Expires On* date and an *Approved/Decline Within* window. Each
send produces a link (`/r/<token>`) where the partner sees the prices —
never the cost, SKU, manufacturer or distributor — and approves or
declines. The landing page shows a summary of every send with its status
on the left and the ratesheet tiles (approved/sent, expires on) on the
right; clicking a tile filters the summary. **+ Link Ratesheet** uploads a
distributor's own price list (any file up to 4 MB, stored in the
database) so it can be downloaded from the same page; linking another
workspace's published sheet is marked *Coming Soon*.

**Quotes** — created against a customer *and* a deal (type to search the
customer's deals, or **+ Add new deal**), with two templates, **Simple**
(clean and printable) and **Modern** (branded dark layout). Every line item has the product name, a *product
description* sub-note, a *project specific notes* sub-note, quantity, unit
value, line total and a required tag. Under the table is the quote total,
and under that a grid totalling every tag — labor, materials, software,
project services, shipping and taxes. Marking a quote sent produces a
public link the customer can open without an account.

**Contracts** — reusable templates, each with a name, a type from a
per-workspace pick list (Service Agreement, Change Order, Purchase Order,
Sales Order, Invoice, Compliance, Custom to start; "+ Add new type" adds an
mNDA or a Commission Agreement in place), a description, and "Who can
send?" (everyone, or a searchable pick of users). Six templates come
preloaded: Service Agreement, Change Order, Purchase Order, Sales Order,
Invoice and Compliance Agreement. Merge fields are chips named in plain
words — Contact Name, Company Name, Deal Name, Quote Total, Contract Total,
Payment Schedule, Your Address — grouped by the screen they come from (ALL,
Contacts, Companies, Pipeline, Products, Quotes, Contracts, Settings);
clicking one drops it into the body. Every template page and contract
page is two columns: the agreement on the left, a silver line, and
**Customer Information** on the right, where you pick the customer, deal
and quote and generate the contract. **Preview** flips each chip to the
real value for that customer, or a flashing "Missing Information" when
there is nothing to fill it with. Generating resolves the fields once, so
the customer reads and e-signs a frozen copy; the send button honours the
template's sender list; signed contracts are locked from editing.

**Deal Tracker** (under Pipeline and under Contracts — one page, two
addresses) — turns a deal's quote into the contracts it actually needs.
Pick a deal and the quote's rows appear down the side with a column for
each contract (up to five): who it goes to (company and contact, existing
or typed in new — Contract A is prefilled from the deal), which template,
payment terms and a payment preset (one payment, deposit + balance, or
installments by month or year). Tick a row under every contract it belongs
on — the same materials line can sit on the customer's Sales Order *and*
the supplier's Purchase Order — and an unticked row stays **Open** on the
deal; rows can be cancelled and restored. "Your Company Signer" is
prefilled with the owner. Creating writes one contract per column with its
own line items, total and dated payment schedule, and the rows then read
CON-1004 · Sent / Signed. Below the grid every contract on the deal shows
sent and signed dates, total, paid-of-total and next due, reminders sent
(a reminder is copied to the clipboard with the signing link and logged —
no email is sent yet), with Edit, Cancel (frees the rows) and Reopen.
A contract's page shows its line items, a payment table that recalculates
(percent, fixed or balance rows; presets; final payment date; tick as
paid), and the signer; the customer's copy prints the Items and Payment
Schedule tables under the agreement, with the recipient's logo.

**Settings** — two sub-panes. **My Account**: name, job title, email,
mobile, a "Receive in-app messages" switch (stored, not yet acted on), a
profile picture, and change password. **Company Information** with five
tiles: **General** (address, phone, email, website, About us, Company
history — all available as merge fields under the Settings tab), **Branding**
(the original settings page: name, logo — now uploaded as a file or pasted
as a URL, one logo shared with General — color and time zone),
**Company Users** (everyone with a login, with title and last login),
**Compliance** (upload W-9, COI, licenses with a type and an expiry that is
flagged when it runs out) and **Marketing** (brochures and materials).
Companies and contacts take a logo or photo too, shown on their pages, the
tracker, and the documents addressed to them. Uploads live in Postgres
(2 MB images, 4 MB documents); images are served by an unguessable link so
they load on a customer's copy, documents only to the workspace.

**Operator console** (`/admin`) — the view across every workspace, for
whoever runs the product. Signups land in a `PENDING` state and cannot log
in until they are approved; each row shows the owner's contact details, when
they last logged in, and how much they have in the workspace, with Approve,
Reject, Pause and Delete. Pause locks a workspace without touching its data,
which is the intended answer to a customer who stops paying.

## How multi-tenancy works

Every row that belongs to a business carries an `organizationId`, and every
query is scoped to `session.organizationId`. Writes use `updateMany`/
`deleteMany` with the organization in the WHERE clause, so an id guessed
from another tenant matches zero rows rather than updating someone else's
record. `src/lib/session.ts` has the `requireSession()` helper every
dashboard page and action calls first.

Operator access is a separate axis: `isSuperAdmin` on `User` is a
platform-level flag, not a tenant role, and it is deliberately unreachable
from the app — nothing in any form, action or route writes it, so it can only
be set against the database (`npm run promote-admin -- <email>`). Both
`requireSession()` and `requireSuperAdmin()` re-read the flag *and* the
workspace status from the database on every request rather than trusting the
JWT, so pausing a workspace or revoking an operator takes effect on sessions
that are already open instead of whenever the token happens to expire.

Public document links (`/q/<token>`, `/c/<token>`) are the one exception:
they're unauthenticated by design, keyed on a 24-byte random token, and
only ever render that single document. Drafts aren't public at all — the
link only resolves for the team that owns it until the document is sent.

## Project layout

```
prisma/schema.prisma              data model
src/lib/                          prisma client, auth, session, formatting,
                                  quote math, merge fields, seed templates
src/components/                   UI kit, icons, quote + contract renderers
src/proxy.ts                      protects everything under /dashboard
src/app/dashboard/...             the app: contacts, companies, deals,
                                  products, quotes, contracts, settings
src/app/dashboard/products/ratesheets
                                  the Ratesheets sub-module
src/app/q/[token]                 public quote view
src/app/c/[token]                 public contract view + e-signature
src/app/r/[token]                 public ratesheet view + partner approve/decline
```

`auth.ts` vs `auth.config.ts`: Next.js runs the `/dashboard` gatekeeping in
the Edge runtime, which can't load `bcrypt` or Prisma. `auth.config.ts`
holds the Edge-safe pieces; `auth.ts` adds the Credentials provider on top
for use everywhere else.

Money is stored as integer cents everywhere, and line totals are rounded
per line then summed as integers — that's what keeps the tag totals adding
up to exactly the quote total.

## Where to go next

- **Sending email.** "Mark as sent", "Send for signature" and "Send to
  partner" on a ratesheet change status and give you a link to paste;
  there's no mail provider wired up yet.
- **Team members.** The `Role` enum (OWNER/ADMIN/MEMBER) gates branding
  today, but there's no invite flow.
- **Restricting signup.** Anyone who reaches the URL can create a
  workspace today. Fine while evaluating, not fine once the address is
  public.
- **Custom domains per business**, and **billing** per organization.

### Parked ideas

Worth building, deliberately not built yet:

- **PDF download** on quotes and contracts. A rendering job, generated on
  demand from the database — deliberately not a stored file, which would
  go stale the moment a line item changed.
- **File uploads**: job-site photos, quote attachments, logo uploads, and
  an archived copy of each contract as signed. These need object storage.
- **AI: quote from a sentence.** "Replace 3-ton rooftop unit, one day, two
  techs" → line items drawn from the product catalog, priced and tagged.
- **AI: pre-call briefing.** Summarize a contact's history before you dial.
- **AI: follow-up drafting.** Turn a logged call into a sent email.
- **AI: inbound extraction.** Paste a customer email, get a contact and a
  draft quote out of it.

The AI items are direct Anthropic API calls from the app — no gateway or
middleware layer, so each feature's cost stays legible on its own.
