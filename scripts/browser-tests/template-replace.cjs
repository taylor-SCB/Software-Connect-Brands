/* Browser regression for replacing a built-in template's wording
 * (Contracts v2, Phase 1, Oct 7, 2026).
 *
 * Covers: the six built-ins arrive as the one in use for their type and
 * remember which built-in they were; Replace with my own empties the body
 * in place (Undo puts it back) and saving keeps the same template, so the
 * app's own Sales Order picks up the new wording; Restore the original
 * puts the built-in wording back; a second template of a type says you
 * already have one, saves as an Alternate unless ticked, and when ticked
 * becomes the one the Contract Coordinator reaches for; deleting it hands
 * the type back.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/scb_test \
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules \
 *   node scripts/browser-tests/template-replace.cjs
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
const OUT = process.env.SHOTS_DIR || path.join(os.tmpdir(), "scb-browser-shots-template-replace");
fs.mkdirSync(OUT, { recursive: true });

const EMAIL = "test-template-replace@example.com";
const PASSWORD = "password123";
const COMPANY = "Test Template Replace Co";
const SLUG_LIKE = "test-template-replace-co%";
const MINE = "OUR SALES ORDER\n\nCustomer: {{client_name}}\nTotal due: {{quote_total}}\nSigned below.";

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

(async () => {
  await sql(`DELETE FROM "Organization" WHERE slug LIKE $1`, [SLUG_LIKE]);
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  page.on("pageerror", (err) => console.error("PAGE ERROR:", err.message));

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
  await page.goto(`${BASE}/login`);
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/dashboard$/);
  const org = (await sql(`SELECT id FROM "Organization" WHERE slug LIKE $1`, [SLUG_LIKE])).rows[0].id;

  log("the six built-ins are each the one in use for their type and remember their original");
  const seeded = (await sql(`SELECT id, name, type, "isDefault", baseline, body FROM "ContractTemplate" WHERE "organizationId"=$1`, [org])).rows;
  assert.equal(seeded.length, 6);
  for (const row of seeded) {
    assert.equal(row.isDefault, true, row.name);
    assert.equal(row.baseline, row.name);
  }
  const salesOrder = seeded.find((row) => row.type === "Sales Order");
  const original = salesOrder.body;

  log("Sales Order: no in-use box with only one of its type, and nothing to restore yet");
  await page.goto(`${BASE}/dashboard/contracts/templates/${salesOrder.id}`);
  await page.locator("[data-testid=template-replace]").waitFor();
  assert.equal(await page.locator("[data-testid=template-in-use]").count(), 0);
  assert.equal(await page.locator("[data-testid=template-restore]").count(), 0);

  log("Replace with my own empties the body; Undo puts it back");
  await page.click("[data-testid=template-replace]");
  assert.equal(await page.locator("#body").inputValue(), "");
  await page.locator("[data-testid=template-swap-note]").getByText("Paste or type your own agreement").waitFor();
  await page.locator("[data-testid=template-swap-note]").getByRole("button", { name: "Undo" }).click();
  assert.ok((await page.locator("#body").inputValue()).startsWith("SALES ORDER"));

  log("Replace, paste our own, Save: the same template now carries our wording and is still the one in use");
  await page.click("[data-testid=template-replace]");
  await page.fill("#body", MINE);
  await shot(page, "01-replaced");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByText("Template saved").waitFor();
  const afterReplace = (await sql(`SELECT body, "isDefault", name, type FROM "ContractTemplate" WHERE id=$1`, [salesOrder.id])).rows[0];
  assert.equal(afterReplace.body.replace(/\r\n/g, "\n"), MINE);
  assert.equal(afterReplace.isDefault, true);
  assert.equal(afterReplace.name, "Sales Order");
  assert.equal(afterReplace.type, "Sales Order");
  assert.equal((await sql(`SELECT count(*)::int n FROM "ContractTemplate" WHERE "organizationId"=$1`, [org])).rows[0].n, 6, "no second Sales Order made");

  log("Restore the original appears now and puts the built-in wording back on Save");
  await page.reload();
  await page.click("[data-testid=template-restore]");
  assert.ok((await page.locator("#body").inputValue()).startsWith("SALES ORDER"));
  assert.equal(await page.locator("[data-testid=template-restore]").count(), 0, "nothing left to restore");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByText("Template saved").waitFor();
  assert.equal((await sql(`SELECT body FROM "ContractTemplate" WHERE id=$1`, [salesOrder.id])).rows[0].body.replace(/\r\n/g, "\n"), original.trim());

  log("a new Sales Order template says one already exists and saves as an Alternate when not ticked");
  await page.goto(`${BASE}/dashboard/contracts/templates/new`);
  await page.selectOption("#type", "Sales Order");
  const inUse = page.locator("[data-testid=template-in-use]");
  await inUse.getByText("You already have a Sales Order template").waitFor();
  assert.equal(await inUse.getByRole("link", { name: "Sales Order" }).getAttribute("href"), `/dashboard/contracts/templates/${salesOrder.id}`);
  assert.equal(await page.locator("[data-testid=template-is-default]").isChecked(), false);
  await page.fill("[name=name]", "Multi-Bids Sales Order");
  await page.fill("#body", MINE);
  await page.getByRole("button", { name: "Save template" }).click();
  await page.waitForURL(/\/dashboard\/contracts\/templates\/(?!new)[a-z0-9]+$/);
  const mineId = page.url().split("/").pop();
  let rows = (await sql(`SELECT id, "isDefault" FROM "ContractTemplate" WHERE "organizationId"=$1 AND type='Sales Order'`, [org])).rows;
  assert.equal(rows.find((r) => r.id === mineId).isDefault, false);
  assert.equal(rows.find((r) => r.id === salesOrder.id).isDefault, true);

  log("the templates list marks which Sales Order is in use and which is the alternate");
  await page.goto(`${BASE}/dashboard/contracts/templates`);
  const card = (name) => page.locator("a.card").filter({ has: page.locator("p.font-semibold", { hasText: new RegExp(`^${name}$`) }) });
  assert.equal(await card("Multi-Bids Sales Order").locator("[data-testid=template-role]").textContent(), "Alternate");
  assert.equal(await card("Sales Order").locator("[data-testid=template-role]").textContent(), "In use");
  assert.equal(await card("Invoice").locator("[data-testid=template-role]").count(), 0, "a type with one template shows no role");

  log("seed a deal with a quote; the Contract Coordinator's first card starts on the built-in Sales Order");
  await sql(`INSERT INTO "Contact" (id,"organizationId",name,email,"updatedAt") VALUES ('ctc_trp','${org}','Dana Buyer','dana@example.com',now())`);
  await sql(`INSERT INTO "Deal" (id,"organizationId","contactId",title,stage,"updatedAt") VALUES ('deal_trp','${org}','ctc_trp','Roof','QUOTE_SENT',now())`);
  await sql(
    `INSERT INTO "Quote" (id,"organizationId","contactId","dealId",number,title,status,"publicToken","updatedAt")
     VALUES ('quo_trp','${org}','ctc_trp','deal_trp',1000,'Roof quote','SENT','tok_quo_trp_0123456789',now())`,
  );
  await sql(`INSERT INTO "QuoteLineItem" (id,"quoteId",name,quantity,"unitPriceCents",tag,position) VALUES ('qli_trp','quo_trp','Shingles',1,10000,'MATERIALS',0)`);
  const selected = (id) => page.locator(id).evaluate((el) => el.selectedOptions[0].textContent);
  await page.goto(`${BASE}/dashboard/deals/tracker?dealId=deal_trp`);
  await page.locator("[data-testid=tracker-grid]").waitFor();
  assert.match(await selected("#col-1-template"), /^Sales Order/);

  log("tick 'Use this one' on ours: it becomes the one in use, and the Coordinator starts on it");
  await page.goto(`${BASE}/dashboard/contracts/templates/${mineId}`);
  await page.locator("[data-testid=template-in-use]").getByText("In use now: Sales Order").waitFor();
  await page.check("[data-testid=template-is-default]");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByText("Template saved").waitFor();
  rows = (await sql(`SELECT id, "isDefault" FROM "ContractTemplate" WHERE "organizationId"=$1 AND type='Sales Order'`, [org])).rows;
  assert.equal(rows.find((r) => r.id === mineId).isDefault, true);
  assert.equal(rows.find((r) => r.id === salesOrder.id).isDefault, false);
  await page.goto(`${BASE}/dashboard/deals/tracker?dealId=deal_trp`);
  await page.locator("[data-testid=tracker-grid]").waitFor();
  assert.match(await selected("#col-1-template"), /Multi-Bids Sales Order/);
  await shot(page, "02-coordinator-uses-ours");

  log("unticking it on ours hands Sales Order back to the built-in");
  await page.goto(`${BASE}/dashboard/contracts/templates/${mineId}`);
  await page.uncheck("[data-testid=template-is-default]");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByText("Template saved").waitFor();
  rows = (await sql(`SELECT id, "isDefault" FROM "ContractTemplate" WHERE "organizationId"=$1 AND type='Sales Order'`, [org])).rows;
  assert.equal(rows.find((r) => r.id === mineId).isDefault, false);
  assert.equal(rows.find((r) => r.id === salesOrder.id).isDefault, true);

  log("make ours the one again, then delete it: the built-in takes Sales Order back");
  await page.check("[data-testid=template-is-default]");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByText("Template saved").waitFor();
  await page.getByRole("button", { name: "Delete template" }).click();
  await page.waitForURL(/\/dashboard\/contracts\/templates$/);
  rows = (await sql(`SELECT id, "isDefault" FROM "ContractTemplate" WHERE "organizationId"=$1 AND type='Sales Order'`, [org])).rows;
  assert.deepEqual(rows, [{ id: salesOrder.id, isDefault: true }]);

  log("moving a template to another type leaves exactly one in use on each side");
  await page.goto(`${BASE}/dashboard/contracts/templates/${salesOrder.id}`);
  await page.selectOption("#type", "Invoice");
  await page.check("[data-testid=template-is-default]");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByText("Template saved").waitFor();
  const perType = (await sql(`SELECT type, count(*) FILTER (WHERE "isDefault")::int n FROM "ContractTemplate" WHERE "organizationId"=$1 GROUP BY type`, [org])).rows;
  for (const row of perType) assert.equal(row.n, 1, row.type);
  assert.equal(perType.find((r) => r.type === "Sales Order"), undefined);

  await browser.close();
  await sql(`DELETE FROM "Organization" WHERE slug LIKE $1`, [SLUG_LIKE]);
  console.log(`\nAll ${step} steps passed. Screenshots in ${OUT}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
