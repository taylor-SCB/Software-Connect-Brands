/* Browser regression for Release 3a, the deeper catalog (Nov 4, 2026).
 *
 * A ratesheet is a row on the Ratesheets page with its own search and a
 * See product list pop-out: tick and untick its products into Products,
 * a COGS discount and a required minimum markup, Cancel / Save and accept
 * at the top and the bottom. A product is bought from several suppliers,
 * each its own row with a price, a COGS discount, an MSRP and a minimum
 * margin shown in dollars; the starred one sets the product's COGS. The
 * Products list shows the star and opens a sub-row per supplier, its
 * Supplier filter matches any of them, and a price under the starred
 * supplier's minimum is flagged in red there and on a quote's lines.
 *
 * Runs against a built app (`npm run build:app && npx next start`) and a
 * local Postgres that has had `prisma migrate deploy` run against it. It
 * signs up its own workspace and deletes it again on the next run.
 * Never point it at the live database.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/scb_test \
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules \
 *   node scripts/browser-tests/catalog-suppliers.cjs
 */
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS on purpose: NODE_PATH only resolves the global playwright for require() */
const os = require("node:os");
const { chromium, devices } = require("playwright");
const { Client } = require("pg");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const BASE = process.env.BASE || "http://localhost:3000";
const DB = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5433/scb_test";
const OUT = process.env.SHOTS_DIR || path.join(os.tmpdir(), "scb-browser-shots-catalog-suppliers");
fs.mkdirSync(OUT, { recursive: true });

const EMAIL = "test-catalog-suppliers@example.com";
const PASSWORD = "password123";
const COMPANY = "Test Catalog Suppliers Co";
const SLUG = "test-catalog-suppliers-co%";

let step = 0;
function log(msg) {
  step += 1;
  console.log(`[${String(step).padStart(2, "0")}] ${msg}`);
}
async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `cs-${name}.png`), fullPage: true });
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

