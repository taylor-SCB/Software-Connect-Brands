# Putting the CRM on the internet

Written for someone who hasn't deployed an app before. No terminal
required — everything below happens in a web browser.

Goal: the CRM live at **app.softwareconnectbrands.com**, with your
existing Squarespace site untouched at softwareconnectbrands.com.

Roughly 20–30 minutes, most of it waiting.

---

## The pieces, in plain terms

| Piece | What it does | Who provides it |
|---|---|---|
| **The code** | The app itself | Already on GitHub |
| **Hosting** | A computer that runs the code 24/7 | Vercel |
| **Database** | Where contacts, quotes and contracts are stored | Neon (Postgres) |
| **Domain** | The address people type | You already own it (Squarespace) |

You need accounts with Vercel and Neon. Both have free tiers — read the
cost note at the bottom before you rely on the free one.

---

## Step 1 — Create the Vercel account

1. Go to **vercel.com** and click **Sign Up**.
2. Choose **Continue with GitHub** and log in with the GitHub account that
   owns this repository.
3. Authorize Vercel when GitHub asks.

## Step 2 — Import the project

On the Vercel dashboard click **Add New… → Project**. You land on a screen
titled **Import Git Repository** showing a list of your repositories, each
with an **Import** button.

Find **Software-Connect-Brands** and click **Import**.

**If the list is empty, or that repo isn't in it**, Vercel hasn't been
given access to it yet. Fix that here:

> **https://github.com/apps/vercel/installations/new**

Choose your **taylor-SCB** account, then either **All repositories** or
**Only select repositories → Software-Connect-Brands**, and click
**Install / Save**. GitHub returns you to Vercel and the repo appears.

You don't need to pick a branch. This repo has exactly one —
`claude/first-app-creation-cdtbrb` — and it's already the default, so
Vercel selects it on its own.

**Do not click Deploy yet.** The app needs a database first, and a deploy
without one fails. Continue to Step 3.

## Step 3 — Create the database

The **Storage** tab lives *inside a project*, so it doesn't exist until
Step 2 is finished. If you can't find it, you haven't got a project yet —
go back.

1. Open your project, then the **Storage** tab.
   Direct link: `vercel.com/<your-team>/<your-project>/stores`
2. Click **Create Database** and choose **Neon** (Postgres). Accept the
   free plan.
3. When it asks which project to connect it to, choose this one.

Newer Vercel accounts may route this through **Marketplace** instead of a
Storage tab — same thing, look for Neon under database integrations.

Vercel adds the connection details to your project automatically. Its
variable is usually named `DATABASE_URL` — if it created `POSTGRES_URL`
instead, that's fine, the app reads either.

## Step 4 — Add the session secret

The app signs login cookies with a secret value. It won't start without one.

1. Go to **Settings → Environment Variables** in your Vercel project.
2. Add a variable:
   - **Name:** `AUTH_SECRET`
   - **Value:** a long random string (44+ characters). Ask Claude for one,
     or mash the keyboard — it only needs to be random and secret.
   - **Environments:** tick all three (Production, Preview, Development).
3. Click **Save**.

Never share this value or commit it to GitHub. If it leaks, replace it —
everyone gets logged out, nothing else breaks.

## Step 5 — Deploy

1. Go to the **Deployments** tab and click **Deploy** (or **Redeploy** on
   the most recent entry).
2. Watch the log. It installs, sets up the database tables, then builds.
   Two to four minutes.
3. When it finishes you get a URL like
   `software-connect-brands.vercel.app`. Open it — you should see the
   landing page.
4. Click **Create your workspace** and sign up. **Do this immediately** —
   see the security note at the bottom.

If the build fails, read the last red lines of the log. Almost always it's
a missing `DATABASE_URL` or `AUTH_SECRET` from Steps 3–4.

## Step 6 — Point your domain at it

**This step is required, not cosmetic.** Vercel's Deployment Protection
defaults to `all_except_custom_domains`, which puts a Vercel login wall in
front of every `*.vercel.app` address. Your own team can get in; a customer
opening a quote link cannot. Only a custom domain is publicly reachable.

That default is worth keeping: your working URL stays private, and the
customer-facing domain is the only way in.

Two gotchas that cost real time here:

- **Environment variable names are case-sensitive.** `Database_URL` and
  `DATABASE_URL` are different variables, and Vercel will not let you
  rename one after saving — you delete it and add a new one.
- **Secret-type values are write-only.** You cannot read a saved
  connection string back out, so re-copy it from Neon rather than hunting
  for it in Vercel.


**In Vercel:**

1. **Settings → Domains → Add**.
2. Enter `app.softwareconnectbrands.com` and confirm.
3. Vercel shows a DNS record it wants you to create. It'll be a **CNAME**
   pointing at something like `cname.vercel-dns.com`. Keep this tab open.

**In Squarespace** (logged in as taylor@softwareconnectbrands.com):

1. Open the account menu → **Domains**.
2. Click **softwareconnectbrands.com**.
3. Find **DNS** / **DNS Settings** → **Add Record** (wording moves around
   as Squarespace updates their dashboard; you're looking for the list of
   existing records like A and CNAME entries).
