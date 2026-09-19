/* Regression: the way a phone types an email address must still log in.
 *
 * Signs up a workspace with a lower-case address, activates it, then logs
 * in with the spellings a real keyboard produces: capitalised first letter
 * (what a phone does on its own), all caps, and a trailing space from a
 * paste. Each must land on the dashboard. A wrong password must still be
 * refused, and must not be refused for the wrong reason.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/scb_test \
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules \
 *   node scripts/browser-tests/login-case.cjs
 */
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS on purpose: NODE_PATH only resolves the global playwright for require() */
const { chromium } = require("playwright");
const { Client } = require("pg");
const assert = require("node:assert/strict");

const BASE = process.env.BASE || "http://localhost:3000";
const DB = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5433/scb_test";

const EMAIL = "owner@logincase.example.com";
const PASSWORD = "password123";
const COMPANY = "Test Login Case Co";
const SLUG_LIKE = "test-login-case-co%";

let step = 0;
const log = (m) => console.log(`[${String(++step).padStart(2, "0")}] ${m}`);

(async () => {
  const db = new Client({ connectionString: DB });
  await db.connect();
  await db.query(`DELETE FROM "Organization" WHERE slug LIKE $1`, [SLUG_LIKE]);

  const browser = await chromium.launch();

  log("sign up, then activate the workspace");
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/signup`);
  await page.fill('input[name="companyName"]', COMPANY);
  await page.fill('input[name="name"]', "Case Owner");
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="phone"]', "5551234567");
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/signup\/submitted/, { timeout: 20000 });
  await db.query(`UPDATE "Organization" SET status='ACTIVE' WHERE slug LIKE $1`, [SLUG_LIKE]);
  await ctx.close();

  // Scoped to this suite's own workspace, so a stray row elsewhere cannot
  // make this pass or fail.
  const stored = await db.query(
    `SELECT u.email FROM "User" u JOIN "Organization" o ON o.id = u."organizationId"
     WHERE o.slug LIKE $1`,
    [SLUG_LIKE],
  );
  assert.equal(stored.rows[0].email, EMAIL, "signup files the address lower-cased");

  const spellings = [
    ["Owner@logincase.example.com", "a phone capitalising the first letter"],
    ["OWNER@LOGINCASE.EXAMPLE.COM", "all caps"],
    [`  ${EMAIL}  `, "a paste with spaces around it"],
    [EMAIL, "exactly as stored"],
  ];

  for (const [typed, why] of spellings) {
    log(`log in with ${why}: ${JSON.stringify(typed)}`);
    const c = await browser.newContext();
    const p = await c.newPage();
    await p.goto(`${BASE}/login`);
    await p.fill('input[name="email"]', typed);
    await p.fill('input[name="password"]', PASSWORD);
    await p.click('button[type="submit"]');
    await p.waitForURL(/dashboard/, { timeout: 20000 });
    assert.match(p.url(), /\/dashboard/, `${why} should reach the dashboard`);
    await c.close();
  }

  log("the keyboard is told not to capitalise or correct the address");
  const c2 = await browser.newContext();
  const p2 = await c2.newPage();
  await p2.goto(`${BASE}/login`);
  assert.equal(await p2.getAttribute('input[name="email"]', "autocapitalize"), "none");
  assert.equal(await p2.getAttribute('input[name="email"]', "autocorrect"), "off");

  // Each refusal starts from a fresh load. Two attempts in a row can show
  // the same words, and waiting for text that is already on screen passes
  // against the previous attempt instead of this one.
  const refuse = async (typed, password, expected) => {
    await p2.goto(`${BASE}/login`);
    await p2.fill('input[name="email"]', typed);
    await p2.fill('input[name="password"]', password);
    await p2.click('button[type="submit"]');
    await p2.waitForSelector(`text=${expected}`, { timeout: 20000 });
    assert.doesNotMatch(p2.url(), /\/dashboard/, `${expected} must not reach the dashboard`);
  };

  log("a wrong password is still refused, whatever the capitals");
  await refuse("OWNER@logincase.example.com", "not-the-password", "Invalid email or password");

  log("the address is still in the box, so a retry is one tap not two");
  assert.equal(
    await p2.inputValue('input[name="email"]'),
    "OWNER@logincase.example.com",
    "a refused login must hand the typed address back",
  );
  assert.equal(
    await p2.inputValue('input[name="password"]'),
    "",
    "the password must not be handed back",
  );

  log("an unknown address is still refused");
  await refuse("nobody@logincase.example.com", PASSWORD, "Invalid email or password");

  log("a paused workspace says so, rather than blaming the password");
  await db.query(`UPDATE "Organization" SET status='PAUSED' WHERE slug LIKE $1`, [SLUG_LIKE]);
  await refuse("Owner@logincase.example.com", PASSWORD, "This workspace is paused");

  await c2.close();
  await browser.close();
  await db.query(`DELETE FROM "Organization" WHERE slug LIKE $1`, [SLUG_LIKE]);
  await db.end();
  console.log("\nALL STEPS PASSED.");
})().catch((e) => { console.error(e); process.exit(1); });
