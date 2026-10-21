/* Browser regression for Import Ratesheet (Oct 21, 2026).
 *
 * A supplier's ratesheet — their price is your cost, their MSRP is kept —
 * read from Excel, shown product by product with ticks, imported with a
 * markup, and declined with a note that lands in the operator console.
 * Also the product form's markup / margin / MSRP boxes and the margin
 * column on the Products list.
 *
 * Runs against a built app (`npm run build:app && npx next start`) and a
 * local Postgres that has had `prisma migrate deploy` run against it. It
 * signs up its own workspace, activates it with SQL, and deletes it again
 * on the next run, so it never touches real data. Never point it at the
 * live database.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/scb_test \
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules \
 *   node scripts/browser-tests/import-ratesheet.cjs
 *
 * Needs `playwright` installed globally (or in node_modules) and a
 * Chromium it can launch. Screenshots land in $SHOTS_DIR or the OS temp dir.
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
const OUT = process.env.SHOTS_DIR || path.join(os.tmpdir(), "scb-browser-shots");
fs.mkdirSync(OUT, { recursive: true });

const EMAIL = "test-import-ratesheet@example.com";
const PASSWORD = "password123";
const COMPANY = "Test Import Ratesheet Co";
const FIXTURE = path.join(__dirname, "fixtures", "spirit-supply-q4-2026.xlsx");

let step = 0;
function log(msg) {
  step += 1;
  console.log(`[${String(step).padStart(2, "0")}] ${msg}`);
}
async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `ir-${name}.png`), fullPage: true });
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

async function openImport(page) {
  await page.goto(`${BASE}/dashboard/products`);
  await page.getByRole("button", { name: "Link Ratesheet" }).click();
  await page.getByRole("button", { name: /Import Ratesheet/ }).click();
  await page.locator("#ratesheet-import-file").waitFor();
}

async function product(org, sku) {
  const { rows } = await sql(
    `SELECT p.*, d.name AS "supplier" FROM "Product" p LEFT JOIN "Distributor" d ON d.id = p."distributorId"
      WHERE p."organizationId" = $1 AND p.sku = $2`,
    [org, sku],
  );
  return rows[0];
}

(async () => {
  // Fresh tenant each run (cascades its products, suppliers and files).
  await sql(`DELETE FROM "Organization" WHERE slug LIKE 'test-import-ratesheet-co%'`);
  await sql(`DELETE FROM "RatesheetImportIssue" WHERE note LIKE 'IR-SUITE%'`);

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (err) => console.error("PAGE ERROR:", err.message));

  log("signup, activate, login");
  await page.goto(`${BASE}/signup`);
  await page.fill("[name=companyName]", COMPANY);
  await page.fill("[name=name]", "Ira Test");
  await page.fill("[name=email]", EMAIL);
  await page.fill("[name=phone]", "5550000000");
  await page.fill("[name=password]", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/signup\/submitted/);
  await sql(`UPDATE "Organization" SET status='ACTIVE', "reviewedAt"=now() WHERE slug LIKE 'test-import-ratesheet-co%'`);
  const org = (await sql(`SELECT id FROM "Organization" WHERE slug LIKE 'test-import-ratesheet-co%'`)).rows[0].id;
  await login(page);

  log("seed: two suppliers, a rep, and products the sheet will meet");
  await sql(
    `INSERT INTO "Distributor" (id,"organizationId",name,"updatedAt") VALUES ('dst_ir_spirit',$1,'Spirit Supply',now()), ('dst_ir_adi',$1,'ADI',now())`,
    [org],
  );
  await sql(
    `INSERT INTO "DistributorContact" (id,"organizationId","distributorId",name,email) VALUES ('dc_ir_mike',$1,'dst_ir_spirit','Mike Chen','mike@spirit.example'), ('dc_ir_adi',$1,'dst_ir_adi','Ada Rep','ada@adi.example')`,
    [org],
  );
  await sql(
    `INSERT INTO "Product" (id,"organizationId",name,description,sku,"unitPriceCents","costCents","defaultTag","distributorId",active,"updatedAt") VALUES
      ('prd_ir_hid',$1,'HID reader (mine)','Customer-facing words','HID-5355',15000,10000,'MATERIALS','dst_ir_spirit',true,now()),
      ('prd_ir_cable',$1,'Cable','', '012345',150000,100000,'MATERIALS','dst_ir_adi',true,now()),
      ('prd_ir_panel',$1,'Panel','', 'PNL-1',10000,0,'MATERIALS',NULL,true,now()),
      ('prd_ir_cat6',$1,'Cat6 cable','', 'CAT6',24500,18900,'MATERIALS','dst_ir_spirit',true,now()),
      ('prd_ir_gone',$1,'Gone item','', 'GONE-1',200,100,'MATERIALS','dst_ir_spirit',true,now())`,
    [org],
  );
  await sql(`INSERT INTO "_DistributorContactToProduct" ("A","B") VALUES ('dc_ir_adi','prd_ir_cable')`);

  log("Link Ratesheet menu: the card is Import Ratesheet now");
  await page.goto(`${BASE}/dashboard/products`);
  await page.getByRole("button", { name: "Link Ratesheet" }).click();
  assert.equal(await page.getByRole("button", { name: /Import CSV/ }).count(), 0, "old Import CSV card is gone");
  await page.getByRole("button", { name: /Import Ratesheet/ }).click();
  const template = await page.request.get(`${BASE}/dashboard/products/import-template`);
  assert.equal(template.status(), 200);
  assert.ok((await template.text()).startsWith("Mfr Part #,Description,Your Cost,MSRP"));

  log("read the Excel sheet: supplier and date guessed, columns read, Discontinued tab left out");
  await page.setInputFiles("#ratesheet-import-file", FIXTURE);
  await page.getByTestId("ratesheet-summary").waitFor();
  await page.waitForFunction(() => !document.body.innerText.includes("matching your catalog"));
  assert.equal(await page.locator("#ratesheet-supplier").inputValue(), "dst_ir_spirit", "supplier guessed from the file name");
  assert.equal(await page.locator("#ratesheet-effective").inputValue(), "2026-11-01", "effective date read from the title rows");
  const columns = await page.getByTestId("ratesheet-columns").innerText();
  for (const expected of ['Your cost (COGS) ← "Dealer"', 'MSRP ← "MSRP"', 'SKU / part # ← "Mfr Part #"', 'Description ← "Description"']) {
    assert.ok(columns.includes(expected), `columns line should include ${expected}: ${columns}`);
  }
  const tabs = page.getByTestId("ratesheet-tabs");
  assert.ok(await tabs.getByLabel(/Price List/).isChecked());
  assert.ok(!(await tabs.getByLabel(/Discontinued/).isChecked()), "Discontinued tab starts unticked");
  assert.match(await page.getByTestId("ratesheet-summary").innerText(), /6 products on the sheet · 4 ticked/);
  await shot(page, "01-preview");

  const row = (text) => page.getByTestId("ratesheet-row").filter({ hasText: text });
  log("rows: Call is held and can't be ticked; a unit change waits for a tick; notes say why");
  assert.ok(!(await row("Special order").getByRole("checkbox").isChecked()));
  assert.ok(await row("Special order").getByRole("checkbox").isDisabled(), "a new product with no price can't be ticked");
  assert.ok(await row("Special order").getByText("No price on the sheet").isVisible());
  assert.ok(!(await row("Cat6").getByRole("checkbox").isChecked()), "cost $189 → $0.21 waits for a tick");
  assert.ok(!(await row("Cat6").getByRole("checkbox").isDisabled()));
  assert.ok(await row("Cat6").getByText(/Cost was \$189\.00, now \$0\.21/).isVisible());
  assert.ok(await row("Wiegand").getByText(/Bought from ADI today/).isVisible());
  assert.ok(await row("Panel").getByText(/at or below the new cost, so it was re-priced/).isVisible());
  assert.equal(await row("HID ProxPro").locator("input[inputmode=decimal]").inputValue(), "168.75", "keep my margin: 150 × 112.50 / 100");
  assert.equal(await row("New camera").locator("input[inputmode=decimal]").inputValue(), "260.00", "30% markup on $200");
  assert.ok(await page.getByText(/1 product you buy\s+from Spirit Supply isn't on this sheet/).isVisible());

  log("Remove all, then Select all, then untick the Cat6 row again");
  await page.getByRole("button", { name: "Remove all" }).click();
  assert.match(await page.getByTestId("ratesheet-summary").innerText(), /· 0 ticked/);
  assert.ok(await page.getByTestId("ratesheet-import").isDisabled());
  await page.getByRole("button", { name: "Select all" }).click();
  assert.match(await page.getByTestId("ratesheet-summary").innerText(), /· 5 ticked/, "Select all ticks every row that can come in");
  assert.ok(!(await row("Special order").getByRole("checkbox").isChecked()), "Select all still skips a row with no price");
  await row("Cat6").getByRole("checkbox").uncheck();
  assert.match(await page.getByTestId("ratesheet-summary").innerText(), /· 4 ticked/);

  log("change a column by hand (UOM → Don't import), type one sell price, pick the rep");
  await page.getByRole("button", { name: "Change" }).click();
  await page.getByLabel("Column UOM").selectOption("skip");
  await page.getByRole("button", { name: "Done" }).click();
  await row("New camera").locator("input[inputmode=decimal]").fill("275");
  await page.locator("#ratesheet-contact").selectOption("dc_ir_mike");
  await page.getByLabel("Mark them inactive").check();
  assert.match(await page.getByTestId("ratesheet-example").innerText(), /30% markup on your cost = 23\.1% margin/);
  await shot(page, "02-ready");

  log("import: only the ticked rows land, costs from the sheet, prices from the rule");
  await page.getByTestId("ratesheet-import").click();
  await page.getByTestId("ratesheet-done").waitFor();
  const done = await page.getByTestId("ratesheet-done").innerText();
  assert.match(done, /Imported 4 products from Spirit Supply: 1 new, 3 updated \(3 cost more\)\. 1 no longer on their list marked inactive\./);
  const hid = await product(org, "HID-5355");
  assert.equal(hid.costCents, 11250);
  assert.equal(hid.unitPriceCents, 16875);
  assert.equal(hid.listPriceCents, 18999);
  assert.equal(hid.name, "HID reader (mine)", "an existing product keeps its own name");
  assert.equal(hid.description, "Customer-facing words", "and its own description");
  const cable = await product(org, "012345");
  assert.equal(cable.costCents, 123450);
  assert.equal(cable.unitPriceCents, 185175);
  assert.equal(cable.supplier, "Spirit Supply", "moved to the supplier that sent the sheet");
  const panel = await product(org, "PNL-1");
  assert.deepEqual([panel.costCents, panel.unitPriceCents, panel.listPriceCents, panel.supplier], [10000, 13000, 14000, "Spirit Supply"]);
  const camera = await product(org, "NEW-1");
  assert.deepEqual([camera.name, camera.costCents, camera.unitPriceCents, camera.listPriceCents, camera.active], ["New camera", 20000, 27500, 32000, true]);
  assert.equal(await product(org, "CALL-1"), undefined, "the Call row was never created");
  const cat6 = await product(org, "CAT6");
  assert.deepEqual([cat6.costCents, cat6.unitPriceCents], [18900, 24500], "the unticked unit change was left alone");
  assert.equal((await product(org, "GONE-1")).active, false, "not on the sheet anymore → inactive");
  assert.equal((await sql(`SELECT count(*)::int n FROM "Product" WHERE "organizationId"=$1 AND sku='OLD-1'`, [org])).rows[0].n, 0, "Discontinued tab not imported");
  const links = (await sql(`SELECT "A","B" FROM "_DistributorContactToProduct" WHERE "B" IN ('prd_ir_cable','prd_ir_hid') ORDER BY "B"`)).rows;
  assert.deepEqual(links, [{ A: "dc_ir_mike", B: "prd_ir_cable" }, { A: "dc_ir_mike", B: "prd_ir_hid" }], "the ADI rep came off the moved product; Mike is on both");
  const supplier = (await sql(`SELECT "priceRule","priceRuleBasisPoints","ratesheetColumns" FROM "Distributor" WHERE id='dst_ir_spirit'`)).rows[0];
  assert.deepEqual([supplier.priceRule, supplier.priceRuleBasisPoints], ["MARKUP", 3000]);
  assert.ok(Object.values(supplier.ratesheetColumns).some((roles) => roles.join(",") === "sku,description,cost,list,skip"), "the hand-fixed columns are remembered");
  const file = (await sql(`SELECT * FROM "LinkedRatesheet" WHERE "organizationId"=$1`, [org])).rows[0];
  assert.deepEqual(
    [file.distributorId, file.addedCount, file.updatedCount, file.costUpCount, file.costDownCount, file.effectiveOn.toISOString().slice(0, 10), file.sizeBytes],
    ["dst_ir_spirit", 1, 3, 3, 0, "2026-11-01", fs.statSync(FIXTURE).size],
  );

  log("Ratesheets page: the saved file says what the import did");
  await page.getByRole("button", { name: "Done" }).click();
  await page.goto(`${BASE}/dashboard/products/ratesheets`);
  const summary = await page.getByTestId("linked-file-import").first().innerText();
  assert.match(summary, /Spirit Supply · effective Nov 1, 2026 · imported .*: 1 new, 3 updated \(3 cost more\)/);

  log("Import prices on the saved file: the columns come back the way they were fixed");
  await page.getByRole("button", { name: "Import prices" }).click();
  await page.getByTestId("ratesheet-summary").waitFor();
  await page.waitForFunction(() => !document.body.innerText.includes("matching your catalog"));
  assert.ok(await page.getByText("Reading the columns the way you set them for Spirit Supply last time.").isVisible());
  assert.ok(!(await page.getByTestId("ratesheet-columns").innerText()).includes("Unit"), "UOM stays Don't import");
  assert.equal(await page.locator("#ratesheet-supplier").inputValue(), "dst_ir_spirit");
  assert.equal(await row("HID ProxPro").locator("input[inputmode=decimal]").inputValue(), "168.75", "same cost now, so the price stays");
  await page.getByLabel("Close").click();

  log("decline: a note is required, nothing imports, the operator sees the file and the note");
  await openImport(page);
  const csv = path.join(OUT, "ir-swapped.csv");
  fs.writeFileSync(csv, "Part #,Description,Price\nZ-1,Zed,10\n");
  await page.setInputFiles("#ratesheet-import-file", csv);
  await page.getByTestId("ratesheet-summary").waitFor();
  await page.locator("#ratesheet-supplier").selectOption("dst_ir_adi");
  await page.getByRole("button", { name: "Decline" }).click();
  await page.getByRole("button", { name: "Send and don't import" }).click();
  await page.getByText("Tell us what was wrong with the import").waitFor();
  await page.fill("#ratesheet-decline-note", "IR-SUITE the price is per 100");
  await page.getByRole("button", { name: "Send and don't import" }).click();
  await page.getByTestId("ratesheet-done").waitFor();
  assert.match(await page.getByTestId("ratesheet-done").innerText(), /nothing was imported/);
  assert.equal(await product(org, "Z-1"), undefined);
  const issue = (await sql(`SELECT * FROM "RatesheetImportIssue" WHERE "organizationId"=$1`, [org])).rows[0];
  assert.equal(issue.note, "IR-SUITE the price is per 100");
  assert.equal(issue.distributorId, "dst_ir_adi");
  assert.deepEqual(issue.detected.tabs[0].headers, ["Part #", "Description", "Price"]);
  await page.getByRole("button", { name: "Done" }).click();
  // Not an operator yet: /admin is a 404.
  assert.equal((await page.goto(`${BASE}/admin`)).status(), 404);
  await sql(`UPDATE "User" SET "isSuperAdmin"=true WHERE email=$1`, [EMAIL]);
  await page.goto(`${BASE}/admin`);
  const issues = page.getByTestId("ratesheet-issues");
  await issues.getByText("IR-SUITE the price is per 100").waitFor();
  assert.ok(await issues.getByText(/Part # → sku · Description → description · Price → cost/).first().isVisible());
  const download = await page.request.get(`${BASE}/admin/ratesheet-issues/${issue.id}`);
  assert.equal(download.status(), 200);
  assert.equal(await download.text(), fs.readFileSync(csv, "utf8"));
  await issues.locator("li", { hasText: "IR-SUITE" }).getByRole("button", { name: "Mark fixed" }).click();
  await page.waitForFunction(() => document.body.innerText.includes("Reopen"));
  assert.ok((await sql(`SELECT "resolvedAt" FROM "RatesheetImportIssue" WHERE id=$1`, [issue.id])).rows[0].resolvedAt);
  await sql(`UPDATE "User" SET "isSuperAdmin"=false WHERE email=$1`, [EMAIL]);

  log("refusals keep the screen: an unpicked supplier is refused, nothing cleared");
  await openImport(page);
  await page.setInputFiles("#ratesheet-import-file", csv);
  await page.getByTestId("ratesheet-summary").waitFor();
  assert.equal(await page.locator("#ratesheet-supplier").inputValue(), "", "no guess → the picker starts empty, not on the first supplier");
  await page.getByTestId("ratesheet-import").click();
  await page.getByText("Pick who sent this ratesheet").waitFor();
  assert.match(await page.getByTestId("ratesheet-summary").innerText(), /1 product on the sheet/, "the preview is still there");
  log("+ Add New Distributor with a name already on file offers the existing one");
  await page.locator("#ratesheet-supplier").selectOption("__new__");
  await page.getByLabel("New distributor name").fill("adi");
  await page.getByRole("button", { name: "Use ADI (already in your list)" }).click();
  assert.equal(await page.locator("#ratesheet-supplier").inputValue(), "dst_ir_adi");
  if (process.env.IR_DEBUG) {
    const all = page.getByLabel("Close");
    console.log("close count", await all.count());
    for (let i = 0; i < await all.count(); i++) console.log(i, await all.nth(i).boundingBox(), await all.nth(i).isVisible());
    console.log("viewport", page.viewportSize(), await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth, window.scrollY]));
    await shot(page, "debug-close");
  }
  await page.getByLabel("Close").click();

  log("+ Add New Distributor with a point of contact makes both, once");
  await openImport(page);
  const csv2 = path.join(OUT, "ir-acme.csv");
  fs.writeFileSync(csv2, "Mfr Part #,Description,Your Cost,MSRP\nAC-1,Acme panel,50,90\n");
  await page.setInputFiles("#ratesheet-import-file", csv2);
  await page.getByTestId("ratesheet-summary").waitFor();
  await page.locator("#ratesheet-supplier").selectOption("__new__");
  await page.getByLabel("New distributor name").fill("Acme Wholesale");
  await page.getByLabel("Contact first name").fill("Rita");
  await page.getByLabel("Contact last name").fill("Rep");
  await page.getByLabel("Contact email").fill("rita@acme.example");
  await page.locator("#ratesheet-rule").selectOption("LIST");
  await page.locator("#ratesheet-percent").fill("10");
  assert.equal(await row("Acme panel").locator("input[inputmode=decimal]").inputValue(), "81.00", "MSRP less 10%");
  await page.getByTestId("ratesheet-import").click();
  await page.getByTestId("ratesheet-done").waitFor();
  const acme = await product(org, "AC-1");
  assert.deepEqual([acme.supplier, acme.costCents, acme.unitPriceCents, acme.listPriceCents], ["Acme Wholesale", 5000, 8100, 9000]);
  const acmeCo = (await sql(`SELECT count(*)::int n FROM "Company" WHERE "organizationId"=$1 AND name='Acme Wholesale'`, [org])).rows[0].n;
  assert.equal(acmeCo, 1, "the new distributor is a Company too");
  const rita = (await sql(`SELECT name, email FROM "DistributorContact" WHERE "organizationId"=$1 AND email='rita@acme.example'`, [org])).rows;
  assert.deepEqual(rita, [{ name: "Rita Rep", email: "rita@acme.example" }]);

  log("product form: markup and margin follow the price, and the price follows them");
  await page.goto(`${BASE}/dashboard/products/prd_ir_cat6`);
  await page.locator("#cost").waitFor();
  assert.equal(await page.locator("#markupPercent").inputValue(), "29.63");
  assert.equal(await page.locator("#marginPercent").inputValue(), "22.86");
  await page.fill("#marginPercent", "50");
  assert.equal(await page.locator("#unitPrice").inputValue(), "378.00");
  assert.equal(await page.locator("#markupPercent").inputValue(), "100");
  await page.fill("#cost", "200");
  assert.equal(await page.locator("#unitPrice").inputValue(), "400.00", "a typed margin keeps holding when the cost moves");
  await page.fill("#unitPrice", "250");
  assert.equal(await page.locator("#marginPercent").inputValue(), "20");
  await page.fill("[name=listPrice]", "299.99");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByText("Product saved").waitFor();
  const saved = await product(org, "CAT6");
  assert.deepEqual([saved.costCents, saved.unitPriceCents, saved.listPriceCents], [20000, 25000, 29999]);

  log("Products list: a Margin column with markup under it");
  await page.goto(`${BASE}/dashboard/products`);
  const hidRow = page.locator("tr", { hasText: "HID reader (mine)" });
  assert.match(await hidRow.getByTestId("product-margin").innerText(), /33%\s*50% markup/);

  log("a 3,000-row sheet: 1,500 updates and 1,500 new products, in batches, inside a minute");
  await sql(
    `INSERT INTO "Product" (id,"organizationId",name,description,sku,"unitPriceCents","costCents","defaultTag","distributorId",active,"updatedAt")
     SELECT 'prd_ir_bulk_' || g, $1, 'Bulk item ' || g, '', 'BULK-' || g, 2000, 1000, 'MATERIALS', 'dst_ir_spirit', true, now()
       FROM generate_series(1, 1500) g`,
    [org],
  );
  const big = path.join(OUT, "ir-spirit-big.csv");
  const lines = ["Mfr Part #,Description,Dealer,MSRP"];
  for (let i = 1; i <= 3000; i += 1) lines.push(`BULK-${i},Bulk item ${i},11.00,25.00`);
  fs.writeFileSync(big, lines.join("\n") + "\n");
  await openImport(page);
  await page.setInputFiles("#ratesheet-import-file", big);
  await page.getByTestId("ratesheet-summary").waitFor();
  await page.locator("#ratesheet-supplier").selectOption("dst_ir_spirit");
  await page.waitForFunction(() => !document.body.innerText.includes("matching your catalog"), null, { timeout: 60_000 });
  assert.match(await page.getByTestId("ratesheet-summary").innerText(), /3,000 products on the sheet · 3,000 ticked/);
  const started = Date.now();
  await page.getByTestId("ratesheet-import").click();
  await page.getByTestId("ratesheet-done").waitFor({ timeout: 120_000 });
  const seconds = (Date.now() - started) / 1000;
  console.log(`     imported 3,000 rows in ${seconds.toFixed(1)}s`);
  assert.match(await page.getByTestId("ratesheet-done").innerText(), /Imported 3,000 products from Spirit Supply: 1,500 new, 1,500 updated \(1,500 cost more\)/);
  assert.ok(seconds < 60, `the import took ${seconds}s`);
  const bulk = (await sql(
    `SELECT count(*) FILTER (WHERE "costCents"=1100 AND "unitPriceCents"=2200 AND "listPriceCents"=2500)::int AS kept_margin,
            count(*) FILTER (WHERE "costCents"=1100 AND "unitPriceCents"=1430)::int AS new_rule,
            count(*)::int AS total
       FROM "Product" WHERE "organizationId"=$1 AND sku LIKE 'BULK-%'`,
    [org],
  )).rows[0];
  assert.deepEqual(bulk, { kept_margin: 1500, new_rule: 1500, total: 3000 });
  await page.getByRole("button", { name: "Done" }).click();

  log("phone: the Import button sits on screen at the foot of the dialog");
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mobile = await phone.newPage();
  await login(mobile);
  await openImport(mobile);
  await mobile.setInputFiles("#ratesheet-import-file", FIXTURE);
  await mobile.getByTestId("ratesheet-summary").waitFor();
  const box = await mobile.getByTestId("ratesheet-import").boundingBox();
  assert.ok(box && box.y + box.height <= 844, `Import button visible without scrolling the dialog (y=${box && box.y})`);
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, `no sideways scroll on a phone (${overflow}px)`);
  await shot(mobile, "03-phone");
  await phone.close();

  await browser.close();
  console.log(`\nAll ${step} import-ratesheet steps passed.`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
