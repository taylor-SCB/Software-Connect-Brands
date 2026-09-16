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

  /* ---------------------------------------------------------------- *
   * W6 — "Save as product?", ticked by default on a hand-typed line.
   * ---------------------------------------------------------------- */
  log("a hand-typed line saves itself into Products, ticked by default");
  // The two lines typed above already became products — that is the
  // feature, ticked by default — so this counts the change, not the total.
  const productsBefore = (
    await sql(`SELECT count(*)::int AS n FROM "Product" WHERE "organizationId"=$1`, [org])
  ).rows[0].n;
  assert.equal(productsBefore, 2, "the two hand-typed lines above should already be in the catalog");

  await page.reload();
  await page.getByRole("button", { name: "Blank line" }).click();
  const saveAsProduct = page.getByLabel("Line 3 save as product", { exact: true });
  assert.equal(await saveAsProduct.isChecked(), true, "Save as product? defaults to ticked");
  await page.getByLabel("Line 3 product", { exact: true }).fill("Site survey");
  await page.getByLabel("Line 3 unit value", { exact: true }).fill("300.00");
  await page.getByLabel("Line 3 tag", { exact: true }).selectOption("LABOR");
  await page.getByLabel("Line 3 unit", { exact: true }).selectOption("PER_HOUR");
  await saveLines(page);

  const made = await sql(
    `SELECT id, name, "unitPriceCents", "defaultTag", "unitOfMeasure" FROM "Product"
      WHERE "organizationId"=$1 AND name='Site survey'`,
    [org],
  );
  assert.equal(made.rows.length, 1, "one product created from the typed line");
  assert.equal(made.rows[0].unitPriceCents, 30000);
  assert.equal(made.rows[0].defaultTag, "LABOR");
  assert.equal(made.rows[0].unitOfMeasure, "PER_HOUR", "the unit came across too");

  const linkedProduct = await sql(
    `SELECT "productId" FROM "QuoteLineItem" WHERE "quoteId"='quo_qi' AND name='Site survey'`,
  );
  assert.equal(linkedProduct.rows[0].productId, made.rows[0].id, "the line points at the new product");

  log("re-saving does not make a second copy of the same product");
  await page.getByLabel("Line 3 quantity", { exact: true }).fill("6");
  await saveLines(page);
  const stillOne = await sql(`SELECT count(*)::int AS n FROM "Product" WHERE "organizationId"=$1`, [org]);
  assert.equal(stillOne.rows[0].n, productsBefore + 1, "a re-save duplicated the product");

  log("unticking it leaves the catalog alone");
  await page.getByRole("button", { name: "Blank line" }).click();
  await page.getByLabel("Line 4 save as product", { exact: true }).uncheck();
  await page.getByLabel("Line 4 product", { exact: true }).fill("One-off crane hire");
  await page.getByLabel("Line 4 unit value", { exact: true }).fill("900.00");
  await saveLines(page);
  const afterUntick = await sql(`SELECT count(*)::int AS n FROM "Product" WHERE "organizationId"=$1`, [org]);
  assert.equal(afterUntick.rows[0].n, productsBefore + 1, "an unticked line was still added to the catalog");

  /* ---------------------------------------------------------------- *
   * W7 — software unit, billing and term, with the Term Total readout.
   * ---------------------------------------------------------------- */
  log("a software line carries unit, billing and term, and shows a Term Total");
  await page.getByRole("button", { name: "Blank line" }).click();
  await page.getByLabel("Line 5 product", { exact: true }).fill("Cloud licences");
  await page.getByLabel("Line 5 quantity", { exact: true }).fill("120");
  await page.getByLabel("Line 5 unit value", { exact: true }).fill("50.00");
  await page.getByLabel("Line 5 tag", { exact: true }).selectOption("SOFTWARE");
  await page.getByLabel("Line 5 unit", { exact: true }).selectOption("PER_DEVICE");
  await page.getByLabel("Line 5 billing", { exact: true }).selectOption("PER_MONTH");
  await page.getByLabel("Line 5 term years", { exact: true }).fill("3");
  await saveLines(page);

  const software = await sql(
    `SELECT "unitOfMeasure","softwareRate","softwareTermMonths" FROM "QuoteLineItem"
      WHERE "quoteId"='quo_qi' AND name='Cloud licences'`,
  );
  assert.equal(software.rows[0].unitOfMeasure, "PER_DEVICE");
  assert.equal(software.rows[0].softwareRate, "PER_MONTH");
  assert.equal(software.rows[0].softwareTermMonths, 36, "3 years stored as 36 months");

  // $50 x 120 devices x 36 months = $216,000. The line total stays $6,000.
  const termTotal = page.getByTestId("line-term-total");
  await termTotal.first().waitFor();
  assert.match(
    (await termTotal.first().innerText()).replace(/\s+/g, " "),
    /216,000/,
    "Term Total should read $216,000",
  );
  await shot(page, "02-software-term-total");

  log("switching the tag away from Software clears its unit, billing and term");
  await page.getByLabel("Line 5 tag", { exact: true }).selectOption("MATERIALS");
  await saveLines(page);
  const cleared = await sql(
    `SELECT "unitOfMeasure","softwareRate","softwareTermMonths" FROM "QuoteLineItem"
      WHERE "quoteId"='quo_qi' AND name='Cloud licences'`,
  );
  assert.equal(cleared.rows[0].softwareRate, null, "software rate should have been cleared");
  assert.equal(cleared.rows[0].softwareTermMonths, null, "software term should have been cleared");
  assert.equal(cleared.rows[0].unitOfMeasure, null, "a Software unit is not legal on a Materials line");

  /* ---------------------------------------------------------------- *
   * W4 + W5 — Supplier / Contractor, and Distributor as a company type.
   * ---------------------------------------------------------------- */
  log("add a distributor from inside a line and pick it as the supplier");
  await page.getByLabel("Line 1 supplier", { exact: true }).selectOption("__new__");
  await page.getByLabel("Line 1 supplier new name", { exact: true }).fill("Gulf Supply");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByLabel("Line 1 supplier", { exact: true }).waitFor();
  await saveLines(page);

  const supplierCompany = await sql(
    `SELECT id, "companyTypes", industries FROM "Company" WHERE "organizationId"=$1 AND name='Gulf Supply'`,
    [org],
  );
  assert.equal(supplierCompany.rows.length, 1, "the supplier was created as a company");
  assert.ok(
    supplierCompany.rows[0].companyTypes.includes("Distributor"),
    "the company is tagged Distributor",
  );

  const bridged = await sql(
    `SELECT "companyId" FROM "Distributor" WHERE "organizationId"=$1 AND name='Gulf Supply'`,
    [org],
  );
  assert.equal(bridged.rows.length, 1, "the matching Distributor record was created");
  assert.equal(
    bridged.rows[0].companyId,
    supplierCompany.rows[0].id,
    "the Distributor and the Company are linked, not two separate records",
  );

  const onLine = await sql(
    `SELECT "supplierCompanyId" FROM "QuoteLineItem" WHERE id=$1`,
    [firstId],
  );
  assert.equal(onLine.rows[0].supplierCompanyId, supplierCompany.rows[0].id, "the line stored its supplier");

  log("Distributor is in the workspace's company-type pick list");
  const typeOption = await sql(
    `SELECT name FROM "CompanyTypeOption" WHERE "organizationId"=$1 AND name='Distributor'`,
    [org],
  );
  assert.equal(typeOption.rows.length, 1, "Distributor should be a real pick-list option");

  log("the supplier survives an unrelated edit rather than being re-pointed");
  await page.reload();
  await page.getByLabel("Line 1 quantity", { exact: true }).fill("5");
  await saveLines(page);
  const stillLinked = await sql(`SELECT "supplierCompanyId" FROM "QuoteLineItem" WHERE id=$1`, [firstId]);
  assert.equal(
    stillLinked.rows[0].supplierCompanyId,
    supplierCompany.rows[0].id,
    "an unrelated edit silently changed the line's supplier",
  );

  /* ---------------------------------------------------------------- *
   * W10 — the quote's own payment table.
   * ---------------------------------------------------------------- */
  log("the payment table starts at the 50/50 baseline, unsaved");
  await page.reload();
  const table = page.getByTestId("payment-schedule");
  await table.waitFor();
  assert.equal(await table.locator("[data-testid=payment-row]").count(), 2, "two baseline rows");
  assert.equal(
    (await sql(`SELECT count(*)::int AS n FROM "QuotePayment" WHERE "quoteId"='quo_qi'`)).rows[0].n,
    0,
    "a page load must not write payment rows",
  );
  const labels = await table.getByLabel("Payment label").all();
  assert.match(await labels[0].inputValue(), /Deposit/, "first row is the deposit");
  assert.match(await labels[1].inputValue(), /Final Pay/, "second row is the final payment");
  const rowTerms = await table.getByTestId("row-terms").all();
  assert.equal(await rowTerms[0].inputValue(), "Net 30", "the baseline carries Net 30");

  log("save it; the two rows add up to the quote total exactly");
  await page.getByTestId("save-schedule").click();
  await page.getByText("Payment table saved", { exact: true }).waitFor();

  const quoteTotal = (
    await sql(
      `SELECT COALESCE(SUM(ROUND(quantity * "unitPriceCents")),0)::int AS total
         FROM "QuoteLineItem" WHERE "quoteId"='quo_qi'`,
    )
  ).rows[0].total;
  const savedRows = await sql(
    `SELECT id, label, kind, percent, "amountCents", terms FROM "QuotePayment"
      WHERE "quoteId"='quo_qi' ORDER BY position`,
  );
  assert.equal(savedRows.rows.length, 2);
  assert.equal(savedRows.rows[0].kind, "PERCENT");
  assert.equal(Number(savedRows.rows[0].percent), 50);
  assert.equal(savedRows.rows[1].kind, "BALANCE");
  assert.equal(savedRows.rows[0].terms, "Net 30");
  assert.equal(
    savedRows.rows[0].amountCents + savedRows.rows[1].amountCents,
    quoteTotal,
    "the table must tie out to the quote total to the cent",
  );
  const paymentIds = savedRows.rows.map((r) => r.id);
  await shot(page, "04-quote-payment-table");

  log("re-saving without a reload keeps the same payment rows");
  await table.getByTestId("row-terms").first().fill("Upon signature");
  await page.getByTestId("save-schedule").click();
  await page.getByText("Payment table saved", { exact: true }).waitFor();
  const resaved = await sql(
    `SELECT id, terms FROM "QuotePayment" WHERE "quoteId"='quo_qi' ORDER BY position`,
  );
  assert.deepEqual(
    resaved.rows.map((r) => r.id),
    paymentIds,
    "the rows were deleted and recreated instead of updated in place",
  );
  assert.equal(resaved.rows[0].terms, "Upon signature");

  // A Balance row always absorbs whatever is left, so a table with one
  // can never fail to tie out. To leave money unscheduled, both rows have
  // to be fixed or percentage rows.
  log("a table that doesn't tie out warns, but still saves");
  await table.locator("[data-testid=payment-row]").nth(1).locator("select").first().selectOption("PERCENT");
  await table.locator("[data-testid=payment-row]").nth(1).locator("input.num").first().fill("10");
  await page.getByTestId("schedule-difference").waitFor();
  assert.match(
    await page.getByTestId("schedule-difference").innerText(),
    /unscheduled/,
    "50% + 10% should report the remaining 40% as unscheduled",
  );
  // Advisory, not blocking — a half-built table still has to be savable.
  await page.getByTestId("save-schedule").click();
  await page.getByText("Payment table saved", { exact: true }).waitFor();

  log("a dollar amount over the total reports the overage");
  await table.locator("[data-testid=payment-row]").nth(1).locator("select").first().selectOption("FIXED");
  await table.locator("[data-testid=payment-row]").nth(1).locator("input.num").first().fill("999999");
  await page.getByTestId("schedule-difference").waitFor();
  assert.match(await page.getByTestId("schedule-difference").innerText(), /over/, "should read as over");

  log("put it back to the baseline; it ties out exactly again");
  await table.locator("[data-testid=payment-row]").nth(1).locator("select").first().selectOption("BALANCE");
  await table.getByTestId("row-terms").first().fill("Net 30");
  await page.getByTestId("save-schedule").click();
  await page.getByText("Payment table saved", { exact: true }).waitFor();
  assert.equal(await page.getByTestId("schedule-difference").count(), 0, "the baseline ties out exactly");
  const restored = await sql(
    `SELECT id, "amountCents" FROM "QuotePayment" WHERE "quoteId"='quo_qi' ORDER BY position`,
  );
  assert.deepEqual(restored.rows.map((r) => r.id), paymentIds, "rows kept their ids throughout");
  assert.equal(
    restored.rows[0].amountCents + restored.rows[1].amountCents,
    quoteTotal,
    "back to tying out to the cent",
  );

  /* ---------------------------------------------------------------- *
   * The leak test: the supplier must not reach the customer's copy.
   * ---------------------------------------------------------------- */
  log("the supplier appears nowhere on the public quote");
  await sql(`UPDATE "Quote" SET status='SENT' WHERE id='quo_qi'`);
  const publicPage = await context.newPage();
  await publicPage.goto(`${BASE}/q/tok_quo_qi_0123456789`);
  await publicPage.getByText("Install labor").first().waitFor();
  const html = await publicPage.content();
  assert.ok(!html.includes("Gulf Supply"), "the supplier's NAME reached the customer's copy");
  assert.ok(
    !html.includes(supplierCompany.rows[0].id),
    "the supplier's ID reached the customer's copy",
  );
  log("the payment table prints on the customer's copy, with the term standing in for a missing date");
  await publicPage.getByTestId("document-payments").waitFor();
  const printed = await publicPage.getByTestId("document-payments").innerText();
  assert.match(printed, /Deposit/, "the deposit row prints");
  assert.match(printed, /Net 30/, "with no date picked, the term stands in");
  assert.equal(
    (await publicPage.getByTestId("document-payments-total").innerText()).replace(/\s/g, ""),
    (await page.getByTestId("scheduled-total").innerText()).replace(/\s/g, ""),
    "the printed total disagrees with the table",
  );
  // How a row was worked out is ours, not the customer's.
  assert.ok(!printed.includes("%"), "a percentage reached the customer's copy");
  await shot(publicPage, "03-public-quote-no-supplier");

  log("Hide from quote keeps it off the customer's copy entirely");
  await page.getByTestId("hide-payment-table").check();
  await page.getByTestId("save-schedule").click();
  await page.getByText("Payment table saved", { exact: true }).waitFor();
  await publicPage.reload();
  await publicPage.getByText("Install labor").first().waitFor();
  assert.equal(
    await publicPage.getByTestId("document-payments").count(),
    0,
    "the payment table is still on the customer's copy after Hide",
  );
  const hiddenHtml = await publicPage.content();
  assert.ok(!hiddenHtml.includes("Final Pay"), "the hidden rows were still shipped inside the page");
  await shot(publicPage, "05-public-quote-hidden-table");

  log("unhide it again");
  await page.getByTestId("hide-payment-table").uncheck();
  await page.getByTestId("save-schedule").click();
  await page.getByText("Payment table saved", { exact: true }).waitFor();
  await publicPage.reload();
  await publicPage.getByTestId("document-payments").waitFor();

  /* ---------------------------------------------------------------- *
   * W12 — lead sales rep, contract signer, other team members.
   * ---------------------------------------------------------------- */
  log("the lead sales rep defaults to whoever made the quote, and prints for the customer");
  const me = (await sql(`SELECT id, name FROM "User" WHERE "organizationId"=$1`, [org])).rows[0];
  await sql(`UPDATE "User" SET title='Sales Director', phone='555-0199' WHERE id=$1`, [me.id]);
  await page.reload();
  assert.equal(
    await page.getByTestId("lead-sales-rep").inputValue(),
    "",
    "this quote was seeded by SQL, so it has no rep yet",
  );

  await page.getByTestId("lead-sales-rep").selectOption(me.id);
  await page.getByTestId("contract-signer").selectOption(me.id);
  await page.getByRole("button", { name: "Save details" }).click();
  await page.getByText("Quote details saved", { exact: true }).waitFor();

  const people = await sql(
    `SELECT "leadSalesRepId","contractSignerId","teamUserIds" FROM "Quote" WHERE id='quo_qi'`,
  );
  assert.equal(people.rows[0].leadSalesRepId, me.id);
  assert.equal(people.rows[0].contractSignerId, me.id);

  await publicPage.reload();
  await publicPage.getByTestId("document-rep").waitFor();
  const repBlock = await publicPage.getByTestId("document-rep").innerText();
  assert.match(repBlock, new RegExp(me.name), "the rep's name prints");
  assert.match(repBlock, /Sales Director/, "their role prints when it is filled in");
  assert.match(repBlock, /555-0199/, "their phone prints when it is filled in");
  await shot(publicPage, "06-public-quote-rep");

  // React empties a form whose action is a server function even when that
  // function refuses. A title past the limit is a refusal the server makes
  // (an empty one is blocked by the browser before it ever gets there).
  log("a refused save keeps what was typed, and keeps the rep");
  await page.getByLabel("Quote title").fill("x".repeat(200));
  await page.locator("#terms").fill("Quote valid 30 days.");
  await page.getByRole("button", { name: "Save details" }).click();
  await page.getByText(/at most 160|too big|Too long/i).waitFor();
  assert.equal(
    await page.getByTestId("lead-sales-rep").inputValue(),
    me.id,
    "a refused save cleared the rep, which the next save would then write",
  );
  assert.equal(
    await page.locator("#terms").inputValue(),
    "Quote valid 30 days.",
    "a refused save threw away what was typed in Terms",
  );
  await page.getByLabel("Quote title").fill("Rekey quote");
  await page.getByRole("button", { name: "Save details" }).click();
  await page.getByText("Quote details saved", { exact: true }).waitFor();
  await publicPage.close();

  /* ---------------------------------------------------------------- *
   * W14 — a contract starts from the quote's payment table.
   * ---------------------------------------------------------------- */
  log("split the quote into a contract; it inherits the quote's payment table");
  await page.goto(`${BASE}/dashboard/contracts/tracker?dealId=deal_qi&quoteId=quo_qi`);
  await page.getByTestId("tracker-grid").waitFor();
  await shot(page, "07-contract-coordinator");

  log('the module now reads "Contract Coordinator"');
  await page.getByRole("heading", { name: "Contract Coordinator" }).waitFor();
  assert.equal(
    await page.getByRole("heading", { name: "Deal Tracker" }).count(),
    0,
    "the old name is still on the page",
  );

  log("the payment schedule defaults to the quote's own table");
  assert.equal(
    await page.locator("#col-1-preset").inputValue(),
    "__quote__",
    "a quote with a payment table should carry it over by default",
  );

  log("tick every row onto Contract A; the preview shows the quote's rows");
  const rowNames = await page.getByRole("checkbox", { name: /^Put .* on Contract A$/ }).all();
  for (const box of rowNames) await box.check();
  // The preview only renders once the column is worth something.
  await page.getByTestId("schedule-preview").first().waitFor();
  assert.match(
    await page.getByTestId("schedule-preview").first().textContent(),
    /Deposit/,
    "the preview should show the quote's rows, not a preset's",
  );

  log("create the contract; its rows and terms came from the quote");
  await page.getByTestId("create-contracts").click();
  // Creating returns to the tracker with the new paperwork listed.
  await page.waitForURL(/created=1/, { timeout: 30000 });

  const madeContract = (
    await sql(
      `SELECT id, "scheduleFromQuote", "scheduleAmendedAt" FROM "Contract" WHERE "organizationId"=$1`,
      [org],
    )
  ).rows[0];
  assert.equal(madeContract.scheduleFromQuote, true, "the contract should be marked as carrying the quote's table");
  assert.equal(madeContract.scheduleAmendedAt, null, "nothing has been amended yet");

  const inherited = await sql(
    `SELECT label, kind, percent, terms, "amountCents" FROM "ContractPayment"
      WHERE "contractId"=$1 ORDER BY position`,
    [madeContract.id],
  );
  assert.equal(inherited.rows.length, 2, "two rows carried over from the quote");
  assert.match(inherited.rows[0].label, /Deposit/);
  assert.equal(inherited.rows[0].terms, "Net 30", "the row's term came across too");
  assert.equal(inherited.rows[1].kind, "BALANCE");
  const contractTotal = (
    await sql(
      `SELECT COALESCE(SUM(ROUND(quantity * "unitPriceCents")),0)::int AS total
         FROM "ContractLineItem" WHERE "contractId"=$1`,
      [madeContract.id],
    )
  ).rows[0].total;
  assert.equal(
    inherited.rows[0].amountCents + inherited.rows[1].amountCents,
    contractTotal,
    "the percentages re-priced against the contract's own total",
  );
  await page.goto(`${BASE}/dashboard/contracts/${madeContract.id}`);
  await page.getByTestId("schedule-origin").waitFor();
  assert.match(
    await page.getByTestId("schedule-origin").innerText(),
    /Carried over from the quote/,
    "the contract should say where its schedule came from",
  );
  await shot(page, "08-contract-inherited-schedule");

  log('changing it stamps "Amended from original quote"');
  await page.getByTestId("payment-schedule").getByLabel("Payment label").first().fill("Deposit — revised");
  await page.getByTestId("save-schedule").click();
  await page.getByText("Payment schedule saved", { exact: true }).waitFor();
  const amended = (
    await sql(`SELECT "scheduleAmendedAt" FROM "Contract" WHERE id=$1`, [madeContract.id])
  ).rows[0];
  assert.ok(amended.scheduleAmendedAt, "editing an inherited schedule should stamp it as amended");
  await page.reload();
  assert.match(
    await page.getByTestId("schedule-origin").innerText(),
    /Amended from original quote/,
    "the amended note should show once it differs from the quote",
  );
  await shot(page, "09-contract-amended");

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
