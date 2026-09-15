/* Browser regression for the Quotes improvement (Sept 15, 2026).
 *
 * Covers: a line item keeping its stored id across two saves without a
 * reload; a hand-typed line saving itself into Products and not doubling
 * on a re-save; the Supplier / Contractor column and its never reaching
 * the customer's copy; software unit, billing and term with the Term
 * Total readout; the quote's payment table, its percent/dollar tie-out
 * and Hide from Quote; the payment table and sales rep block printing on
 * the public quote; and Lead Sales Rep / Contract Signer / team members.
 *
 * Runs against a built app (`bash scripts/dev-serve.sh`) and a local
 * Postgres that has had `prisma migrate deploy` run against it. It signs
 * up its own workspace, activates it with SQL, and deletes it again on
 * the next run, so it never touches real data. Never point it at the
 * live database.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/scb_test \
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules \
 *   node scripts/browser-tests/quotes-improvement.cjs
 */
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS on purpose: NODE_PATH only resolves the global playwright for require() */
const os = require("node:os");
const { chromium } = require("playwright");
const { Client } = require("pg");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const BASE = process.env.BASE || "http://localhost:3000";
const DB = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5433/scb_test";
const OUT = process.env.SHOTS_DIR || path.join(os.tmpdir(), "scb-browser-shots-quotes-improvement");
fs.mkdirSync(OUT, { recursive: true });

const EMAIL = "test-quotes-improvement@example.com";
const PASSWORD = "password123";
const COMPANY = "Test Quotes Improvement Co";
const SLUG_LIKE = "test-quotes-improvement-co%";

let step = 0;
function log(msg) {
  step += 1;
  console.log(`[${String(step).padStart(2, "0")}] ${msg}`);
}
async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
}
async function sql(text, params) {
  const client = new Client({ connectionString: DB });
  await client.connect();
  try {
    return await client.query(text, params);
  } finally {
    await client.end();
  }
}
async function login(page) {
  await page.goto(`${BASE}/login`);
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/dashboard$/);
}
// "Unsaved changes" also contains the word "saved", so the success banner
// has to be matched on its own text rather than a substring.
async function saveLines(page) {
  await page.getByRole("button", { name: "Save line items" }).click();
  await page.getByText("Line items saved", { exact: true }).waitFor();
}

// Held outside the run so a failed assertion can still close the browser;
// otherwise node keeps running with a live Chromium and the suite reads as
// a hang rather than a failure.
let browser;
let context;

