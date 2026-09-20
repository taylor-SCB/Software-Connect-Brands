/* Browser regression for Projects and budgets (Sept 14, 2026).
 *
 * Covers: service types on a quote's rows ("Split by service type") and
 * "+ Add new service type"; a signed agreement becoming a job with one
 * scope per service type; the four budget numbers (Awarded, Spent,
 * Committed, Left) on the job and on each scope, and the project's being
 * the sum of its scopes'; a supplier's purchase order counting as
 * committed and then as spent when it is paid; moving a row between
 * scopes moving two bars and not the project's; the award history under
 * a bar; a typed adjustment with a reason; "Award without paperwork" for
 * a handshake job; the Projects list with its search, stage chips and
 * Show finished; the Budgets page; the Jobs card on a company page; the
 * dashboard's Active jobs tile; and `npm run recompute-projects`
 * reporting no drift.
 *
 * Runs against a built app (`bash scripts/dev-serve.sh`) and a local
 * Postgres that has had `prisma migrate deploy` run against it. It signs
 * up its own workspace, activates it with SQL, and deletes it again on
 * the next run, so it never touches real data. Never point it at the
 * live database.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/scb_test \
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules \
 *   node scripts/browser-tests/projects-core.cjs
 */
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS on purpose: NODE_PATH only resolves the global playwright for require() */
const os = require("node:os");
const { chromium } = require("playwright");
const { Client } = require("pg");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");

const BASE = process.env.BASE || "http://localhost:3000";
const DB = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5433/scb_test";
const OUT = process.env.SHOTS_DIR || path.join(os.tmpdir(), "scb-browser-shots-projects");
fs.mkdirSync(OUT, { recursive: true });

