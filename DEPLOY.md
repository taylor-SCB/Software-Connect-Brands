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

## Two things to know before you rely on this

**Anyone who finds the URL can create their own workspace.** That's how a
self-serve product is supposed to work, and each workspace is walled off
from the others — but there's no invite gate and no payment wall yet. Sign
up first so you own the first workspace, and expect to add a signup
restriction before you advertise the address anywhere.

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
