/* Browser regression for Forgot password (Sept 18, 2026).
 *
 * Covers: the link only appearing when email is switched on, the same
 * answer for a known and an unknown address, the email that actually goes
 * out, setting a new password and logging in with it, the old password
 * dying, a link working only once, an expired link, the confirm-box
 * mismatch, the length floor, other outstanding links dying with the one
 * that got used, and the per-hour cap.
 *
 * Stands up a throwaway HTTP server on :3999 and points the app's email
 * sender at it with RESEND_ENDPOINT, so the link under test is read out of
 * the message a customer would really receive rather than out of the
 * database — the database only ever holds the hash.
 *
 * Runs against a built app (`bash scripts/dev-serve.sh`) and a local
 * Postgres that has had `prisma migrate deploy` run against it. It signs
 * up its own workspace and deletes it again, so it never touches real
 * data. Never point it at the live database.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/scb_test \
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules \
 *   node scripts/browser-tests/password-reset.cjs
 */
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS on purpose: NODE_PATH only resolves the global playwright for require() */
const http = require("node:http");
const { chromium } = require("playwright");
const { Client } = require("pg");
const assert = require("node:assert/strict");

const BASE = process.env.BASE || "http://localhost:3000";
const DB = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5433/scb_test";
const CATCHER_PORT = 3999;

const EMAIL = "owner@resettest.example.com";
const OLD_PASSWORD = "the-forgotten-one";
const NEW_PASSWORD = "Rooftop-Maple-2026";
const COMPANY = "Test Reset Co";
const SLUG_LIKE = "test-reset-co%";

let step = 0;
const log = (m) => console.log(`[${String(++step).padStart(2, "0")}] ${m}`);

// Every message the app sent, newest last.
const inbox = [];

function startCatcher() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        try {
          inbox.push(JSON.parse(body));
        } catch {
          inbox.push({ raw: body });
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: `caught-${inbox.length}` }));
      });
    });
    server.listen(CATCHER_PORT, () => resolve(server));
  });
}

const linkFrom = (mail) => (mail.text.match(/https?:\/\/\S+\/reset-password\/\S+/) || [])[0];

async function submitReset(page, email) {
  await page.goto(`${BASE}/forgot-password`);
  await page.fill('input[name="email"]', email);
  await page.click('button[type="submit"]');
  await page.waitForSelector("text=If that address has an account", { timeout: 20000 });
}