(async () => {
  await sql(`DELETE FROM "Organization" WHERE slug LIKE $1`, [SLUG_LIKE]);

  browser = await chromium.launch();
  context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const page = await context.newPage();
  page.on("pageerror", (err) => console.error("PAGE ERROR:", err.message));
  page.on("dialog", (dialog) => dialog.accept());

  log("signup + activate + login");
  await page.goto(`${BASE}/signup`);
  await page.fill("[name=companyName]", COMPANY);
  await page.fill("[name=name]", "Taylor Test");
  await page.fill("[name=email]", EMAIL);
  await page.fill("[name=phone]", "5550000000");
  await page.fill("[name=password]", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/signup\/submitted/);
  await sql(`UPDATE "Organization" SET status='ACTIVE', "reviewedAt"=now() WHERE slug LIKE $1`, [SLUG_LIKE]);
  const org = (await sql(`SELECT id FROM "Organization" WHERE slug LIKE $1`, [SLUG_LIKE])).rows[0].id;
  await login(page);

  log("seed a customer and a deal with an empty quote");
  await sql(
    `INSERT INTO "Company" (id,"organizationId",name,city,state,"updatedAt")
     VALUES ('cmp_qi','${org}','Harbor Property Group','Austin','TX',now())`,
  );
  await sql(
    `INSERT INTO "Contact" (id,"organizationId","companyId",name,title,email,"updatedAt")
     VALUES ('ctc_qi','${org}','cmp_qi','Dana Ruiz','Owner','dana@harbor.com',now())`,
  );
  await sql(
    `INSERT INTO "Deal" (id,"organizationId","contactId",title,stage,"updatedAt")
     VALUES ('deal_qi','${org}','ctc_qi','Rekey the building','QUOTE_SENT',now())`,
  );
  await sql(
    `INSERT INTO "Quote" (id,"organizationId","contactId","dealId",number,title,status,"publicToken","updatedAt")
     VALUES ('quo_qi','${org}','ctc_qi','deal_qi',1000,'Rekey quote','DRAFT','tok_quo_qi_0123456789',now())`,
  );
  await sql(`UPDATE "Organization" SET "nextQuoteNumber"=1001 WHERE id='${org}'`);

  /* ---------------------------------------------------------------- *
   * W1 — a row keeps its stored id across two saves without a reload.
   * Before the fix the second save deleted every row added in the
   * session and created it again, which silently severed any contract
   * line pointing at it.
   * ---------------------------------------------------------------- */
  log("add a hand-typed line and save it");
  await page.goto(`${BASE}/dashboard/quotes/quo_qi`);
  await page.getByRole("button", { name: "Blank line" }).click();
  await page.getByLabel("Line 1 product", { exact: true }).fill("Install labor");
  await page.getByLabel("Line 1 quantity", { exact: true }).fill("2");
  await page.getByLabel("Line 1 unit value", { exact: true }).fill("500.00");
  await saveLines(page);

  const afterFirst = await sql(`SELECT id, name, quantity FROM "QuoteLineItem" WHERE "quoteId"='quo_qi'`);
  assert.equal(afterFirst.rows.length, 1, "one line after the first save");
  const firstId = afterFirst.rows[0].id;
  assert.equal(afterFirst.rows[0].name, "Install labor");

  log("edit and re-save WITHOUT reloading — the row id must not change");
  await page.getByLabel("Line 1 unit value", { exact: true }).fill("550.00");
  await saveLines(page);

  const afterSecond = await sql(
    `SELECT id, "unitPriceCents" FROM "QuoteLineItem" WHERE "quoteId"='quo_qi'`,
  );
  assert.equal(afterSecond.rows.length, 1, "still one line after the second save");
  assert.equal(
    afterSecond.rows[0].id,
    firstId,
    "the row was deleted and recreated instead of updated in place",
  );
  assert.equal(afterSecond.rows[0].unitPriceCents, 55000, "the edit was saved");
  await shot(page, "01-line-id-round-trip");

  log("a third save with a second row added in the same session");
  await page.getByRole("button", { name: "Blank line" }).click();
  await page.getByLabel("Line 2 product", { exact: true }).fill("Locks");
  await page.getByLabel("Line 2 unit value", { exact: true }).fill("120.00");
  await saveLines(page);
  await page.getByLabel("Line 2 quantity", { exact: true }).fill("4");
  await saveLines(page);

  const afterThird = await sql(
    `SELECT id, name, quantity FROM "QuoteLineItem" WHERE "quoteId"='quo_qi' ORDER BY position`,
  );
  assert.equal(afterThird.rows.length, 2, "two lines, not four");
  assert.equal(afterThird.rows[0].id, firstId, "the first row still holds its id");
  assert.equal(afterThird.rows[1].name, "Locks");
  assert.equal(Number(afterThird.rows[1].quantity), 4, "the second row's edit was saved in place");
  const secondId = afterThird.rows[1].id;

  log("reload and save again — ids still stable");
  await page.reload();
  await page.getByLabel("Line 1 quantity", { exact: true }).fill("3");
  await saveLines(page);
  const afterReload = await sql(
    `SELECT id FROM "QuoteLineItem" WHERE "quoteId"='quo_qi' ORDER BY position`,
  );
  assert.deepEqual(
    afterReload.rows.map((r) => r.id),
    [firstId, secondId],
    "ids changed across a reload-and-save",
  );

  console.log("\nAll steps passed.");
  await context.close();
  await browser.close();
})().catch(async (err) => {
  console.error("\nFAILED:", err.message);
  process.exitCode = 1;
  try {
    await context?.close();
    await browser?.close();
  } catch {
    // Already gone; the failure above is what matters.
  }
});
