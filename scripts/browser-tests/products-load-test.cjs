/* Load test for Products at a distributor's full catalog (Oct 25, 2026).
 *
 * The Products page used to load every product: 8,600 of them made it
 * 44 MB and 24 seconds, and the quote's product picker shipped the whole
 * catalog too. This fills a workspace with 25,000 products straight in
 * SQL, times the pages and searches a user opens, and then brings in a
 * 25,000-row ratesheet for a new supplier through Import Ratesheet, which
 * used to stop at 2,000 new products. It fails if a page is over its
 * budget.
 *
 * Run it against a server pointed through the slow proxy, so the times
 * are the live site's, not the local database's:
 *
 *   node scripts/browser-tests/slow-db-proxy.cjs &          # :5434 -> :5433, 8 ms each way
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5434/scb_test npx next start
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/scb_test \
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules \
 *   node scripts/browser-tests/products-load-test.cjs
 *
 * Takes a few minutes. Signs up its own workspace and deletes it at the
 * end. Never point it at the live database.
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
const OUT = process.env.SHOTS_DIR || path.join(os.tmpdir(), "scb-browser-shots-products-load");
fs.mkdirSync(OUT, { recursive: true });

const EMAIL = "test-products-load@example.com";
const PASSWORD = "password123";
const COMPANY = "Test Products Load Co";
const SLUG_LIKE = "test-products-load-co%";
const PRODUCTS = 25_000;
const SHEET_ROWS = 25_000;
// Seconds a page may take, through the slow proxy.
const PAGE_BUDGET_S = Number(process.env.LOAD_BUDGET_S || 2);
// Seconds a picker's search may take to answer.
const SEARCH_BUDGET_S = 0.5;

let step = 0;
const timings = [];
function log(msg) {
  step += 1;
  console.log(`[${String(step).padStart(2, "0")}] ${msg}`);
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
// Opened twice: the first visit pays for loading the route's code once
// per server start, which no customer sees twice.
async function timed(page, label, url, ready, budget = PAGE_BUDGET_S) {
  await page.goto(url);
  await page.locator(ready).first().waitFor({ timeout: 60000 });
  const started = Date.now();
  const response = await page.goto(url);
  await page.locator(ready).first().waitFor({ timeout: 60000 });
  const seconds = (Date.now() - started) / 1000;
  const bytes = (await response.body()).length;
  timings.push({ label, seconds });
  console.log(`     ${seconds.toFixed(2)}s  ${(bytes / 1024).toFixed(0)} KB  ${label}`);
  assert.ok(seconds <= budget, `${label} took ${seconds.toFixed(2)}s, budget ${budget}s`);
  assert.ok(bytes < 1024 * 1024, `${label} is ${(bytes / 1024).toFixed(0)} KB`);
}
async function timedSearch(page, label, query) {
  const result = await page.evaluate(async (url) => {
    await fetch(url);
    const started = performance.now();
    const response = await fetch(url);
    const rows = await response.json();
    return { ms: performance.now() - started, count: rows.length, first: rows[0]?.name ?? null };
  }, `/dashboard/products/search?active=1&q=${encodeURIComponent(query)}`);
  const seconds = result.ms / 1000;
  timings.push({ label, seconds });
  console.log(`     ${seconds.toFixed(2)}s  ${result.count} found, first "${result.first}"  ${label}`);
  assert.ok(seconds <= SEARCH_BUDGET_S, `${label} took ${seconds.toFixed(2)}s, budget ${SEARCH_BUDGET_S}s`);
  return result;
}

(async () => {
  await sql(`DELETE FROM "Organization" WHERE slug LIKE $1`, [SLUG_LIKE]);
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
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
  const org = (await sql(`SELECT id FROM "Organization" WHERE slug LIKE $1`, [SLUG_LIKE])).rows[0].id;
  await page.goto(`${BASE}/login`);
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/dashboard$/);

  log(`seed ${PRODUCTS.toLocaleString()} products from 20 suppliers and 200 manufacturers, straight in SQL`);
  const seedStart = Date.now();
  await sql(
    `INSERT INTO "Distributor" (id,"organizationId",name,"updatedAt")
     SELECT 'dst_pl_' || g, $1, 'Supplier ' || lpad(g::text, 2, '0'), now() FROM generate_series(1, 20) g`,
    [org],
  );
  await sql(
    `INSERT INTO "Manufacturer" (id,"organizationId",name)
     SELECT 'mfr_pl_' || g, $1, 'Maker ' || lpad(g::text, 3, '0') FROM generate_series(1, 200) g`,
    [org],
  );
  await sql(
    `INSERT INTO "Product" (id,"organizationId",name,description,sku,"unitPriceCents","costCents","defaultTag","distributorId","manufacturerId","serviceType",active,"updatedAt")
     SELECT 'prd_pl_' || g, $1,
            (ARRAY['Copper pipe','Cat6 cable','Card reader','Door strike','Conduit','Breaker','Junction box','Camera'])[1 + g % 8] || ' ' || g,
            'Catalog item ' || g, 'PL-' || lpad(g::text, 6, '0'), 1000 + g % 9000, 500 + g % 4000,
            (ARRAY['MATERIALS','MATERIALS','MATERIALS','LABOR','SOFTWARE','SHIPPING'])[1 + g % 6]::"LineItemTag",
            'dst_pl_' || (1 + g % 20), 'mfr_pl_' || (1 + g % 200),
            (ARRAY['Low Voltage','Plumbing','Electrical',NULL])[1 + g % 4], g % 25 <> 0, now()
       FROM generate_series(1, $2::int) g`,
    [org, PRODUCTS],
  );
  console.log(`     seeded in ${((Date.now() - seedStart) / 1000).toFixed(1)}s`);
  await sql(`ANALYZE "Product"`);
  await sql(`INSERT INTO "Contact" (id,"organizationId",name,"updatedAt") VALUES ('ctc_pl',$1,'Load Buyer',now())`, [org]);
  await sql(`INSERT INTO "Deal" (id,"organizationId","contactId",title,stage,"updatedAt") VALUES ('deal_pl',$1,'ctc_pl','Load deal','QUOTE_SENT',now())`, [org]);
  await sql(
    `INSERT INTO "Quote" (id,"organizationId","contactId","dealId",number,title,status,"publicToken","updatedAt")
     VALUES ('quo_pl',$1,'ctc_pl','deal_pl',1000,'Load quote','DRAFT','tok_quo_pl_0123456789',now())`,
    [org],
  );

  log("time the Products pages a person opens");
  const row = "table tbody tr";
  await timed(page, "Products, first page of 50", `${BASE}/dashboard/products`, row);
  await timed(page, "Products, 100 per page", `${BASE}/dashboard/products?per=100`, row);
  await timed(page, "Products, page 400 of 500", `${BASE}/dashboard/products?page=400`, row);
  await timed(page, "Products search 'cat6 cable'", `${BASE}/dashboard/products?q=cat6%20cable`, row);
  await timed(page, "Products search by part number", `${BASE}/dashboard/products?q=PL-012345`, row);
  await timed(page, "Products, Supplier + Tag + Active", `${BASE}/dashboard/products?supplier=dst_pl_3&tag=MATERIALS&status=active`, row);
  await timed(page, "Products, Manufacturer + Service type", `${BASE}/dashboard/products?maker=mfr_pl_18&service=Plumbing`, row);
  assert.match(await page.getByTestId("page-summary").innerText(), /of [\d,]+ products$/);

  log("time the pages with a product picker, and the picker's search");
  await timed(page, "Quote page", `${BASE}/dashboard/quotes/quo_pl`, "[aria-label='Add product from catalog']");
  await timed(page, "Create Ratesheet", `${BASE}/dashboard/products/ratesheets/new`, "[aria-label='Search products']");
  const empty = await timedSearch(page, "Picker, empty box (first 20)", "");
  assert.equal(empty.count, 20);
  const exact = await timedSearch(page, "Picker, a part number typed in full", "PL-012345");
  assert.match(exact.first, / 12345$/);
  await timedSearch(page, "Picker, two words", "door strike 99");
  await timedSearch(page, "Picker, one word that matches thousands", "copper");

  log(`bring in a ${SHEET_ROWS.toLocaleString()}-row ratesheet for a new supplier through Import Ratesheet`);
  await sql(`INSERT INTO "Distributor" (id,"organizationId",name,"updatedAt") VALUES ('dst_pl_new',$1,'Big Catalog Supply',now())`, [org]);
  const sheet = path.join(OUT, "big-catalog.csv");
  const lines = ["Mfr Part #,Description,Dealer,MSRP"];
  for (let i = 1; i <= SHEET_ROWS; i += 1) lines.push(`BC-${i},Big catalog item ${i},${(10 + (i % 90)).toFixed(2)},${(20 + (i % 90)).toFixed(2)}`);
  fs.writeFileSync(sheet, lines.join("\n") + "\n");
  await page.goto(`${BASE}/dashboard/products`);
  await page.getByRole("button", { name: "Link Ratesheet" }).click();
  await page.getByRole("button", { name: /Import Ratesheet/ }).click();
  await page.setInputFiles("#ratesheet-import-file", sheet);
  await page.getByTestId("ratesheet-summary").waitFor({ timeout: 60000 });
  await page.locator("#ratesheet-supplier").selectOption("dst_pl_new");
  await page.waitForFunction(() => !document.body.innerText.includes("matching your catalog"), null, { timeout: 120_000 });
  assert.match(await page.getByTestId("ratesheet-summary").innerText(), /25,000 products on the sheet · 25,000 ticked/);
  const importStart = Date.now();
  await page.getByTestId("ratesheet-import").click();
  await page.getByTestId("ratesheet-done").waitFor({ timeout: 280_000 });
  const importSeconds = (Date.now() - importStart) / 1000;
  console.log(`     ${importSeconds.toFixed(1)}s  import of ${SHEET_ROWS.toLocaleString()} new products`);
  const landed = (await sql(
    `SELECT count(*)::int n, count(DISTINCT sku)::int skus, min("costCents")::int lo, max("costCents")::int hi
       FROM "Product" WHERE "organizationId"=$1 AND "distributorId"='dst_pl_new'`,
    [org],
  )).rows[0];
  assert.deepEqual(landed, { n: SHEET_ROWS, skus: SHEET_ROWS, lo: 1000, hi: 9900 }, "every row, once, at its dealer cost");
  assert.ok(importSeconds < 240, `the import took ${importSeconds.toFixed(0)}s`);

  log(`with ${(PRODUCTS + SHEET_ROWS).toLocaleString()} products the list and the picker are still inside budget`);
  await timed(page, "Products, first page of 50 (50,000 products)", `${BASE}/dashboard/products`, row);
  await timed(page, "Products filtered to the new supplier", `${BASE}/dashboard/products?supplier=dst_pl_new`, row);
  const bc = await timedSearch(page, "Picker, a new part number", "BC-24999");
  assert.equal(bc.first, "Big catalog item 24999");

  await browser.close();
  await sql(`DELETE FROM "Organization" WHERE slug LIKE $1`, [SLUG_LIKE]);
  const slowest = timings.reduce((a, b) => (b.seconds > a.seconds ? b : a));
  console.log(`\nAll ${step} steps passed. Slowest: ${slowest.label} at ${slowest.seconds.toFixed(2)}s.`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