(async () => {
  const db = new Client({ connectionString: DB });
  await db.connect();
  await db.query(`DELETE FROM "Organization" WHERE slug LIKE $1`, [SLUG_LIKE]);

  const catcher = await startCatcher();
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  log("sign up, activate, and confirm the old password works");
  await page.goto(`${BASE}/signup`);
  await page.fill('input[name="companyName"]', COMPANY);
  await page.fill('input[name="name"]', "Reset Owner");
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="phone"]', "5551234567");
  await page.fill('input[name="password"]', OLD_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/signup\/submitted/, { timeout: 20000 });
  await db.query(`UPDATE "Organization" SET status='ACTIVE' WHERE slug LIKE $1`, [SLUG_LIKE]);

  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', OLD_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 20000 });
  await ctx.close();

  const guest = await browser.newContext();
  const g = await guest.newPage();

  log("the login screen offers the link, because email is switched on here");
  await g.goto(`${BASE}/login`);
  await g.waitForSelector('a[href="/forgot-password"]', { timeout: 20000 });

  log("an address with no account gets the same answer as one that has");
  await submitReset(g, "nobody@resettest.example.com");
  assert.equal(inbox.length, 0, "an unknown address must not send anything");

  log("asking for a link sends one");
  await submitReset(g, EMAIL);
  assert.equal(inbox.length, 1, "exactly one message");
  const mail = inbox[inbox.length - 1];
  assert.equal(mail.to[0], EMAIL);
  assert.match(mail.subject, /new password/i);
  assert.match(mail.text, /60 minutes/, "the email says how long it lasts");
  const link = linkFrom(mail);
  assert.ok(link, "the email carries a reset link");

  log("the token is not stored anywhere in the database, only its hash");
  const stored = await db.query(
    `SELECT pr."tokenHash" FROM "PasswordReset" pr
     JOIN "User" u ON u.id = pr."userId"
     JOIN "Organization" o ON o.id = u."organizationId" WHERE o.slug LIKE $1`,
    [SLUG_LIKE],
  );
  const rawToken = link.split("/reset-password/")[1];
  assert.equal(stored.rows.length, 1);
  assert.notEqual(stored.rows[0].tokenHash, rawToken, "the raw token must never be stored");

  log("the two password boxes have to match");
  await g.goto(link);
  await g.fill('input[name="password"]', NEW_PASSWORD);
  await g.fill('input[name="confirm"]', "something-else-entirely");
  await g.click('button[type="submit"]');
  await g.waitForSelector("text=don't match", { timeout: 20000 });

  log("a too-short password is refused");
  await g.fill('input[name="password"]', "short");
  await g.fill('input[name="confirm"]', "short");
  await g.click('button[type="submit"]');
  await g.waitForSelector("text=at least 8 characters", { timeout: 20000 });

  log("neither refusal spent the link");
  const notSpent = await db.query(
    `SELECT pr."usedAt" FROM "PasswordReset" pr JOIN "User" u ON u.id = pr."userId"
     JOIN "Organization" o ON o.id = u."organizationId" WHERE o.slug LIKE $1`,
    [SLUG_LIKE],
  );
  assert.equal(notSpent.rows[0].usedAt, null, "a typo must not cost the one use");

  log("set the new password");
  await g.goto(link);
  await g.fill('input[name="password"]', NEW_PASSWORD);
  await g.fill('input[name="confirm"]', NEW_PASSWORD);
  await g.click('button[type="submit"]');
  await g.waitForSelector("text=Password changed", { timeout: 20000 });

  log("log in with the new password");
  await g.goto(`${BASE}/login`);
  await g.fill('input[name="email"]', EMAIL);
  await g.fill('input[name="password"]', NEW_PASSWORD);
  await g.click('button[type="submit"]');
  await g.waitForURL(/dashboard/, { timeout: 20000 });
  await guest.close();

  const after = await browser.newContext();
  const a = await after.newPage();

  log("the old password no longer works");
  await a.goto(`${BASE}/login`);
  await a.fill('input[name="email"]', EMAIL);
  await a.fill('input[name="password"]', OLD_PASSWORD);
  await a.click('button[type="submit"]');
  await a.waitForSelector("text=Invalid email or password", { timeout: 20000 });

  log("the link cannot be used a second time");
  await a.goto(link);
  await a.waitForSelector("text=already been used or has expired", { timeout: 20000 });

  log("a made-up token says the same thing, not that it never existed");
  await a.goto(`${BASE}/reset-password/not-a-real-token-at-all`);
  await a.waitForSelector("text=already been used or has expired", { timeout: 20000 });

  log("asking twice kills the older link");
  inbox.length = 0;
  await submitReset(a, EMAIL);
  await submitReset(a, EMAIL);
  assert.equal(inbox.length, 2);
  const firstLink = linkFrom(inbox[0]);
  const secondLink = linkFrom(inbox[1]);
  assert.notEqual(firstLink, secondLink, "each request gets its own link");

  await a.goto(secondLink);
  await a.fill('input[name="password"]', "Second-Choice-2026");
  await a.fill('input[name="confirm"]', "Second-Choice-2026");
  await a.click('button[type="submit"]');
  await a.waitForSelector("text=Password changed", { timeout: 20000 });

  await a.goto(firstLink);
  await a.waitForSelector("text=already been used or has expired", { timeout: 20000 });

  log("an expired link is refused");
  inbox.length = 0;
  await submitReset(a, EMAIL);
  const staleLink = linkFrom(inbox[0]);
  await db.query(
    `UPDATE "PasswordReset" SET "expiresAt" = now() - interval '1 minute'
     WHERE "usedAt" IS NULL AND "userId" IN (
       SELECT u.id FROM "User" u JOIN "Organization" o ON o.id = u."organizationId"
       WHERE o.slug LIKE $1)`,
    [SLUG_LIKE],
  );
  await a.goto(staleLink);
  await a.waitForSelector("text=already been used or has expired", { timeout: 20000 });

  log("five requests an hour is the cap, and the sixth sends nothing");
  await db.query(
    `DELETE FROM "PasswordReset" WHERE "userId" IN (
       SELECT u.id FROM "User" u JOIN "Organization" o ON o.id = u."organizationId"
       WHERE o.slug LIKE $1)`,
    [SLUG_LIKE],
  );
  inbox.length = 0;
  for (let i = 0; i < 6; i += 1) await submitReset(a, EMAIL);
  assert.equal(inbox.length, 5, `expected 5 sends, got ${inbox.length}`);

  await after.close();
  await browser.close();
  catcher.close();
  await db.query(`DELETE FROM "Organization" WHERE slug LIKE $1`, [SLUG_LIKE]);
  await db.end();
  console.log("\nALL STEPS PASSED.");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
