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

**Contacts** — company name, contact name, email, phone and website, with a
notes counter and separate counters for each activity type (text, email,
phone call, meeting) on every row. The contact page is the hub: log
activity, add notes, open deals, and see every quote and contract for that
customer.

**Pipeline** — deals by stage (New → Contacted → Won/Lost) with per-stage
value totals.

**Products** — the catalog you quote from. Each product carries a
description, SKU, unit price and a default tag.

**Quotes** — two templates, **Simple** (clean and printable) and **Modern**
(branded dark layout). Every line item has the product name, a *product
description* sub-note, a *project specific notes* sub-note, quantity, unit
value, line total and a required tag. Under the table is the quote total,
and under that a grid totalling every tag — labor, materials, software,
project services, shipping and taxes. Marking a quote sent produces a
public link the customer can open without an account.

**Contracts** — reusable templates with merge fields (`{{client_name}}`,
`{{company_name}}`, `{{contract_number}}`…), seeded with a **Service
Agreement** and a **Change Order**. Generating a contract resolves the merge
fields into a frozen copy, and sending it produces a link where the
customer reads and e-signs it. Signed contracts are locked from editing.

**Branding** — company name, logo and primary color, applied across the
dashboard *and* customer-facing quotes and contracts.

## How multi-tenancy works

Every row that belongs to a business carries an `organizationId`, and every
query is scoped to `session.organizationId`. Writes use `updateMany`/
`deleteMany` with the organization in the WHERE clause, so an id guessed
from another tenant matches zero rows rather than updating someone else's
record. `src/lib/session.ts` has the `requireSession()` helper every
dashboard page and action calls first.

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
src/app/dashboard/...             the app: contacts, deals, products,
                                  quotes, contracts, settings
src/app/q/[token]                 public quote view
src/app/c/[token]                 public contract view + e-signature
```

`auth.ts` vs `auth.config.ts`: Next.js runs the `/dashboard` gatekeeping in
the Edge runtime, which can't load `bcrypt` or Prisma. `auth.config.ts`
holds the Edge-safe pieces; `auth.ts` adds the Credentials provider on top
for use everywhere else.

Money is stored as integer cents everywhere, and line totals are rounded
per line then summed as integers — that's what keeps the tag totals adding
up to exactly the quote total.

## Where to go next

- **Sending email.** "Mark as sent" and "Send for signature" change status
  and give you a link to paste; there's no mail provider wired up yet.
- **Team members.** The `Role` enum (OWNER/ADMIN/MEMBER) gates branding
  today, but there's no invite flow.
- **Restricting signup.** Anyone who reaches the URL can create a
  workspace today. Fine while evaluating, not fine once the address is
  public.
- **Custom domains per business**, and **billing** per organization.
