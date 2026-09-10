/* Browser regression for the Deal Tracker, Settings sub-panes and uploads
 * (Sept 10, 2026).
 *
 * Covers: the six built-in templates a new workspace starts with; Settings
 * → My Account (title, mobile, in-app switch, avatar, change password) and
 * Company Information's five tiles (General with the shared logo, Branding
 * with a logo file upload, Company Users, Compliance and Marketing file
 * uploads with private downloads); company logo and contact photo uploads;
 * the Deal Tracker grid — prefilled Contract A, a typed-in new company and
 * contact for Contract B, one row on both contracts, payment presets, "Your
 * Company Signer" — creating the contracts; the contract page's line items,
 * payment schedule editor and signer; the printed document's Items and
 * Payment schedule tables; sending, reminders, signing; cancelling and
 * restoring a row; cancelling and reopening a contract; and a quote edit
 * keeping its rows linked.
 *
 * Runs against a built app (`npm run build:app && npx next start`) and a
 * local Postgres that has had `prisma migrate deploy` run against it. It
 * signs up its own workspace, activates it with SQL, and deletes it again
 * on the next run, so it never touches real data. Never point it at the
 * live database.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/scb_test \
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules \
 *   node scripts/browser-tests/deal-tracker.cjs
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
const OUT = process.env.SHOTS_DIR || path.join(os.tmpdir(), "scb-browser-shots-tracker");
fs.mkdirSync(OUT, { recursive: true });

const EMAIL = "test-tracker@example.com";
const PASSWORD = "password123";
const COMPANY = "Test Tracker Co";
const SLUG_LIKE = "test-tracker-co%";

// A 1×1 red PNG and a 1×1 blue PNG, so uploads can be told apart.
const PNG_RED = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  "base64",
);
const PNG_BLUE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPj/HwADBwIAMCbHYQAAAABJRU5ErkJggg==",
  "base64",
);
const png = (name, buffer) => ({ name, mimeType: "image/png", buffer });

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
async function login(page, password = PASSWORD) {
  await page.goto(`${BASE}/login`);
  await page.fill("#email", EMAIL);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/dashboard$/);
}
// Fetches a URL with no session at all.
async function anonymousStatus(browser, url) {
  const context = await browser.newContext();
  const response = await context.request.get(`${BASE}${url}`);
  const status = response.status();
  const type = response.headers()["content-type"];
  await context.close();
  return { status, type };
}

(async () => {
  await sql(`DELETE FROM "Organization" WHERE slug LIKE $1`, [SLUG_LIKE]);

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const page = await context.newPage();
  page.on("pageerror", (err) => console.error("PAGE ERROR:", err.message));
  // The reminder button falls back to window.prompt when the clipboard is
  // blocked (it is, in headless); accept it.
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
  await login(page);

  const org = (await sql(`SELECT id FROM "Organization" WHERE slug LIKE $1`, [SLUG_LIKE])).rows[0].id;

  log("a new workspace starts with seven types and six templates, the four new ones included");
  const types = await sql(`SELECT name FROM "ContractTypeOption" WHERE "organizationId"=$1 ORDER BY name`, [org]);
  assert.deepEqual(
    types.rows.map((r) => r.name),
    ["Change Order", "Compliance", "Custom", "Invoice", "Purchase Order", "Sales Order", "Service Agreement"],
  );
  const seeded = await sql(`SELECT name, type FROM "ContractTemplate" WHERE "organizationId"=$1 ORDER BY name`, [org]);
  assert.deepEqual(seeded.rows.map((r) => `${r.name} · ${r.type}`), [
    "Change Order · Change Order",
    "Compliance Agreement · Compliance",
    "Invoice · Invoice",
    "Purchase Order · Purchase Order",
    "Sales Order · Sales Order",
    "Service Agreement · Service Agreement",
  ]);

  /* ------------------------------ Settings ------------------------------ */

  log("Settings has My Account and Company Information under it; Branding is still the landing page with five tiles");
  await page.goto(`${BASE}/dashboard/settings`);
  await page.getByRole("heading", { name: "Branding" }).waitFor();
  const nav = page.locator("aside nav");
  assert.ok(await nav.getByRole("link", { name: "My Account" }).isVisible());
  assert.ok(await nav.getByRole("link", { name: "Company Information" }).isVisible());
  const tiles = await page.getByRole("tab").allTextContents();
  assert.deepEqual(
    tiles.map((t) => t.match(/^(General|Branding|Company Users|Compliance|Marketing)/)?.[1]),
    ["General", "Branding", "Company Users", "Compliance", "Marketing"],
  );
  await shot(page, "01-settings-branding");

  log("Branding: upload a logo file; it shows in the sidebar from /files/ and loads without a login");
  await page.setInputFiles("input[name=logoFile]", png("logo-red.png", PNG_RED));
  await page.locator("[data-testid=logo-preview]").waitFor();
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByText("Branding saved").waitFor();
  await page.reload();
  const sidebarLogo = await page.locator("aside img").first().getAttribute("src");
  assert.match(sidebarLogo, /^\/files\/[A-Za-z0-9_-]{20,}$/, `sidebar logo is an upload, got ${sidebarLogo}`);
  const logoFetch = await anonymousStatus(browser, sidebarLogo);
  assert.equal(logoFetch.status, 200);
  assert.equal(logoFetch.type, "image/png");
  assert.equal(await page.locator("input[name=logoUrl]").count(), 0, "the URL box hides once a file is uploaded");
  const logoRow = await sql(`SELECT "logoUrl" FROM "Organization" WHERE id=$1`, [org]);
  assert.equal(logoRow.rows[0].logoUrl, sidebarLogo);

  log("General: the same logo shows; fill in address, contact details, about us and history");
  await page.getByRole("tab", { name: /General/ }).click();
  await page.waitForURL(/\/dashboard\/settings\/general$/);
  assert.equal(await page.locator("[data-testid=logo-preview]").getAttribute("src"), sidebarLogo, "one logo, two places");
  await page.fill("[name=addressLine1]", "123 Main St");
  await page.fill("[name=addressLine2]", "Suite 4");
  await page.fill("[name=city]", "Austin");
  await page.fill("[name=state]", "TX");
  await page.fill("[name=postalCode]", "78701");
  await page.fill("[name=phone]", "555-0199");
  await page.fill("[name=email]", "office@tracker.test");
  await page.fill("[name=website]", "tracker.test");
  await page.fill("textarea[name=description]", "We install things.");
  await page.fill("textarea[name=history]", "Founded 2020.");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByText("Company information saved").waitFor();
  const info = await sql(`SELECT "addressLine1", city, website, description FROM "Organization" WHERE id=$1`, [org]);
  assert.deepEqual(info.rows[0], { addressLine1: "123 Main St", city: "Austin", website: "https://tracker.test", description: "We install things." });
  await shot(page, "02-settings-general");

  log("General: replacing the logo here replaces it on Branding too; the old file address is gone");
  // Reload so the previous save's message is gone before waiting for the next one.
  await page.reload();
  await page.setInputFiles("input[name=logoFile]", png("logo-blue.png", PNG_BLUE));
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByText("Company information saved").waitFor();
  await page.goto(`${BASE}/dashboard/settings`);
  const newLogo = await page.locator("[data-testid=logo-preview]").getAttribute("src");
  assert.notEqual(newLogo, sidebarLogo);
  assert.equal((await anonymousStatus(browser, sidebarLogo)).status, 404, "replaced logo is deleted");
  assert.equal((await sql(`SELECT count(*)::int AS n FROM "Upload" WHERE "organizationId"=$1 AND kind='ORG_LOGO'`, [org])).rows[0].n, 1);

  log("My Account: title, mobile, in-app switch off, avatar upload; the sidebar shows title and picture");
  await page.goto(`${BASE}/dashboard/settings/account`);
  await page.getByRole("heading", { name: "My Account" }).waitFor();
  await page.fill("[name=title]", "Founder");
  await page.fill("[name=phone]", "555-0111");
  const inApp = page.getByRole("switch", { name: "Receive in-app messages" });
  assert.equal(await inApp.getAttribute("aria-checked"), "true");
  await inApp.click();
  await page.setInputFiles("input[name=avatarFile]", png("me.png", PNG_RED));
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByText("Account saved").waitFor();
  const me = await sql(`SELECT title, phone, "receiveInAppMessages", "avatarUrl" FROM "User" WHERE email=$1`, [EMAIL]);
  assert.equal(me.rows[0].title, "Founder");
  assert.equal(me.rows[0].receiveInAppMessages, false);
  assert.match(me.rows[0].avatarUrl, /^\/files\//);
  await page.reload();
  assert.ok(await page.locator("aside").getByText("Founder").isVisible(), "title under the name in the sidebar");
  await shot(page, "03-my-account");

  log("My Account: wrong current password is refused; the right one changes it and logs in");
  await page.fill("[name=currentPassword]", "nope-nope");
  await page.fill("[name=newPassword]", "newpassword456");
  await page.fill("[name=confirmPassword]", "newpassword456");
  await page.getByRole("button", { name: "Change password" }).click();
  await page.getByText("That current password isn't right").waitFor();
  // The form resets after an action, so every box is filled again.
  await page.fill("[name=currentPassword]", PASSWORD);
  await page.fill("[name=newPassword]", "newpassword456");
  await page.fill("[name=confirmPassword]", "newpassword456");
  await page.getByRole("button", { name: "Change password" }).click();
  await page.getByText("Password changed").waitFor();
  await page.goto(`${BASE}/dashboard/settings/account`);
  await page.locator("form").filter({ hasText: "Log out" }).first().locator("button").click();
  await page.waitForURL(/\/login/);
  await login(page, "newpassword456");

  log("Company Users lists the one user with their title");
  await page.goto(`${BASE}/dashboard/settings/users`);
  await page.getByRole("heading", { name: "Company Users" }).waitFor();
  const userRow = page.locator("table tbody tr").first();
  assert.match(await userRow.textContent(), /Taylor Test.*Founder.*test-tracker@example\.com.*Owner/s);

  log("Compliance: upload a W-9 with an expiry; it downloads with a login and 404s without; delete it");
  await page.goto(`${BASE}/dashboard/settings/compliance`);
  await page.setInputFiles("input[name=file]", { name: "w9.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 test") });
  await page.fill("[name=name]", "2026 W-9");
  await page.selectOption("#category", "W-9");
  await page.fill("[name=expiresOn]", "2027-01-31");
  await page.getByRole("button", { name: "Upload" }).click();
  await page.getByText("2026 W-9 uploaded").waitFor();
  const w9 = (await sql(`SELECT "publicToken", category, "expiresOn" FROM "Upload" WHERE "organizationId"=$1 AND kind='COMPLIANCE'`, [org])).rows[0];
  assert.equal(w9.category, "W-9");
  assert.equal(new Date(w9.expiresOn).toISOString().slice(0, 10), "2027-01-31");
  const owned = await page.request.get(`${BASE}/files/${w9.publicToken}`);
  assert.equal(owned.status(), 200);
  assert.match(owned.headers()["content-disposition"], /attachment/);
  assert.equal((await anonymousStatus(browser, `/files/${w9.publicToken}`)).status, 404, "documents are private");
  await shot(page, "04-compliance");
  await page.getByRole("button", { name: "Delete 2026 W-9" }).click();
  await page.getByText("No compliance files yet").waitFor();

  log("Marketing: upload a brochure; it lists");
  await page.goto(`${BASE}/dashboard/settings/marketing`);
  await page.setInputFiles("input[name=file]", { name: "brochure.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 brochure") });
  await page.getByRole("button", { name: "Upload" }).click();
  await page.getByText("brochure uploaded").waitFor();
  assert.ok(await page.locator("table tbody tr").filter({ hasText: "brochure.pdf" }).isVisible());

  /* ------------------------- Customers and the deal ------------------------- */

  log("seed a customer company, two contacts, a deal and a quote with three lines");
  await sql(
    `INSERT INTO "Company" (id,"organizationId",name,phone,city,state,"updatedAt")
     VALUES ('cmp_tr','${org}','Palmetto Roofing','555-0100','Columbia','SC',now())`,
  );
  await sql(
    `INSERT INTO "Contact" (id,"organizationId","companyId",name,title,email,phone,"updatedAt")
     VALUES ('ctc_tr','${org}','cmp_tr','Danny Ortiz','Owner','danny@palmetto.com','555-0101',now()),
            ('ctc_tr2','${org}','cmp_tr','Maria Ortiz','Office Manager',NULL,NULL,now())`,
  );
  await sql(
    `INSERT INTO "Deal" (id,"organizationId","contactId",title,stage,"updatedAt")
     VALUES ('deal_tr','${org}','ctc_tr','Kitchen remodel','QUOTE_SENT',now())`,
  );
  await sql(
    `INSERT INTO "Quote" (id,"organizationId","contactId","dealId",number,title,status,"publicToken","updatedAt")
     VALUES ('quo_tr','${org}','ctc_tr','deal_tr',1000,'Kitchen quote','SENT','tok_quo_tr_0123456789',now())`,
  );
  await sql(
    `INSERT INTO "QuoteLineItem" (id,"quoteId",name,quantity,"unitPriceCents",tag,position)
     VALUES ('qli_tr1','quo_tr','Demo labor',2,10000,'LABOR',0),
            ('qli_tr2','quo_tr','Tile',1,5000,'MATERIALS',1),
            ('qli_tr3','quo_tr','Scheduling software',1,1200,'SOFTWARE',2)`,
  );

  log("company logo and contact photo upload from their edit forms and show on their pages");
  await page.goto(`${BASE}/dashboard/companies/cmp_tr/edit`);
  await page.setInputFiles("input[name=logoFile]", png("palmetto.png", PNG_BLUE));
  await page.getByRole("button", { name: /Save/ }).click();
  await page.getByText("Company saved").waitFor();
  const companyLogo = (await sql(`SELECT "logoUrl" FROM "Company" WHERE id='cmp_tr'`)).rows[0].logoUrl;
  assert.match(companyLogo, /^\/files\//);
  await page.goto(`${BASE}/dashboard/companies/cmp_tr`);
  assert.equal(await page.locator("main img").first().getAttribute("src"), companyLogo);
  await page.goto(`${BASE}/dashboard/contacts/ctc_tr/edit`);
  await page.setInputFiles("input[name=imageFile]", png("danny.png", PNG_RED));
  await page.getByRole("button", { name: /Save/ }).click();
  await page.getByText("Contact saved").waitFor();
  assert.match((await sql(`SELECT "imageUrl" FROM "Contact" WHERE id='ctc_tr'`)).rows[0].imageUrl, /^\/files\//);

  /* ------------------------------ Deal Tracker ------------------------------ */

  log("Deal Tracker under Pipeline is blank until a deal is picked");
  await page.goto(`${BASE}/dashboard/deals/tracker`);
  await page.getByRole("heading", { name: "Deal Tracker" }).waitFor();
  await page.getByText("Pick a deal to start").waitFor();
  assert.ok(await nav.getByRole("link", { name: "Deal Tracker" }).first().isVisible());

  log("the quote page's Split into contracts button lands on the tracker with the deal picked");
  await page.goto(`${BASE}/dashboard/quotes/quo_tr`);
  await page.locator("[data-testid=split-into-contracts]").click();
  await page.waitForURL(/\/dashboard\/contracts\/tracker\?dealId=deal_tr/);
  await page.locator("[data-testid=tracker-grid]").waitFor();
  assert.equal(await page.locator("[data-testid=tracker-row]").count(), 3);
  assert.equal(await page.locator("[data-testid=tracker-row]").filter({ hasText: "Open" }).count(), 3, "every row starts open");

  log("Contract A is prefilled with the deal's company, contact and a Sales Order; the signer is the owner");
  const colA = page.locator("[data-testid=column-header]").nth(0);
  assert.equal(await colA.locator("select").nth(0).evaluate((el) => el.selectedOptions[0].textContent), "Palmetto Roofing");
  assert.match(await colA.locator("select").nth(1).evaluate((el) => el.selectedOptions[0].textContent), /Danny Ortiz/);
  assert.match(await colA.locator("select").nth(2).evaluate((el) => el.selectedOptions[0].textContent), /Sales Order/);
  assert.equal(await page.locator("#signerName").inputValue(), "Taylor Test");
  assert.ok(await page.locator("[data-testid=create-contracts]").isDisabled(), "nothing ticked yet");

  log("tick labor and tile on A with a 50% deposit; add Contract B to a new supplier company and contact, Purchase Order, tile only");
  await page.getByRole("checkbox", { name: "Put Demo labor on Contract A" }).check();
  await page.getByRole("checkbox", { name: "Put Tile on Contract A" }).check();
  await colA.locator("select").nth(4).selectOption("DEPOSIT_BALANCE");
  await colA.locator("input[type=date]").fill("2026-10-01");
  assert.equal(await page.locator("[data-testid=column-total]").nth(0).textContent(), "$250.00");
  assert.match(await page.locator("[data-testid=schedule-preview]").nth(0).textContent(), /Deposit\$125\.002026-10-01Balance on completion\$125\.00/);
  await page.locator("[data-testid=add-column]").click();
  const colB = page.locator("[data-testid=column-header]").nth(1);
  await colB.locator("select").nth(0).selectOption("__new__");
  await page.getByLabel("New company for Contract B").fill("ACME Supply");
  await page.getByLabel("New contact for Contract B").fill("Sue Rep");
  assert.match(await colB.locator("select").nth(2).evaluate((el) => el.selectedOptions[0].textContent), /Purchase Order/, "second column defaults to a PO");
  await page.getByRole("checkbox", { name: "Put Tile on Contract B" }).check();
  assert.equal(await page.locator("[data-testid=column-total]").nth(1).textContent(), "$50.00");
  await shot(page, "05-tracker-grid");

  log("Create 2 contracts: both exist, the new company and contact were made, tile sits on both, software stays open");
  await page.locator("[data-testid=create-contracts]").click();
  await page.waitForURL(/created=2/);
  await page.getByText("2 contracts created").waitFor();
  const contracts = (await sql(
    `SELECT c.id, c.number, c.title, c.type, c.status, c."senderSignerName", c."paymentTerms", co.name AS company, ct.name AS contact,
            (SELECT count(*)::int FROM "ContractLineItem" l WHERE l."contractId"=c.id) AS lines,
            (SELECT count(*)::int FROM "ContractPayment" p WHERE p."contractId"=c.id) AS payments
     FROM "Contract" c LEFT JOIN "Company" co ON co.id=c."companyId" JOIN "Contact" ct ON ct.id=c."contactId"
     WHERE c."organizationId"=$1 ORDER BY c.number`,
    [org],
  )).rows;
  assert.equal(contracts.length, 2);
  const [a, b] = contracts;
  assert.deepEqual(
    { title: a.title, type: a.type, status: a.status, signer: a.senderSignerName, terms: a.paymentTerms, company: a.company, contact: a.contact, lines: a.lines, payments: a.payments },
    { title: "Sales Order", type: "Sales Order", status: "DRAFT", signer: "Taylor Test", terms: "Net 30", company: "Palmetto Roofing", contact: "Danny Ortiz", lines: 2, payments: 2 },
  );
  assert.deepEqual(
    { title: b.title, type: b.type, company: b.company, contact: b.contact, lines: b.lines, payments: b.payments },
    { title: "Purchase Order", type: "Purchase Order", company: "ACME Supply", contact: "Sue Rep", lines: 1, payments: 1 },
  );
  const sue = (await sql(`SELECT ct."companyId" FROM "Contact" ct WHERE ct.name='Sue Rep' AND ct."organizationId"=$1`, [org])).rows[0];
  assert.ok(sue.companyId, "Sue Rep was filed under ACME Supply");
  const tileRow = page.locator("[data-testid=tracker-row][data-line-id=qli_tr2]");
  assert.match(await tileRow.textContent(), new RegExp(`CON-${a.number} · Draft.*CON-${b.number} · Draft`, "s"));
  assert.match(await page.locator("[data-testid=tracker-row][data-line-id=qli_tr3]").textContent(), /Open/);
  assert.equal(await page.locator("[data-testid=tracker-contract]").count(), 2);
  await shot(page, "06-tracker-after-create");

  log("the payment rows were priced against each contract's own total");
  const payA = (await sql(`SELECT label, kind, "amountCents", "dueOn" FROM "ContractPayment" WHERE "contractId"=$1 ORDER BY position`, [a.id])).rows;
  assert.deepEqual(payA.map((p) => [p.label, p.kind, p.amountCents, p.dueOn ? new Date(p.dueOn).toISOString().slice(0, 10) : null]), [
    ["Deposit", "PERCENT", 12500, "2026-10-01"],
    ["Balance on completion", "BALANCE", 12500, null],
  ]);
  const payB = (await sql(`SELECT "amountCents" FROM "ContractPayment" WHERE "contractId"=$1`, [b.id])).rows;
  assert.equal(payB[0].amountCents, 5000);

  log("contract A's page: merged body has the total and terms, line items table, payment editor, signer");
  await page.goto(`${BASE}/dashboard/contracts/${a.id}`);
  await page.getByRole("heading", { name: "Sales Order" }).waitFor();
  const bodyText = await page.locator("#body").inputValue();
  assert.match(bodyText, /ORDER TOTAL: \$250\.00/);
  assert.match(bodyText, /PAYMENT TERMS: Net 30/);
  assert.match(bodyText, /123 Main St, Suite 4, Austin, TX 78701/, "your address merged from Company Information");
  assert.equal(await page.locator("[data-testid=contract-total]").textContent(), "$250.00");
  assert.equal(await page.locator("[data-testid=payment-row]").count(), 2);
  assert.equal(await page.locator("[data-testid=scheduled-total]").textContent(), "$250.00");
  assert.equal(await page.locator("[name=senderSignerName]").inputValue(), "Taylor Test");
  await shot(page, "07-contract-page");

  log("payment editor: apply three monthly installments, amounts recalc and the final date shows; save");
  await page.selectOption("[data-testid=payment-schedule] select >> nth=0", "INSTALLMENTS");
  await page.getByLabel("How many installments").fill("3");
  await page.getByLabel("First due date").fill("2026-10-15");
  await page.locator("[data-testid=apply-preset]").click();
  assert.equal(await page.locator("[data-testid=payment-row]").count(), 3);
  const amounts = await page.locator("[data-testid=payment-amount]").allTextContents();
  assert.deepEqual(amounts, ["$83.33", "$83.33", "$83.34"], "balance row takes the rounding cent");
  assert.match(await page.locator("[data-testid=payment-schedule] tfoot").textContent(), /final payment 2026-12-15/);
  assert.equal(await page.locator("[data-testid=schedule-difference]").count(), 0, "adds up exactly");
  await page.locator("[data-testid=save-schedule]").click();
  await page.getByText("Payment schedule saved").waitFor();
  assert.equal((await sql(`SELECT count(*)::int AS n FROM "ContractPayment" WHERE "contractId"=$1`, [a.id])).rows[0].n, 3);

  log("send A for signature; the tracker row reads Sent; a reminder copies and is logged");
  await page.getByRole("button", { name: "Send for signature" }).first().click();
  await page.getByText("Signature link").waitFor();
  await page.locator("[data-testid=reminder-button]").click();
  await page.getByText("Copied · logged").waitFor();
  const reminded = (await sql(`SELECT "reminderCount", "lastReminderAt" FROM "Contract" WHERE id=$1`, [a.id])).rows[0];
  assert.equal(reminded.reminderCount, 1);
  assert.ok(reminded.lastReminderAt);
  await page.goto(`${BASE}/dashboard/deals/tracker?dealId=deal_tr`);
  assert.match(await page.locator("[data-testid=tracker-row][data-line-id=qli_tr1]").textContent(), new RegExp(`CON-${a.number} · Sent`));
  assert.match(await page.locator("[data-testid=tracker-contract]").filter({ hasText: "Sales Order" }).textContent(), /1 sent/);
  assert.equal((await sql(`SELECT stage FROM "Deal" WHERE id='deal_tr'`)).rows[0].stage, "CONTRACT_SENT");

  log("the customer's copy prints the Items and Payment schedule tables with the signer; they sign");
  const tokenA = (await sql(`SELECT "publicToken" FROM "Contract" WHERE id=$1`, [a.id])).rows[0].publicToken;
  const customer = await browser.newContext();
  const cpage = await customer.newPage();
  await cpage.goto(`${BASE}/c/${tokenA}`);
  await cpage.locator("[data-testid=document-items]").waitFor();
  assert.equal(await cpage.locator("[data-testid=document-total]").textContent(), "$250.00");
  assert.equal(await cpage.locator("[data-testid=document-payments] tbody tr").count(), 3);
  assert.match(await cpage.locator("[data-testid=document-payments]").textContent(), /Final payment Dec 15, 2026/);
  assert.match(await cpage.textContent("body"), /Test Tracker Co · Taylor Test/, "signer under the provider line");
  assert.ok(await cpage.locator(`img[src="${companyLogo}"]`).count() >= 1, "customer's own logo on their copy");
  await cpage.screenshot({ path: path.join(OUT, "08-customer-document.png"), fullPage: true });
  await cpage.fill("[name=signerName]", "Danny Ortiz");
  await cpage.check("[name=agree]");
  await cpage.click("button[type=submit]");
  await cpage.getByText("Accepted electronically").waitFor();
  await customer.close();
  assert.equal((await sql(`SELECT status FROM "Contract" WHERE id=$1`, [a.id])).rows[0].status, "SIGNED");
  assert.equal((await sql(`SELECT stage FROM "Deal" WHERE id='deal_tr'`)).rows[0].stage, "WON");

  log("cancel the software row, then restore it");
  await page.goto(`${BASE}/dashboard/deals/tracker?dealId=deal_tr`);
  const softwareRow = page.locator("[data-testid=tracker-row][data-line-id=qli_tr3]");
  await softwareRow.locator("[data-testid=cancel-row]").click();
  await softwareRow.getByText("Cancelled").waitFor();
  assert.ok(await softwareRow.getByRole("checkbox").first().isDisabled(), "a cancelled row can't be ticked");
  assert.ok((await sql(`SELECT "cancelledAt" FROM "QuoteLineItem" WHERE id='qli_tr3'`)).rows[0].cancelledAt);
  await softwareRow.locator("[data-testid=restore-row]").click();
  await softwareRow.getByText("Open").waitFor();

  log("cancel contract B from the tracker: tile shows only A, B's link goes dark, reopen brings it back as a draft");
  await page.locator("[data-testid=tracker-contract]").filter({ hasText: "Purchase Order" }).locator("[data-testid=cancel-contract]").click();
  await page.locator("[data-testid=tracker-contract][data-status=CANCELLED]").waitFor();
  const tileText = await page.locator("[data-testid=tracker-row][data-line-id=qli_tr2]").textContent();
  assert.match(tileText, new RegExp(`CON-${a.number} · Signed`));
  assert.doesNotMatch(tileText, new RegExp(`CON-${b.number}`));
  const tokenB = (await sql(`SELECT "publicToken" FROM "Contract" WHERE id=$1`, [b.id])).rows[0].publicToken;
  assert.equal((await anonymousStatus(browser, `/c/${tokenB}`)).status, 404);
  await shot(page, "09-tracker-cancelled");
  await page.getByRole("button", { name: "Reopen" }).click();
  await page.locator("[data-testid=tracker-contract][data-status=DRAFT]").waitFor();
  assert.match(await page.locator("[data-testid=tracker-row][data-line-id=qli_tr2]").textContent(), new RegExp(`CON-${b.number} · Draft`));

  log("editing the quote's lines keeps the rows the contracts point at");
  await page.goto(`${BASE}/dashboard/quotes/quo_tr`);
  await page.getByLabel("Line 2 quantity").fill("2");
  await page.getByRole("button", { name: /Save line items/ }).click();
  await page.getByText("Line items saved").waitFor();
  const linked = (await sql(`SELECT count(*)::int AS n FROM "ContractLineItem" WHERE "quoteLineItemId" IS NOT NULL AND "contractId" IN ($1,$2)`, [a.id, b.id])).rows[0].n;
  assert.equal(linked, 3, "all three contract rows still point at their quote rows");

  log("Contracts list shows who each one went to and its total; the Deal Tracker under Contracts is the same page");
  await page.goto(`${BASE}/dashboard/contracts`);
  const listRows = await page.locator("table tbody tr").allTextContents();
  assert.ok(listRows.some((r) => /Purchase Order.*ACME Supply.*\$50\.00/s.test(r)), `PO row lists ACME Supply and $50.00: ${listRows}`);
  await page.getByRole("link", { name: "Deal Tracker" }).first().click();
  await page.waitForURL(/\/dashboard\/contracts\/tracker$/);
  await page.getByText("Pick a deal to start").waitFor();

  await browser.close();
  console.log(`\nALL ${step} STEPS PASSED · screenshots in ${OUT}`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
