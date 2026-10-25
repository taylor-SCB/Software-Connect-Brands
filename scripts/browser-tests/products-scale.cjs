/* Browser regression for Products at full catalog size (Oct 25, 2026).
 *
 * Covers: the Products list paged at 10 / 50 / 100 with "Showing 1–50 of
 * 130 products"; the search box matching every word against name, part
 * number, description and manufacturer; the Supplier, Manufacturer, Tag,
 * Service type and Status filters stacking, with chips and Clear all, and
 * surviving a reload; a search with nothing to show; the quote's "Add
 * from catalog" box (a typed part number first, arrow keys and Enter, two
 * in a row, inactive products never offered, the page no longer carrying
 * the catalog); the Create Ratesheet picker searching, keeping ticks
 * through a search, saving, and the edit page showing them first; Order
 * materials pricing a row whose contract captured $0 at the catalog cost
 * now, and leaving a real captured cost alone; the phone layout.
 *
 * Oct 25, 2026 audit fixes (their own steps at the end): Enter pressed
 * before the search answers adds what was typed, not the last search's
 * first row; an arrow key before the list loads; the catalog list drawn
 * above the Payment table and taking taps there; a backslash in a search;
 * a delete landing back on the same filtered page; Create Ratesheet's
 * Select all reaching the whole catalog, Show 50 more, Clear matching.
 *
 * Runs against a built app and a local Postgres that has had `prisma
 * migrate deploy` run. Signs up its own workspace and deletes it at the
 * end. Never point it at the live database.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/scb_test \
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules \
 *   node scripts/browser-tests/products-scale.cjs
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
const OUT = process.env.SHOTS_DIR || path.join(os.tmpdir(), "scb-browser-shots-products-scale");
fs.mkdirSync(OUT, { recursive: true });

const EMAIL = "test-products-scale@example.com";
const PASSWORD = "password123";
const COMPANY = "Test Products Scale Co";
const SLUG_LIKE = "test-products-scale-co%";

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
async function signAs(browser, token, name) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${BASE}/c/${token}`);
  await page.fill("[name=signerName]", name);
  await page.check("[name=agree]");
  await page.click("button[type=submit]");
  await page.getByText("Accepted electronically").waitFor();
  await context.close();
}

(async () => {
  await sql(`DELETE FROM "Organization" WHERE slug LIKE $1`, [SLUG_LIKE]);
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
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
  await page.goto(`${BASE}/login`);
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/dashboard$/);

  log("seed 130 products across three suppliers, four manufacturers, the tags and two service types");
  await sql(
    `INSERT INTO "Distributor" (id,"organizationId",name,"updatedAt") VALUES
       ('dst_ps_gulf',$1,'Gulf Supply',now()), ('dst_ps_metro',$1,'Metro Electric',now()), ('dst_ps_ace',$1,'Ace Distribution',now())`,
    [org],
  );
  await sql(
    `INSERT INTO "Manufacturer" (id,"organizationId",name) VALUES
       ('mfr_ps_mueller',$1,'Mueller'), ('mfr_ps_belden',$1,'Belden'), ('mfr_ps_hid',$1,'HID'), ('mfr_ps_leviton',$1,'Leviton')`,
    [org],
  );
  // 120 generated: every 10th inactive; suppliers, makers, tags and
  // service types in turn.
  await sql(
    `INSERT INTO "Product" (id,"organizationId",name,description,sku,"unitPriceCents","costCents","defaultTag","distributorId","manufacturerId","serviceType",active,"updatedAt")
     SELECT 'prd_ps_' || g, $1, 'Widget ' || lpad(g::text, 3, '0'), 'Generated part', 'WG-' || lpad(g::text, 4, '0'),
            1000 + g, 500 + g,
            (ARRAY['LABOR','MATERIALS','SOFTWARE','PROJECT_SERVICES','SHIPPING','TAXES'])[1 + g % 6]::"LineItemTag",
            (ARRAY['dst_ps_gulf','dst_ps_metro','dst_ps_ace'])[1 + g % 3],
            (ARRAY['mfr_ps_mueller','mfr_ps_belden','mfr_ps_hid','mfr_ps_leviton'])[1 + g % 4],
            (ARRAY['Plumbing','Electrical',NULL])[1 + g % 3],
            g % 10 <> 0, now()
       FROM generate_series(1, 120) g`,
    [org],
  );
  await sql(
    `INSERT INTO "Product" (id,"organizationId",name,description,sku,"unitPriceCents","costCents","defaultTag","distributorId","manufacturerId","unitOfMeasure",active,"updatedAt") VALUES
       ('prd_ps_cu',$1,'Copper pipe 3/4in','Type L, 10ft','CU-34',403,310,'MATERIALS','dst_ps_gulf','mfr_ps_mueller','PER_LINEAR_FT',true,now()),
       ('prd_ps_cat6',$1,'Cat6 cable','Plenum, 1000ft box','CAT6-1000',18900,12000,'MATERIALS','dst_ps_metro','mfr_ps_belden','EACH',true,now()),
       ('prd_ps_cat6j',$1,'Cat6 jack','Keystone, CAT6-1000 compatible','CAT6-J',450,210,'MATERIALS','dst_ps_metro','mfr_ps_leviton',NULL,true,now()),
       ('prd_ps_reader',$1,'Prox card reader','iCLASS','HID-5355',14625,11250,'MATERIALS','dst_ps_ace','mfr_ps_hid',NULL,true,now()),
       ('prd_ps_ret',$1,'Retired fitting','No longer stocked','RET-1',100,50,'MATERIALS','dst_ps_gulf','mfr_ps_mueller',NULL,false,now()),
       ('prd_ps_lab1',$1,'Journeyman labor','','LAB-1',13000,10000,'LABOR',NULL,NULL,'PER_HOUR',true,now()),
       ('prd_ps_lab2',$1,'Apprentice labor','','LAB-2',7500,5000,'LABOR',NULL,NULL,'PER_HOUR',true,now()),
       ('prd_ps_permit',$1,'Permit handling','','PERMIT',19500,15000,'PROJECT_SERVICES',NULL,NULL,NULL,true,now()),
       ('prd_ps_ship',$1,'Freight','','SHIP-1',5000,4000,'SHIPPING',NULL,NULL,NULL,true,now()),
       ('prd_ps_tax',$1,'Sales tax','','TAX-1',0,0,'TAXES',NULL,NULL,NULL,true,now())`,
    [org],
  );
  const count = async (where) =>
    (await sql(`SELECT count(*)::int n FROM "Product" WHERE "organizationId"=$1 AND ${where}`, [org])).rows[0].n;
  assert.equal(await count("true"), 130);
  const summary = () => page.getByTestId("page-summary").innerText();

  log("the Products list pages: 50 to start, then 10, with page 2 a link away");
  await page.goto(`${BASE}/dashboard/products`);
  assert.match(await summary(), /^Showing 1–50 of 130 products$/);
  assert.equal(await page.locator("table tbody tr").count(), 50);
  await page.getByText("130 products", { exact: true }).waitFor();
  await page.getByLabel("Rows per page").selectOption("10");
  await page.waitForURL(/per=10/);
  await page.waitForFunction(() => document.querySelector("[data-testid=page-summary]")?.textContent?.startsWith("Showing 1–10 of 130"));
  assert.equal(await page.locator("table tbody tr").count(), 10);
  await page.getByRole("link", { name: "Page 2" }).click();
  await page.waitForURL(/page=2/);
  await page.waitForFunction(() => document.querySelector("[data-testid=page-summary]")?.textContent?.startsWith("Showing 11–20 of 130"));
  await shot(page, "01-paged");

  log("the search box matches every word, in any field: name, part number, description, manufacturer");
  const search = async (text) => {
    await page.getByLabel("Search products").fill(text);
    await page.getByLabel("Search products").press("Enter");
    await page.waitForURL((url) => url.searchParams.get("q") === text);
  };
  await page.goto(`${BASE}/dashboard/products`);
  await search("copper 3/4");
  assert.match(await summary(), /of 1 products$/);
  await page.getByRole("link", { name: "Copper pipe 3/4in" }).waitFor();
  await search("cat6-1000");
  // Its own part number, and the jack whose description names it.
  assert.deepEqual(await page.locator("table tbody tr td:first-child a").allTextContents(), ["Cat6 cable", "Cat6 jack"]);
  await search("hid reader");
  assert.deepEqual(await page.locator("table tbody tr td:first-child a").allTextContents(), ["Prox card reader"]);
  await search("nothing like this anywhere");
  await page.getByText("No products match").waitFor();
  await page.getByRole("link", { name: "Clear search and filters" }).click();
  await page.waitForURL(/\/dashboard\/products$/);

  log("the filters stack, show as chips, survive a reload, and Clear all brings everything back");
  const pick = async (filter, option) => {
    await page.getByTestId(filter).click();
    await page.getByRole("listbox").getByLabel(option, { exact: true }).check();
    await page.keyboard.press("Escape");
  };
  await pick("filter-supplier", "Metro Electric");
  await page.waitForURL(/supplier=dst_ps_metro/);
  const metro = await count(`"distributorId"='dst_ps_metro'`);
  await page.waitForFunction((n) => document.querySelector("[data-testid=page-summary]")?.textContent?.endsWith(`of ${n} products`), metro);
  await pick("filter-tag", "Materials");
  await page.waitForURL(/tag=MATERIALS/);
  const metroMaterials = await count(`"distributorId"='dst_ps_metro' AND "defaultTag"='MATERIALS'`);
  await page.waitForFunction((n) => document.querySelector("[data-testid=page-summary]")?.textContent?.endsWith(`of ${n} products`), metroMaterials);
  const chips = await page.getByTestId("active-filters").innerText();
  assert.match(chips, /Supplier: Metro Electric/);
  assert.match(chips, /Tag: Materials/);
  await page.reload();
  await page.waitForFunction((n) => document.querySelector("[data-testid=page-summary]")?.textContent?.endsWith(`of ${n} products`), metroMaterials);
  await page.getByRole("button", { name: "Clear all" }).click();
  await page.waitForURL(/\/dashboard\/products$/);
  await pick("filter-status", "Inactive");
  await page.waitForURL(/status=inactive/);
  await page.waitForFunction((n) => document.querySelector("[data-testid=page-summary]")?.textContent?.endsWith(`of ${n} products`), await count("active=false"));
  await page.getByRole("button", { name: "Clear all" }).click();
  await pick("filter-manufacturer", "Mueller");
  await pick("filter-service-type", "Plumbing");
  await page.waitForURL(/service=Plumbing/);
  await page.waitForFunction(
    (n) => document.querySelector("[data-testid=page-summary]")?.textContent?.endsWith(`of ${n} products`),
    await count(`"manufacturerId"='mfr_ps_mueller' AND "serviceType"='Plumbing'`),
  );
  await shot(page, "02-filters");
  await page.getByRole("button", { name: "Clear all" }).click();
  await page.waitForURL(/\/dashboard\/products$/);

  log("seed a customer, a deal and a quote, and open it");
  await sql(`INSERT INTO "Company" (id,"organizationId",name,"updatedAt") VALUES ('cmp_ps',$1,'Harbor Lofts',now())`, [org]);
  await sql(
    `INSERT INTO "Contact" (id,"organizationId","companyId",name,email,"updatedAt") VALUES ('ctc_ps',$1,'cmp_ps','Dana Ruiz','dana@harbor.com',now())`,
    [org],
  );
  await sql(`INSERT INTO "Deal" (id,"organizationId","contactId",title,stage,"updatedAt") VALUES ('deal_ps',$1,'ctc_ps','Harbor wiring','QUOTE_SENT',now())`, [org]);
  await sql(
    `INSERT INTO "Quote" (id,"organizationId","contactId","dealId",number,title,status,"publicToken","updatedAt")
     VALUES ('quo_ps',$1,'ctc_ps','deal_ps',1000,'Wiring quote','DRAFT','tok_quo_ps_0123456789',now())`,
    [org],
  );
  const quoteResponse = await page.goto(`${BASE}/dashboard/quotes/quo_ps`);
  const html = await quoteResponse.text();
  assert.ok(!html.includes("Widget 077"), "the quote page no longer ships the catalog");

  log("Add from catalog: a typed part number comes first, Enter adds it, and the box stays ready for the next");
  const catalog = page.getByLabel("Add product from catalog");
  const results = page.getByTestId("catalog-results");
  await catalog.fill("cat6-1000");
  await results.getByRole("option").first().waitFor();
  assert.match(await results.getByRole("option").first().innerText(), /Cat6 cable[\s\S]*CAT6-1000 · Belden[\s\S]*\$189\.00/);
  await catalog.press("Enter");
  await page.getByLabel("Line 1 product", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Line 1 product", { exact: true }).inputValue(), "Cat6 cable");
  assert.equal(await page.getByLabel("Line 1 unit value").inputValue(), "189.00");
  assert.equal(await catalog.inputValue(), "", "the box is cleared for the next one");
  await catalog.fill("labor");
  await results.getByRole("option", { name: /Apprentice labor/ }).waitFor();
  await catalog.press("ArrowDown");
  await catalog.press("Enter");
  assert.equal(await page.getByLabel("Line 2 product", { exact: true }).inputValue(), "Journeyman labor");
  assert.equal(await page.getByLabel("Line 2 tag").inputValue(), "LABOR");

  log("an inactive product is never offered; a search with no match says so");
  await catalog.fill("retired fitting");
  await results.getByText("No active product matches").waitFor();
  // Widget 010 is one of the inactive ones, by its part number.
  await catalog.fill("WG-0010");
  await results.getByText("No active product matches").waitFor();
  await catalog.fill("widget 011");
  await results.getByRole("option", { name: /Widget 011/ }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Save line items" }).click();
  await page.getByText("Line items saved").waitFor();
  const lines = (await sql(`SELECT name, "productId", "unitPriceCents" FROM "QuoteLineItem" WHERE "quoteId"='quo_ps' ORDER BY position`)).rows;
  assert.deepEqual(lines, [
    { name: "Cat6 cable", productId: "prd_ps_cat6", unitPriceCents: 18900 },
    { name: "Journeyman labor", productId: "prd_ps_lab1", unitPriceCents: 13000 },
  ]);
  await shot(page, "03-catalog-picker");

  log("Create Ratesheet: the picker searches, keeps a tick through a search, and saves it");
  await page.goto(`${BASE}/dashboard/products/ratesheets/new`);
  await page.getByText("0 of 130 selected").waitFor();
  await page.getByRole("button", { name: "Select all 130" }).waitFor();
  await page.getByRole("button", { name: "Show 50 more" }).waitFor();
  await page.getByLabel("Search products").fill("copper");
  await page.getByLabel("Include Copper pipe 3/4in").check();
  await page.getByLabel("Search products").fill("cat6");
  await page.getByLabel("Include Cat6 jack").check();
  await page.getByText("2 of 130 selected").waitFor();
  await page.getByLabel("Search products").fill("");
  // With no search, what is ticked comes first.
  await page.getByLabel("Include Copper pipe 3/4in").waitFor();
  const firstTwo = await page.locator("label[class*=cursor-pointer] input[type=checkbox]").evaluateAll((boxes) =>
    boxes.slice(0, 2).map((box) => box.getAttribute("aria-label")),
  );
  assert.deepEqual(firstTwo.sort(), ["Include Cat6 jack", "Include Copper pipe 3/4in"]);
  await page.fill("#name", "Harbor pricing");
  await page.fill("#partnerEmail", "buyer@harbor.com");
  await page.getByRole("button", { name: "Create ratesheet" }).click();
  await page.waitForURL(/\/dashboard\/products\/ratesheets\/[^/?]+\?created=1/);
  const sheet = (await sql(`SELECT id FROM "Ratesheet" WHERE "organizationId"=$1 AND name='Harbor pricing'`, [org])).rows[0];
  const items = (await sql(`SELECT "productId" FROM "RatesheetItem" WHERE "ratesheetId"=$1 ORDER BY "productId"`, [sheet.id])).rows;
  assert.deepEqual(items.map((row) => row.productId), ["prd_ps_cat6j", "prd_ps_cu"]);

  log("the sheet's own page shows its two ticked first, and a third can be added by search");
  await page.getByText("2 of 130 selected").waitFor();
  assert.equal(await page.getByLabel("Include Copper pipe 3/4in").isChecked(), true);
  await page.getByLabel("Search products").fill("HID-5355");
  await page.getByLabel("Include Prox card reader").check();
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByText(/saved/i).first().waitFor();
  assert.equal((await sql(`SELECT count(*)::int n FROM "RatesheetItem" WHERE "ratesheetId"=$1`, [sheet.id])).rows[0].n, 3);

  log("Order materials: a row whose contract captured $0 orders at the catalog cost now; a real captured cost is kept");
  // A product that came in through the old Import CSV with $0 cost, and
  // one with a real cost.
  await sql(
    `INSERT INTO "Product" (id,"organizationId",name,description,"unitPriceCents","costCents","defaultTag","distributorId","serviceType","updatedAt") VALUES
       ('prd_ps_zero',$1,'Door strike','',9900,0,'MATERIALS','dst_ps_gulf','Access',now()),
       ('prd_ps_real',$1,'Mag lock','',25000,15000,'MATERIALS','dst_ps_gulf','Access',now())`,
    [org],
  );
  await sql(`INSERT INTO "Deal" (id,"organizationId","contactId",title,stage,"updatedAt") VALUES ('deal_ps2',$1,'ctc_ps','Harbor doors','QUOTE_SENT',now())`, [org]);
  await sql(
    `INSERT INTO "Quote" (id,"organizationId","contactId","dealId",number,title,status,"publicToken","updatedAt")
     VALUES ('quo_ps2',$1,'ctc_ps','deal_ps2',1001,'Doors quote','SENT','tok_quo_ps2_123456789',now())`,
    [org],
  );
  await sql(
    `INSERT INTO "QuoteLineItem" (id,"quoteId","productId",name,quantity,"unitPriceCents",tag,"serviceType",position) VALUES
       ('qli_ps1','quo_ps2','prd_ps_zero','Door strikes',4,9900,'MATERIALS','Access',0),
       ('qli_ps2','quo_ps2','prd_ps_real','Mag locks',2,25000,'MATERIALS','Access',1)`,
  );
  await page.goto(`${BASE}/dashboard/deals/tracker?dealId=deal_ps2`);
  await page.locator("[data-testid=tracker-row]").first().waitFor();
  await page.getByRole("checkbox", { name: "Put Door strikes on Contract A" }).check();
  await page.getByRole("checkbox", { name: "Put Mag locks on Contract A" }).check();
  await page.locator("[data-testid=create-contracts]").click();
  await page.waitForURL(/created=\d+/);
  const sales = (await sql(
    `SELECT id, "publicToken" FROM "Contract" WHERE "organizationId"=$1 AND "dealId"='deal_ps2' AND payable=false`,
    [org],
  )).rows[0];
  const captured = (await sql(`SELECT name, "unitCostCents" FROM "ContractLineItem" WHERE "contractId"=$1 ORDER BY position`, [sales.id])).rows;
  assert.deepEqual(captured, [{ name: "Door strikes", unitCostCents: 0 }, { name: "Mag locks", unitCostCents: 15000 }], "the contract captured $0 and $150");
  await page.goto(`${BASE}/dashboard/contracts/${sales.id}`);
  await page.getByRole("button", { name: /Mark as sent|Send for signature/ }).first().click();
  await page.getByText(/Sent/).first().waitFor();
  await signAs(browser, sales.publicToken, "Dana Ruiz");
  const project = (await sql(`SELECT id FROM "Project" WHERE "organizationId"=$1 AND "dealId"='deal_ps2'`, [org])).rows[0];
  // A ratesheet re-import fixes the catalog: the strike costs $45 now,
  // and the mag lock's catalog cost moves to $160.
  await sql(`UPDATE "Product" SET "costCents"=4500 WHERE id='prd_ps_zero'`);
  await sql(`UPDATE "Product" SET "costCents"=16000 WHERE id='prd_ps_real'`);
  await page.goto(`${BASE}/dashboard/projects/${project.id}/money`);
  await page.locator("[data-testid=order-materials]").click();
  await page.locator("[data-testid=supplier-to-order]").first().waitFor();
  // 4 strikes at $45 + 2 mag locks at the $150 the contract captured = $480.
  assert.match(await page.locator("[data-testid=supplier-to-order]").first().textContent(), /\$480\.00/);
  await page.locator("[data-testid=order-from-supplier]").first().click();
  await page.waitForURL(/\/dashboard\/contracts\/[a-z0-9]+$/, { timeout: 20000 });
  const po = (await sql(
    `SELECT li.name, li."unitPriceCents", li."unitCostCents" FROM "ContractLineItem" li JOIN "Contract" c ON c.id = li."contractId"
      WHERE c."organizationId"=$1 AND c.payable=true AND c."projectId"=$2 ORDER BY li.position`,
    [org, project.id],
  )).rows;
  assert.deepEqual(po, [
    { name: "Door strikes", unitPriceCents: 4500, unitCostCents: 4500 },
    { name: "Mag locks", unitPriceCents: 15000, unitCostCents: 15000 },
  ]);

  log("on a phone the list and its bar fit the screen, and the catalog box is full width");
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await context.storageState() });
  const mobile = await phone.newPage();
  await mobile.goto(`${BASE}/dashboard/products?per=10`);
  await mobile.getByTestId("page-summary").waitFor();
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "no sideways scroll on the page");
  await shot(mobile, "04-phone-products");
  await mobile.goto(`${BASE}/dashboard/quotes/quo_ps`);
  const box = await mobile.getByLabel("Add product from catalog").boundingBox();
  assert.ok(box && box.width > 300, `catalog box ${box?.width}px wide`);
  await phone.close();

  log("audit fixes: Enter pressed before the search answers adds what was typed, not the last search's first row");
  await page.goto(`${BASE}/dashboard/quotes/quo_ps`);
  // The scanner's search answers slowly; the empty box's list is on screen.
  await page.route(/\/dashboard\/products\/search\?active=1&q=HID-5355$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 700));
    await route.continue();
  });
  await catalog.focus();
  await results.getByRole("option").first().waitFor();
  const linesBefore = await page.locator("[aria-label$=' product'][aria-label^='Line ']").count();
  await catalog.fill("HID-5355");
  await catalog.press("Enter");
  const scanned = page.getByLabel(`Line ${linesBefore + 1} product`, { exact: true });
  await scanned.waitFor();
  assert.equal(await scanned.inputValue(), "Prox card reader");
  await page.unroute(/\/dashboard\/products\/search/);

  log("audit fixes: an arrow key pressed before the list loads still leaves Enter working");
  await page.goto(`${BASE}/dashboard/quotes/quo_ps`);
  await page.route(/\/dashboard\/products\/search\?active=1&q=$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.continue();
  });
  await catalog.focus();
  await catalog.press("ArrowDown");
  await results.getByRole("option").first().waitFor();
  assert.equal(await results.locator("[aria-selected=true]").count(), 1, "a row is highlighted");
  await page.unroute(/\/dashboard\/products\/search/);
  await page.keyboard.press("Escape");

  log("audit fixes: the catalog list is drawn above the Payment table and takes taps there");
  await page.goto(`${BASE}/dashboard/quotes/quo_ps`);
  await catalog.focus();
  await results.getByRole("option").nth(10).waitFor();
  const lowest = await results.evaluate((list) => {
    const box = list.getBoundingClientRect();
    const rows = [...list.querySelectorAll("[role=option]")].filter((row) => row.getBoundingClientRect().bottom <= box.bottom);
    const row = rows[rows.length - 1];
    const rect = row.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return { name: row.querySelector("p")?.textContent, onTop: Boolean(hit && hit.closest("[data-testid=catalog-results]")) };
  });
  assert.equal(lowest.onTop, true, "the list's lowest visible row is not covered");
  const linesNow = await page.locator("[aria-label$=' product'][aria-label^='Line ']").count();
  await results.getByRole("option", { name: lowest.name }).click();
  assert.equal(await page.getByLabel(`Line ${linesNow + 1} product`, { exact: true }).inputValue(), lowest.name);

  log("audit fixes: a backslash in a search is just a character, not an error");
  const status = await page.evaluate(async () => (await fetch("/dashboard/products/search?active=1&q=%5C")).status);
  assert.equal(status, 200);
  await catalog.fill("CAT\\");
  await results.getByRole("option", { name: /Cat6 cable/ }).waitFor();

  log("audit fixes: deleting a product from a filtered page lands back on that page");
  await page.goto(`${BASE}/dashboard/products?q=widget&per=10&page=2`);
  await page.waitForFunction(() => document.querySelector("[data-testid=page-summary]")?.textContent?.startsWith("Showing 11–20 of 120"));
  await page.getByRole("button", { name: "Delete Widget 015" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("[data-testid=page-summary]")?.textContent?.startsWith("Showing 11–20 of 119"));
  const landed = new URL(page.url());
  assert.deepEqual([landed.pathname, landed.searchParams.get("q"), landed.searchParams.get("per"), landed.searchParams.get("page")], ["/dashboard/products", "widget", "10", "2"]);
  assert.equal((await sql(`SELECT count(*)::int n FROM "Product" WHERE id='prd_ps_15'`)).rows[0].n, 0);

  log("audit fixes: Create Ratesheet's Select all reaches the whole catalog; Show 50 more; Clear matching");
  await page.goto(`${BASE}/dashboard/products/ratesheets/new`);
  const total = await count("true");
  await page.getByText(`0 of ${total} selected`).waitFor();
  const boxes = page.locator("label[class*=cursor-pointer] input[type=checkbox]");
  await page.getByRole("button", { name: "Show 50 more" }).click();
  await page.waitForFunction(() => document.querySelectorAll("label[class*=cursor-pointer] input[type=checkbox]").length === 100);
  await page.getByRole("button", { name: `Select all ${total}` }).click();
  await page.getByText(`${total} of ${total} selected`).waitFor();
  assert.equal(await boxes.count(), total, "with everything ticked, everything is listed");
  await page.getByLabel("Search products").fill("cat6");
  await page.getByLabel("Include Cat6 jack").waitFor();
  await page.getByRole("button", { name: "Clear matching" }).click();
  await page.getByText(`${total - 2} of ${total} selected`).waitFor();
  await page.getByRole("button", { name: "Select all matching" }).click();
  await page.getByText(`${total} of ${total} selected`).waitFor();

  await browser.close();
  await sql(`DELETE FROM "Organization" WHERE slug LIKE $1`, [SLUG_LIKE]);
  console.log(`\nAll ${step} steps passed. Screenshots in ${OUT}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