4. Add:
   - **Type:** CNAME
   - **Host / Name:** `app`
   - **Data / Value:** the target Vercel gave you (e.g. `cname.vercel-dns.com`)
5. Save.

Then wait. DNS changes usually take 10–30 minutes, occasionally a few
hours. Vercel's Domains page flips to a green checkmark when it's live.

**Your Squarespace site is unaffected** — you added a new subdomain record
and changed nothing about the existing ones.

---

## After it's live

- **Everything auto-updates.** Any time new code is pushed to that branch,
  Vercel rebuilds and redeploys. No steps on your end.
- **Your data persists.** The database is separate from the app, so
  deploys never wipe contacts or quotes.
- **Check it on your phone.** It's built to work there.

## Approving who gets in

Signing up no longer opens a workspace. A new signup is stored as **waiting**
and cannot log in until you approve it, so nobody uses the app without your
say-so.

**The operator console** lives at `/admin` — for example
`https://softwareconnectbrands.com/admin`. Only an account with the operator
flag can open it; anyone else gets a 404, so nobody can tell the page exists.
There is also an **Operator console** link in your sidebar once you have the
flag.

Each workspace shows the owner's name, email and phone, when they signed up,
when anyone last logged in, and how many contacts, quotes and contracts they
have. The buttons:

- **Approve** — they can log in from that moment.
- **Reject** — they cannot.
- **Pause** — locks a workspace without touching a single row of its data.
  This is the lever for someone who stops paying; **Unpause** gives it all
  back. Pausing takes effect immediately, even for someone already logged in.
- **Delete** — removes the workspace and every contact, quote and contract in
  it. You have to type the company name to arm the button, and the server
  checks the name again, so a stray click can't do it.

### Making yourself the operator

The flag is not a button anywhere — nothing in the app can grant it, so no
signup form or bug can hand out operator access. It is set directly against
the database, once.

**Easiest way (Neon's web console):**

1. Open your project at [console.neon.tech](https://console.neon.tech).
2. Click **SQL Editor** in the sidebar.
3. Paste this, with your own email, and hit Run:

   ```sql
   UPDATE "User" SET "isSuperAdmin" = true WHERE email = 'you@yourcompany.com';
   ```

4. Log out of the CRM and back in. The **Operator console** link appears in
   your sidebar.

If it says `UPDATE 0`, the email doesn't match an account — check for a typo.

**From a terminal instead**, with `DATABASE_URL` set to the same connection
string:

```bash
npm run promote-admin -- you@yourcompany.com          # grant
npm run promote-admin -- you@yourcompany.com --revoke # take it back
npm run promote-admin -- --list                       # who has it
```

### What this does not do yet

**Approving somebody does not tell them.** Nothing in the app sends email, so
after you click Approve you have to call or text them — which is why signup
now asks for a phone number, and why it's on the console next to their name.
Sending real email needs an email service wired up; that same piece is what
makes "forgot my password" possible, and neither exists yet.

**Nothing here charges anybody.** Approval controls access; billing is a
separate build.

## Two websites: the real one and the workshop

There are two copies of this app running, on purpose.

**The real one — `softwareconnectbrands.com`.** This is what customers and
clients use. It is open to the public: no Vercel login, no gate. It is
built from the `claude/first-app-creation-cdtbrb` branch. Nothing reaches
it unless that branch changes.

**The workshop — the `.vercel.app` addresses.** Every other branch gets its
own address automatically, of the form
`software-connect-brands-git-<branch>-software-connect.vercel.app`. New
work happens on the `dev` branch and lands there first. These addresses ask
for a Vercel login before showing anything, so only the account owner can
open them — a half-finished feature is never visible to a customer.

Shipping a change means merging `dev` into
`claude/first-app-creation-cdtbrb` and pushing. That rebuild is what
updates the real website.

**Both currently share one database.** Test data entered in the workshop
shows up on the real site, because there is only one Neon database behind
both. Before there are real customers in here, the workshop needs its own
separate database — otherwise a test contact and a paying client's contact
sit in the same table.

## Two things to know before you rely on this

**There is still no password reset.** If someone forgets their password
there is no way back in on their own, and no way for you to send them one —
it needs the same email service approving somebody does. Until that exists,
a forgotten password is a database edit.

**Vercel's free Hobby plan is for non-commercial use.** Running a CRM you
sell to clients is commercial, so plan on the Pro plan (about $20/month)
once this is more than a demo. The free tier is fine for evaluating it.
Neon's free Postgres tier is fine to start and has no such restriction.

## If something breaks

- **Build failed** → Deployments tab, click the failed one, read the red
  lines at the bottom.
- **Site loads but errors on login** → `AUTH_SECRET` is missing or wasn't
  applied to Production. Re-check Step 4, then redeploy.
- **Site loads but data operations fail** → the database variable is
  missing or the migration step didn't run. Check Storage is connected to
  this project, then redeploy.
- **Domain stuck "Invalid Configuration"** → the CNAME hasn't propagated,
  or the Host field says `app.softwareconnectbrands.com` instead of just
  `app`. Squarespace adds the domain part for you.
