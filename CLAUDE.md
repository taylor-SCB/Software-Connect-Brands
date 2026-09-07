@AGENTS.md

# Working with Taylor on this project

Taylor owns this product and is building software for the first time. These
rules exist because each one was learned the hard way in an earlier session.
Read them before doing anything else.

## How to talk

- **Plain English. No jargon.** Not "environment variable" — "the setting in
  Vercel called DATABASE_URL". Not "deployment" — "the live website". If a
  technical word is unavoidable, say what it means in the same sentence.
- **Don't make him feel stupid.** He has said so directly. Explaining too
  much is as bad as explaining too little; say the thing, then stop.
- **Answers, not menus.** Recommend one option and say why. Don't lay out
  five alternatives and ask him to pick unless the choice is genuinely his
  (pricing, business rules, who gets access).
- **When walking him through a screen, go one step at a time** and let him
  tell you what he sees. Do not guess at what a UI looks like or bounce him
  between screens. If you cannot see it, ask.
- **Own mistakes in one sentence and move on.** No paragraphs of apology.

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

- Deploys run `prisma migrate deploy` automatically, so **a push can change
  the live database**. Any migration must be safe for rows that already
  exist.
- Vercel keeps every past deployment. A bad release is undone with **Instant
  Rollback** in the Deployments tab — ten seconds, doesn't touch data.
- **You cannot change Vercel settings from here.** No tool exists for
  environment variables, domains or the production branch. Those are things
  Taylor has to click, so walk him through them.

## What is already built

Contacts, pipeline, products, quotes (Simple + Modern templates, tagged line
items, tag totals grid), contracts (templates, merge fields, e-signature),
PDF export for both, per-workspace branding and time zone, and an operator
console at `/admin` where signups are approved, paused or deleted.

See `README.md` for how those work and `DEPLOY.md` for anything to do with
the live site.

## Known gaps — say so rather than implying otherwise

- **No email is sent, ever.** No approval notice, no receipts, and **no
  password reset** — a forgotten password today means editing the database.
  Everything else waiting on email is blocked behind this.
- **No billing.** Nothing charges anybody.
- **`AUTH_SECRET` was exposed in chat and still needs rotating.**
- **The GitHub repository is public.**
- Operator access (`isSuperAdmin`) is deliberately unreachable from the app.
  It is only ever set with SQL or `npm run promote-admin`.