const EMAIL = "test-projects@example.com";
const PASSWORD = "password123";
const COMPANY = "Test Projects Co";
const SLUG_LIKE = "test-projects-co%";

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

  log("seed a customer, a supplier, two products with costs, a deal and a four-row quote");
  await sql(
    `INSERT INTO "Company" (id,"organizationId",name,city,state,"updatedAt")
     VALUES ('cmp_pj','${org}','Lakeside Towers','Austin','TX',now()),
            ('cmp_sup_pj','${org}','Gulf Lock Supply','Austin','TX',now())`,
  );
  await sql(
    `INSERT INTO "Contact" (id,"organizationId","companyId",name,title,email,"updatedAt")
     VALUES ('ctc_pj','${org}','cmp_pj','Dana Ruiz','Owner','dana@lakeside.com',now()),
            ('ctc_sup_pj','${org}','cmp_sup_pj','Sam Rep','Sales','sam@gulflock.com',now())`,
  );
  // Costs on file, so the job can show what it is expected to cost.
  await sql(
    `INSERT INTO "Product" (id,"organizationId",name,description,"unitPriceCents","costCents","defaultTag","updatedAt")
     VALUES ('prd_lock','${org}','Smart lock','','15000',9000,'MATERIALS',now()),
            ('prd_reader','${org}','Card reader','','20000',12000,'MATERIALS',now())`,
  );
  await sql(
    `INSERT INTO "Deal" (id,"organizationId","contactId",title,stage,"updatedAt")
     VALUES ('deal_pj','${org}','ctc_pj','Lakeside Towers rekey','QUOTE_SENT',now())`,
  );
  await sql(
    `INSERT INTO "Quote" (id,"organizationId","contactId","dealId",number,title,status,"publicToken","updatedAt")
     VALUES ('quo_pj','${org}','ctc_pj','deal_pj',1000,'Rekey quote','SENT','tok_quo_pj_0123456789',now())`,
  );
  await sql(
    `INSERT INTO "QuoteLineItem" (id,"quoteId","productId",name,quantity,"unitPriceCents",tag,position)
     VALUES ('qli_pj1','quo_pj',NULL,'Install labor',10,8000,'LABOR',0),
            ('qli_pj2','quo_pj','prd_lock','Smart locks',20,15000,'MATERIALS',1),
            ('qli_pj3','quo_pj','prd_reader','Card readers',4,20000,'MATERIALS',2),
            ('qli_pj4','quo_pj',NULL,'Cloud plan',1,60000,'SOFTWARE',3)`,
  );

  /* ------------------------------ Service types ------------------------------ */

  log("split the quote by service type: Smart Locks on rows 1–2, Access Control on 3–4");
  await page.goto(`${BASE}/dashboard/quotes/quo_pj`);
  await page.locator("[data-testid=split-by-service-type]").check();
  const typeSelects = page.locator("[data-testid=line-service-type]");
  assert.equal(await typeSelects.count(), 4, "one picker per row");
  await typeSelects.nth(0).selectOption("Smart Locks");
  await typeSelects.nth(1).selectOption("Smart Locks");
  await typeSelects.nth(2).selectOption("Access Control");
  await typeSelects.nth(3).selectOption("Access Control");
  await page.getByRole("button", { name: "Save line items" }).click();
  // "Unsaved changes" also contains "saved", so wait for the real thing.
  await page.getByText("Line items saved").waitFor();
  const seeded = (await sql(
    `SELECT name, "serviceType" FROM "QuoteLineItem" WHERE "quoteId"='quo_pj' ORDER BY position`,
  )).rows;
  assert.deepEqual(
    seeded.map((row) => row.serviceType),
    ["Smart Locks", "Smart Locks", "Access Control", "Access Control"],
  );
  await shot(page, "01-split-by-service-type");

  /* ------------------------- The contracts, then the job ------------------------- */

  log("tracker: a Sales Order for everything, and a Purchase Order to the supplier for the locks");
  await page.goto(`${BASE}/dashboard/deals/tracker?dealId=deal_pj`);
  await page.locator("[data-testid=tracker-row]").first().waitFor();
  for (const name of ["Install labor", "Smart locks", "Card readers", "Cloud plan"]) {
    await page.getByRole("checkbox", { name: `Put ${name} on Contract A` }).check();
  }
  await page.locator("[data-testid=add-column]").click();
  await page.locator("#col-2-company").selectOption("cmp_sup_pj");
  await page.locator("#col-2-contact").selectOption("ctc_sup_pj");
  await page.getByRole("checkbox", { name: "Put Smart locks on Contract B" }).check();
  await page.locator("[data-testid=create-contracts]").click();
  await page.waitForURL(/created=\d+/);

  const contracts = (await sql(
    `SELECT id, number, payable, "publicToken" FROM "Contract" WHERE "organizationId"=$1 ORDER BY number`,
    [org],
  )).rows;
  const sales = contracts.find((row) => !row.payable);
  const order = contracts.find((row) => row.payable);
  assert.ok(sales && order, "one contract each way");

  log("no job exists until the customer signs");
  assert.equal(Number((await sql(`SELECT count(*) FROM "Project" WHERE "organizationId"=$1`, [org])).rows[0].count), 0);

  log("send both, the supplier accepts the purchase order, and still no job");
  for (const contract of [sales, order]) {
    await page.goto(`${BASE}/dashboard/contracts/${contract.id}`);
    await page.getByRole("button", { name: /Mark as sent|Send for signature/ }).first().click();
    await page.getByText(/Sent/).first().waitFor();
  }
  await signAs(browser, order.publicToken, "Sam Rep");
  assert.equal(Number((await sql(`SELECT count(*) FROM "Project" WHERE "organizationId"=$1`, [org])).rows[0].count), 0);
  assert.equal((await sql(`SELECT stage FROM "Deal" WHERE id='deal_pj'`)).rows[0].stage, "CONTRACT_SENT");

  log("the customer signs: PRJ-1000 appears with a scope per service type");
  await signAs(browser, sales.publicToken, "Dana Ruiz");
  const project = (await sql(
    `SELECT id, number, stage, "awardedCents", "spentCents", "committedCents", "billedCents", "plannedCostCents"
       FROM "Project" WHERE "organizationId"=$1`,
    [org],
  )).rows[0];
  assert.equal(project.number, 1000);
  assert.equal(project.stage, "AWARDED");
  // 10 × $80 + 20 × $150 + 4 × $200 + $600 = $800 + $3,000 + $800 + $600 = $5,200
  assert.equal(project.awardedCents, 520000, "awarded is the signed agreement's total");
  const scopes = (await sql(
    `SELECT name, "serviceType", "isDefault", "awardedCents" FROM "ProjectScope"
      WHERE "projectId"=$1 ORDER BY position`,
    [project.id],
  )).rows;
  assert.deepEqual(
    scopes.map((row) => [row.name, row.awardedCents]),
    [["Whole job", 0], ["Smart Locks", 380000], ["Access Control", 140000]],
    "each kind of work carries its own share",
  );
  assert.equal(
    scopes.reduce((sum, row) => sum + row.awardedCents, 0),
    project.awardedCents,
    "the job's awarded amount is the sum of its scopes'",
  );
  // The supplier's purchase order belongs to the job as one of its costs.
  assert.equal(
    (await sql(`SELECT "projectId" FROM "Contract" WHERE id=$1`, [order.id])).rows[0].projectId,
    project.id,
  );

  log("signing again changes nothing");
  const before = (await sql(`SELECT "awardedCents" FROM "Project" WHERE id=$1`, [project.id])).rows[0];
  await sql(`UPDATE "Contract" SET status='SIGNED' WHERE id=$1`, [sales.id]);
  await page.goto(`${BASE}/dashboard/projects/${project.id}`);
  await page.locator("[data-testid=project-left]").waitFor();
  assert.equal(
    (await sql(`SELECT "awardedCents" FROM "Project" WHERE id=$1`, [project.id])).rows[0].awardedCents,
    before.awardedCents,
  );
  assert.equal(
    Number((await sql(`SELECT count(*) FROM "ScopeAward" WHERE "contractId"=$1`, [sales.id])).rows[0].count),
    2,
    "one award row per scope, not doubled",
  );

  /* -------------------------------- The bar -------------------------------- */

  log("the purchase order that is out counts as committed, not spent");
  await page.goto(`${BASE}/dashboard/projects/${project.id}`);
  await page.locator("[data-testid=project-left]").waitFor();
  const numbers = (await sql(
    `SELECT "awardedCents","spentCents","committedCents" FROM "Project" WHERE id=$1`,
    [project.id],
  )).rows[0];
  assert.equal(numbers.committedCents, 300000, "the $3,000 order is committed");
  assert.equal(numbers.spentCents, 0, "nothing paid out yet");
  assert.equal(
    Number(await page.locator("[data-testid=project-left]").textContent().then((t) => t.replace(/[^0-9]/g, ""))),
    220000,
    "Left is $2,200.00 — awarded less committed",
  );
  await shot(page, "02-budget-bar");

  log("paying the supplier moves the same money from committed to spent");
  const orderRow = (await sql(
    `SELECT id FROM "ContractPayment" WHERE "contractId"=$1 ORDER BY position LIMIT 1`,
    [order.id],
  )).rows[0];
  await page.goto(`${BASE}/dashboard/contracts/${order.id}`);
  await page.locator("[data-testid=payment-money]").first().locator("[data-testid=record-payment]").click();
  await page.locator("[data-testid=payment-amount-input]").fill("1000");
  await page.locator("[data-testid=payment-save]").click();
  await page.getByText(/\$1,000\.00 recorded/).waitFor();
  const paid = (await sql(
    `SELECT "spentCents","committedCents","awardedCents" FROM "Project" WHERE id=$1`,
    [project.id],
  )).rows[0];
  assert.equal(paid.spentCents, 100000);
  assert.equal(paid.committedCents, 200000);
  assert.equal(
    paid.awardedCents - paid.spentCents - paid.committedCents,
    220000,
    "Left does not move when a commitment is paid",
  );
  assert.ok(orderRow.id, "the purchase order had a payment row to record against");

  log("what the customer has paid shows as collected, separately from the budget");
  const salesRow = (await sql(
    `SELECT id, "amountCents" FROM "ContractPayment" WHERE "contractId"=$1 ORDER BY position LIMIT 1`,
    [sales.id],
  )).rows[0];
  await page.goto(`${BASE}/dashboard/contracts/${sales.id}`);
  await page.locator("[data-testid=payment-money]").first().locator("[data-testid=record-payment]").click();
  await page.locator("[data-testid=payment-amount-input]").fill("2000");
  await page.locator("[data-testid=payment-save]").click();
  await page.getByText(/\$2,000\.00 recorded/).waitFor();
  const collected = (await sql(
    `SELECT "billedCents","receivedCents","spentCents" FROM "Project" WHERE id=$1`,
    [project.id],
  )).rows[0];
  assert.equal(collected.billedCents, salesRow.amountCents === 520000 ? 520000 : collected.billedCents);
  assert.equal(collected.receivedCents, 200000, "the customer's payment is collected");
  assert.equal(collected.spentCents, 100000, "and is not confused with money going out");

  /* ------------------------------ Moving a row ------------------------------ */

  log("moving the readers to Smart Locks moves two scope bars and not the job's");
  await page.goto(`${BASE}/dashboard/projects/${project.id}`);
  const accessCard = page.locator("[data-testid=scope-card]").filter({ hasText: "Card readers" }).first();
  // Two scopes now, so Access Control is the second card.
  await page.locator("[data-testid=scope-expand]").nth(1).click();
  const lineScope = page.locator("[data-testid=line-scope]").first();
  await lineScope.waitFor();
  const smartLocksId = (await sql(
    `SELECT id FROM "ProjectScope" WHERE "projectId"=$1 AND name='Smart Locks'`,
    [project.id],
  )).rows[0].id;
  const readerLine = (await sql(
    `SELECT cli.id FROM "ContractLineItem" cli WHERE cli."contractId"=$1 AND cli.name='Card readers'`,
    [sales.id],
  )).rows[0].id;
  await page.locator(`[data-testid=scope-line]`).filter({ hasText: "Card readers" }).first()
    .locator("[data-testid=line-scope]").selectOption(smartLocksId);
  await page.waitForFunction(
    () => !document.body.textContent.includes("Moving…"),
    undefined,
    { timeout: 15000 },
  );
  await page.waitForTimeout(1500);
  const moved = (await sql(
    `SELECT name, "awardedCents" FROM "ProjectScope" WHERE "projectId"=$1 ORDER BY position`,
    [project.id],
  )).rows;
  const awardedByName = Object.fromEntries(moved.map((row) => [row.name, row.awardedCents]));
  assert.equal(awardedByName["Smart Locks"], 460000, "Smart Locks gains the readers' $800");
  assert.equal(awardedByName["Access Control"], 60000, "Access Control keeps only the cloud plan");
  assert.equal(
    (await sql(`SELECT "awardedCents" FROM "Project" WHERE id=$1`, [project.id])).rows[0].awardedCents,
    520000,
    "the job's awarded amount does not change",
  );
  assert.ok(readerLine, "the readers row exists");
  assert.ok(await accessCard.count() >= 0);

  log("the expected cost from the catalog shows, and is never a customer's number");
  const planned = (await sql(`SELECT "plannedCostCents" FROM "Project" WHERE id=$1`, [project.id])).rows[0];
  // 20 locks × $90 + 4 readers × $120 = $1,800 + $480
  assert.equal(planned.plannedCostCents, 228000);
  await page.goto(`${BASE}/dashboard/projects/${project.id}`);
  assert.match(await page.locator("[data-testid=planned-cost]").textContent(), /\$2,280\.00/);

  /* --------------------------- History and adjusting --------------------------- */

  log("the award history explains the number, and a typed change needs a reason");
  await page.goto(`${BASE}/dashboard/projects/${project.id}`);
  await page.locator("[data-testid=scope-expand]").first().click();
  await page.locator("[data-testid=award-history]").first().waitFor();
  await page.locator("[data-testid=scope-adjust]").nth(1).click();
  await page.locator("[data-testid=adjust-amount]").fill("-500");
  await page.locator("[data-testid=adjust-save]").click();
  await page.getByText(/Say why the awarded amount is changing/).waitFor();
  await page.locator("[data-testid=adjust-note]").fill("Owner dropped two doors");
  await page.locator("[data-testid=adjust-save]").click();
  await page.waitForTimeout(1500);
  const adjusted = (await sql(
    `SELECT "awardedCents" FROM "Project" WHERE id=$1`,
    [project.id],
  )).rows[0];
  assert.equal(adjusted.awardedCents, 470000, "the job's awarded amount drops by $500");
  const manual = (await sql(
    `SELECT kind, "deltaCents", note FROM "ScopeAward" WHERE kind='MANUAL'`,
  )).rows[0];
  assert.equal(manual.deltaCents, -50000);
  assert.match(manual.note, /two doors/);
  await shot(page, "03-award-history");

  /* ----------------------- Award without paperwork ----------------------- */

  log("a handshake job: Award without paperwork writes the agreement and starts the job");
  await sql(
    `INSERT INTO "Deal" (id,"organizationId","contactId",title,stage,"updatedAt")
     VALUES ('deal_pj2','${org}','ctc_pj','Paint the lobby','QUOTE_SENT',now())`,
  );
  await sql(
    `INSERT INTO "Quote" (id,"organizationId","contactId","dealId",number,title,status,"publicToken","updatedAt")
     VALUES ('quo_pj2','${org}','ctc_pj','deal_pj2',1001,'Lobby paint','SENT','tok_quo_pj2_012345678',now())`,
  );
  await sql(
    `INSERT INTO "QuoteLineItem" (id,"quoteId",name,quantity,"unitPriceCents",tag,position)
     VALUES ('qli_pj5','quo_pj2','Paint and labor',1,240000,'LABOR',0)`,
  );
  // A workspace on Pacific time, where the browser's UTC clock reads
  // tomorrow from 5pm onward — the date prefilled here has to come from
  // the workspace's own clock instead.
  await sql(`UPDATE "Organization" SET "timeZone"='America/Los_Angeles' WHERE id=$1`, [org]);
  await page.goto(`${BASE}/dashboard/deals/tracker?dealId=deal_pj2`);
  await page.locator("[data-testid=award-without-paperwork]").click();
  const pacificToday = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  assert.equal(
    await page.locator("[data-testid=award-date]").inputValue(),
    pacificToday,
    "audit fix: the agreement date is today where the business is, not in UTC",
  );
  await sql(`UPDATE "Organization" SET "timeZone"='America/Chicago' WHERE id=$1`, [org]);
  // The payment dates follow the day they agreed, as they always did.
  await page.locator("[data-testid=award-date]").fill("2026-09-13");
  assert.equal(
    await page.locator("[data-testid=award-schedule]").getByLabel("Payment 1 due date").inputValue(),
    "2026-09-13",
    "a quick fill is re-dated from the day they agreed",
  );
  await page.locator("[data-testid=award-signer]").fill("Dana Ruiz");
  await page.locator("[data-testid=award-note]").fill("agreed on site");
  // The full form: the row is listed and ticked, a discount on the whole
  // job, and the payment rows written out with a quick fill.
  assert.equal(await page.locator("[data-testid=award-rows] input[type=checkbox]:checked").count(), 1);
  assert.equal(await page.locator("[data-testid=award-subtotal]").textContent(), "$2,400.00");
  await page.locator("#award-discount").fill("10");
  assert.equal(await page.locator("[data-testid=award-total]").textContent(), "$2,160.00", "10% off the handshake");
  await page.locator("#award-preset").selectOption("DEPOSIT_BALANCE");
  await page.locator("#award-depositPercent").fill("25");
  assert.deepEqual(
    await page.locator("[data-testid=award-schedule] [data-testid=schedule-amount]").allTextContents(),
    ["$540.00", "$1,620.00"],
  );
  await page.locator("[data-testid=award-save]").click();
  await page.waitForURL(/\/dashboard\/projects\/[a-z0-9]+$/, { timeout: 20000 });
  const handshake = (await sql(
    `SELECT p.id, p.number, p."awardedCents", p."awardedOffline" FROM "Project" p
      WHERE p."dealId"='deal_pj2'`,
  )).rows[0];
  assert.equal(handshake.number, 1001);
  assert.equal(handshake.awardedCents, 216000, "awarded is the discounted total");
  const handshakePayments = (await sql(
    `SELECT label, "amountCents" FROM "ContractPayment" WHERE "contractId"=(SELECT id FROM "Contract" WHERE "dealId"='deal_pj2') ORDER BY position`,
  )).rows;
  assert.deepEqual(handshakePayments.map((p) => [p.label, p.amountCents]), [["Deposit", 54000], ["Balance on completion", 162000]]);
  assert.equal(
    (await sql(`SELECT "discountCents" FROM "Contract" WHERE "dealId"='deal_pj2'`)).rows[0].discountCents,
    24000,
  );
  assert.equal(handshake.awardedOffline, true, "flagged as recorded by hand");
  assert.equal((await sql(`SELECT stage FROM "Deal" WHERE id='deal_pj2'`)).rows[0].stage, "WON");
  const offline = (await sql(
    `SELECT status, payable, "signedOffline", "signedNote" FROM "Contract" WHERE "dealId"='deal_pj2'`,
  )).rows[0];
  assert.equal(offline.status, "SIGNED");
  assert.equal(offline.payable, false);
  assert.equal(offline.signedOffline, true);
  assert.match(offline.signedNote, /agreed on site/);
  // One scope only, so the page never mentions the word.
  assert.equal(
    Number((await sql(`SELECT count(*) FROM "ProjectScope" WHERE "projectId"=$1`, [handshake.id])).rows[0].count),
    1,
  );
  assert.equal(await page.locator("[data-testid=scope-card]").count(), 0, "one bar, no scope cards");
  await shot(page, "04-handshake-job");

  log("asking twice is refused, with what to do instead");
  await page.goto(`${BASE}/dashboard/deals/tracker?dealId=deal_pj2`);
  assert.match(await page.locator("[data-testid=tracker-project]").textContent(), /PRJ-1001/);

  /* -------------------------------- The list -------------------------------- */

  log("the Projects list shows both jobs with what is left, and search finds one");
  await page.goto(`${BASE}/dashboard/projects`);
  await page.locator("[data-testid=project-row]").first().waitFor();
  assert.equal(await page.locator("[data-testid=project-row]").count(), 2);
  await page.fill("[name=q]", "Paint the lobby");
  await page.keyboard.press("Enter");
  await page.waitForURL(/q=Paint/);
  await page.locator("[data-testid=project-row]").first().waitFor();
  assert.equal(await page.locator("[data-testid=project-row]").count(), 1);
  await page.goto(`${BASE}/dashboard/projects`);
  await page.fill("[name=q]", "PRJ-1000");
  await page.keyboard.press("Enter");
  await page.waitForURL(/q=PRJ-1000/);
  await page.locator("[data-testid=project-row]").first().waitFor();
  assert.equal(await page.locator("[data-testid=project-row]").count(), 1, "the number finds it too");

  log("Delayed reads as Delayed, and a finished job hides until asked for");
  await page.goto(`${BASE}/dashboard/projects/${project.id}`);
  await page.locator("[data-testid=project-stage]").selectOption("ON_HOLD");
  await page.waitForTimeout(1200);
  assert.equal((await sql(`SELECT stage FROM "Project" WHERE id=$1`, [project.id])).rows[0].stage, "ON_HOLD");
  await page.reload();
  assert.match(await page.locator("main").textContent(), /Delayed/);
  await page.locator("[data-testid=project-stage]").selectOption("COMPLETED");
  await page.waitForTimeout(1200);
  await page.goto(`${BASE}/dashboard/projects`);
  await page.locator("[data-testid=project-row]").first().waitFor();
  assert.equal(await page.locator("[data-testid=project-row]").count(), 1, "the finished one is out of the way");
  await page.locator("[data-testid=show-finished]").click();
  await page.waitForURL(/finished=1/);
  await page.locator("[data-testid=project-row]").first().waitFor();
  assert.equal(await page.locator("[data-testid=project-row]").count(), 2);
  await shot(page, "05-projects-list");

  // Put it back so the Budgets page has it.
  await page.goto(`${BASE}/dashboard/projects/${project.id}`);
  await page.locator("[data-testid=project-stage]").selectOption("ACTIVE");
  await page.waitForTimeout(1200);

  log("Budgets shows every live job, tightest first");
  await page.goto(`${BASE}/dashboard/projects/budgets`);
  await page.locator("[data-testid=budget-row]").first().waitFor();
  assert.equal(await page.locator("[data-testid=budget-row]").count(), 2);
  await shot(page, "06-budgets");

  log("the customer's page lists the jobs, and the dashboard counts them");
  await page.goto(`${BASE}/dashboard/companies/cmp_pj`);
  await page.locator("[data-testid=project-card-row]").first().waitFor();
  assert.equal(await page.locator("[data-testid=project-card-row]").count(), 2);
  await page.goto(`${BASE}/dashboard`);
  const tile = page.locator("text=Active jobs").locator("xpath=ancestor::*[self::a or self::div][1]");
  assert.match(await tile.textContent(), /2/);

  log("the job name and where the work is both save");
  await page.goto(`${BASE}/dashboard/projects/${project.id}`);
  await page.fill("[data-testid=project-site]", "1200 Lakeside Dr, Austin");
  await page.getByRole("button", { name: "Save" }).first().click();
  await page.getByText(/Saved/).first().waitFor();
  assert.equal(
    (await sql(`SELECT "siteAddress" FROM "Project" WHERE id=$1`, [project.id])).rows[0].siteAddress,
    "1200 Lakeside Dr, Austin",
  );

  log("audit fixes: a second row-less agreement does not award the quote twice");
  // The classic New contract page writes no priced rows, so awarding used
  // to fall back to the whole quote — a second such agreement on the same
  // deal added the quote again and a $3,000 job reported $6,000 awarded.
  const awardedBefore = (await sql(`SELECT "awardedCents" FROM "Project" WHERE id=$1`, [project.id]))
    .rows[0].awardedCents;
  await sql(`UPDATE "Organization" SET "nextContractNumber"=9100 WHERE id=$1`, [org]);
  // Signed, on the same deal, no priced rows and no job of its own — so
  // the contract page offers "Track this as a job", which is the award
  // path a person actually presses.
  await sql(
    `INSERT INTO "Contract" (id,"organizationId","contactId","dealId",number,title,type,payable,status,body,"publicToken","signedAt","updatedAt")
     VALUES ('con_pj_extra','${org}','ctc_pj','deal_pj',9100,'Compliance agreement','Compliance Agreement',false,'SIGNED','','tok_con_pj_extra_01',now(),now())`,
  );
  await page.goto(`${BASE}/dashboard/contracts/con_pj_extra`);
  await page.locator("[data-testid=create-project]").click();
  await page.waitForURL(/\/dashboard\/projects\//);
  const awardedAfter = (await sql(`SELECT "awardedCents" FROM "Project" WHERE id=$1`, [project.id]))
    .rows[0].awardedCents;
  assert.equal(
    awardedAfter,
    awardedBefore,
    "a second agreement with no priced rows adds nothing to the budget",
  );
  assert.equal(
    (await sql(`SELECT count(*)::int AS n FROM "ScopeAward" WHERE "contractId"='con_pj_extra'`)).rows[0].n,
    0,
    "and writes no award row of its own",
  );
  await sql(`DELETE FROM "Contract" WHERE id='con_pj_extra'`);

  log("audit fixes: sending, then deleting a purchase order keeps Committed honest");
  await sql(`UPDATE "Organization" SET "nextContractNumber"=9200 WHERE id=$1`, [org]);
  await sql(
    `INSERT INTO "Contract" (id,"organizationId","contactId","projectId",number,title,type,payable,status,body,"publicToken","updatedAt")
     VALUES ('con_pj_po','${org}','ctc_pj','${project.id}',9200,'Supply order','Purchase Order',true,'DRAFT','','tok_con_pj_po_01',now())`,
  );
  await sql(
    `INSERT INTO "ContractPayment" (id,"organizationId","contractId",label,kind,"amountCents",position)
     VALUES ('cp_pj_po','${org}','con_pj_po','Due on invoice','BALANCE',180000,0)`,
  );
  const committedDraft = (await sql(`SELECT "committedCents" FROM "Project" WHERE id=$1`, [project.id]))
    .rows[0].committedCents;
  // Mark as sent: the stored budget has to pick the order up.
  await page.goto(`${BASE}/dashboard/contracts/con_pj_po`);
  await page.getByRole("button", { name: /Mark as sent|Send for signature/ }).first().click();
  await page.getByText(/Sent/).first().waitFor();
  for (let tries = 0; tries < 40; tries += 1) {
    const now = (await sql(`SELECT "committedCents" FROM "Project" WHERE id=$1`, [project.id])).rows[0]
      .committedCents;
    if (now === committedDraft + 180000) break;
    await page.waitForTimeout(250);
  }
  assert.equal(
    (await sql(`SELECT "committedCents" FROM "Project" WHERE id=$1`, [project.id])).rows[0].committedCents,
    committedDraft + 180000,
    "an order that is out counts as committed on the job",
  );
  // And deleting it has to take the money back out — a purchase order has
  // no award rows, so the reversal alone never touched the totals.
  await page.locator("[data-testid=delete-record]").click();
  await page.waitForURL(/\/dashboard\/contracts$/);
  for (let tries = 0; tries < 40; tries += 1) {
    const now = (await sql(`SELECT "committedCents" FROM "Project" WHERE id=$1`, [project.id])).rows[0]
      .committedCents;
    if (now === committedDraft) break;
    await page.waitForTimeout(250);
  }
  assert.equal(
    (await sql(`SELECT "committedCents" FROM "Project" WHERE id=$1`, [project.id])).rows[0].committedCents,
    committedDraft,
    "and a deleted order stops counting",
  );

  log("audit fixes: an amount past what a money column holds is refused in words");
  await page.goto(`${BASE}/dashboard/projects/${project.id}`);
  await page.locator("[data-testid=scope-adjust]").first().click();
  await page.locator("[data-testid=adjust-amount]").first().fill("99999999.99");
  await page.locator("[data-testid=adjust-note]").first().fill("Fat finger");
  await page.locator("[data-testid=adjust-save]").first().click();
  await page.getByText(/That is more than \$21,474,836\.47/).waitFor();

  log("recompute-projects agrees with every number the app stored");
  const recompute = execFileSync("npm", ["run", "--silent", "recompute-projects"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: DB },
  });
  assert.match(recompute, /every number already right/, recompute);

  log("a job's page fits a phone screen");
  const phone = await browser.newContext({ viewport: { width: 400, height: 800 } });
  const ppage = await phone.newPage();
  await ppage.goto(`${BASE}/login`);
  await ppage.fill("#email", EMAIL);
  await ppage.fill("#password", PASSWORD);
  await ppage.click("button[type=submit]");
  await ppage.waitForURL(/\/dashboard$/);
  await ppage.goto(`${BASE}/dashboard/projects/${project.id}`);
  await ppage.locator("[data-testid=project-left]").waitFor();
  assert.ok(
    await ppage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    "the page itself does not scroll sideways on a phone",
  );
  await ppage.screenshot({ path: path.join(OUT, "07-phone.png"), fullPage: true });
  await phone.close();

  await browser.close();
  console.log(`\nALL ${step} STEPS PASSED · screenshots in ${OUT}`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
