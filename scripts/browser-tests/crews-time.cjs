/* Browser regression for Crews and time on a job (Sept 14, 2026).
 *
 * Covers: building a crew of your own people and a subcontractor crew
 * with the company that bills you; people on a crew and whose rate wins;
 * logging hours, days, and both on one entry; the rate being copied onto
 * the entry so a later rise never rewrites what a day cost; unpaid time
 * counting as Committed and paid time as Spent; "Mark paid through";
 * a subcontractor's hours being tracked without touching the budget, the
 * override for a sub paid by the hour, and the warning when that override
 * sits alongside their purchase order; assigning a crew to a scope of
 * work; refusing to delete a crew that has worked; and the phone layout.
 *
 * Runs against a built app (`bash scripts/dev-serve.sh`) and a local
 * Postgres that has had `prisma migrate deploy` run against it. It signs
 * up its own workspace, activates it with SQL, and deletes it again on
 * the next run, so it never touches real data. Never point it at the
 * live database.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/scb_test \
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules \
 *   node scripts/browser-tests/crews-time.cjs
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
const OUT = process.env.SHOTS_DIR || path.join(os.tmpdir(), "scb-browser-shots-crews");
fs.mkdirSync(OUT, { recursive: true });

const EMAIL = "test-crews@example.com";
const PASSWORD = "password123";
const COMPANY = "Test Crews Co";
const SLUG_LIKE = "test-crews-co%";

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
// yyyy-mm-dd, n days back from today, for a date input.
function daysAgo(n) {
  const date = new Date();
  date.setDate(date.getDate() - n);
  return date.toISOString().slice(0, 10);
}
async function cents(locator) {
  return Number(await locator.getAttribute("data-cents"));
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

  log("seed a customer, a subcontractor's company, a deal and a quote split across two service types");
  await sql(
    `INSERT INTO "Company" (id,"organizationId",name,city,state,"updatedAt")
     VALUES ('cmp_cw','${org}','Harbor Property Group','Tampa','FL',now()),
            ('cmp_sub','${org}','Ridgeline Roofing','Tampa','FL',now())`,
  );
  await sql(
    `INSERT INTO "Contact" (id,"organizationId","companyId",name,title,email,"updatedAt")
     VALUES ('ctc_cw','${org}','cmp_cw','Dana Ruiz','Owner','dana@harbor.com',now()),
            ('ctc_sub','${org}','cmp_sub','Rick Ridge','Foreman','rick@ridgeline.com',now())`,
  );
  await sql(
    `INSERT INTO "Deal" (id,"organizationId","contactId",title,stage,"updatedAt")
     VALUES ('deal_cw','${org}','ctc_cw','Harbor reroof and locks','QUOTE_SENT',now())`,
  );
  await sql(
    `INSERT INTO "Quote" (id,"organizationId","contactId","dealId",number,title,status,"publicToken","updatedAt")
     VALUES ('quo_cw','${org}','ctc_cw','deal_cw',1000,'Harbor quote','SENT','tok_quo_cw_0123456789',now())`,
  );
  await sql(
    `INSERT INTO "QuoteLineItem" (id,"quoteId",name,quantity,"unitPriceCents",tag,"serviceType",position)
     VALUES ('qli_cw1','quo_cw','Roof replacement',1,4000000,'PROJECT_SERVICES','Roofing',0),
            ('qli_cw2','quo_cw','Smart lock install',1,1000000,'PROJECT_SERVICES','Smart Locks',1)`,
  );

  log("award the job so there is a budget for crew time to land on");
  await page.goto(`${BASE}/dashboard/deals/tracker?dealId=deal_cw`);
  await page.locator("[data-testid=tracker-row]").first().waitFor();
  await page.getByRole("checkbox", { name: "Put Roof replacement on Contract A" }).check();
  await page.getByRole("checkbox", { name: "Put Smart lock install on Contract A" }).check();
  await page.locator("[data-testid=create-contracts]").click();
  await page.waitForURL(/created=\d+/);
  const sales = (
    await sql(
      `SELECT id, "publicToken" FROM "Contract" WHERE "organizationId"=$1 AND payable=false ORDER BY number LIMIT 1`,
      [org],
    )
  ).rows[0];
  // The public page only offers a signature once the agreement is out.
  await page.goto(`${BASE}/dashboard/contracts/${sales.id}`);
  await page.getByRole("button", { name: /Mark as sent|Send for signature/ }).first().click();
  await page.getByText(/Sent/).first().waitFor();
  await signAs(browser, sales.publicToken, "Dana Ruiz");
  const projectId = (await sql(`SELECT id FROM "Project" WHERE "organizationId"=$1`, [org])).rows[0].id;
  assert.ok(projectId, "signing the agreement made the job");

  log("build a crew of your own people, with both rates and what they do");
  await page.goto(`${BASE}/dashboard/projects/crews`);
  await page.getByText("No crews yet").waitFor();
  await page.locator("[data-testid=new-crew]").click();
  await page.fill("#crew-new-name", "Install Team A");
  assert.match(
    await page.locator("[data-testid=crew-kind-hint]").textContent(),
    /hours are your cost/i,
    "the form says what your own crew means for the budget",
  );
  await page.fill("#crew-new-hourlyRate", "45.00");
  await page.fill("#crew-new-dailyRate", "520.00");
  await page.locator("[data-testid=crew-service-types]").getByRole("button", { name: "Smart Locks", exact: true }).click();
  await page.locator("[data-testid=crew-save]").click();
  // The form closes itself on a save that worked, so the card appearing
  // is the signal — there is no success message left to wait on.
  const teamA = page.locator("[data-testid=crew-card]").filter({ hasText: "Install Team A" });
  await teamA.waitFor();
  assert.match(await teamA.textContent(), /\$45\.00\/hr/, "the hourly rate reads on the card");
  assert.match(await teamA.textContent(), /\$520\.00\/day/, "the day rate reads too");

  log("a subcontractor crew carries the company that bills you, and says so");
  await page.locator("[data-testid=new-crew]").click();
  await page.fill("#crew-new-name", "Ridgeline Roofing");
  await page.selectOption("#crew-new-kind", "SUBCONTRACTOR");
  assert.match(
    await page.locator("[data-testid=crew-kind-hint]").textContent(),
    /purchase order/i,
    "the form says a sub's money comes from their order",
  );
  await page.selectOption("#crew-new-companyId", { label: "Ridgeline Roofing" });
  await page.fill("#crew-new-dailyRate", "2400.00");
  await page.locator("[data-testid=crew-service-types]").getByRole("button", { name: "Roofing", exact: true }).click();
  await page.locator("[data-testid=crew-save]").click();
  await page.getByText("Subcontractors", { exact: true }).waitFor();
  const sub = page.locator("[data-testid=crew-card]").filter({ hasText: "Bills you as" });
  assert.match(await sub.textContent(), /Ridgeline Roofing/);

  log("two people on the crew: one on the crew's rate, one on their own");
  await teamA.locator("[data-testid=crew-add-person]").click();
  await teamA.locator("[data-testid=worker-name]").fill("Marco Diaz");
  await teamA.getByLabel(/What they do/).fill("Journeyman");
  await teamA.locator("[data-testid=worker-save]").click();
  const marco = page.locator("[data-testid=worker-row]").filter({ hasText: "Marco Diaz" });
  await marco.waitFor();
  await teamA.locator("[data-testid=crew-add-person]").click();
  await teamA.locator("[data-testid=worker-name]").fill("Nia Patel");
  await teamA.locator("[data-testid=worker-hourly]").fill("62.00");
  await teamA.locator("[data-testid=worker-save]").click();
  const nia = page.locator("[data-testid=worker-row]").filter({ hasText: "Nia Patel" });
  await nia.waitFor();
  assert.match(await marco.textContent(), /the crew's rate/, "no own rate means the crew's, and the row says so");
  assert.match(await nia.textContent(), /\$62\.00\/hr/, "her own hourly rate wins");
  assert.match(await nia.textContent(), /\$520\.00\/day/, "the crew's day rate still applies to her");
  await shot(page, "01-crews");

  log("the Crew & time tab opens from the job, with nothing logged");
  await page.goto(`${BASE}/dashboard/projects/${projectId}`);
  await page.locator("[data-testid=tab-crew]").click();
  await page.waitForURL(/\/crew$/);
  await page.getByText("No time logged yet").waitFor();

  log("assign the right crew to each scope, suited crews listed first");
  // Scoped by the select's own label: a crew called "Ridgeline Roofing"
  // appears as an option inside every one of them.
  const roofSelect = page.getByLabel("Crew on Roofing");
  const lockSelect = page.getByLabel("Crew on Smart Locks");
  await roofSelect.selectOption({ label: "Ridgeline Roofing (sub)" });
  await lockSelect.selectOption({ label: "Install Team A" });
  // The picker writes on change and the page revalidates, so wait for the
  // saved state in the database rather than for a flash of text.
  for (let tries = 0; tries < 40; tries += 1) {
    const rows = await sql(
      `SELECT count(*)::int AS n FROM "ProjectScope" WHERE "projectId"=$1 AND "crewId" IS NOT NULL`,
      [projectId],
    );
    if (rows.rows[0].n === 2) break;
    await page.waitForTimeout(250);
  }
  await page.reload();
  assert.equal(
    (await page.getByLabel("Crew on Roofing").locator("option:checked").textContent()).trim(),
    "Ridgeline Roofing (sub)",
  );
  const suited = await page.getByLabel("Crew on Smart Locks").locator("optgroup").first().getAttribute("label");
  assert.equal(suited, "Does Smart Locks", "the crews that do this work are grouped first");

  log("the Budget tab shows the assigned crew instead of an empty box");
  await page.goto(`${BASE}/dashboard/projects/${projectId}`);
  const names = await page.locator("[data-testid=scope-crew-name]").allTextContents();
  assert.deepEqual(names.sort(), ["Install Team A", "Ridgeline Roofing"], "both scopes read their crew");

  log("picking a crew moves the scope to the one they are on");
  await page.goto(`${BASE}/dashboard/projects/${projectId}/crew`);
  await page.selectOption("#log-crewId", { label: "Ridgeline Roofing (sub)" });
  assert.equal(
    (await page.locator("[data-testid=log-scope] option:checked").textContent()).trim(),
    "Roofing",
    "the sub is on the roofing scope, so that is what the form offers",
  );
  await page.selectOption("#log-crewId", { label: "Install Team A" });
  assert.equal(
    (await page.locator("[data-testid=log-scope] option:checked").textContent()).trim(),
    "Smart Locks",
    "and switching crews follows them to theirs",
  );

  log("log a day for the whole crew: the day rate, on the right scope");
  await page.locator("[data-testid=log-days]").fill("1");
  assert.match(await page.locator("[data-testid=log-preview]").textContent(), /\$520\.00/, "the cost is worked out as you type");
  await page.locator("[data-testid=log-worked-on]").fill(daysAgo(3));
  await page.locator("[data-testid=log-note]").fill("Locks on floors 1 and 2");
  await page.locator("[data-testid=log-time-save]").click();
  await page.getByText(/1 day logged/).waitFor();
  await page.reload();
  const firstRow = page.locator("[data-testid=time-row]").first();
  assert.equal(await cents(firstRow.locator("[data-testid=time-amount]")), 52000);
  assert.match(await firstRow.textContent(), /Smart Locks/);
  assert.match(await firstRow.textContent(), /To pay/, "time starts unpaid");

  log("hours and days on one entry, at one person's own rate");
  await page.selectOption("#log-workerId", { label: "Nia Patel" });
  await page.locator("[data-testid=log-days]").fill("2");
  await page.locator("[data-testid=log-hours]").fill("4");
  // 2 days at the crew's $520 + 4 hours at her own $62.
  assert.match(await page.locator("[data-testid=log-preview]").textContent(), /\$1,288\.00/);
  await page.locator("[data-testid=log-worked-on]").fill(daysAgo(1));
  await page.locator("[data-testid=log-time-save]").click();
  await page.getByText(/2 days · 4 hrs logged/).waitFor();
  await page.reload();
  const niaRow = page.locator("[data-testid=time-row]").filter({ hasText: "Nia Patel" });
  assert.equal(await cents(niaRow.locator("[data-testid=time-amount]")), 128800);

  log("unpaid crew time is Committed on the budget, not Spent");
  let totals = (
    await sql(
      `SELECT "spentCents","committedCents","laborSpentCents","laborCommittedCents" FROM "Project" WHERE id=$1`,
      [projectId],
    )
  ).rows[0];
  assert.equal(totals.laborCommittedCents, 52000 + 128800, "both entries are waiting to be paid");
  assert.equal(totals.laborSpentCents, 0);
  assert.equal(totals.committedCents, 52000 + 128800, "crew time is part of Committed");
  assert.equal(totals.spentCents, 0);

  log("the job's Budget bar explains the crew-time part of it");
  await page.goto(`${BASE}/dashboard/projects/${projectId}`);
  assert.match(
    await page.locator("[data-testid=project-labor]").textContent(),
    /\$1,808\.00/,
    "Of which crew time reads the sum of both entries",
  );

  log("marking one entry paid moves it from Committed to Spent");
  await page.goto(`${BASE}/dashboard/projects/${projectId}/crew`);
  await niaRow.locator("[data-testid=time-toggle-paid]").click();
  await niaRow.getByText("Paid", { exact: true }).waitFor();
  totals = (
    await sql(`SELECT "spentCents","committedCents","laborSpentCents" FROM "Project" WHERE id=$1`, [projectId])
  ).rows[0];
  assert.equal(totals.laborSpentCents, 128800);
  assert.equal(totals.spentCents, 128800);
  assert.equal(totals.committedCents, 52000, "only the other entry is still committed");

  log("a rate rise does not rewrite what an already-logged day cost");
  await page.goto(`${BASE}/dashboard/projects/crews`);
  await teamA.locator("[data-testid=crew-edit]").click();
  const teamAId = await teamA.getAttribute("data-crew-id");
  await page.fill(`#crew-${teamAId}-dailyRate`, "600.00");
  await teamA.locator("[data-testid=crew-save]").click();
  // The edit form closes on success and the card comes back with the new
  // rate in its subtitle.
  await teamA.getByText(/\$600\.00\/day/).first().waitFor();
  const kept = (
    await sql(`SELECT "dailyRateCents","amountCents" FROM "TimeEntry" WHERE "amountCents"=52000 AND "organizationId"=$1`, [org])
  ).rows[0];
  assert.equal(kept.dailyRateCents, 52000, "the old rate stayed on the old entry");
  assert.equal(kept.amountCents, 52000);

  log("a day logged after the rise uses the new rate");
  await page.goto(`${BASE}/dashboard/projects/${projectId}/crew`);
  await page.selectOption("#log-crewId", { label: "Install Team A" });
  await page.locator("[data-testid=log-days]").fill("1");
  await page.locator("[data-testid=log-worked-on]").fill(daysAgo(0));
  await page.locator("[data-testid=log-time-save]").click();
  await page.getByText(/1 day logged/).waitFor();
  const newest = (
    await sql(
      `SELECT "dailyRateCents","amountCents" FROM "TimeEntry" WHERE "organizationId"=$1 ORDER BY "createdAt" DESC LIMIT 1`,
      [org],
    )
  ).rows[0];
  assert.equal(newest.amountCents, 60000, "today's day costs the new rate");

  log("Mark paid through settles everything up to a day, and nothing after it");
  await page.reload();
  await page.locator("[data-testid=paid-through-date]").fill(daysAgo(2));
  await page.locator("[data-testid=paid-through-save]").click();
  await page.getByText(/1 entry marked paid/).waitFor();
  const unpaid = (
    await sql(
      `SELECT count(*)::int AS n FROM "TimeEntry" WHERE "organizationId"=$1 AND "paidOn" IS NULL AND "countsAsCost"`,
      [org],
    )
  ).rows[0].n;
  assert.equal(unpaid, 1, "only today's entry is still waiting");

  log("a subcontractor's hours are tracked but stay off the budget");
  const before = (await sql(`SELECT "committedCents","spentCents" FROM "Project" WHERE id=$1`, [projectId])).rows[0];
  await page.selectOption("#log-crewId", { label: "Ridgeline Roofing (sub)" });
  await page.locator("[data-testid=log-scope]").selectOption({ label: "Roofing" });
  await page.locator("[data-testid=log-days]").fill("3");
  await page.locator("[data-testid=log-hours]").fill("");
  assert.match(
    await page.locator("[data-testid=log-preview]").textContent(),
    /tracked only/i,
    "the form says it will not touch the budget",
  );
  await page.locator("[data-testid=log-time-save]").click();
  await page.getByText(/tracked but not added to the budget/).waitFor();
  const after = (await sql(`SELECT "committedCents","spentCents" FROM "Project" WHERE id=$1`, [projectId])).rows[0];
  assert.equal(after.committedCents, before.committedCents, "the budget did not move");
  assert.equal(after.spentCents, before.spentCents);
  await page.reload();
  const subRow = page.locator("[data-testid=time-row]").filter({ hasText: "Ridgeline Roofing" }).first();
  assert.match(await subRow.textContent(), /Tracked only/);
  assert.match(await subRow.textContent(), /\$7,200\.00/, "their time is still valued at their rate");

  log("a sub paid by the hour can be counted, and then the double-count warning appears");
  await sql(
    `INSERT INTO "Contract" (id,"organizationId","contactId","companyId","projectId",number,title,type,payable,status,body,"publicToken","updatedAt")
     VALUES ('con_sub','${org}','ctc_sub','cmp_sub','${projectId}',9001,'Ridgeline reroof','Purchase Order',true,'SENT','','tok_con_sub_012345',now())`,
  );
  await sql(
    `INSERT INTO "ContractPayment" (id,"organizationId","contractId",label,kind,"amountCents",position)
     VALUES ('cp_sub','${org}','con_sub','Due on invoice','BALANCE',3600000,0)`,
  );
  await page.reload();
  await page.selectOption("#log-crewId", { label: "Ridgeline Roofing (sub)" });
  await page.locator("[data-testid=log-days]").fill("1");
  await page.locator("[data-testid=log-counts-as-cost]").locator("input").check();
  await page.locator("[data-testid=log-time-save]").click();
  // "on the job" alone also matches the "Crew time on the job" tile, so
  // wait on the wording only a saved entry produces.
  await page.getByText(/day logged — /).waitFor();
  await page.reload();
  assert.match(
    await page.locator("[data-testid=double-count-warning]").textContent(),
    /Ridgeline Roofing has hours counted as a cost and a purchase order/,
    "the one mistake that doubles a cost is called out",
  );

  log("the tiles add up: counted time, paid, still to pay, and subs tracked only");
  const tiles = await page.locator("[data-testid=stat-tile]").allTextContents();
  const joined = tiles.join(" | ");
  assert.match(joined, /Subs, tracked only/);
  assert.match(joined, /\$7,200\.00/, "the sub's uncounted time is shown on its own");

  log("deleting paid time is refused; the entry has to be unpaid first");
  await niaRow.locator("[data-testid=time-delete]").click();
  await page.getByText(/That time has been paid/).waitFor();
  await niaRow.locator("[data-testid=time-toggle-paid]").click();
  await niaRow.getByText("To pay", { exact: true }).waitFor();

  log("deleting a crew that has worked is refused, and retiring it is offered instead");
  await page.goto(`${BASE}/dashboard/projects/crews`);
  await teamA.locator("[data-testid=crew-delete]").click();
  await page.getByText(/Retire them instead/).waitFor();
  assert.match(
    await teamA.locator("[data-testid=crew-days-logged]").textContent(),
    /entries logged/,
    "the card says how much they have worked",
  );

  log("retiring a crew takes it off the pickers but leaves its cost on the job");
  const spentBefore = (await sql(`SELECT "spentCents" FROM "Project" WHERE id=$1`, [projectId])).rows[0].spentCents;
  await teamA.locator("[data-testid=crew-retire]").click();
  await teamA.getByText("Retired", { exact: true }).waitFor();
  await page.goto(`${BASE}/dashboard/projects/${projectId}/crew`);
  const options = await page.locator("#log-crewId option").allTextContents();
  assert.ok(!options.some((name) => name.includes("Install Team A")), "a retired crew is off the picker");
  assert.equal(
    (await sql(`SELECT "spentCents" FROM "Project" WHERE id=$1`, [projectId])).rows[0].spentCents,
    spentBefore,
    "retiring changed no money",
  );
  await page.goto(`${BASE}/dashboard/projects/crews`);
  await teamA.locator("[data-testid=crew-retire]").click();
  await teamA.getByText("Retired", { exact: true }).waitFor({ state: "detached" });

  log("a person with time logged cannot be deleted either");
  await page.reload();
  await nia.getByLabel("Delete Nia Patel").click();
  await page.getByText(/Take them off the crew instead/).waitFor();

  log("recompute-projects agrees with every number the app stored");
  const { execSync } = require("node:child_process");
  const out = execSync("npm run recompute-projects --silent -- --check", {
    cwd: path.resolve(__dirname, "..", ".."),
    env: { ...process.env, DATABASE_URL: DB },
  }).toString();
  assert.match(out, /every number already right/, `recompute reported drift:\n${out}`);

  log("no rate on file is refused with what to do about it");
  await sql(
    `INSERT INTO "Crew" (id,"organizationId",name,kind,"updatedAt")
     VALUES ('crw_norate','${org}','Rate-less Crew','OWN',now())`,
  );
  await page.goto(`${BASE}/dashboard/projects/${projectId}/crew`);
  await page.selectOption("#log-crewId", { label: "Rate-less Crew" });
  await page.locator("[data-testid=log-hours]").fill("5");
  await page.locator("[data-testid=log-time-save]").click();
  await page.getByText(/No rate on file for Rate-less Crew/).waitFor();

  log("logging nothing at all is refused");
  await page.selectOption("#log-crewId", { label: "Install Team A" });
  await page.locator("[data-testid=log-hours]").fill("");
  await page.locator("[data-testid=log-days]").fill("");
  await page.locator("[data-testid=log-time-save]").click();
  await page.getByText("Enter the hours, the days, or both.").waitFor();

  log("hours against a crew with only a day rate says so rather than reading as free work");
  await sql(`UPDATE "Crew" SET "hourlyRateCents"=NULL, "dailyRateCents"=40000 WHERE id='crw_norate'`);
  await page.reload();
  await page.selectOption("#log-crewId", { label: "Rate-less Crew" });
  await page.locator("[data-testid=log-hours]").fill("5");
  const missing = await page.locator("[data-testid=log-preview]").textContent();
  assert.match(missing, /no hourly rate on file/, "the form names the missing rate");
  assert.ok(!missing.includes("$0.00"), "and never shows the work as costing nothing");
  await page.locator("[data-testid=log-time-save]").click();
  await page.getByText(/no hourly rate — log it in days/).waitFor();

  log("the Crew & time tab and the crews page fit a phone screen");
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const small = await phone.newPage();
  await small.goto(`${BASE}/login`);
  await small.fill("#email", EMAIL);
  await small.fill("#password", PASSWORD);
  await small.click("button[type=submit]");
  await small.waitForURL(/\/dashboard$/);
  for (const [url, name] of [
    [`${BASE}/dashboard/projects/${projectId}/crew`, "02-phone-crew-tab"],
    [`${BASE}/dashboard/projects/crews`, "03-phone-crews"],
  ]) {
    await small.goto(url);
    await small.locator("h1").first().waitFor();
    const overflow = await small.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    assert.ok(overflow <= 1, `${name} overflows by ${overflow}px`);
    await shot(small, name);
  }
  await phone.close();

  await shot(page, "04-crew-tab");
  await browser.close();
  console.log(`\nALL ${step} STEPS PASSED · screenshots in ${OUT}`);
  process.exit(0);
})().catch(async (error) => {
  console.error(`\nFAILED at step ${step} \n`, error);
  process.exit(1);
});
