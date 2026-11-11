/* Load test for Products at a distributor's full catalog (Oct 25, 2026).
 *
 * The Products page used to load every product: 8,600 of them made it
 * 44 MB and 24 seconds, and the quote's product picker shipped the whole
 * catalog too. This fills a workspace with 25,000 products straight in
 * SQL, times the pages and searches a user opens, and then brings in a
 * 25,000-row ratesheet for a new supplier through Import Ratesheet, which
 * used to stop at 2,000 new products. It fails if a page is over its
 * budget. Last, an apparel-style sheet where every row has the same name
 * and its own part number, against 8,000 products of that name: the
 * import's name matching used to scan every same-named product for every
 * row, which froze the preview (found by the Oct 25, 2026 audit).
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
async function timed(page, label, url, ready, budget = PAGE_BUDGET_S, maxBytes = 1024 * 1024) {
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
  assert.ok(bytes < maxBytes, `${label} is ${(bytes / 1024).toFixed(0)} KB`);
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

  log("See product list on the 25,000-row sheet (Release 3a): open, search, take all off and put all back");
  await timed(page, "Ratesheets page with a 25,000-line sheet", `${BASE}/dashboard/products/ratesheets`, "[data-testid=linked-file-lines]");
  assert.match(await page.getByTestId("linked-file-lines").first().innerText(), /25,000 of 25,000 products in Products/);
  const list = page.getByTestId("product-list");
  const openStart = Date.now();
  await page.getByRole("button", { name: "See product list" }).first().click();
  await list.getByTestId("product-list-row").nth(49).waitFor({ timeout: 30_000 });
  const openSeconds = (Date.now() - openStart) / 1000;
  console.log(`     ${openSeconds.toFixed(2)}s  the list's first 50 of 25,000`);
  assert.ok(openSeconds < PAGE_BUDGET_S, `opening the list took ${openSeconds.toFixed(2)}s`);
  const searchStart = Date.now();
  await list.getByLabel("Search this sheet").fill("item 24999");
  await page.waitForFunction(() => document.querySelectorAll("[data-testid=product-list-row]").length === 1, null, { timeout: 30_000 });
  console.log(`     ${((Date.now() - searchStart) / 1000).toFixed(2)}s  searching the sheet for one item`);
  await list.getByLabel("Search this sheet").fill("");
  await list.getByTestId("product-list-row").nth(49).waitFor();
  const saveAll = async (button, label) => {
    await list.getByRole("button", { name: button }).click();
    await list.getByTestId("product-list-actions-bottom").getByText(/25,000 (ticked|unticked)/).waitFor({ timeout: 30_000 });
    const start = Date.now();
    await list.getByTestId("product-list-actions-top").getByRole("button", { name: "Save and accept" }).click();
    await list.getByTestId("product-list-result").waitFor({ timeout: 280_000 });
    const seconds = (Date.now() - start) / 1000;
    console.log(`     ${seconds.toFixed(1)}s  ${label}`);
    assert.ok(seconds < 240, `${label} took ${seconds.toFixed(0)}s`);
    return list.getByTestId("product-list-result").innerText();
  };
  assert.match(await saveAll("Clear all", "taking 25,000 off in batches of 500"), /25,000 taken off \(25,000 turned off: no other supplier\)/);
  const off = (await sql(`SELECT count(*)::int n FROM "Product" WHERE "organizationId"=$1 AND sku LIKE 'BC-%' AND active`, [org])).rows[0].n;
  assert.equal(off, 0);
  await list.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "See product list" }).first().click();
  await list.getByTestId("product-list-row").nth(49).waitFor({ timeout: 30_000 });
  assert.match(await saveAll("Select all 25,000", "putting 25,000 back"), /25,000 linked to products you already had/);
  const back = (await sql(
    `SELECT count(*)::int n, count(ps.id)::int rows FROM "Product" p
       LEFT JOIN "ProductSupplier" ps ON ps."productId" = p.id AND ps."preferredFor" = p.id
      WHERE p."organizationId"=$1 AND p.sku LIKE 'BC-%' AND p.active AND p."distributorId"='dst_pl_new'`,
    [org],
  )).rows[0];
  assert.deepEqual(back, { n: SHEET_ROWS, rows: SHEET_ROWS }, "every one back on, starred to the sheet's supplier, none doubled");
  await list.getByRole("button", { name: "Done" }).click();

  log("an apparel sheet: 8,000 rows all named Classic Tee, against 8,000 Classic Tees already carried");
  await sql(
    `INSERT INTO "Product" (id,"organizationId",name,description,sku,"unitPriceCents","costCents","defaultTag","distributorId",active,"updatedAt")
     SELECT 'prd_pl_tee_' || g, $1, 'Classic Tee', '', 'CT-' || g, 1500, 900, 'MATERIALS', 'dst_pl_3', true, now()
       FROM generate_series(1, 8000) g`,
    [org],
  );
  const tees = path.join(OUT, "classic-tees.csv");
  const teeLines = ["Style #,Product,Dealer,MSRP"];
  for (let i = 1; i <= 8000; i += 1) teeLines.push(`NT-${i},Classic Tee,${(5 + (i % 9)).toFixed(2)},${(15 + (i % 9)).toFixed(2)}`);
  fs.writeFileSync(tees, teeLines.join("\n") + "\n");
  await page.goto(`${BASE}/dashboard/products`);
  await page.getByRole("button", { name: "Link Ratesheet" }).click();
  await page.getByRole("button", { name: /Import Ratesheet/ }).click();
  const previewStart = Date.now();
  await page.setInputFiles("#ratesheet-import-file", tees);
  await page.getByTestId("ratesheet-summary").waitFor({ timeout: 60000 });
  await page.locator("#ratesheet-supplier").selectOption("dst_pl_new");
  await page.waitForFunction(() => !document.body.innerText.includes("matching your catalog"), null, { timeout: 120_000 });
  await page.getByTestId("ratesheet-summary").getByText(/8,000 products on the sheet/).waitFor({ timeout: 60000 });
  const previewSeconds = (Date.now() - previewStart) / 1000;
  console.log(`     ${previewSeconds.toFixed(1)}s  preview of 8,000 same-named rows`);
  assert.ok(previewSeconds < 15, `the preview took ${previewSeconds.toFixed(1)}s`);
  const teeStart = Date.now();
  await page.getByTestId("ratesheet-import").click();
  await page.getByTestId("ratesheet-done").waitFor({ timeout: 280_000 });
  const teeSeconds = (Date.now() - teeStart) / 1000;
  console.log(`     ${teeSeconds.toFixed(1)}s  import of 8,000 same-named rows`);
  assert.ok(teeSeconds < 60, `the import took ${teeSeconds.toFixed(0)}s`);
  const teeCount = (await sql(
    `SELECT count(*)::int n FROM "Product" WHERE "organizationId"=$1 AND name='Classic Tee' AND sku LIKE 'NT-%'`,
    [org],
  )).rows[0].n;
  assert.equal(teeCount, 8000, "each new style number is its own product, none merged by name");

  log("Release 3b: every product with 8 labels and a picture; the list still inside budget");
  await sql(
    `INSERT INTO "VariationGroup" (id,"organizationId",kind,name,position,"updatedAt") VALUES
       ('vg_pl_color',$1,'COLOR','Color',1,now()), ('vg_pl_size',$1,'SIZE','Size',2,now()), ('vg_pl_unit',$1,'UNIT','Unit',0,now())`,
    [org],
  );
  await sql(
    `INSERT INTO "VariationOption" (id,"organizationId","groupId",name,position,"updatedAt")
     SELECT 'vo_pl_' || g || '_' || i, $1, 'vg_pl_' || g, initcap(g) || ' ' || i, i, now()
       FROM unnest(ARRAY['color','size']) g, generate_series(1, 4) i`,
    [org],
  );
  await sql(
    `INSERT INTO "VariationOption" (id,"organizationId","groupId",name,position,contains,"baseUnit",tag,"updatedAt")
     VALUES ('vo_pl_box',$1,'vg_pl_unit','Box of 12',100,12,'EACH','MATERIALS',now())`,
    [org],
  );
  const labelStart = Date.now();
  await sql(
    `INSERT INTO "ProductVariation" ("productId","optionId","organizationId")
     SELECT p.id, o.id, $1 FROM "Product" p CROSS JOIN "VariationOption" o
      WHERE p."organizationId"=$1 AND o."organizationId"=$1 AND o."groupId" IN ('vg_pl_color','vg_pl_size')`,
    [org],
  );
  await sql(
    `INSERT INTO "ProductImage" (id,"organizationId","productId",position,"storageKey","thumbKey","docKey","contentType","sizeBytes","publicToken")
     SELECT 'pi_pl_' || p.id, $1, p.id, 0, 'org/x/products/' || p.id || '/a.webp', 'org/x/products/' || p.id || '/a-thumb.webp',
            'org/x/products/' || p.id || '/a-doc.jpg', 'image/webp', 1000, 'tok_pi_' || p.id
       FROM "Product" p WHERE p."organizationId"=$1`,
    [org],
  );
  await sql(`ANALYZE "ProductVariation"`);
  await sql(`ANALYZE "ProductImage"`);
  console.log(`     ${((Date.now() - labelStart) / 1000).toFixed(1)}s  seeded the labels and pictures`);
  await timed(page, "Products with pictures and labels, first page", `${BASE}/dashboard/products`, "[data-testid=product-label-counts]");
  await timed(page, "Products with pictures and labels, 100 per page", `${BASE}/dashboard/products?per=100`, "[data-testid=product-label-counts]");
  assert.equal(await page.locator("[data-testid=product-thumb]").count(), 100);
  assert.match(await page.locator("[data-testid=product-label-counts]").first().innerText(), /^4 colors · 4 sizes$/);

  log("a 200-line sent quote with labels, a workspace unit and pictures saves well inside the 5-second transaction");
  await sql(
    `INSERT INTO "Quote" (id,"organizationId","contactId","dealId",number,title,status,"publicToken","updatedAt")
     VALUES ('quo_pl_200',$1,'ctc_pl','deal_pl',1002,'Big tee order','SENT','tok_quo_pl_200_0123456',now())`,
    [org],
  );
  await sql(
    `INSERT INTO "QuoteLineItem" (id,"quoteId","productId",name,quantity,"unitPriceCents",tag,position,variations,"variationText","customUnitId","unitLabel","imageId")
     SELECT 'qli_pl_' || n, 'quo_pl_200', p.id, p.name, 1, 1500, 'MATERIALS', n - 1,
            jsonb_build_array(jsonb_build_object('groupId','vg_pl_color','group','Color','optionId','vo_pl_color_1','label','Color 1')),
            'Color 1', 'vo_pl_box', 'Box of 12', 'pi_pl_' || p.id
       FROM (SELECT id, name, row_number() OVER (ORDER BY id) AS n FROM "Product"
              WHERE "organizationId"=$1 AND "defaultTag"='MATERIALS' ORDER BY id LIMIT 200) p`,
    [org],
  );
  // A 200-line quote is the largest a quote gets. Its page was already
  // 1.0 MB before Release 3b (every row carries the supplier list); the
  // label selects add about 0.4 MB. Uncompressed: it travels at about a
  // tenth of that.
  await timed(
    page,
    "a 200-line quote with labels and pictures",
    `${BASE}/dashboard/quotes/quo_pl_200`,
    "select[aria-label='Line 200 Color']",
    4,
    2 * 1024 * 1024,
  );
  await page.locator("select[aria-label='Line 1 Color']").selectOption("vo_pl_color_2");
  await page.locator("select[aria-label='Line 200 Size']").selectOption("vo_pl_size_3");
  await page.getByLabel("Line 100 quantity").fill("7");
  // How long the save holds its transaction open, read from Postgres while
  // it runs: one write per line, all or nothing. It has 20 s; past 5 s is
  // the early warning that a quote this size is getting slow to save.
  const monitor = new Client({ connectionString: DB });
  await monitor.connect();
  let longestTx = 0;
  let watching = true;
  const watcher = (async () => {
    while (watching) {
      const open = await monitor.query(
        `SELECT max(extract(epoch FROM now() - xact_start)) AS s FROM pg_stat_activity
          WHERE datname = current_database() AND pid <> pg_backend_pid() AND xact_start IS NOT NULL AND state <> 'idle'`,
      );
      longestTx = Math.max(longestTx, Number(open.rows[0].s || 0));
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  })();
  const saveStart = Date.now();
  await page.getByTestId("quote-save").click();
  await page.getByText(/Line items saved|went wrong|error/i).first().waitFor({ timeout: 30000 });
  const saveSeconds = (Date.now() - saveStart) / 1000;
  watching = false;
  await watcher;
  await monitor.end();
  timings.push({ label: "saving the 200-line quote", seconds: saveSeconds });
  console.log(`     ${saveSeconds.toFixed(2)}s  saving the 200-line quote, the page redrawn after (transaction open ${longestTx.toFixed(2)}s)`);
  await page.getByText("Line items saved").waitFor({ timeout: 1000 });
  assert.ok(longestTx < 5, `the save held its transaction ${longestTx.toFixed(2)}s`);
  assert.ok(saveSeconds < 8, `the save took ${saveSeconds.toFixed(2)}s`);
  const saved = (await sql(
    `SELECT id, "variationText", "imageId", quantity FROM "QuoteLineItem" WHERE id IN ('qli_pl_1','qli_pl_100','qli_pl_200') ORDER BY position`,
  )).rows;
  assert.deepEqual(saved.map((row) => row.variationText), ["Color 2", "Color 1", "Color 1 · Size 3"]);
  assert.equal(saved[1].quantity, 7);

  await browser.close();
  await sql(`DELETE FROM "Organization" WHERE slug LIKE $1`, [SLUG_LIKE]);
  const slowest = timings.reduce((a, b) => (b.seconds > a.seconds ? b : a));
  console.log(`\nAll ${step} steps passed. Slowest: ${slowest.label} at ${slowest.seconds.toFixed(2)}s.`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
