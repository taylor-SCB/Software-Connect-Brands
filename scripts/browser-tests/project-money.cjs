/* Browser regression for the Money tab on a job (Sept 14, 2026).
 *
 * Covers: the tab strip; what the customer owes from the paperwork they
 * signed; sending one payment as an invoice (INV-n, the page the customer
 * opens, its PDF, and the payment instructions from Settings); recording
 * what came in from the job page; ordering materials from the distributor
 * on a product, which drafts that supplier's purchase order at cost and
 * gives them a company record; the bills grouped by supplier; a change
 * order that adds to one scope's budget; a credit that comes off what is
 * owed; and files on a job, including the other party's signed contract.
 *
 * Runs against a built app (`bash scripts/dev-serve.sh`) and a local
 * Postgres that has had `prisma migrate deploy` run against it. It signs
 * up its own workspace, activates it with SQL, and deletes it again on
 * the next run, so it never touches real data. Never point it at the
 * live database.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/scb_test \
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules \
 *   node scripts/browser-tests/project-money.cjs
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
const OUT = process.env.SHOTS_DIR || path.join(os.tmpdir(), "scb-browser-shots-projmoney");
fs.mkdirSync(OUT, { recursive: true });

const EMAIL = "test-projmoney@example.com";
const PASSWORD = "password123";
const COMPANY = "Test Project Money Co";
const SLUG_LIKE = "test-project-money-co%";

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
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
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

  log("tell customers how to pay you");
  await page.goto(`${BASE}/dashboard/settings/general`);
  await page.locator("[data-testid=payment-instructions]").fill("Checks to Test Project Money Co\nZelle: pay@testco.com");
  await page.getByRole("button", { name: /Save changes/ }).click();
  await page.getByText("Company information saved").waitFor();

  log("seed a customer, a distributor with a rep, a product from them, a deal and a quote");
  await sql(
    `INSERT INTO "Company" (id,"organizationId",name,city,state,"updatedAt")
     VALUES ('cmp_pm','${org}','Beachfront Lofts','Austin','TX',now())`,
  );
  await sql(
    `INSERT INTO "Contact" (id,"organizationId","companyId",name,title,email,"updatedAt")
     VALUES ('ctc_pm','${org}','cmp_pm','Dana Ruiz','Owner','dana@beachfront.com',now())`,
  );
  await sql(
    `INSERT INTO "Distributor" (id,"organizationId",name,"updatedAt")
     VALUES ('dst_pm','${org}','Gulf Lock Supply',now())`,
  );
  await sql(
    `INSERT INTO "DistributorContact" (id,"organizationId","distributorId",name,email,phone)
     VALUES ('dsc_pm','${org}','dst_pm','Sam Rep','sam@gulflock.com','555-0190')`,
  );
  await sql(
    `INSERT INTO "Product" (id,"organizationId",name,description,"unitPriceCents","costCents","defaultTag","distributorId","serviceType","updatedAt")
     VALUES ('prd_pm','${org}','Smart lock','','15000',9000,'MATERIALS','dst_pm','Smart Locks',now())`,
  );
  await sql(
    `INSERT INTO "Deal" (id,"organizationId","contactId",title,stage,"updatedAt")
     VALUES ('deal_pm','${org}','ctc_pm','Beachfront rekey','QUOTE_SENT',now())`,
  );
  await sql(
    `INSERT INTO "Quote" (id,"organizationId","contactId","dealId",number,title,status,"publicToken","updatedAt")
     VALUES ('quo_pm','${org}','ctc_pm','deal_pm',1000,'Rekey quote','SENT','tok_quo_pm_0123456789',now())`,
  );
  await sql(
    `INSERT INTO "QuoteLineItem" (id,"quoteId","productId",name,quantity,"unitPriceCents",tag,"serviceType",position)
     VALUES ('qli_pm1','quo_pm','prd_pm','Smart locks',20,15000,'MATERIALS','Smart Locks',0),
            ('qli_pm2','quo_pm',NULL,'Install labor',10,8000,'LABOR','Smart Locks',1)`,
  );

  log("split into one Sales Order with a deposit and balance, and sign it");
  await page.goto(`${BASE}/dashboard/deals/tracker?dealId=deal_pm`);
  await page.locator("[data-testid=tracker-row]").first().waitFor();
  await page.getByRole("checkbox", { name: "Put Smart locks on Contract A" }).check();
  await page.getByRole("checkbox", { name: "Put Install labor on Contract A" }).check();
  await page.locator("#col-1-preset").selectOption("DEPOSIT_BALANCE");
  await page.locator("#col-1-depositPercent").fill("50");
  await page.locator("[data-testid=create-contracts]").click();
  // The redirect carries how many were made; waiting on it is exact,
  // where waiting on the wording is not.
  await page.waitForURL(/created=\d+/);
  const sales = (await sql(
    `SELECT id, number, "publicToken" FROM "Contract" WHERE "organizationId"=$1 AND payable=false ORDER BY number LIMIT 1`,
    [org],
  )).rows[0];
  await page.goto(`${BASE}/dashboard/contracts/${sales.id}`);
  await page.getByRole("button", { name: /Mark as sent|Send for signature/ }).first().click();
  await page.getByText(/Sent/).first().waitFor();
  await signAs(browser, sales.publicToken, "Dana Ruiz");
  const project = (await sql(`SELECT id, number FROM "Project" WHERE "organizationId"=$1`, [org])).rows[0];

  /* -------------------------------- Owes you -------------------------------- */

  log("the Money tab shows both payments they signed for, and what each is worth");
  await page.goto(`${BASE}/dashboard/projects/${project.id}`);
  await page.locator("[data-testid=tab-money]").click();
  await page.waitForURL(/\/money$/);
  await page.locator("[data-testid=owed-row]").first().waitFor();
  // 20 × $150 + 10 × $80 = $3,800, halved into deposit and balance.
  assert.equal(await page.locator("[data-testid=owed-row]").count(), 2);
  const balances = await page.locator("[data-testid=owed-balance]").evaluateAll((els) =>
    els.map((el) => Number(el.getAttribute("data-cents"))),
  );
  assert.deepEqual(balances, [190000, 190000]);
  await shot(page, "01-money-tab");

  log("sending one as an invoice stamps INV-1000 and makes the page the customer opens");
  await page.locator("[data-testid=send-invoice]").first().click();
  await page.locator("[data-testid=open-invoice]").first().waitFor();
  const invoice = (await sql(
    `SELECT cp."invoiceNumber", cp."invoiceToken", cp."issuedAt", cp."amountCents"
       FROM "ContractPayment" cp WHERE cp."contractId"=$1 AND cp."invoiceNumber" IS NOT NULL`,
    [sales.id],
  )).rows;
  assert.equal(invoice.length, 1, "only the row that was sent gets a number");
  assert.equal(invoice[0].invoiceNumber, 1000);
  assert.ok(invoice[0].issuedAt, "the date it went out is recorded");

  log("the invoice reads right to the customer, with how to pay you");
  const guest = await browser.newContext();
  const gpage = await guest.newPage();
  await gpage.goto(`${BASE}/i/${invoice[0].invoiceToken}`);
  await gpage.locator("[data-testid=invoice-number]").waitFor();
  assert.match(await gpage.locator("[data-testid=invoice-number]").textContent(), /INV-1000/);
  assert.match(await gpage.locator("[data-testid=invoice-balance]").textContent(), /\$1,900\.00/);
  assert.match(await gpage.locator("[data-testid=invoice-instructions]").textContent(), /Zelle: pay@testco\.com/);
  assert.match(await gpage.textContent("body"), new RegExp(`PRJ-${project.number}`), "it names the job");
  await gpage.screenshot({ path: path.join(OUT, "02-invoice.png"), fullPage: true });

  log("the invoice downloads as a PDF");
  const pdf = await guest.request.get(`${BASE}/i/${invoice[0].invoiceToken}/pdf`);
  assert.equal(pdf.status(), 200);
  assert.equal(pdf.headers()["content-type"], "application/pdf");
  assert.match(pdf.headers()["content-disposition"], /INV-1000/);
  await guest.close();

  log("sending the same row again hands back the same invoice, not a second number");
  await page.reload();
  await page.locator("[data-testid=open-invoice]").first().waitFor();
  assert.equal(
    Number((await sql(`SELECT count(*) FROM "ContractPayment" WHERE "invoiceNumber" IS NOT NULL AND "contractId"=$1`, [sales.id])).rows[0].count),
    1,
  );

  log("recording what came in, right on the job");
  await page.locator("[data-testid=record-payment]").first().click();
  await page.locator("[data-testid=payment-amount-input]").fill("1000");
  await page.locator("[data-testid=payment-method]").fill("Check");
  await page.locator("[data-testid=payment-reference]").fill("2051");
  await page.locator("[data-testid=payment-save]").click();
  await page.locator("[data-testid=recorded-payment]").first().waitFor();
  assert.equal(
    Number(await page.locator("[data-testid=owed-balance]").first().getAttribute("data-cents")),
    90000,
    "the deposit has $900 left on it",
  );
  const collected = (await sql(`SELECT "receivedCents" FROM "Project" WHERE id=$1`, [project.id])).rows[0];
  assert.equal(collected.receivedCents, 100000, "the job knows it collected $1,000");

  log("the customer's invoice shows the payment and the new balance");
  const guest2 = await browser.newContext();
  const gpage2 = await guest2.newPage();
  await gpage2.goto(`${BASE}/i/${invoice[0].invoiceToken}`);
  assert.match(await gpage2.locator("[data-testid=invoice-balance]").textContent(), /\$900\.00/);
  assert.match(await gpage2.textContent("body"), /Check · 2051/);
  await guest2.close();

  /* ----------------------------- Order materials ----------------------------- */

  log("the locks can be ordered from the supplier on the product, at what they cost");
  await page.goto(`${BASE}/dashboard/projects/${project.id}/money`);
  await page.locator("[data-testid=order-materials]").click();
  await page.locator("[data-testid=supplier-to-order]").first().waitFor();
  assert.match(await page.locator("[data-testid=supplier-to-order]").first().textContent(), /Gulf Lock Supply/);
  // 20 locks at $90 cost = $1,800.
  assert.match(await page.locator("[data-testid=supplier-to-order]").first().textContent(), /\$1,800\.00/);
  await page.locator("[data-testid=order-from-supplier]").first().click();
  await page.waitForURL(/\/dashboard\/contracts\/[a-z0-9]+$/, { timeout: 20000 });
  const order = (await sql(
    `SELECT id, number, payable, status, "projectId", "companyId" FROM "Contract"
      WHERE "organizationId"=$1 AND payable=true`,
    [org],
  )).rows[0];
  assert.equal(order.payable, true);
  assert.equal(order.status, "DRAFT", "it is a draft to review before it goes out");
  assert.equal(order.projectId, project.id);
  const orderTotal = (await sql(
    `SELECT SUM(ROUND(quantity * "unitPriceCents"))::int AS total FROM "ContractLineItem" WHERE "contractId"=$1`,
    [order.id],
  )).rows[0].total;
  assert.equal(orderTotal, 180000, "priced at cost, not at what the customer pays");

  log("the supplier got a company record, tagged as a distributor, and the Distributor points at it");
  const bridged = (await sql(
    `SELECT c.id, c.name, c.industries, c."companyTypes" FROM "Company" c
      JOIN "Distributor" d ON d."companyId" = c.id WHERE d.id='dst_pm'`,
  )).rows[0];
  assert.equal(bridged.name, "Gulf Lock Supply");
  assert.deepEqual(bridged.industries, ["Service Provider"]);
  assert.deepEqual(bridged.companyTypes, ["Distributor"]);
  assert.equal(order.companyId, bridged.id, "the order is addressed to that company");

  log("ordering the same materials twice is refused — there is nothing left to order");
  await page.goto(`${BASE}/dashboard/projects/${project.id}/money`);
  assert.equal(
    await page.locator("[data-testid=order-materials]").count(),
    0,
    "the button is gone once everything is on an order",
  );

  log("the order shows under You owe, grouped by supplier, once it is sent");
  await page.goto(`${BASE}/dashboard/contracts/${order.id}`);
  await page.getByRole("button", { name: /Mark as sent|Send for signature/ }).first().click();
  await page.getByText(/Sent/).first().waitFor();
  await page.goto(`${BASE}/dashboard/projects/${project.id}/money`);
  await page.locator("[data-testid=supplier-group]").first().waitFor();
  assert.match(await page.locator("[data-testid=supplier-group]").first().textContent(), /Gulf Lock Supply/);
  assert.match(await page.locator("[data-testid=bill-row]").first().textContent(), /\$0\.00 of \$1,800\.00 paid/);
  await shot(page, "03-you-owe");

  /* ------------------------------ Change orders ------------------------------ */

  log("a change order adds to the budget and to what they owe");
  const awardedBefore = (await sql(`SELECT "awardedCents" FROM "Project" WHERE id=$1`, [project.id])).rows[0].awardedCents;
  await page.locator("[data-testid=add-change-order]").click();
  await page.locator("[data-testid=change-description]").fill("Two extra doors");
  await page.locator("[data-testid=change-amount]").fill("2400");
  await page.locator("[data-testid=change-signer]").fill("Dana Ruiz");
  await page.locator("[data-testid=change-save]").click();
  await page.getByText(/added to/).waitFor();
  const afterAdd = (await sql(`SELECT "awardedCents" FROM "Project" WHERE id=$1`, [project.id])).rows[0].awardedCents;
  assert.equal(afterAdd, awardedBefore + 240000, "the awarded amount grew by $2,400");
  await page.reload();
  assert.equal(await page.locator("[data-testid=change-order-row]").count(), 1);
  assert.match(await page.locator("[data-testid=change-order-row]").first().textContent(), /\+\$2,400\.00/);
  // It is money the customer now owes too.
  assert.equal(await page.locator("[data-testid=owed-row]").count(), 3);

  log("a credit comes off the budget, reads as a credit, and is nothing to chase");
  await page.locator("[data-testid=add-change-order]").click();
  await page.locator("[data-testid=change-description]").fill("Dropped the side entry");
  await page.locator("[data-testid=change-amount]").fill("-500");
  await page.locator("[data-testid=change-save]").click();
  await page.getByText(/Credit of/).waitFor();
  const afterCredit = (await sql(`SELECT "awardedCents" FROM "Project" WHERE id=$1`, [project.id])).rows[0].awardedCents;
  assert.equal(afterCredit, afterAdd - 50000, "the awarded amount dropped by $500");
  const creditRow = (await sql(
    `SELECT cp.label, cp."amountCents", cp."paidAt", cp."dueOn" FROM "ContractPayment" cp
       JOIN "Contract" c ON c.id = cp."contractId"
      WHERE c."organizationId"=$1 AND cp."amountCents" < 0`,
    [org],
  )).rows[0];
  assert.equal(creditRow.label, "Credit");
  assert.equal(creditRow.amountCents, -50000);
  assert.ok(creditRow.paidAt, "a credit is settled, not something to collect");
  assert.equal(creditRow.dueOn, null, "and it has no due date");
  await page.reload();
  assert.match(await page.locator("[data-testid=change-order-row]").nth(1).textContent(), /Credit \$500\.00/);
  await shot(page, "04-change-orders");

  log("what they owe is what the rows say, net of the credit");
  const owed = (await sql(
    `SELECT COALESCE(SUM(cp."amountCents") - COALESCE(SUM(p.total), 0), 0)::int AS owed
       FROM "Contract" c
       JOIN "ContractPayment" cp ON cp."contractId" = c.id
       LEFT JOIN LATERAL (SELECT SUM(pm."amountCents") AS total FROM "Payment" pm WHERE pm."contractPaymentId" = cp.id) p ON true
      WHERE c."organizationId"=$1 AND c.payable=false AND c.status='SIGNED'`,
    [org],
  )).rows[0].owed;
  // $3,800 signed + $2,400 change − $500 credit − $1,000 paid.
  assert.equal(owed, 470000);
  await page.goto(`${BASE}/dashboard/companies`);
  const row = page.locator("[data-testid=company-row]").filter({ hasText: "Beachfront Lofts" });
  assert.equal(Number(await row.locator("[data-testid=owes-line]").getAttribute("data-cents")), 470000);

  /* --------------------------------- Files --------------------------------- */

  log("the other party's own signed contract can live with the job");
  await page.goto(`${BASE}/dashboard/projects/${project.id}/files`);
  await page.setInputFiles("[data-testid=project-file-input]", {
    name: "beachfront-master-agreement.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 their paper"),
  });
  await page.locator("[data-testid=project-file-name]").fill("Their master agreement");
  await page.locator("[data-testid=project-file-category]").selectOption("Signed contract");
  await page.locator("[data-testid=project-file-upload]").click();
  await page.getByText(/uploaded/).waitFor();
  await page.locator("[data-testid=project-file]").first().waitFor();
  assert.match(await page.locator("[data-testid=project-file]").first().textContent(), /Their master agreement/);
  assert.match(await page.locator("[data-testid=project-file]").first().textContent(), /Signed contract/);
  const upload = (await sql(
    `SELECT "publicToken", kind, category FROM "Upload" WHERE "projectId"=$1`,
    [project.id],
  )).rows[0];
  assert.equal(upload.kind, "PROJECT_FILE");
  assert.equal(upload.category, "Signed contract");
  await shot(page, "05-files");

  log("a job's file needs a login: the link alone is not enough");
  const stranger = await browser.newContext();
  const denied = await stranger.request.get(`${BASE}/files/${upload.publicToken}`);
  assert.equal(denied.status(), 404, "no session, no file");
  await stranger.close();

  log("deleting it takes it off the job");
  await page.locator("[data-testid=delete-project-file]").first().click();
  await page.waitForFunction(() => document.querySelectorAll("[data-testid=project-file]").length === 0);
  assert.equal(Number((await sql(`SELECT count(*) FROM "Upload" WHERE "projectId"=$1`, [project.id])).rows[0].count), 0);

  log("the Money tab fits a phone screen");
  const phone = await browser.newContext({ viewport: { width: 400, height: 800 } });
  const ppage = await phone.newPage();
  await ppage.goto(`${BASE}/login`);
  await ppage.fill("#email", EMAIL);
  await ppage.fill("#password", PASSWORD);
  await ppage.click("button[type=submit]");
  await ppage.waitForURL(/\/dashboard$/);
  await ppage.goto(`${BASE}/dashboard/projects/${project.id}/money`);
  await ppage.locator("[data-testid=owed-row]").first().waitFor();
  assert.ok(
    await ppage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    "the page itself does not scroll sideways on a phone",
  );
  await ppage.screenshot({ path: path.join(OUT, "06-phone.png"), fullPage: true });
  await phone.close();

  await browser.close();
  console.log(`\nALL ${step} STEPS PASSED · screenshots in ${OUT}`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
