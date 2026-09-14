/* Browser regression for the money foundation (Sept 14, 2026).
 *
 * Covers: which way a contract's money goes (Money in / Money out) and
 * that it defaults from the template; a supplier signing a Purchase Order
 * no longer wins the deal; recorded payments (partial, over-payment
 * refused, remove); the Paid tick recording and removing a real payment;
 * a signed contract's payment table staying editable, keeping its row ids
 * and refusing an amount below what was recorded; the tracker's
 * Outstanding counting only money coming in, with the signed part under
 * it; "Mark signed" as the manual override; the Preset Payment Table in
 * Settings feeding a new tracker column; and deleting a contact with
 * money on the books being refused.
 *
 * Runs against a built app (`bash scripts/dev-serve.sh`) and a local
 * Postgres that has had `prisma migrate deploy` run against it. It signs
 * up its own workspace, activates it with SQL, and deletes it again on
 * the next run, so it never touches real data. Never point it at the
 * live database.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/scb_test \
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules \
 *   node scripts/browser-tests/money-payments.cjs
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
const OUT = process.env.SHOTS_DIR || path.join(os.tmpdir(), "scb-browser-shots-money");
fs.mkdirSync(OUT, { recursive: true });

const EMAIL = "test-money@example.com";
const PASSWORD = "password123";
const COMPANY = "Test Money Co";
const SLUG_LIKE = "test-money-co%";

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
// Signs a contract on its public link, the way a customer or supplier does.
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

  log("seed a customer, a supplier and a deal with a quote of two rows");
  await sql(
    `INSERT INTO "Company" (id,"organizationId",name,phone,city,state,"updatedAt")
     VALUES ('cmp_mo','${org}','Harbor Property Group','555-0140','Austin','TX',now()),
            ('cmp_sup','${org}','Gulf Supply','555-0141','Austin','TX',now())`,
  );
  await sql(
    `INSERT INTO "Contact" (id,"organizationId","companyId",name,title,email,"updatedAt")
     VALUES ('ctc_mo','${org}','cmp_mo','Dana Ruiz','Owner','dana@harbor.com',now()),
            ('ctc_sup','${org}','cmp_sup','Sam Rep','Sales','sam@gulfsupply.com',now())`,
  );
  await sql(
    `INSERT INTO "Deal" (id,"organizationId","contactId",title,stage,"updatedAt")
     VALUES ('deal_mo','${org}','ctc_mo','Rekey the building','QUOTE_SENT',now())`,
  );
  await sql(
    `INSERT INTO "Quote" (id,"organizationId","contactId","dealId",number,title,status,"publicToken","updatedAt")
     VALUES ('quo_mo','${org}','ctc_mo','deal_mo',1000,'Rekey quote','SENT','tok_quo_mo_0123456789',now())`,
  );
  await sql(
    `INSERT INTO "QuoteLineItem" (id,"quoteId",name,quantity,"unitPriceCents",tag,position)
     VALUES ('qli_mo1','quo_mo','Install labor',1,200000,'LABOR',0),
            ('qli_mo2','quo_mo','Locks',1,100000,'MATERIALS',1)`,
  );

  /* ------------------------- Which way the money goes ------------------------- */

  log("the tracker grid defaults Contract A to Money in and a Purchase Order column to Money out");
  await page.goto(`${BASE}/dashboard/deals/tracker?dealId=deal_mo`);
  await page.locator("[data-testid=tracker-row]").first().waitFor();
  assert.equal(await page.locator("#col-1-direction").inputValue(), "in");
  await page.getByRole("checkbox", { name: "Put Install labor on Contract A" }).check();
  await page.getByRole("checkbox", { name: "Put Locks on Contract A" }).check();
  await page.locator("#col-1-preset").selectOption("DEPOSIT_BALANCE");
  await page.locator("#col-1-depositPercent").fill("40");
  await page.locator("[data-testid=add-column]").click();
  assert.equal(await page.locator("#col-2-direction").inputValue(), "out", "a Purchase Order is money going out");
  await page.locator("#col-2-company").selectOption("cmp_sup");
  await page.locator("#col-2-contact").selectOption("ctc_sup");
  await page.getByRole("checkbox", { name: "Put Locks on Contract B" }).check();
  await shot(page, "01-directions");
  await page.locator("[data-testid=create-contracts]").click();
  await page.getByText(/contracts created/).waitFor();

  const contracts = (await sql(
    `SELECT id, number, payable, status, "publicToken" FROM "Contract" WHERE "organizationId"=$1 ORDER BY number`,
    [org],
  )).rows;
  assert.equal(contracts.length, 2);
  const inbound = contracts.find((c) => !c.payable);
  const outbound = contracts.find((c) => c.payable);
  assert.ok(inbound && outbound, "one contract each way");

  log("send both, then the supplier signs the Purchase Order: it is signed, but the deal is not won");
  for (const contract of [inbound, outbound]) {
    await page.goto(`${BASE}/dashboard/contracts/${contract.id}`);
    await page.getByRole("button", { name: /Mark as sent|Send for signature/ }).first().click();
    await page.getByText(/Sent/).first().waitFor();
  }
  await signAs(browser, outbound.publicToken, "Sam Rep");
  assert.equal((await sql(`SELECT status FROM "Contract" WHERE id=$1`, [outbound.id])).rows[0].status, "SIGNED");
  assert.equal(
    (await sql(`SELECT stage FROM "Deal" WHERE id='deal_mo'`)).rows[0].stage,
    "CONTRACT_SENT",
    "a supplier accepting a purchase order is not the customer saying yes",
  );

  log("the customer signs the Sales Order and the deal is won");
  await signAs(browser, inbound.publicToken, "Dana Ruiz");
  assert.equal((await sql(`SELECT stage FROM "Deal" WHERE id='deal_mo'`)).rows[0].stage, "WON");

  /* ------------------------------- Payments ------------------------------- */

  log("record $600 of the $1,200 deposit: the row reads part paid and is not settled");
  await page.goto(`${BASE}/dashboard/contracts/${inbound.id}`);
  await page.locator("[data-testid=payment-schedule]").waitFor();
  const firstRowMoney = page.locator("[data-testid=payment-money]").first();
  await firstRowMoney.locator("[data-testid=record-payment]").click();
  await page.locator("[data-testid=payment-amount-input]").fill("600");
  await page.locator("[data-testid=payment-method]").fill("Check");
  await page.locator("[data-testid=payment-reference]").fill("1042");
  await page.locator("[data-testid=payment-save]").click();
  await page.getByText(/\$600\.00 recorded/).waitFor();
  assert.match(await firstRowMoney.locator("[data-testid=paid-of]").textContent(), /\$600\.00 of \$1,200\.00/);
  const depositRow = (await sql(
    `SELECT cp.id, cp."paidAt" FROM "ContractPayment" cp WHERE cp."contractId"=$1 ORDER BY cp.position LIMIT 1`,
    [inbound.id],
  )).rows[0];
  assert.equal(depositRow.paidAt, null, "part paid is not settled");

  log("more than the balance is refused in plain words");
  await firstRowMoney.locator("[data-testid=record-payment]").click();
  await page.locator("[data-testid=payment-amount-input]").fill("900");
  await page.locator("[data-testid=payment-save]").click();
  await page.getByText(/That's more than the \$600\.00 still open on this row\./).waitFor();

  log("the rest settles the row and ticks Paid");
  await page.locator("[data-testid=payment-amount-input]").fill("600");
  await page.locator("[data-testid=payment-save]").click();
  await page.getByText(/\$600\.00 recorded/).waitFor();
  await page.waitForFunction(() => {
    const el = document.querySelector("[data-testid=paid-of]");
    return el && /\$1,200\.00 of \$1,200\.00/.test(el.textContent || "");
  });
  assert.ok(
    (await sql(`SELECT "paidAt" FROM "ContractPayment" WHERE id=$1`, [depositRow.id])).rows[0].paidAt,
    "the row settles once the payments cover it",
  );
  assert.equal(
    Number((await sql(`SELECT count(*) FROM "Payment" WHERE "contractPaymentId"=$1`, [depositRow.id])).rows[0].count),
    2,
    "two payments on the row",
  );
  await shot(page, "02-part-paid");

  log("ticking Paid on the balance row records one payment for what is open");
  const balanceRow = page.locator("[data-testid=payment-money]").nth(1);
  // The tick records a payment on the server, so the box only flips once
  // the answer is back — click it rather than asserting an instant change.
  await page.locator("[data-testid=paid-checkbox]").nth(1).click();
  await page.waitForFunction(() => {
    const rows = document.querySelectorAll("[data-testid=paid-of]");
    return rows[1] && /\$1,800\.00 of \$1,800\.00/.test(rows[1].textContent || "");
  });
  const balanceId = (await sql(
    `SELECT id FROM "ContractPayment" WHERE "contractId"=$1 ORDER BY position OFFSET 1 LIMIT 1`,
    [inbound.id],
  )).rows[0].id;
  assert.equal(
    Number((await sql(`SELECT count(*) FROM "Payment" WHERE "contractPaymentId"=$1`, [balanceId])).rows[0].count),
    1,
    "the tick is one payment for the balance",
  );

  log("unticking Paid takes the payment back off and reopens the row");
  await page.locator("[data-testid=paid-checkbox]").nth(1).click();
  await page.waitForFunction(() => {
    const rows = document.querySelectorAll("[data-testid=paid-of]");
    return rows[1] && /\$0\.00 of \$1,800\.00/.test(rows[1].textContent || "");
  });
  assert.equal(
    Number((await sql(`SELECT count(*) FROM "Payment" WHERE "contractPaymentId"=$1`, [balanceId])).rows[0].count),
    0,
  );
  assert.equal((await sql(`SELECT "paidAt" FROM "ContractPayment" WHERE id=$1`, [balanceId])).rows[0].paidAt, null);
  assert.ok(await balanceRow.isVisible());

  /* --------------------- The table stays editable after signing --------------------- */

  log("a signed contract's payment table still saves, and its rows keep their ids");
  const idsBefore = (await sql(
    `SELECT id FROM "ContractPayment" WHERE "contractId"=$1 ORDER BY position`,
    [inbound.id],
  )).rows.map((row) => row.id);
  await page.locator("[data-testid=payment-row]").nth(1).locator("input[type=date]").fill("2026-12-15");
  await page.locator("[data-testid=save-schedule]").click();
  await page.getByText("Payment schedule saved").waitFor();
  const idsAfter = (await sql(
    `SELECT id, "dueOn" FROM "ContractPayment" WHERE "contractId"=$1 ORDER BY position`,
    [inbound.id],
  )).rows;
  assert.deepEqual(idsAfter.map((row) => row.id), idsBefore, "editing the table keeps the rows it had");
  assert.match(idsAfter[1].dueOn.toISOString(), /^2026-12-15/);

  log("an amount below what was already recorded is refused");
  await page.locator("[data-testid=payment-row]").first().locator("select").first().selectOption("FIXED");
  await page.locator("[data-testid=payment-row]").first().locator("input.num").first().fill("400");
  await page.locator("[data-testid=save-schedule]").click();
  await page.getByText(/already has \$1,200\.00 recorded on it/).waitFor();
  await shot(page, "03-amount-refused");
  await page.reload();

  /* ------------------------------ The tracker ------------------------------ */

  log("Outstanding counts only money coming in, with the signed part under it");
  await page.goto(`${BASE}/dashboard/deals/tracker?dealId=deal_mo`);
  await page.locator("[data-testid=tracker-outstanding]").waitFor();
  // $3,000 on the Sales Order, $1,200 recorded. The supplier's $1,000
  // purchase order is money we owe them, so it is not in either number.
  assert.equal(await page.locator("[data-testid=tracker-outstanding]").textContent(), "$1,800.00");
  assert.match(await page.locator("[data-testid=tracker-signed-owed]").textContent(), /Signed: \$1,800\.00/);
  await shot(page, "04-tracker-outstanding");

  /* ------------------------------ Mark signed ------------------------------ */

  log("Mark signed records a contract signed on paper, with who and when");
  await sql(
    `INSERT INTO "Contract" (id,"organizationId","contactId","companyId","dealId",number,title,type,body,status,"publicToken","sentAt","updatedAt")
     VALUES ('con_off','${org}','ctc_mo','cmp_mo','deal_mo',2000,'Service agreement','Service Agreement','Body','SENT','tok_con_off_0123456789',now(),now())`,
  );
  await page.goto(`${BASE}/dashboard/contracts/con_off`);
  // The button sits in the header and again in the side panel.
  await page.locator("[data-testid=mark-signed]").first().click();
  await page.locator("[data-testid=mark-signed-name]").first().fill("Dana Ruiz");
  await page.locator("[data-testid=mark-signed-note]").first().fill("signed a paper copy on site");
  await page.locator("[data-testid=mark-signed-save]").first().click();
  await page.getByText(/Signed offline/).waitFor();
  const offline = (await sql(
    `SELECT status, "signedOffline", "signedNote", "signerName" FROM "Contract" WHERE id='con_off'`,
  )).rows[0];
  assert.equal(offline.status, "SIGNED");
  assert.equal(offline.signedOffline, true);
  assert.equal(offline.signerName, "Dana Ruiz");
  assert.match(offline.signedNote, /paper copy/);
  await shot(page, "05-mark-signed");

  /* ------------------------- The Preset Payment Table ------------------------- */

  log("the payment table preset in Settings is what a new tracker column starts with");
  await page.goto(`${BASE}/dashboard/settings/general`);
  await page.locator("[data-testid=preset-terms]").selectOption("Net 15");
  await page.locator("[data-testid=preset-kind]").selectOption("DEPOSIT_BALANCE");
  await page.locator("[data-testid=preset-deposit]").fill("30");
  await page.getByRole("button", { name: /Save changes/ }).click();
  await page.getByText("Company information saved").waitFor();
  const preset = (await sql(
    `SELECT "defaultPaymentTerms","defaultPaymentPreset","defaultDepositPercent" FROM "Organization" WHERE id=$1`,
    [org],
  )).rows[0];
  assert.deepEqual(preset, { defaultPaymentTerms: "Net 15", defaultPaymentPreset: "DEPOSIT_BALANCE", defaultDepositPercent: 30 });

  await sql(
    `INSERT INTO "Deal" (id,"organizationId","contactId",title,stage,"updatedAt")
     VALUES ('deal_mo2','${org}','ctc_mo','Second job','QUOTE_SENT',now())`,
  );
  await sql(
    `INSERT INTO "Quote" (id,"organizationId","contactId","dealId",number,title,status,"publicToken","updatedAt")
     VALUES ('quo_mo2','${org}','ctc_mo','deal_mo2',1001,'Second quote','SENT','tok_quo_mo2_012345678',now())`,
  );
  await sql(
    `INSERT INTO "QuoteLineItem" (id,"quoteId",name,quantity,"unitPriceCents",tag,position)
     VALUES ('qli_mo3','quo_mo2','Paint',1,50000,'LABOR',0)`,
  );
  await page.goto(`${BASE}/dashboard/deals/tracker?dealId=deal_mo2`);
  await page.locator("[data-testid=tracker-row]").first().waitFor();
  assert.equal(await page.locator("#col-1-terms").inputValue(), "Net 15");
  assert.equal(await page.locator("#col-1-preset").inputValue(), "DEPOSIT_BALANCE");
  assert.equal(await page.locator("#col-1-depositPercent").inputValue(), "30");

  /* ------------------------------ Delete guards ------------------------------ */

  log("deleting a contact who has money on the books is refused, with the amounts");
  await page.goto(`${BASE}/dashboard/contacts/ctc_mo/edit`);
  await page.locator("[data-testid=delete-record]").click();
  await page.getByText(/still owed|payments recorded/).waitFor();
  const refusal = await page.locator("[data-testid=delete-record]").locator("xpath=..").textContent();
  assert.match(refusal, /archive this contact instead of deleting/);
  assert.equal(Number((await sql(`SELECT count(*) FROM "Contact" WHERE id='ctc_mo'`)).rows[0].count), 1);
  await shot(page, "06-delete-refused");

  await browser.close();
  console.log(`\nALL ${step} STEPS PASSED · screenshots in ${OUT}`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
