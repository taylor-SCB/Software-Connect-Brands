# White-Label CRM

A CRM that small service businesses can put their own name and colors on.
Each business gets its own workspace ("organization") with its own
contacts, deals, and branding — nobody else can see their data.

## Stack

- **Next.js** (App Router) + **TypeScript** — pages and backend logic in one project
- **Prisma** + **SQLite** — the database (swap SQLite for Postgres later without touching your queries)
- **NextAuth (Auth.js)** — login/signup, using email + password
- **Tailwind CSS** — styling

## Running it locally

```bash
npm install
npx prisma migrate dev   # creates the local SQLite database (dev.db)
npm run dev
```

Open http://localhost:3000, click "Get started," and create an account.
Signing up creates a new organization (your business) and makes you its
first user.

## How multi-tenancy works

Every row in the database that belongs to a business — contacts, deals,
notes, users — has an `organizationId`. Every query in the app is scoped
to `session.organizationId`, so one business's data is never visible to
another's. `src/lib/session.ts` has the `requireSession()` helper every
dashboard page and action calls first, and `src/app/dashboard/layout.tsx`
reads the organization's branding and renders it (name, logo, accent
color via the `--brand` CSS variable) around every dashboard page.

## Project layout

```
prisma/schema.prisma          data model (Organization, User, Contact, Deal, Note)
src/lib/auth.ts, auth.config.ts   NextAuth setup (split for Edge middleware, see below)
src/lib/prisma.ts              shared database client
src/lib/session.ts             requireSession() helper
src/proxy.ts                   protects everything under /dashboard
src/app/signup, /login         account creation and sign-in
src/app/dashboard/...          the app itself: contacts, deals, settings
```

`auth.ts` vs `auth.config.ts`: Next.js runs the `/dashboard` gatekeeping
in the Edge runtime, which can't load `bcrypt` or Prisma. `auth.config.ts`
holds the Edge-safe pieces (pages, the `authorized` check); `auth.ts` adds
the actual Credentials provider (password hashing, database lookups) on
top of it for use everywhere else.

## Where to go next

This covers the core loop (sign up → brand your workspace → track
contacts and deals). Natural next steps if you keep building:

- **Team members**: invite more users into an organization (the `Role`
  enum on `User` — OWNER/ADMIN/MEMBER — is already there but unused
  beyond the signup owner).
- **Postgres in production**: swap the SQLite adapter in `src/lib/prisma.ts`
  for `@prisma/adapter-pg` (or similar) and point `DATABASE_URL` at a
  real Postgres instance — the schema doesn't need to change.
- **Custom domains per business**: true white-labeling usually means
  `acme.yourcrm.com` or a fully custom domain resolving to the right
  organization.
- **Billing**: Stripe subscriptions per organization, since this is meant
  to be sold to multiple businesses.
