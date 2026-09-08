/* Browser regression for Products v1 fields + Ratesheets MVP.
 *
 * Runs against a built app (`npm run build:app && npx next start`) and a
 * local Postgres that has had `prisma migrate deploy` run against it. It
 * signs up its own workspace, activates it with SQL, and deletes it again
 * on the next run, so it never touches real data. Never point it at the
 * live database.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/scb_test \
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules \
 *   node scripts/browser-tests/products-ratesheets.cjs
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

const EMAIL = "test-rs@example.com";
const PASSWORD = "password123";
const COMPANY = "Test Ratesheets Co";

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

(async () => {
  // Fresh tenant each run.
  await sql(`DELETE FROM "Organization" WHERE slug LIKE 'test-ratesheets-co%'`);

  const csvPath = path.join(OUT, "ferguson-2026.csv");
  fs.writeFileSync(csvPath, "name,sku,price\nCopper 3/4in,CU-34,4.25\nPVC 2in,PVC-2,1.10\n");
  const bigPath = path.join(OUT, "too-big.bin");
  fs.writeFileSync(bigPath, Buffer.alloc(5 * 1024 * 1024, 1));

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (err) => console.error("PAGE ERROR:", err.message));

  log("signup");
  await page.goto(`${BASE}/signup`);
  await page.fill("[name=companyName]", COMPANY);
  await page.fill("[name=name]", "Taylor Test");
  await page.fill("[name=email]", EMAIL);
  await page.fill("[name=phone]", "5550000000");
  await page.fill("[name=password]", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/signup\/submitted/);
  await sql(`UPDATE "Organization" SET status='ACTIVE', "reviewedAt"=now() WHERE slug LIKE 'test-ratesheets-co%'`);

  log("login");
  await login(page);

  log("products page header buttons + subnav");
  await page.goto(`${BASE}/dashboard/products`);
  await page.getByRole("button", { name: "Link Ratesheet" }).waitFor();
  await page.getByRole("link", { name: "Create Ratesheet" }).first().waitFor();
  await page.getByRole("link", { name: "Add product" }).first().waitFor();
  assert.ok(await page.getByRole("link", { name: "Ratesheets" }).first().isVisible());
  assert.equal(await page.getByText("Legacy widget").count(), 0, "must not see another tenant's product");

  log("create labor product with new manufacturer, distributor and contact");
  await page.goto(`${BASE}/dashboard/products/new`);
  await page.fill("#name", "Journeyman labor");
  await page.selectOption("#defaultTag", "LABOR");
  await page.selectOption("#manufacturerId", "__new__");
  await page.fill("[name=newManufacturerName]", "Acme Tools");
  await page.fill("#sku", "LAB-1");
  await page.fill("#description", "Licensed journeyman, business hours");
  await page.fill("#cost", "80.50");
  await page.fill("#unitPrice", "125");
  await page.selectOption("#unitOfMeasure", "PER_HOUR");
  assert.equal(await page.locator("#softwareRate").count(), 0, "software pop-out hidden for labor unit");
  await page.selectOption("#distributorId", "__new__");
  await page.fill("[name=newDistributorName]", "Ferguson");
  await page.getByRole("button", { name: "Add contact" }).click();
  await page.getByLabel("New contact 1 name").fill("Sam Rep");
  await page.getByLabel("New contact 1 email").fill("sam@ferguson.com");
  await page.getByLabel("New contact 1 phone").fill("555-0100");
  await shot(page, "01-product-form-new");
  await page.getByRole("button", { name: "Save product" }).click();
  await page.waitForURL(/\/dashboard\/products$/);
  const rowA = page.locator("tr", { hasText: "Journeyman labor" });
  await rowA.waitFor();
  assert.ok(await rowA.getByText("Acme Tools").isVisible());
  assert.ok(await rowA.getByText("$125.00").isVisible());
  assert.ok(await rowA.getByText("Per Hour").isVisible());
  await shot(page, "02-products-list");

  log("edit product: lookups persisted, contact ticked, fix contact phone");
  await rowA.getByRole("link", { name: "Edit" }).click();
  await page.waitForURL(/\/dashboard\/products\/[^/]+$/);
  const productAUrl = page.url();
  assert.equal(await page.locator("#manufacturerId option:checked").textContent(), "Acme Tools");
  assert.equal(await page.locator("#distributorId option:checked").textContent(), "Ferguson");
  assert.equal(await page.locator("#unitOfMeasure").inputValue(), "PER_HOUR");
  assert.equal(await page.locator("#cost").inputValue(), "80.50", "decimal COGS round-trips");
  const samBox = page.getByLabel("Select Sam Rep");
  assert.ok(await samBox.isChecked(), "new contact should be ticked for the product");
  assert.ok(await page.getByText("sam@ferguson.com").isVisible());
  assert.ok(await page.getByText("555-0100").isVisible());
  await page.getByLabel("Edit Sam Rep").click();
  await page.getByLabel("Contact phone").fill("555-0199");
  await shot(page, "03-product-form-edit-contact");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByText("Product saved").waitFor();
  await page.reload();
  assert.ok(await page.getByText("555-0199").isVisible(), "edited phone persisted");
  assert.ok(await page.getByLabel("Select Sam Rep").isChecked());

  log("second save without a reload keeps one contact and its link");
  await page.getByRole("button", { name: "Add contact" }).click();
  await page.getByLabel("New contact 1 name").fill("Pat Desk");
  await page.getByLabel("New contact 1 phone").fill("555-0200");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByText("Product saved").waitFor();
  await page.getByLabel("Select Pat Desk").waitFor();
  assert.ok(await page.getByLabel("Select Pat Desk").isChecked(), "new contact ticked after save");
  assert.equal(await page.getByLabel("New contact 1 name").count(), 0, "new-contact rows cleared after save");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByText("Product saved").waitFor();
  const contactCounts = await sql(`SELECT name, count(*)::int AS n FROM "DistributorContact" WHERE name IN ('Sam Rep','Pat Desk') GROUP BY name ORDER BY name`);
  assert.deepEqual(contactCounts.rows, [{ name: "Pat Desk", n: 1 }, { name: "Sam Rep", n: 1 }], "no duplicate contacts after saving twice");
  const linked = await sql(`SELECT count(*)::int AS n FROM "_DistributorContactToProduct"`);
  assert.equal(linked.rows[0].n, 2, "both contacts still linked to the product");
  await page.reload();
  assert.ok(await page.getByLabel("Select Sam Rep").isChecked());
  assert.ok(await page.getByLabel("Select Pat Desk").isChecked());

  log("create software product: pop-out and total");
  await page.goto(`${BASE}/dashboard/products/new`);
  await page.fill("#name", "Monitoring seat");
  await page.selectOption("#defaultTag", "SOFTWARE");
  await page.fill("#unitPrice", "10");
  await page.selectOption("#unitOfMeasure", "PER_DEVICE");
  await page.locator("#softwareRate").waitFor();
  await page.selectOption("#softwareRate", "PER_MONTH");
  await page.fill("#softwareTerm", "12");
  await page.getByText("$120.00").first().waitFor();
  assert.ok(await page.getByText("× 12 months = $120.00").isVisible());
  await shot(page, "04-product-form-software");
  await page.getByRole("button", { name: "Save product" }).click();
  await page.waitForURL(/\/dashboard\/products$/);
  const rowB = page.locator("tr", { hasText: "Monitoring seat" });
  assert.ok(await rowB.getByText("Per Device · Per Month").isVisible());
  const softwareRow = await sql(`SELECT "softwareRate","softwareTerm","unitOfMeasure" FROM "Product" WHERE name='Monitoring seat'`);
  assert.deepEqual(softwareRow.rows[0], { softwareRate: "PER_MONTH", softwareTerm: 12, unitOfMeasure: "PER_DEVICE" });

  log("clone product");
  await rowA.getByRole("button", { name: "Clone" }).click();
  await page.waitForURL(/\/dashboard\/products\/[^/]+$/);
  assert.notEqual(page.url(), productAUrl, "clone lands on the new product");
  assert.equal(await page.locator("#name").inputValue(), "Journeyman labor (copy)");
  assert.equal(await page.locator("#sku").inputValue(), "", "clone blanks the SKU");
  assert.equal(await page.locator("#manufacturerId option:checked").textContent(), "Acme Tools");
  assert.ok(await page.getByLabel("Select Sam Rep").isChecked(), "clone keeps distributor contacts");

  log("toggle inactive / active on the clone");
  await page.goto(`${BASE}/dashboard/products`);
  const rowCopy = page.locator("tr", { hasText: "Journeyman labor (copy)" });
  assert.ok(await rowCopy.getByText("Active", { exact: true }).first().isVisible());
  await rowCopy.getByRole("button", { name: "Inactive", exact: true }).click();
  await rowCopy.getByRole("button", { name: "Active", exact: true }).waitFor();
  assert.ok(await rowCopy.locator(".badge", { hasText: "Inactive" }).isVisible());
  await rowCopy.getByRole("button", { name: "Active", exact: true }).click();
  await rowCopy.getByRole("button", { name: "Inactive", exact: true }).waitFor();

  log("delete the clone with inline confirm");
  await rowCopy.getByRole("button", { name: "Delete Journeyman labor (copy)" }).click();
  await page.getByText("Delete Journeyman labor (copy)?").waitFor();
  await shot(page, "05-delete-confirm");
  await page.getByRole("button", { name: "Cancel" }).click();
  assert.equal(await page.getByText("Delete Journeyman labor (copy)?").count(), 0);
  await rowCopy.getByRole("button", { name: "Delete Journeyman labor (copy)" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.waitForFunction(() => !document.body.innerText.includes("Journeyman labor (copy)"));

  log("link ratesheet modal: coming soon + oversized file refused");
  await page.getByRole("button", { name: "Link Ratesheet" }).click();
  await page.getByRole("dialog").waitFor();
  await page.getByRole("button", { name: "Link Distributor / Partner" }).click();
  await page.getByText("Coming Soon…").waitFor();
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: "Upload File" }).click();
  await page.setInputFiles("#ratesheet-file", bigPath);
  await page.getByText("over 4 MB").waitFor();
  assert.ok(await page.getByRole("button", { name: "Upload" }).isDisabled());

  log("upload a CSV");
  await page.setInputFiles("#ratesheet-file", csvPath);
  assert.equal(await page.getByText("over 4 MB").count(), 0);
  await page.fill("#ratesheet-name", "Ferguson 2026");
  await shot(page, "06-upload-modal");
  await page.getByRole("button", { name: "Upload" }).click();
  await page.waitForURL(/\/dashboard\/products\/ratesheets\?uploaded=/);
  await page.getByText("Ferguson 2026").waitFor();
  assert.ok(await page.getByText("Saved").isVisible());
  const downloadHref = await page.getByRole("link", { name: "Download" }).getAttribute("href");
  const download = await page.request.get(`${BASE}${downloadHref}`);
  assert.equal(download.status(), 200);
  assert.match(download.headers()["content-disposition"], /attachment; filename="ferguson-2026.csv"/);
  assert.equal(await download.text(), fs.readFileSync(csvPath, "utf8"));

  log("upload again from the Ratesheets page: dialog closes on its own");
  await page.getByRole("button", { name: "Link Ratesheet" }).click();
  await page.getByRole("button", { name: "Upload File" }).click();
  await page.setInputFiles("#ratesheet-file", csvPath);
  await page.fill("#ratesheet-name", "Ferguson 2026 again");
  await page.getByRole("button", { name: "Upload" }).click();
  await page.getByText("Ferguson 2026 again").waitFor();
  await page.waitForFunction(() => !document.querySelector("[role=dialog]"));
  assert.equal(await page.getByRole("dialog").count(), 0, "upload dialog closed after redirect to the same page");
  await page.getByRole("button", { name: "Delete Ferguson 2026 again" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.waitForFunction(() => !document.body.innerText.includes("Ferguson 2026 again"));

  log("create ratesheet (partner specific)");
  await page.goto(`${BASE}/dashboard/products/ratesheets/new`);
  assert.equal(await page.getByRole("button", { name: /Partner Specific/ }).getAttribute("aria-pressed"), "true");
  await page.fill("#name", "Contractor pricing 2026");
  await page.fill("#expiresOn", "2027-12-31");
  await page.fill("#respondWithinDays", "14");
  await page.fill("#partnerEmail", "partner@example.com");
  await page.fill("#partnerName", "Acme Supply");
  await page.getByRole("button", { name: "Select all" }).click();
  await page.getByText("2 of 2 selected").waitFor();
  await shot(page, "07-ratesheet-new");
  await page.getByRole("button", { name: "Create ratesheet" }).click();
  await page.waitForURL(/\/dashboard\/products\/ratesheets\/[^/?]+\?created=1/);
  const sheetUrl = page.url().split("?")[0];
  await page.getByText("Ratesheet created.").waitFor();
  const partnerRow = page.locator("li", { hasText: "Acme Supply" });
  await partnerRow.getByText("Pending").waitFor();
  const inviteLink = await partnerRow.getByLabel("Public document link").inputValue();
  assert.match(inviteLink, /\/r\//);
  await shot(page, "08-ratesheet-detail");

  log("partner opens link (no login), sees prices, no internals, approves");
  const partnerCtx = await browser.newContext({ viewport: { width: 420, height: 860 } });
  const partner = await partnerCtx.newPage();
  await partner.goto(inviteLink);
  await partner.getByText("Contractor pricing 2026").waitFor();
  const body = await partner.locator("body").innerText();
  assert.ok(body.toLowerCase().includes(`ratesheet from ${COMPANY}`.toLowerCase()));
  assert.ok(body.includes("Journeyman labor") && body.includes("$125.00") && body.includes("Per Hour"));
  assert.ok(body.includes("Monitoring seat") && body.includes("12 months"));
  for (const forbidden of ["COGS", "80.50", "LAB-1", "Acme Tools", "Ferguson", "Sam Rep", "Pat Desk", "555-0199", "555-0200"]) {
    assert.ok(!body.includes(forbidden), `partner page leaked ${forbidden}`);
  }
  const html = await partner.content();
  assert.ok(!html.includes("costCents") && !html.includes("8000"), "COGS must not be in the payload");
  await shot(partner, "09-partner-page-mobile");
  await partner.getByRole("button", { name: "Approve" }).click();
  await partner.getByText("Approved.").waitFor();
  assert.equal(await partner.getByRole("button", { name: "Approve" }).count(), 0);
  await shot(partner, "10-partner-approved");

  log("ratesheets board: counts, tile filter chip");
  await page.goto(`${BASE}/dashboard/products/ratesheets`);
  const tile = page.locator("[role=button]", { hasText: "Contractor pricing 2026" });
  await tile.waitFor();
  assert.ok(await tile.getByText("1/1").isVisible());
  assert.ok(await tile.getByText("Expires on Dec 31, 2027").isVisible());
  const summary = page.locator("#summary");
  assert.equal((await summary.locator("li", { hasText: "Acme Supply" }).count()), 1);
  assert.ok(await summary.locator("li", { hasText: "Acme Supply" }).getByText("Approved").isVisible());
  await tile.click();
  await tile.getByText("Filter Applied").waitFor();
  assert.equal(await tile.getAttribute("aria-pressed"), "true");
  await summary.getByText("Showing sends for").waitFor();
  await shot(page, "11-board-filter-applied");
  await tile.click();
  assert.equal(await tile.getByText("Filter Applied").count(), 0);

  log("send to a second partner from the detail page");
  await page.goto(sheetUrl);
  await page.fill("#partnerEmail", "second@example.com");
  await page.getByRole("button", { name: "Send to partner" }).click();
  await page.getByText("Link created").waitFor();
  const secondRow = page.locator("li", { hasText: "second@example.com" });
  await secondRow.getByText("Pending").waitFor();
  const secondLink = await secondRow.getByLabel("Public document link").inputValue();
  await page.goto(`${BASE}/dashboard/products/ratesheets`);
  await page.locator("[role=button]", { hasText: "Contractor pricing 2026" }).getByText("1/2").waitFor();
  assert.equal(await page.locator("#summary li").count(), 2);

  log("partner-specific sheet has no share link for strangers; public sheet does, read-only, without inactive products");
  await page.goto(sheetUrl);
  assert.equal(await page.getByText("Share link").count(), 0, "partner specific sheets don't offer a share link");
  const previewHref = await page.getByRole("link", { name: "Preview" }).getAttribute("href");
  const shareLink = `${BASE}${previewHref}`;
  const reader = await partnerCtx.newPage();
  const strangerResponse = await reader.goto(shareLink);
  assert.equal(strangerResponse.status(), 404, "a stranger can't open a partner-specific sheet's preview token");
  await page.goto(shareLink);
  await page.getByText("Owner preview.").waitFor();
  // A Public sheet: one link anyone can open, read-only.
  await page.goto(`${BASE}/dashboard/products/ratesheets/new`);
  await page.fill("#name", "Public list");
  await page.getByRole("button", { name: /^Public/ }).click();
  assert.equal(await page.locator("#respondWithinDays").count(), 0, "no respond window on a public sheet");
  await page.getByRole("button", { name: "Select all" }).click();
  await page.getByRole("button", { name: "Create ratesheet" }).click();
  await page.waitForURL(/\/dashboard\/products\/ratesheets\/[^/?]+\?created=1/);
  const publicShare = await page.locator("div").filter({ hasText: "Share link" }).getByLabel("Public document link").last().inputValue();
  await sql(`UPDATE "Product" SET active=false WHERE name='Monitoring seat'`);
  await reader.goto(publicShare);
  await reader.getByText("has published this price list").waitFor();
  assert.equal(await reader.getByRole("button", { name: "Approve" }).count(), 0);
  assert.ok(await reader.getByText("Journeyman labor").isVisible());
  assert.equal(await reader.getByText("Monitoring seat").count(), 0, "inactive product hidden from partners");
  await sql(`UPDATE "Product" SET active=true WHERE name='Monitoring seat'`);

  log("inactive sheet hides from partners, owner still previews");
  await page.goto(`${BASE}/dashboard/products/ratesheets`);
  await page.locator("[role=button]", { hasText: "Contractor pricing 2026" }).getByRole("button", { name: "Inactive", exact: true }).click();
  await page.locator("[role=button]", { hasText: "Contractor pricing 2026" }).getByRole("button", { name: "Active", exact: true }).waitFor();
  const pendingPartner = await partnerCtx.newPage();
  await pendingPartner.goto(secondLink);
  await pendingPartner.getByText("no longer available").waitFor();
  assert.equal(await pendingPartner.getByRole("button", { name: "Approve" }).count(), 0);
  await page.goto(shareLink);
  await page.getByText("Owner preview.").waitFor();
  await page.goto(`${BASE}/dashboard/products/ratesheets`);
  await page.locator("[role=button]", { hasText: "Contractor pricing 2026" }).getByRole("button", { name: "Active", exact: true }).click();
  await page.locator("[role=button]", { hasText: "Contractor pricing 2026" }).getByRole("button", { name: "Inactive", exact: true }).waitFor();

  log("edit ratesheet: rename, past expiry -> Expired");
  await page.goto(sheetUrl);
  await page.fill("#name", "Contractor pricing 2026 v2");
  await page.fill("#expiresOn", "2020-01-01");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByText("Ratesheet saved").waitFor();
  await page.goto(`${BASE}/dashboard/products/ratesheets`);
  const tile2 = page.locator("[role=button]", { hasText: "Contractor pricing 2026 v2" });
  await tile2.getByText("Expired").waitFor();
  await pendingPartner.goto(secondLink);
  await pendingPartner.getByText("no longer available").waitFor();
  const respond = await sql(`SELECT status FROM "RatesheetInvite" WHERE "partnerEmail"='second@example.com'`);
  assert.equal(respond.rows[0].status, "PENDING");

  log("mobile layout screenshots");
  const mobile = await context.newPage();
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.goto(productAUrl);
  await shot(mobile, "12-product-form-mobile");
  await mobile.goto(`${BASE}/dashboard/products/ratesheets`);
  await shot(mobile, "13-board-mobile");
  await mobile.goto(`${BASE}/dashboard/products`);
  await shot(mobile, "14-products-mobile");
  await mobile.close();

  log("delete ratesheet and linked file from the board");
  await page.goto(`${BASE}/dashboard/products/ratesheets`);
  await tile2.getByRole("button", { name: "Delete Contractor pricing 2026 v2" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.waitForFunction(() => !document.body.innerText.includes("Contractor pricing 2026 v2"));
  await page.getByRole("button", { name: "Delete Ferguson 2026" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.waitForFunction(() => !document.body.innerText.includes("Ferguson 2026"));
  await pendingPartner.goto(secondLink);
  assert.ok((await pendingPartner.locator("body").innerText()).match(/404|not be found/i), "deleted sheet's link should 404");

  log("quote builder still pulls products from the catalog");
  await page.goto(`${BASE}/dashboard/contacts/new`);
  await page.fill("#name", "Quote Customer");
  await page.getByRole("button", { name: "Save contact" }).click();
  await page.waitForURL(/\/dashboard\/contacts\/(?!new)[^/]+$/);
  await page.getByRole("link", { name: "New quote" }).click();
  await page.waitForURL(/\/dashboard\/quotes\/new/);
  await page.fill("#title", "Regression quote");
  await page.getByRole("button", { name: "Create quote" }).click();
  await page.waitForURL(/\/dashboard\/quotes\/(?!new)[^/]+$/);
  const catalog = page.getByLabel("Add product from catalog");
  const options = await catalog.locator("option").allTextContents();
  assert.ok(options.some((o) => o.startsWith("Journeyman labor")), "product should be in the catalog picker");
  await catalog.selectOption({ label: options.find((o) => o.startsWith("Journeyman labor")) });
  await page.getByLabel("Line 1 product", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Line 1 unit value").inputValue(), "125.00");
  assert.equal(await page.getByLabel("Line 1 tag").inputValue(), "LABOR");
  await page.getByRole("button", { name: "Save line items" }).click();
  await page.getByText("Line items saved").waitFor();

  log("cross-tenant product id 404s");
  const foreign = await page.goto(`${BASE}/dashboard/products/prod_legacy`);
  assert.equal(foreign.status(), 404);

  await browser.close();
  console.log("\nALL PASSED");
})().catch(async (err) => {
  console.error("\nFAILED at step", step, "\n", err);
  process.exit(1);
});