(async () => {
  await sql(`DELETE FROM "Organization" WHERE slug LIKE $1`, [SLUG]);

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (err) => console.error("PAGE ERROR:", err.message));

  log("signup, activate, login");
  await page.goto(`${BASE}/signup`);
  await page.fill("[name=companyName]", COMPANY);
  await page.fill("[name=name]", "Cass Test");
  await page.fill("[name=email]", EMAIL);
  await page.fill("[name=phone]", "5550000000");
  await page.fill("[name=password]", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/signup\/submitted/);
  await sql(`UPDATE "Organization" SET status='ACTIVE', "reviewedAt"=now() WHERE slug LIKE $1`, [SLUG]);
  const org = (await sql(`SELECT id FROM "Organization" WHERE slug LIKE $1`, [SLUG])).rows[0].id;
  await login(page);

  // Scoped to this workspace, like every lookup here.
  const product = async (sku) =>
    (await sql(`SELECT * FROM "Product" WHERE "organizationId"=$1 AND sku=$2`, [org, sku])).rows[0];
  const rowsOf = async (productId) =>
    (
      await sql(
        `SELECT d.name, ps."costCents", ps."discountBp", ps."listPriceCents", ps."minMarginBp", ps."preferredFor" IS NOT NULL AS starred
           FROM "ProductSupplier" ps JOIN "Distributor" d ON d.id = ps."distributorId"
          WHERE ps."organizationId"=$1 AND ps."productId"=$2 ORDER BY d.name`,
        [org, productId],
      )
    ).rows;

  log("seed: three suppliers, a rep, a product bought from ADI and one with no supplier row yet");
  await sql(
    `INSERT INTO "Distributor" (id,"organizationId",name,"updatedAt") VALUES
       ('dst_cs_spirit',$1,'Spirit Supply',now()), ('dst_cs_adi',$1,'ADI',now()), ('dst_cs_anix',$1,'Anixter',now())`,
    [org],
  );
  await sql(
    `INSERT INTO "DistributorContact" (id,"organizationId","distributorId",name,email) VALUES
       ('dc_cs_ada',$1,'dst_cs_adi','Ada Rep','ada@adi.example'), ('dc_cs_mike',$1,'dst_cs_spirit','Mike Chen','mike@spirit.example')`,
    [org],
  );
  await sql(
    `INSERT INTO "Product" (id,"organizationId",name,description,sku,"unitPriceCents","costCents","defaultTag","distributorId",active,"updatedAt") VALUES
       ('prd_cs_reader',$1,'Prox reader','','PR-100',15000,10000,'MATERIALS','dst_cs_adi',true,now()),
       ('prd_cs_strike',$1,'Door strike','','DS-1',4000,2500,'MATERIALS','dst_cs_spirit',true,now())`,
    [org],
  );
  await sql(
    `INSERT INTO "ProductSupplier" (id,"organizationId","productId","distributorId","costCents","preferredFor","updatedAt")
       VALUES ('ps_cs_reader_adi',$1,'prd_cs_reader','dst_cs_adi',10000,'prd_cs_reader',now())`,
    [org],
  );
  await sql(`INSERT INTO "_DistributorContactToProduct" ("A","B") VALUES ('dc_cs_ada','prd_cs_reader')`);

  log("import Spirit's sheet: three ticked, two left out; Prox reader gets Spirit beside ADI");
  const csv = path.join(OUT, "spirit-q4.csv");
  fs.writeFileSync(
    csv,
    "Mfr Part #,Description,Your Cost,MSRP\nPR-100,Prox reader,90,200\nDS-1,Door strike,20,40\nKP-1,Keypad,50,100\nEB-1,Exit button,10,25\nPS-1,Power supply,30,60\n",
  );
  await page.goto(`${BASE}/dashboard/products`);
  await page.getByRole("button", { name: "Link Ratesheet" }).click();
  await page.getByRole("button", { name: /Import Ratesheet/ }).click();
  await page.setInputFiles("#ratesheet-import-file", csv);
  await page.getByTestId("ratesheet-summary").waitFor();
  await page.locator("#ratesheet-supplier").selectOption("dst_cs_spirit");
  await page.locator("#ratesheet-rule").selectOption("MARKUP");
  await page.locator("#ratesheet-percent").fill("50");
  const importRow = (text) => page.getByTestId("ratesheet-row").filter({ hasText: text });
  await importRow("Exit button").getByRole("checkbox").uncheck();
  await importRow("Power supply").getByRole("checkbox").uncheck();
  assert.ok(await importRow("Prox reader").getByTestId("ratesheet-second-supplier").isVisible());
  await page.getByTestId("ratesheet-import").click();
  await page.getByTestId("ratesheet-done").waitFor();
  assert.match(await page.getByTestId("ratesheet-done").innerText(), /Imported 3 products from Spirit Supply: 1 new, .*1 added beside another supplier/);
  const sheet = (await sql(`SELECT * FROM "LinkedRatesheet" WHERE "organizationId"=$1`, [org])).rows[0];
  assert.equal(sheet.lineCount, 5, "every row of the sheet is kept, imported or not");
  const reader0 = await product("PR-100");
  assert.deepEqual([reader0.costCents, reader0.unitPriceCents, reader0.distributorId], [10000, 15000, "dst_cs_adi"], "ADI still sets the COGS");
  assert.deepEqual(await rowsOf("prd_cs_reader"), [
    { name: "ADI", costCents: 10000, discountBp: 0, listPriceCents: null, minMarginBp: null, starred: true },
    { name: "Spirit Supply", costCents: 9000, discountBp: 0, listPriceCents: 20000, minMarginBp: null, starred: false },
  ]);
  const strike0 = await product("DS-1");
  assert.deepEqual([strike0.costCents, strike0.unitPriceCents], [2000, 4000], "cost down keeps the price");
  assert.deepEqual((await rowsOf("prd_cs_strike")).map((row) => [row.name, row.costCents, row.starred]), [["Spirit Supply", 2000, true]], "a product with no supplier row gets one");
  const keypad0 = await product("KP-1");
  assert.deepEqual([keypad0.costCents, keypad0.unitPriceCents, keypad0.listPriceCents], [5000, 7500, 10000]);
  assert.equal(await product("EB-1"), undefined, "an unticked row isn't a product");
  await page.getByRole("button", { name: "Done" }).click();

  log("Ratesheets page: the sheet is a row with what's in Products, its own search, and See product list");
  await page.goto(`${BASE}/dashboard/products/ratesheets`);
  assert.match(await page.getByTestId("linked-file-lines").first().innerText(), /3 of 5 products in Products/);
  const sheetSearch = page.getByRole("search").first().getByRole("searchbox");
  await sheetSearch.fill("button");
  await sheetSearch.press("Enter");
  const list = page.getByTestId("product-list");
  await list.waitFor();
  assert.equal(await list.getByLabel("Search this sheet").inputValue(), "button", "the row's search opens the list on what was typed");
  const listRow = (text) => list.getByTestId("product-list-row").filter({ hasText: text });
  await listRow("Exit button").waitFor();
  assert.equal(await list.getByTestId("product-list-row").count(), 1);
  assert.ok(!(await listRow("Exit button").getByRole("checkbox").isChecked()));
  assert.ok(await list.getByTestId("product-list-actions-top").getByRole("button", { name: "Save and accept" }).isVisible());
  assert.ok(await list.getByTestId("product-list-actions-bottom").getByRole("button", { name: "Cancel" }).isVisible());
  await shot(page, "01-search");

  log("the whole list: counts per filter, COGS and MSRP, a second supplier said as such");
  await list.getByLabel("Search this sheet").fill("");
  await page.waitForFunction(() => document.querySelectorAll("[data-testid=product-list-row]").length === 5);
  assert.match(await list.getByTestId("product-list-filter-in").innerText(), /In Products \(3\)/);
  assert.match(await list.getByTestId("product-list-filter-out").innerText(), /Not in Products \(2\)/);
  assert.match(await listRow("Prox reader").innerText(), /beside your starred supplier/);
  assert.match(await listRow("Keypad").innerText(), /\$50\.00[\s\S]*\$50\.00[\s\S]*\$100\.00[\s\S]*\$75\.00/, "their cost, your COGS, MSRP, sell");
  await list.getByTestId("product-list-filter-out").click();
  await page.waitForFunction(() => document.querySelectorAll("[data-testid=product-list-row]").length === 2);
  await list.getByTestId("product-list-filter-all").click();
  await page.waitForFunction(() => document.querySelectorAll("[data-testid=product-list-row]").length === 5);

  log("Cancel throws the ticks away");
  await listRow("Exit button").getByRole("checkbox").check();
  await listRow("Door strike").getByRole("checkbox").uncheck();
  assert.match(await list.getByTestId("product-list-actions-bottom").innerText(), /1 ticked · 1 unticked/);
  await list.getByTestId("product-list-actions-bottom").getByRole("button", { name: "Cancel" }).click();
  await list.waitFor({ state: "detached" });
  assert.equal(await product("EB-1"), undefined);
  assert.equal((await product("DS-1")).active, true);

  log("a typed discount moves the COGS column as it's typed; a bad one is refused in words");
  await page.getByRole("button", { name: "See product list" }).first().click();
  await list.waitFor();
  await page.waitForFunction(() => document.querySelectorAll("[data-testid=product-list-row]").length === 5);
  await list.locator("#product-list-discount").fill("10");
  assert.equal(await listRow("Keypad").getByTestId("product-list-cogs").innerText(), "$45.00");
  await list.locator("#product-list-discount").fill("96");
  await list.getByTestId("product-list-actions-top").getByRole("button", { name: "Save and accept" }).click();
  await list.getByText("Type the discount as a percentage under 95, like 10.").first().waitFor();
  assert.equal((await sql(`SELECT "discountBp" FROM "LinkedRatesheet" WHERE id=$1`, [sheet.id])).rows[0].discountBp, 0);

  log("another tab saving the same sheet: this one waits, in words, and nothing is half-done");
  await list.locator("#product-list-discount").fill("10");
  await list.locator("#product-list-markup").fill("60");
  await listRow("Exit button").getByRole("checkbox").check();
  await listRow("Door strike").getByRole("checkbox").uncheck();
  await sql(`UPDATE "LinkedRatesheet" SET "savingAt"=now() WHERE id=$1`, [sheet.id]);
  await list.getByTestId("product-list-actions-top").getByRole("button", { name: "Save and accept" }).click();
  await list.getByText("This sheet is being saved in another tab. Try again in a moment.").waitFor();
  assert.equal(await product("EB-1"), undefined);
  await sql(`UPDATE "LinkedRatesheet" SET "savingAt"=NULL WHERE id=$1`, [sheet.id]);

  log("Save and accept: one added, one taken off and turned off, the discount on every product from this sheet, the markup raising one price");
  await list.getByTestId("product-list-actions-bottom").getByRole("button", { name: "Save and accept" }).click();
  const result = list.getByTestId("product-list-result");
  await result.waitFor();
  const said = await result.innerText();
  assert.match(said, /Saved: 1 added to Products, 1 taken off \(1 turned off: no other supplier\)\./);
  assert.match(said, /Your 10% discount is on 3 products from this sheet\./);
  assert.match(said, /1 re-priced up to your 60% minimum markup: Exit button \$13\.50 → \$14\.40\./);
  await shot(page, "02-saved");
  const exit = await product("EB-1");
  assert.deepEqual([exit.costCents, exit.unitPriceCents, exit.active, exit.distributorId], [900, 1440, true, "dst_cs_spirit"]);
  const strike1 = await product("DS-1");
  assert.deepEqual([strike1.active, strike1.distributorId], [false, null], "its only supplier gone, it is turned off, not deleted");
  assert.deepEqual(await rowsOf("prd_cs_strike"), []);
  assert.equal((await product("KP-1")).costCents, 4500, "the starred row's discount is the product's COGS");
  assert.equal((await product("KP-1")).unitPriceCents, 7500, "already over the minimum markup: price kept");
  const reader1 = await product("PR-100");
  assert.equal(reader1.costCents, 10000, "a discount on Spirit's row doesn't move a product ADI sets");
  assert.equal((await rowsOf("prd_cs_reader")).find((row) => row.name === "Spirit Supply").discountBp, 1000);
  const sheet1 = (await sql(`SELECT "discountBp","minMarkupBp","savingAt" FROM "LinkedRatesheet" WHERE id=$1`, [sheet.id])).rows[0];
  assert.deepEqual([sheet1.discountBp, sheet1.minMarkupBp, sheet1.savingAt], [1000, 6000, null]);
  await list.getByRole("button", { name: "Done" }).click();
  await page.waitForFunction(() => /3 of 5 products in Products · 10% COGS discount · 60% minimum markup/.test(document.body.innerText));

  log("ticked back in: a turned-off product comes back on, under the sheet's discount");
  await page.getByRole("button", { name: "See product list" }).first().click();
  await list.waitFor();
  assert.equal(await list.locator("#product-list-discount").inputValue(), "10", "the sheet keeps its discount");
  await listRow("Door strike").getByRole("checkbox").check();
  await list.getByTestId("product-list-actions-top").getByRole("button", { name: "Save and accept" }).click();
  await result.waitFor();
  assert.match(await result.innerText(), /Saved: 1 linked to products you already had\./);
  const strike2 = await product("DS-1");
  assert.deepEqual([strike2.active, strike2.costCents, strike2.unitPriceCents, strike2.distributorId], [true, 1800, 4000, "dst_cs_spirit"]);
  await list.getByRole("button", { name: "Done" }).click();

  log("an older sheet whose lines weren't kept is read from its file the first time it's opened");
  await sql(`DELETE FROM "RatesheetLine" WHERE "linkedRatesheetId"=$1`, [sheet.id]);
  await sql(`UPDATE "LinkedRatesheet" SET "lineCount"=NULL, "linesStoredAt"=NULL WHERE id=$1`, [sheet.id]);
  await page.goto(`${BASE}/dashboard/products/ratesheets`);
  await page.getByRole("button", { name: "See product list" }).first().click();
  await list.waitFor();
  await page.waitForFunction(() => document.querySelectorAll("[data-testid=product-list-row]").length === 5);
  assert.match(await list.getByTestId("product-list-filter-in").innerText(), /In Products \(4\)/, "matched back to the four products it is; Power supply was never one");
  assert.ok(await listRow("Prox reader").getByRole("checkbox").isChecked());
  assert.equal((await sql(`SELECT "lineCount" FROM "LinkedRatesheet" WHERE id=$1`, [sheet.id])).rows[0].lineCount, 5);
  await list.getByLabel("Close").click();

  log("the product's Suppliers card: both suppliers, Spirit's discount, and how much cheaper it is");
  await page.goto(`${BASE}/dashboard/products/prd_cs_reader`);
  const card = page.getByTestId("product-suppliers");
  const supplierRow = (name) => card.getByTestId("product-supplier-row").filter({ hasText: name });
  assert.equal(await card.getByTestId("product-supplier-row").count(), 2);
  assert.ok(await card.getByLabel("Star ADI").isChecked());
  assert.equal(await card.getByLabel("Spirit Supply price").inputValue(), "90.00");
  assert.equal(await card.getByLabel("Spirit Supply COGS discount").inputValue(), "10");
  assert.equal(await supplierRow("Spirit Supply").getByTestId("supplier-cogs").innerText(), "$81.00");
  assert.equal(await supplierRow("Spirit Supply").getByTestId("supplier-cheaper").innerText(), "$19.00 cheaper than your starred supplier");
  assert.equal(await card.getByLabel("Remove ADI").count(), 0, "the starred supplier can't be removed; move the star first");

  log("a minimum margin is shown in dollars, and a price under it is red but allowed");
  await card.getByLabel("ADI minimum margin").fill("40");
  const adiMin = await supplierRow("ADI").getByTestId("supplier-min-price").innerText();
  assert.match(adiMin, /\$166\.67[\s\S]*you make \$66\.67[\s\S]*your price is under it/);
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByText("Product saved").waitFor();
  assert.equal((await rowsOf("prd_cs_reader")).find((row) => row.name === "ADI").minMarginBp, 4000);
  assert.equal((await product("PR-100")).unitPriceCents, 15000, "flagged, not changed");
  await shot(page, "03-suppliers-card");

  log("Products list: the star, a sub-row per supplier on asking, and Below minimum in red");
  await page.goto(`${BASE}/dashboard/products?q=prox`);
  const readerRow = page.locator("table tbody tr").filter({ has: page.getByRole("link", { name: "Prox reader" }) });
  assert.equal(await page.locator("table tbody tr").count(), 1, "sub-rows stay shut until asked for");
  assert.match(await readerRow.getByTestId("product-suppliers-toggle").innerText(), /ADI\s*·\s*2 suppliers/);
  assert.equal(await readerRow.getByTestId("product-below-minimum").innerText(), "Below minimum ($166.67)");
  await readerRow.getByTestId("product-suppliers-toggle").click();
  const subRows = page.getByTestId("product-supplier-subrow");
  assert.equal(await subRows.count(), 2);
  assert.match(await subRows.nth(0).innerText(), /ADI[\s\S]*starred, sets your COGS[\s\S]*Minimum margin 40% · \$166\.67 \(you make \$66\.67\)/);
  assert.match(await subRows.nth(1).innerText(), /Spirit Supply[\s\S]*Their price \$90\.00[\s\S]*COGS discount 10%[\s\S]*COGS \$81\.00[\s\S]*MSRP \$200\.00/);
  await shot(page, "04-list-subrows");
  await readerRow.getByTestId("product-suppliers-toggle").click();
  assert.equal(await subRows.count(), 0);

  log("moving the star: Spirit's discounted price is the COGS, read-only, and ADI's rep stays linked");
  await page.goto(`${BASE}/dashboard/products/prd_cs_reader`);
  await card.getByLabel("Star Spirit Supply").check();
  assert.equal(await page.locator("#cost").inputValue(), "81.00");
  assert.ok(await page.locator("#cost").evaluate((el) => el.readOnly), "a discounted star sets the COGS; nothing to type");
  assert.ok(await page.getByText("Spirit Supply's price less your 10% discount — change it under Suppliers.").isVisible());
  assert.equal(await page.locator("#distributorId").inputValue(), "dst_cs_spirit", "the Distributor box follows the star");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByText("Product saved").waitFor();
  const reader2 = await product("PR-100");
  assert.deepEqual([reader2.costCents, reader2.distributorId, reader2.unitPriceCents], [8100, "dst_cs_spirit", 15000]);
  assert.deepEqual((await rowsOf("prd_cs_reader")).map((row) => [row.name, row.starred]), [["ADI", false], ["Spirit Supply", true]]);
  const linked = async () =>
    (await sql(`SELECT "A" FROM "_DistributorContactToProduct" WHERE "B"='prd_cs_reader' ORDER BY "A"`)).rows.map((row) => row.A);
  assert.deepEqual(await linked(), ["dc_cs_ada"], "a supplier still on the product keeps its rep");

  log("remove ADI and add Anixter: the rep goes with ADI, Anixter shows as cheaper");
  await page.goto(`${BASE}/dashboard/products/prd_cs_reader`);
  await card.getByLabel("Remove ADI").click();
  await card.getByLabel("Add a supplier").selectOption({ label: "Anixter" });
  await card.getByLabel("Anixter price").fill("70");
  assert.equal(await supplierRow("Anixter").getByTestId("supplier-cheaper").innerText(), "$11.00 cheaper than your starred supplier");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByText("Product saved").waitFor();
  assert.deepEqual((await rowsOf("prd_cs_reader")).map((row) => [row.name, row.costCents, row.starred]), [
    ["Anixter", 7000, false],
    ["Spirit Supply", 9000, true],
  ]);
  assert.deepEqual(await linked(), [], "ADI's rep comes off with ADI");
  assert.equal((await product("PR-100")).costCents, 8100, "a cheaper supplier is a hint; the star stays where it was put");

  log("the Supplier filter finds a product by any of its suppliers, not only the starred one");
  await page.goto(`${BASE}/dashboard/products?supplier=dst_cs_anix`);
  assert.deepEqual(await page.locator("table tbody tr td:first-child a").allTextContents(), ["Prox reader"]);
  await page.goto(`${BASE}/dashboard/products?supplier=dst_cs_spirit`);
  assert.deepEqual(
    (await page.locator("table tbody tr td:first-child a").allTextContents()).sort(),
    ["Door strike", "Exit button", "Keypad", "Prox reader"],
  );

  log("a quote line under the starred supplier's minimum is flagged, and a discount counts");
  await page.goto(`${BASE}/dashboard/products/prd_cs_reader`);
  await card.getByLabel("Spirit Supply minimum margin").fill("50");
  assert.match(await supplierRow("Spirit Supply").getByTestId("supplier-min-price").innerText(), /\$162\.00[\s\S]*you make \$81\.00/);
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByText("Product saved").waitFor();
  await sql(`INSERT INTO "Company" (id,"organizationId",name,"updatedAt") VALUES ('cmp_cs',$1,'Harbor Lofts',now())`, [org]);
  await sql(`INSERT INTO "Contact" (id,"organizationId","companyId",name,email,"updatedAt") VALUES ('ctc_cs',$1,'cmp_cs','Dana Ruiz','dana@harbor.example',now())`, [org]);
  await sql(`INSERT INTO "Deal" (id,"organizationId","contactId",title,stage,"updatedAt") VALUES ('deal_cs',$1,'ctc_cs','Harbor doors','QUOTE_SENT',now())`, [org]);
  await sql(
    `INSERT INTO "Quote" (id,"organizationId","contactId","dealId",number,title,status,"publicToken","updatedAt")
     VALUES ('quo_cs',$1,'ctc_cs','deal_cs',1000,'Doors quote','DRAFT','tok_quo_cs_0123456789',now())`,
    [org],
  );
  await page.goto(`${BASE}/dashboard/quotes/quo_cs`);
  const catalog = page.getByLabel("Add product from catalog");
  await catalog.fill("PR-100");
  await page.getByTestId("catalog-results").getByRole("option").first().waitFor();
  await catalog.press("Enter");
  await page.getByLabel("Line 1 unit value").waitFor();
  assert.equal(await page.getByLabel("Line 1 unit value").inputValue(), "150.00");
  assert.equal(await page.getByTestId("line-below-minimum").innerText(), "Below minimum ($162.00)");
  await page.getByLabel("Line 1 unit value").fill("170");
  assert.equal(await page.getByTestId("line-below-minimum").count(), 0);
  await page.getByLabel("Line 1 discount", { exact: true }).fill("10");
  assert.equal(await page.getByTestId("line-below-minimum").count(), 1, "$170 less 10% is $153 a unit, under $162");
  await page.getByTestId("quote-save").click();
  await page.getByText("Line items saved").waitFor();
  await page.reload();
  assert.equal(await page.getByTestId("line-below-minimum").innerText(), "Below minimum ($162.00)", "read again when the quote opens");
  assert.equal(
    (await sql(`SELECT "unitPriceCents" FROM "QuoteLineItem" WHERE "quoteId"='quo_cs'`)).rows[0].unitPriceCents,
    17000,
    "flagged, never changed",
  );

  log("Clone brings every supplier, and the clone's star is its own");
  await page.goto(`${BASE}/dashboard/products?q=prox`);
  await page.locator("table tbody tr").filter({ hasText: "Prox reader" }).getByRole("button", { name: "Clone" }).click();
  await page.waitForURL((url) => /\/dashboard\/products\/[^/]+$/.test(url.pathname) && !url.pathname.endsWith("prd_cs_reader"));
  const cloneId = page.url().split("/").pop();
  assert.deepEqual((await rowsOf(cloneId)).map((row) => [row.name, row.costCents, row.minMarginBp, row.starred]), [
    ["Anixter", 7000, null, false],
    ["Spirit Supply", 9000, 5000, true],
  ]);
  assert.deepEqual((await rowsOf("prd_cs_reader")).map((row) => row.starred), [false, true], "the original keeps its star");

  log("forged: another sheet's lines and a foreign supplier on the form are refused");
  const forged = await page.request.get(`${BASE}/dashboard/products/ratesheets/files/lrs_not_mine/lines`);
  assert.equal(forged.status(), 404);
  await page.goto(`${BASE}/dashboard/products/prd_cs_reader`);
  await page.evaluate(() => {
    const input = document.querySelector("input[name=suppliers]");
    const rows = JSON.parse(input.value);
    rows.push({ distributorId: "dst_someone_else", cost: "1", discount: "", list: "", minMargin: "" });
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, JSON.stringify(rows));
  });
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.waitForTimeout(800);
  assert.equal((await rowsOf("prd_cs_reader")).length, 2, "nothing written for a supplier that isn't this workspace's");

  // ---- Nov 4, 2026 audit fixes -------------------------------------------
  await sql(
    `INSERT INTO "Distributor" (id,"organizationId",name,"updatedAt") VALUES
       ('dst_cs_wes',$1,'Wesco',now()), ('dst_cs_gray',$1,'Graybar',now())`,
    [org],
  );
  const importCsv = async (fileName, content, supplierId, { only = null, rule = "MARKUP", percent = "20", before = null } = {}) => {
    const file = path.join(OUT, fileName);
    fs.writeFileSync(file, content);
    await page.goto(`${BASE}/dashboard/products`);
    await page.getByRole("button", { name: "Link Ratesheet" }).click();
    await page.getByRole("button", { name: /Import Ratesheet/ }).click();
    await page.setInputFiles("#ratesheet-import-file", file);
    await page.getByTestId("ratesheet-summary").waitFor();
    await page.locator("#ratesheet-supplier").selectOption(supplierId);
    await page.waitForFunction(() => !document.body.innerText.includes("matching your catalog"));
    await page.locator("#ratesheet-rule").selectOption(rule);
    await page.locator("#ratesheet-percent").fill(percent);
    if (only) {
      await page.getByRole("button", { name: "Remove all" }).click();
      await page.getByLabel(`Import ${only}`, { exact: true }).check();
    }
    if (before) await before();
    await page.getByTestId("ratesheet-import").click();
    await page.getByTestId("ratesheet-done").waitFor({ timeout: 120_000 });
    const text = await page.getByTestId("ratesheet-done").innerText();
    await page.getByRole("button", { name: "Done" }).click();
    return text;
  };
  const sheetNamed = async (fileName) =>
    (await sql(`SELECT * FROM "LinkedRatesheet" WHERE "organizationId"=$1 AND "fileName"=$2`, [org, fileName])).rows[0];
  const openSheet = async (fileName) => {
    await page.goto(`${BASE}/dashboard/products/ratesheets`);
    await page
      .locator("li")
      .filter({ has: page.getByTestId("linked-file-lines") })
      .filter({ hasText: fileName })
      .getByRole("button", { name: "See product list" })
      .click();
    await list.waitFor();
    await list.getByTestId("product-list-row").first().waitFor();
  };
  const saveList = async () => {
    await list.getByTestId("product-list-actions-top").getByRole("button", { name: "Save and accept" }).click();
    await result.waitFor({ timeout: 120_000 });
    return result.innerText();
  };

  log("audit fixes: a $3,000 item imports (the COGS sync no longer overflows) and a minimum markup over it saves");
  const nvr = await importCsv("wesco-nvr.csv", "Mfr Part #,Description,Your Cost,MSRP\nNVR-1,NVR 64 channel,3000,4500\n", "dst_cs_wes");
  assert.match(nvr, /Imported 1 product from Wesco: 1 new/);
  const nvr0 = await product("NVR-1");
  assert.deepEqual([nvr0.costCents, nvr0.unitPriceCents], [300000, 360000]);
  assert.ok((await sheetNamed("wesco-nvr.csv")).importedAt, "the import finished, not left half-done");
  await openSheet("wesco-nvr.csv");
  await list.locator("#product-list-markup").fill("25");
  assert.match(await saveList(), /1 re-priced up to your 25% minimum markup: NVR 64 channel \$3,600\.00 → \$3,750\.00\./);
  assert.equal((await product("NVR-1")).unitPriceCents, 375000);
  await list.getByRole("button", { name: "Done" }).click();

  log("audit fixes: a product with no supplier keeps its COGS and MSRP when a 'Call' sheet brings one; a hold names the COGS after the discount");
  await sql(
    `INSERT INTO "Product" (id,"organizationId",name,description,sku,"unitPriceCents","costCents","listPriceCents","defaultTag","distributorId",active,"updatedAt") VALUES
       ('prd_cs_cam',$1,'Camera 2','','CAM-2',1800,1000,2000,'MATERIALS',NULL,true,now()),
       ('prd_cs_lock',$1,'Mag lock','','ML-1',2000,1000,NULL,'MATERIALS','dst_cs_gray',true,now())`,
    [org],
  );
  await sql(
    `INSERT INTO "ProductSupplier" (id,"organizationId","productId","distributorId","costCents","discountBp","preferredFor","updatedAt")
       VALUES ('ps_cs_lock_gray',$1,'prd_cs_lock','dst_cs_gray',2000,5000,'prd_cs_lock',now())`,
    [org],
  );
  await importCsv("graybar-call.csv", "Mfr Part #,Description,Your Cost\nCAM-2,Camera 2,Call\nML-1,Mag lock,45\n", "dst_cs_gray", {
    before: async () => {
      assert.match(await importRow("Mag lock").innerText(), /Cost was \$10\.00, now \$22\.50 — check the unit/, "the COGS after Graybar's 50% off");
      assert.ok(!(await importRow("Mag lock").getByRole("checkbox").isChecked()));
      assert.ok(await importRow("Camera 2").getByRole("checkbox").isChecked());
    },
  });
  const cam = await product("CAM-2");
  assert.deepEqual([cam.costCents, cam.listPriceCents, cam.distributorId], [1000, 2000, "dst_cs_gray"], "COGS and MSRP kept, Graybar starred");
  assert.deepEqual(await rowsOf("prd_cs_cam"), [
    { name: "Graybar", costCents: 1000, discountBp: 0, listPriceCents: 2000, minMarginBp: null, starred: true },
  ]);

  log("audit fixes: See product list never re-prices what a newer sheet set, links older lines, keeps the 2x hold, and counts and names every line left out");
  await sql(
    `INSERT INTO "Product" (id,"organizationId",name,description,sku,"unitPriceCents","costCents","defaultTag",active,"updatedAt") VALUES
       ('prd_cs_card',$1,'Prox card','','PX-1',200,100,'MATERIALS',true,now()),
       ('prd_cs_widget',$1,'Widget','','W1',800,500,'MATERIALS',true,now())`,
    [org],
  );
  // Sixty products already carried at $1.00 that the sheet lists at $95:
  // each one held, more than the 50 reasons the server sends back.
  await sql(
    `INSERT INTO "Product" (id,"organizationId",name,description,sku,"unitPriceCents","costCents","defaultTag",active,"updatedAt")
     SELECT 'prd_cs_jump_' || g, $1, 'Jump item ' || g, '', 'JP-' || g, 200, 100, 'MATERIALS', true, now() FROM generate_series(1, 60) g`,
    [org],
  );
  const callRows = Array.from({ length: 60 }, (_, i) => `JP-${i + 1},Jump item ${i + 1},95`).join("\n");
  await importCsv(
    "anixter-q2.csv",
    `Mfr Part #,Description,Your Cost\nAX-9,Spare,1\nAX-1,Door contact,5\nPX-1,Prox card,95\nW-1,Widget alt,4\n,Widget,4\n${callRows}\n`,
    "dst_cs_anix",
    { only: "Spare" },
  );
  await importCsv("anixter-q3.csv", "Mfr Part #,Description,Your Cost\nAX-1,Door contact,6\n", "dst_cs_anix");
  const door = await product("AX-1");
  assert.equal(door.costCents, 600);
  const q2 = await sheetNamed("anixter-q2.csv");
  const q3 = await sheetNamed("anixter-q3.csv");
  const doorLine = async () =>
    (await sql(`SELECT "productId" FROM "RatesheetLine" WHERE "linkedRatesheetId"=$1 AND sku='AX-1'`, [q2.id])).rows[0].productId;
  assert.equal(await doorLine(), door.id, "the newer sheet's product is linked onto the older sheet's line");
  await page.goto(`${BASE}/dashboard/products/ratesheets`);
  assert.match(await page.locator("li").filter({ hasText: "anixter-q2.csv" }).getByTestId("linked-file-lines").innerText(), /2 of 65 products in Products/);
  // A line stored before that link existed reads Not in Products; ticking
  // it must link it, not put Q2's $5.00 back over Q3's $6.00.
  await sql(`UPDATE "RatesheetLine" SET "productId"=NULL WHERE "linkedRatesheetId"=$1 AND sku='AX-1'`, [q2.id]);
  await openSheet("anixter-q2.csv");
  await list.getByRole("button", { name: "Select all 65" }).click();
  const q2Said = await saveList();
  assert.match(q2Said, /Saved: 1 linked to products you already had, 1 already priced from a newer sheet of theirs \(left as they are\)\./);
  assert.match(q2Said, /62 not added: Prox card \(Cost was \$1\.00, now \$95\.00 — check the unit\); Widget \(Same product as Widget alt\); Jump item 1 \(Cost was \$1\.00, now \$95\.00 — check the unit\);/);
  assert.match(q2Said, /; and more\. Use Import prices to check them\./);
  const door1 = await product("AX-1");
  assert.equal(door1.costCents, 600, "Q3's price stays");
  assert.equal(
    (await sql(`SELECT "linkedRatesheetId" FROM "ProductSupplier" WHERE "productId"=$1 AND "distributorId"='dst_cs_anix'`, [door.id])).rows[0].linkedRatesheetId,
    q3.id,
    "Q3 still prices it",
  );
  assert.equal(await doorLine(), door.id);
  assert.equal((await product("PX-1")).costCents, 100, "a 95x jump is still held when ticked here");
  assert.equal((await product("W1")).costCents, 400);
  await list.getByRole("button", { name: "Done" }).click();

  log("audit fixes: a save that stops part-way re-reads the list, and an untick after it is sent");
  const bulkRows = Array.from({ length: 505 }, (_, i) => `BK-${i + 1},Bulk item ${i + 1},1,2`).join("\n");
  await importCsv("wesco-bulk.csv", `Mfr Part #,Description,Your Cost,MSRP\n${bulkRows}\n`, "dst_cs_wes", { only: "Bulk item 1" });
  await openSheet("wesco-bulk.csv");
  let actionPosts = 0;
  const cutSecond = async (route) => {
    const request = route.request();
    if (request.method() === "POST" && request.headers()["next-action"]) {
      actionPosts += 1;
      if (actionPosts === 2) return route.abort();
    }
    return route.continue();
  };
  await page.route("**/dashboard/products/ratesheets**", cutSecond);
  await list.getByRole("button", { name: "Select all 505" }).click();
  await list.getByTestId("product-list-actions-top").getByRole("button", { name: "Save and accept" }).click();
  await list.getByText(/500 of your changes were saved before it stopped; the list now shows what's in Products\./).waitFor({ timeout: 120_000 });
  await page.unroute("**/dashboard/products/ratesheets**", cutSecond);
  await page.waitForFunction(() => /In Products \(500\)/.test(document.querySelector("[data-testid=product-list-filter-in]")?.textContent ?? ""));
  const bulk2 = list.getByLabel("In Products: Bulk item 2", { exact: true });
  assert.ok(await bulk2.isChecked(), "a saved line reads as saved");
  await bulk2.uncheck();
  assert.match(await list.getByTestId("product-list-actions-bottom").innerText(), /5 ticked · 1 unticked/);
  assert.match(await saveList(), /Saved: 5 added to Products, 1 taken off \(1 turned off: no other supplier\)\./);
  assert.equal((await product("BK-2")).active, false, "the untick reached the server");
  assert.equal((await sql(`SELECT count(*)::int n FROM "Product" WHERE "organizationId"=$1 AND sku LIKE 'BK-%' AND active`, [org])).rows[0].n, 504);
  await list.getByRole("button", { name: "Done" }).click();

  log("audit fixes: the product form keeps a returning star's reps, saves a COGS typed before JavaScript, and stars a supplier picked by its account");
  await sql(
    `INSERT INTO "Product" (id,"organizationId",name,description,sku,"unitPriceCents","costCents","listPriceCents","defaultTag","distributorId",active,"updatedAt") VALUES
       ('prd_cs_panel',$1,'Alarm panel','','AP-1',30000,20000,25000,'MATERIALS','dst_cs_adi',true,now())`,
    [org],
  );
  await sql(
    `INSERT INTO "ProductSupplier" (id,"organizationId","productId","distributorId","costCents","listPriceCents","preferredFor","updatedAt") VALUES
       ('ps_cs_panel_adi',$1,'prd_cs_panel','dst_cs_adi',20000,25000,'prd_cs_panel',now()),
       ('ps_cs_panel_spirit',$1,'prd_cs_panel','dst_cs_spirit',18000,NULL,NULL,now()),
       ('ps_cs_panel_gray',$1,'prd_cs_panel','dst_cs_gray',15000,NULL,NULL,now())`,
    [org],
  );
  await sql(`INSERT INTO "_DistributorContactToProduct" ("A","B") VALUES ('dc_cs_ada','prd_cs_panel'), ('dc_cs_mike','prd_cs_panel')`);
  const panelLinks = async () =>
    (await sql(`SELECT "A" FROM "_DistributorContactToProduct" WHERE "B"='prd_cs_panel' ORDER BY "A"`)).rows.map((row) => row.A);
  await page.goto(`${BASE}/dashboard/products/prd_cs_panel`);
  await card.getByLabel("Star Spirit Supply").check();
  assert.ok(await page.getByLabel("Select Mike Chen").isChecked(), "Spirit's linked rep shows ticked");
  await card.getByLabel("Star ADI").check();
  assert.ok(await page.getByLabel("Select Ada Rep").isChecked(), "back on ADI, Ada is still ticked");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByText("Product saved").waitFor();
  assert.deepEqual(await panelLinks(), ["dc_cs_ada", "dc_cs_mike"], "neither rep was dropped");

  const noJs = await browser.newContext({ javaScriptEnabled: false, storageState: await context.storageState(), viewport: { width: 1360, height: 900 } });
  const plain = await noJs.newPage();
  await plain.goto(`${BASE}/dashboard/products/prd_cs_panel`);
  await plain.locator("#cost").fill("210");
  await plain.locator("#listPrice").fill("300");
  await Promise.all([plain.waitForLoadState("load"), plain.locator("#listPrice").press("Enter")]);
  for (let i = 0; i < 50 && (await product("AP-1")).costCents !== 21000; i++) await page.waitForTimeout(100);
  const panel1 = await product("AP-1");
  assert.deepEqual([panel1.costCents, panel1.listPriceCents], [21000, 30000], "typed COGS and MSRP saved without JavaScript");
  assert.deepEqual(
    (await rowsOf("prd_cs_panel")).find((row) => row.name === "ADI"),
    { name: "ADI", costCents: 21000, discountBp: 0, listPriceCents: 30000, minMarginBp: null, starred: true },
  );
  await noJs.close();

  await sql(
    `INSERT INTO "Organization" (id,name,slug,status,"reviewedAt","accountType",city,state,"updatedAt")
     VALUES ('org_cs_graybar','Graybar','test-catalog-suppliers-co-graybar','ACTIVE',now(),'DISTRIBUTOR','St. Louis','MO',now())`,
  );
  await page.goto(`${BASE}/dashboard/products/prd_cs_panel`);
  await page.locator("#distributorId").selectOption("platform:org_cs_graybar");
  assert.ok(await card.getByLabel("Star Graybar").isChecked(), "the account picked is the Graybar already on this product");
  assert.equal(await page.locator("#cost").inputValue(), "150.00", "its price comes up as the COGS");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByText("Product saved").waitFor();
  const panel2 = await product("AP-1");
  assert.deepEqual([panel2.costCents, panel2.distributorId], [15000, "dst_cs_gray"]);
  assert.equal((await sql(`SELECT "platformOrganizationId" FROM "Distributor" WHERE id='dst_cs_gray'`)).rows[0].platformOrganizationId, "org_cs_graybar");
  assert.equal(await page.locator("#cost").inputValue(), "150.00");

  log("audit fixes: '+ Add new' with a supplier's own name previews as that supplier, its 6x jump held");
  await page.goto(`${BASE}/dashboard/products`);
  await page.getByRole("button", { name: "Link Ratesheet" }).click();
  await page.getByRole("button", { name: /Import Ratesheet/ }).click();
  const typed = path.join(OUT, "graybar-typed.csv");
  fs.writeFileSync(typed, "Mfr Part #,Description,Your Cost\nAP-1,Alarm panel,900\n");
  await page.setInputFiles("#ratesheet-import-file", typed);
  await page.getByTestId("ratesheet-summary").waitFor();
  await page.locator("#ratesheet-supplier").selectOption("__new__");
  await page.getByLabel("New distributor name").fill("Graybar");
  await page.waitForFunction(() => /Cost was \$150\.00, now \$900\.00/.test(document.body.innerText), null, { timeout: 30_000 });
  assert.equal(await importRow("Alarm panel").getByTestId("ratesheet-second-supplier").count(), 0, "not 'adds this supplier': it is the starred one");
  assert.ok(!(await importRow("Alarm panel").getByRole("checkbox").isChecked()));
  await page.getByLabel("Close").first().click();

  log("audit fixes: a quote line at its minimum with a fractional quantity isn't flagged; a typed line linked on save is");
  await sql(
    `INSERT INTO "Product" (id,"organizationId",name,description,sku,"unitPriceCents","costCents","defaultTag","distributorId",active,"updatedAt") VALUES
       ('prd_cs_min',$1,'Min test','','MT-1',1500,1000,'MATERIALS','dst_cs_spirit',true,now())`,
    [org],
  );
  await sql(
    `INSERT INTO "ProductSupplier" (id,"organizationId","productId","distributorId","costCents","minMarginBp","preferredFor","updatedAt")
       VALUES ('ps_cs_min',$1,'prd_cs_min','dst_cs_spirit',1000,3000,'prd_cs_min',now())`,
    [org],
  );
  await page.goto(`${BASE}/dashboard/quotes/quo_cs`);
  const flags = page.getByTestId("line-below-minimum");
  const baseline = await flags.count();
  await catalog.fill("MT-1");
  await page.getByTestId("catalog-results").getByRole("option").first().waitFor();
  await catalog.press("Enter");
  await page.keyboard.press("Escape");
  const lineNo = await page.locator("input[aria-label$=' unit value']").count();
  await page.getByLabel(`Line ${lineNo} quantity`).fill("1.25");
  await page.getByLabel(`Line ${lineNo} unit value`).fill("14.29");
  assert.equal(await flags.count(), baseline, "1.25 × $14.29 is exactly the minimum");
  await page.getByLabel(`Line ${lineNo} unit value`).fill("14.28");
  assert.equal(await flags.count(), baseline + 1);
  await page.getByLabel(`Line ${lineNo} unit value`).fill("14.29");
  await page.getByRole("button", { name: "Blank line" }).click();
  await page.getByLabel(`Line ${lineNo + 1} product`, { exact: true }).fill("min test");
  await page.getByLabel(`Line ${lineNo + 1} unit value`).fill("10");
  assert.equal(await flags.count(), baseline);
  await page.getByTestId("quote-save").click();
  await page.getByText("Line items saved").waitFor();
  assert.equal(await flags.count(), baseline + 1, "linked to Min test by name on save, flagged without a reload");
  assert.equal(
    (await sql(`SELECT "productId" FROM "QuoteLineItem" WHERE "quoteId"='quo_cs' AND name='min test'`)).rows[0].productId,
    "prd_cs_min",
  );

  log("audit fixes: a product changed outside 3a is trusted over its stale row; the sheet row counts beside-supplier apart; the new index");
  // As the code before 3a writes a product: its updatedAt moves with it.
  await sql(`UPDATE "Product" SET "costCents"=1100, "updatedAt"=now() WHERE id='prd_cs_lock'`);
  await page.goto(`${BASE}/dashboard/products/prd_cs_lock`);
  assert.equal((await product("ML-1")).costCents, 1100);
  assert.deepEqual((await rowsOf("prd_cs_lock")).map((row) => [row.name, row.costCents, row.discountBp, row.starred]), [["Graybar", 2200, 5000, true]]);
  await sql(`UPDATE "Product" SET "distributorId"='dst_cs_wes', "updatedAt"=now() WHERE id='prd_cs_lock'`);
  await page.goto(`${BASE}/dashboard/products/prd_cs_lock`);
  const lock = await product("ML-1");
  assert.deepEqual([lock.costCents, lock.distributorId], [1100, "dst_cs_wes"]);
  assert.deepEqual((await rowsOf("prd_cs_lock")).map((row) => [row.name, row.costCents, row.starred]), [
    ["Graybar", 2200, false],
    ["Wesco", 1100, true],
  ]);
  const first = await sheetNamed("spirit-q4.csv");
  assert.deepEqual([first.addedCount, first.updatedCount, first.besideCount], [1, 1, 1]);
  await page.goto(`${BASE}/dashboard/products/ratesheets`);
  assert.match(
    await page.locator("li").filter({ hasText: "spirit-q4.csv" }).getByTestId("linked-file-import").innerText(),
    /1 new, 1 updated \(1 cost less\), 1 added beside another supplier/,
  );
  assert.equal((await sql(`SELECT count(*)::int n FROM pg_indexes WHERE indexname='ProductSupplier_linkedRatesheetId_idx'`)).rows[0].n, 1);

  // ---- second pass: the fixes' own review (Nov 4, 2026) ---------------
  log("fix review: a supplier's standing discount stays on a row made with no price, and on a row the repair had to make");
  // Spirit's sheets carry 10% (spirit-q4.csv, inherited by the next).
  await importCsv("spirit-n4.csv", "Mfr Part #,Description,Your Cost,MSRP\nSW-1,Software seat,Call,500\n", "dst_cs_spirit", { rule: "LIST", percent: "0" });
  const seat = await product("SW-1");
  assert.deepEqual((await rowsOf(seat.id)).map((row) => [row.name, row.discountBp]), [["Spirit Supply", 1000]]);
  await importCsv("spirit-n4b.csv", "Mfr Part #,Description,Your Cost,MSRP\nSW-1,Software seat,300,500\n", "dst_cs_spirit", { rule: "LIST", percent: "0" });
  assert.equal((await product("SW-1")).costCents, 27000, "$300 less Spirit's 10%");
  // A product the code before 3a switched to Spirit: the import's repair
  // makes Spirit's row, and it carries the 10% the preview priced with.
  await sql(
    `INSERT INTO "Product" (id,"organizationId",name,description,sku,"unitPriceCents","costCents","defaultTag","distributorId",active,"updatedAt") VALUES
       ('prd_cs_gate',$1,'Gate opener','','GO-1',15000,10000,'MATERIALS','dst_cs_adi',true,now() - interval '1 day')`,
    [org],
  );
  await sql(
    `INSERT INTO "ProductSupplier" (id,"organizationId","productId","distributorId","costCents","preferredFor","updatedAt")
       VALUES ('ps_cs_gate_adi',$1,'prd_cs_gate','dst_cs_adi',10000,'prd_cs_gate',now() - interval '1 day')`,
    [org],
  );
  await sql(`UPDATE "Product" SET "distributorId"='dst_cs_spirit', "updatedAt"=now() WHERE id='prd_cs_gate'`);
  await importCsv("spirit-gate.csv", "Mfr Part #,Description,Your Cost\nGO-1,Gate opener,180\n", "dst_cs_spirit");
  const gate = await product("GO-1");
  assert.deepEqual([gate.costCents, gate.distributorId], [16200, "dst_cs_spirit"], "$180 less 10%, as previewed");
  assert.deepEqual((await rowsOf("prd_cs_gate")).map((row) => [row.name, row.costCents, row.discountBp, row.starred]), [
    ["ADI", 10000, 0, false],
    ["Spirit Supply", 18000, 1000, true],
  ]);

  log("fix review: a page opened mid-save leaves the row alone; a product set to no supplier outside 3a loses its rows");
  // As finishRatesheetLines leaves it between the discount and the sync.
  await sql(`UPDATE "ProductSupplier" SET "discountBp"=1000, "updatedAt"=now() WHERE "productId"='prd_cs_cam'`);
  await page.goto(`${BASE}/dashboard/products/prd_cs_cam`);
  assert.deepEqual((await rowsOf("prd_cs_cam")).map((row) => [row.costCents, row.discountBp]), [[1000, 1000]], "not rewritten to $11.11");
  await sql(`UPDATE "ProductSupplier" SET "discountBp"=0 WHERE "productId"='prd_cs_cam'`);
  await sql(`UPDATE "Product" SET "updatedAt"=now() - interval '1 hour' WHERE id='prd_cs_gate'`);
  await sql(`UPDATE "ProductSupplier" SET "updatedAt"=now() - interval '1 hour' WHERE "productId"='prd_cs_gate'`);
  await sql(`UPDATE "Product" SET "distributorId"=NULL, "updatedAt"=now() WHERE id='prd_cs_gate'`);
  await page.goto(`${BASE}/dashboard/products/prd_cs_gate`);
  assert.deepEqual(await rowsOf("prd_cs_gate"), [], "None means no suppliers, as on the form");
  assert.equal((await product("GO-1")).distributorId, null);

  log("fix review: a typed name the server resolves to a supplier the preview didn't plan for is refused");
  await sql(`INSERT INTO "Company" (id,"organizationId",name,"updatedAt") VALUES ('cmp_cs_adiglobal',$1,'ADI Global',now())`, [org]);
  await sql(`UPDATE "Distributor" SET "companyId"='cmp_cs_adiglobal' WHERE id='dst_cs_adi'`);
  await page.goto(`${BASE}/dashboard/products`);
  await page.getByRole("button", { name: "Link Ratesheet" }).click();
  await page.getByRole("button", { name: /Import Ratesheet/ }).click();
  const bridged = path.join(OUT, "adi-global.csv");
  fs.writeFileSync(bridged, "Mfr Part #,Description,Your Cost\nAP-1,Alarm panel,900\n");
  await page.setInputFiles("#ratesheet-import-file", bridged);
  await page.getByTestId("ratesheet-summary").waitFor();
  await page.locator("#ratesheet-supplier").selectOption("__new__");
  await page.getByLabel("New distributor name").fill("ADI Global");
  await page.waitForFunction(() => !document.body.innerText.includes("matching your catalog"));
  await page.getByTestId("ratesheet-import").click();
  // Named as "Who sent it?" lists it, not by its renamed company.
  await page.getByText(/^ADI is already one of your suppliers\. Pick it under "Who sent it\?"/).waitFor();
  assert.equal((await product("AP-1")).costCents, 15000, "nothing written");
  await page.getByLabel("Close").first().click();
  // The same company reached through an account of that name.
  await sql(
    `INSERT INTO "Organization" (id,name,slug,status,"reviewedAt","accountType",city,state,"updatedAt")
     VALUES ('org_cs_adiglobal','ADI Global','test-catalog-suppliers-co-adiglobal','ACTIVE',now(),'DISTRIBUTOR','Melville','NY',now())`,
  );
  await page.goto(`${BASE}/dashboard/products`);
  await page.getByRole("button", { name: "Link Ratesheet" }).click();
  await page.getByRole("button", { name: /Import Ratesheet/ }).click();
  await page.setInputFiles("#ratesheet-import-file", bridged);
  await page.getByTestId("ratesheet-summary").waitFor();
  await page.locator("#ratesheet-supplier").selectOption("platform:org_cs_adiglobal");
  await page.waitForFunction(() => !document.body.innerText.includes("matching your catalog"));
  await page.getByTestId("ratesheet-import").click();
  await page.getByText(/^ADI is already one of your suppliers\./).waitFor();
  assert.equal((await product("AP-1")).costCents, 15000, "nothing written through the account either");
  assert.equal(
    (await sql(`SELECT "platformOrganizationId" FROM "Distributor" WHERE id='dst_cs_adi'`)).rows[0].platformOrganizationId,
    null,
    "the link the refused import made comes off with it",
  );
  // Clicking Import again (the dialog keeps its state) is refused again,
  // rather than finding ADI by the link and importing as ADI.
  await page.getByTestId("ratesheet-import").click();
  await page.waitForTimeout(1500);
  await page.getByText(/^ADI is already one of your suppliers\./).waitFor();
  assert.equal((await product("AP-1")).costCents, 15000, "still nothing written");
  await page.getByLabel("Close").first().click();

  log("fix review: a save whose answer is lost re-reads the list, so an untick after it is sent");
  await importCsv("wesco-n3.csv", "Mfr Part #,Description,Your Cost\nN3-1,Lost one,5\nN3-2,Lost two,6\n", "dst_cs_wes", { only: "Lost one" });
  await openSheet("wesco-n3.csv");
  const lose = async (route) => {
    const request = route.request();
    if (request.method() === "POST" && request.headers()["next-action"]) {
      await route.fetch(); // the server saves it…
      return route.abort(); // …and the answer never arrives
    }
    return route.continue();
  };
  await page.route("**/dashboard/products/ratesheets**", lose);
  await list.getByLabel("In Products: Lost two", { exact: true }).check();
  await list.getByTestId("product-list-actions-top").getByRole("button", { name: "Save and accept" }).click();
  await list.getByText(/That didn't reach the server/).waitFor();
  await page.unroute("**/dashboard/products/ratesheets**", lose);
  await page.waitForFunction(() => /In Products \(2\)/.test(document.querySelector("[data-testid=product-list-filter-in]")?.textContent ?? ""));
  await list.getByLabel("In Products: Lost two", { exact: true }).uncheck();
  assert.match(await saveList(), /1 taken off \(1 turned off: no other supplier\)/);
  assert.equal((await product("N3-2")).active, false);
  await list.getByRole("button", { name: "Done" }).click();

  log("fix review: the relink skips part numbers Excel turned into 8.50012E+11");
  await importCsv(
    "anixter-e1.csv",
    "Mfr Part #,Description,Your Cost\nAX-E0,Spare E,1\n8.50012E+11,Reader A,10\n8.50012E+11,Reader B,11\n",
    "dst_cs_anix",
    { only: "Spare E" },
  );
  await importCsv("anixter-e2.csv", "Mfr Part #,Description,Your Cost\n8.50012E+11,Reader A,10\n", "dst_cs_anix");
  const e1 = await sheetNamed("anixter-e1.csv");
  assert.deepEqual(
    (await sql(`SELECT name, "productId" FROM "RatesheetLine" WHERE "linkedRatesheetId"=$1 AND name LIKE 'Reader %' ORDER BY name`, [e1.id])).rows,
    [{ name: "Reader A", productId: null }, { name: "Reader B", productId: null }],
  );

  log("fix review: the newest sheet's tick prices a product set by hand or by an older sheet");
  await importCsv("anixter-q4.csv", "Mfr Part #,Description,Your Cost\nAX-Q0,Spare Q,1\nAX-7,Door strike 7,48\n", "dst_cs_anix", { only: "Spare Q" });
  await sql(
    `INSERT INTO "Product" (id,"organizationId",name,description,sku,"unitPriceCents","costCents","defaultTag","distributorId",active,"updatedAt") VALUES
       ('prd_cs_ds7',$1,'Door strike 7','','AX-7',4500,3000,'MATERIALS','dst_cs_anix',true,now())`,
    [org],
  );
  await sql(
    `INSERT INTO "ProductSupplier" (id,"organizationId","productId","distributorId","costCents","preferredFor","updatedAt")
       VALUES ('ps_cs_ds7',$1,'prd_cs_ds7','dst_cs_anix',3000,'prd_cs_ds7',now())`,
    [org],
  );
  // The sheet carries 10% already; the row on the product has none.
  await sql(`UPDATE "LinkedRatesheet" SET "discountBp"=1000 WHERE "organizationId"=$1 AND "fileName"='anixter-q4.csv'`, [org]);
  await openSheet("anixter-q4.csv");
  assert.equal(await listRow("Door strike 7").getByTestId("product-list-cogs").innerText(), "$43.20");
  await list.getByLabel("In Products: Door strike 7", { exact: true }).check();
  assert.match(await saveList(), /Saved: 1 linked to products you already had\./);
  assert.equal((await product("AX-7")).costCents, 4320, "the newest sheet's price, at the COGS the list showed");
  const q4 = await sheetNamed("anixter-q4.csv");
  const ds7 = (await sql(`SELECT "linkedRatesheetId", "discountBp" FROM "ProductSupplier" WHERE id='ps_cs_ds7'`)).rows[0];
  assert.deepEqual([ds7.linkedRatesheetId, ds7.discountBp], [q4.id, 1000]);
  await list.getByRole("button", { name: "Done" }).click();

  log("fix review: a cent under the minimum on a quantity under one is flagged; a typed markup keeps following after a save");
  await page.goto(`${BASE}/dashboard/quotes/quo_cs`);
  const mtLine = await page.locator("input[aria-label$=' unit value']").count() - 1; // Min test, before the typed line
  const flagsNow = await flags.count();
  await page.getByLabel(`Line ${mtLine} quantity`).fill("0.25");
  await page.getByLabel(`Line ${mtLine} unit value`).fill("14.28");
  assert.equal(await flags.count(), flagsNow + 1, "0.25 × $14.28 is under 0.25 × $14.29");
  await page.getByLabel(`Line ${mtLine} unit value`).fill("14.29");
  assert.equal(await flags.count(), flagsNow);
  await page.goto(`${BASE}/dashboard/products/prd_cs_min`);
  // 60, not the 50 it already reads (an unchanged box fires no change).
  await page.locator("#markupPercent").fill("60");
  await page.locator("#cost").fill("12");
  assert.equal(await page.locator("#unitPrice").inputValue(), "19.20");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByText("Product saved").waitFor();
  await page.locator("#cost").fill("13");
  assert.equal(await page.locator("#unitPrice").inputValue(), "20.80", "the 60% markup still holds");

  log("fix review: changing a sheet's discount keeps a cost the code before 3a wrote since");
  const keypad = await product("KP-1");
  await sql(`UPDATE "Product" SET "costCents"=4700, "updatedAt"=now() WHERE id=$1`, [keypad.id]);
  await openSheet("spirit-q4.csv");
  await list.locator("#product-list-discount").fill("20");
  await saveList();
  assert.equal(
    (await sql(`SELECT "costCents" FROM "ProductSupplier" WHERE "productId"=$1 AND "distributorId"='dst_cs_spirit'`, [keypad.id])).rows[0].costCents,
    5222,
    "the $47.00 worked back through 10%",
  );
  assert.equal((await product("KP-1")).costCents, 4178, "and then 20% off it");
  await list.getByRole("button", { name: "Done" }).click();

  log("final review: an outside switch onto a supplier already on the product keeps its COGS; None with a new COGS still clears; a discounted line at the minimum isn't flagged");
  await sql(
    `INSERT INTO "Product" (id,"organizationId",name,description,sku,"unitPriceCents","costCents","defaultTag","distributorId",active,"updatedAt") VALUES
       ('prd_cs_siren',$1,'Siren','','SR-1',1500,1000,'MATERIALS','dst_cs_adi',true,now() - interval '1 hour'),
       ('prd_cs_horn',$1,'Horn','','HN-1',15000,9000,'MATERIALS','dst_cs_adi',true,now() - interval '1 hour')`,
    [org],
  );
  await sql(
    `INSERT INTO "ProductSupplier" (id,"organizationId","productId","distributorId","costCents","discountBp","preferredFor","updatedAt") VALUES
       ('ps_cs_siren_adi',$1,'prd_cs_siren','dst_cs_adi',1000,0,'prd_cs_siren',now() - interval '1 hour'),
       ('ps_cs_siren_wes',$1,'prd_cs_siren','dst_cs_wes',900,0,NULL,now() - interval '1 hour'),
       ('ps_cs_horn_adi',$1,'prd_cs_horn','dst_cs_adi',10000,1000,'prd_cs_horn',now() - interval '1 hour')`,
    [org],
  );
  // The code before 3a: Siren switched to Wesco at $9.50; Horn set to
  // None with its COGS changed in the same save.
  await sql(`UPDATE "Product" SET "distributorId"='dst_cs_wes', "costCents"=950, "updatedAt"=now() WHERE id='prd_cs_siren'`);
  await sql(`UPDATE "Product" SET "distributorId"=NULL, "costCents"=9500, "updatedAt"=now() WHERE id='prd_cs_horn'`);
  await page.goto(`${BASE}/dashboard/products/prd_cs_siren`);
  assert.deepEqual((await rowsOf("prd_cs_siren")).map((row) => [row.name, row.costCents, row.starred]), [
    ["ADI", 1000, false],
    ["Wesco", 950, true],
  ]);
  await page.goto(`${BASE}/dashboard/products/prd_cs_horn`);
  assert.deepEqual(await rowsOf("prd_cs_horn"), []);
  assert.deepEqual([(await product("HN-1")).costCents, (await product("HN-1")).distributorId], [9500, null]);

  await sql(
    `INSERT INTO "Product" (id,"organizationId",name,description,sku,"unitPriceCents","costCents","defaultTag","distributorId",active,"updatedAt") VALUES
       ('prd_cs_fifteen',$1,'Min fifteen','','MF-1',2000,1050,'MATERIALS','dst_cs_spirit',true,now())`,
    [org],
  );
  await sql(
    `INSERT INTO "ProductSupplier" (id,"organizationId","productId","distributorId","costCents","minMarginBp","preferredFor","updatedAt")
       VALUES ('ps_cs_fifteen',$1,'prd_cs_fifteen','dst_cs_spirit',1050,3000,'prd_cs_fifteen',now())`,
    [org],
  );
  await page.goto(`${BASE}/dashboard/quotes/quo_cs`);
  const before15 = await flags.count();
  await catalog.fill("MF-1");
  await page.getByTestId("catalog-results").getByRole("option").first().waitFor();
  await catalog.press("Enter");
  await page.keyboard.press("Escape");
  const n15 = await page.locator("input[aria-label$=' unit value']").count();
  await page.getByLabel(`Line ${n15} quantity`).fill("1.1");
  await page.getByLabel(`Line ${n15} unit value`).fill("20");
  await page.getByLabel(`Line ${n15} discount`, { exact: true }).fill("25");
  assert.equal(await flags.count(), before15, "1.1 × $20 less 25% is exactly 1.1 × $15.00");
  await page.getByLabel(`Line ${n15} discount`, { exact: true }).fill("26");
  assert.equal(await flags.count(), before15 + 1);

  log("phone: the pop-out, the Suppliers card and the list's sub-rows fit without sideways scrolling");
  const phone = await browser.newContext({ ...devices["iPhone 13"] });
  const mobile = await phone.newPage();
  await mobile.goto(`${BASE}/login`);
  await mobile.fill("#email", EMAIL);
  await mobile.fill("#password", PASSWORD);
  await mobile.click("button[type=submit]");
  await mobile.waitForURL(/\/dashboard$/);
  const fits = () => mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  await mobile.goto(`${BASE}/dashboard/products/ratesheets`);
  await mobile.getByRole("button", { name: "See product list" }).first().click();
  await mobile.getByTestId("product-list-row").first().waitFor();
  assert.ok(await fits(), "pop-out fits a phone");
  assert.ok(await mobile.getByTestId("product-list-actions-top").getByRole("button", { name: "Save and accept" }).isVisible());
  await mobile.screenshot({ path: path.join(OUT, "cs-05-phone-list.png") });
  await mobile.goto(`${BASE}/dashboard/products/prd_cs_reader`);
  assert.ok(await fits(), "product page fits a phone");
  await mobile.goto(`${BASE}/dashboard/products?q=prox`);
  await mobile.getByTestId("product-suppliers-toggle").first().click();
  assert.ok(await fits(), "products list with sub-rows open fits a phone");
  await mobile.screenshot({ path: path.join(OUT, "cs-06-phone-subrows.png") });
  await phone.close();

  await browser.close();
  console.log(`\nAll ${step} catalog-suppliers steps passed. Screenshots in ${OUT}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
