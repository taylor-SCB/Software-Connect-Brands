/* Browser regression for Property budgets, Close out, job notes and the
 * job merge fields (Sept 14, 2026).
 *
 * Covers: a property with several jobs at it, and a roll-up that is the
 * sum of those jobs' own numbers; the stage chips that decide what counts,
 * with cancelled work left out by default and the choice living in the
 * address bar; a job belonging to one property only, so picking it on a
 * second building moves it rather than double-counting it; the picker on
 * the job's own page; jobs at no property being called out; deleting a
 * property leaving its jobs alone; Close out with its list of loose ends,
 * the note it records, and reopening; notes on a job; and {{project_number}}
 * resolving on a change order.
 *
 * Runs against a built app (`bash scripts/dev-serve.sh`) and a local
 * Postgres that has had `prisma migrate deploy` run against it. It signs
 * up its own workspace, activates it with SQL, and — unlike the others —
 * deletes it again when it finishes rather than on the next run. Its
 * budgets are seeded by hand with no paperwork behind them, and every
 * other suite checks that `recompute-projects --check` finds no drift
 * anywhere, so this workspace must not outlive the run. Never point it
 * at the live database.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/scb_test \
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules \
 *   node scripts/browser-tests/properties-closeout.cjs
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
const OUT = process.env.SHOTS_DIR || path.join(os.tmpdir(), "scb-browser-shots-props");
fs.mkdirSync(OUT, { recursive: true });

const EMAIL = "test-props@example.com";
const PASSWORD = "password123";
const COMPANY = "Test Properties Co";
const SLUG_LIKE = "test-properties-co%";

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
async function cents(locator, attr = "data-awarded") {
  return Number(await locator.getAttribute(attr));
}
function today() {
  return new Date().toISOString().slice(0, 10);
}
// The picker writes on change and the page revalidates, so wait for the
// saved value rather than for a link that was already on the screen.
async function waitForProperty(page, projectId, expected) {
  for (let tries = 0; tries < 40; tries += 1) {
    const row = await sql(`SELECT "propertyId" FROM "Project" WHERE id=$1`, [projectId]);
    if (row.rows[0].propertyId === expected) return;
    await page.waitForTimeout(250);
  }
  assert.fail(`${projectId} never landed on ${expected ?? "no property"}`);
}

(async () => {
  await sql(`DELETE FROM "Organization" WHERE slug LIKE $1`, [SLUG_LIKE]);

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1500, height: 1050 } });
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

  log("seed a customer and four jobs at known amounts, one of them cancelled");
  await sql(
    `INSERT INTO "Company" (id,"organizationId",name,city,state,"updatedAt")
     VALUES ('cmp_pr','${org}','Harbor Property Group','Tampa','FL',now())`,
  );
  await sql(
    `INSERT INTO "Contact" (id,"organizationId","companyId",name,title,email,"updatedAt")
     VALUES ('ctc_pr','${org}','cmp_pr','Dana Ruiz','Owner','dana@harbor.com',now())`,
  );
  // The numbers are seeded directly so the roll-up arithmetic is exact:
  // the awarding path itself is covered by projects-core.
  const jobs = [
    ["prj_a", 1000, "Tower B reroof", "COMPLETED", 4000000, 3000000, 200000, 4000000, 3500000],
    ["prj_b", 1001, "Tower B rekey", "ACTIVE", 1000000, 250000, 150000, 500000, 250000],
    ["prj_c", 1002, "Tower B lobby paint", "ON_HOLD", 600000, 0, 0, 0, 0],
    ["prj_d", 1003, "Tower B cameras", "CANCELLED", 900000, 0, 0, 0, 0],
  ];
  for (const [id, number, name, stage, awarded, spent, committed, billed, received] of jobs) {
    await sql(
      `INSERT INTO "Project" (id,"organizationId",number,name,stage,"companyId","contactId","customerName","awardedAt","awardedCents","spentCents","committedCents","billedCents","receivedCents","updatedAt")
       VALUES ($1,$2,$3,$4,$5,'cmp_pr','ctc_pr','Harbor Property Group · Dana Ruiz',now(),$6,$7,$8,$9,$10,now())`,
      [id, org, number, name, stage, awarded, spent, committed, billed, received],
    );
    await sql(
      `INSERT INTO "ProjectScope" (id,"projectId",name,"isDefault",position,"awardedCents","spentCents","committedCents")
       VALUES ($1,$2,'Whole job',true,0,$3,$4,$5)`,
      [`scp_${id}`, id, awarded, spent, committed],
    );
  }

  log("a job at no property is called out rather than silently left out");
  await page.goto(`${BASE}/dashboard/projects/properties`);
  await page.getByText("No properties yet").waitFor();
  assert.match(
    await page.locator("[data-testid=loose-jobs]").textContent(),
    /4 jobs are at no property/,
    "nothing is quietly missing from every total",
  );

  log("make a property");
  await page.locator("[data-testid=new-property]").click();
  await page.locator("[data-testid=property-name]").fill("Beachfront Lofts — Tower B");
  await page.locator("[data-testid=property-address]").fill("1400 Harbor Blvd");
  await page.locator("[data-testid=property-company]").selectOption({ label: "Harbor Property Group" });
  await page.locator("[data-testid=property-save]").click();
  await page.locator("[data-testid=property-row]").waitFor();
  const propertyId = await page.locator("[data-testid=property-row]").getAttribute("data-property-id");
  assert.ok(propertyId);

  log("put three of the four jobs at it");
  await page.goto(`${BASE}/dashboard/projects/properties/${propertyId}`);
  await page.locator("[data-testid=pick-jobs]").click();
  for (const name of ["Tower B reroof", "Tower B rekey", "Tower B lobby paint"]) {
    await page.getByRole("checkbox", { name: new RegExp(name) }).check();
  }
  await page.locator("[data-testid=pick-jobs-save]").click();
  await page.locator("[data-testid=property-job]").first().waitFor();
  assert.equal(
    (await sql(`SELECT count(*)::int AS n FROM "Project" WHERE "propertyId"=$1`, [propertyId])).rows[0].n,
    3,
  );

  log("the roll-up is the sum of those jobs' own numbers");
  // 4,000,000 + 1,000,000 + 600,000 = 5,600,000 awarded.
  assert.equal(await cents(page.locator("[data-testid=property-rollup]")), 5600000);
  assert.match(
    await page.locator("[data-testid=property-owed]").textContent(),
    /\$7,500\.00/,
    "billed 4,500,000 less collected 3,750,000",
  );
  await shot(page, "01-property");

  log("cancelled work is left out by default, and turning it on changes the total");
  await page.locator("[data-testid=pick-jobs]").click();
  await page.getByRole("checkbox", { name: /Tower B cameras/ }).check();
  await page.locator("[data-testid=pick-jobs-save]").click();
  await page.locator("[data-testid=property-job]").nth(3).waitFor();
  assert.equal(
    await cents(page.locator("[data-testid=property-rollup]")),
    5600000,
    "the cancelled job is at the property but not in the total",
  );
  const cancelledRow = page.locator("[data-testid=property-job]").filter({ hasText: "cameras" });
  assert.equal(await cancelledRow.getAttribute("data-counted"), "false");
  assert.match(await cancelledRow.textContent(), /Cancelled is not being counted/);

  log("switching Cancelled on adds it, and the choice lives in the address bar");
  await page.locator("[data-testid=stage-chip-CANCELLED]").click();
  await page.waitForURL(/stages=/);
  await page.waitForFunction(
    () => document.querySelector("[data-testid=property-rollup]")?.getAttribute("data-awarded") === "6500000",
  );
  assert.equal(await cents(page.locator("[data-testid=property-rollup]")), 6500000);
  await page.locator("[data-testid=stage-chips-reset]").click();
  await page.waitForFunction(
    () => document.querySelector("[data-testid=property-rollup]")?.getAttribute("data-awarded") === "5600000",
  );

  log("turning every stage off is refused: the last one stays on");
  for (const stage of ["AWARDED", "ACTIVE", "ON_HOLD", "COMPLETED"]) {
    await page.locator(`[data-testid=stage-chip-${stage}]`).click();
    await page.waitForTimeout(150);
  }
  const onChips = await page
    .locator("[data-testid=stage-chips] [aria-pressed=true]")
    .count();
  assert.ok(onChips >= 1, "something is always being counted");

  log("a job belongs to one property, so a second building moves it rather than sharing it");
  await page.goto(`${BASE}/dashboard/projects/properties`);
  await page.locator("[data-testid=new-property]").click();
  await page.locator("[data-testid=property-name]").fill("Beachfront Lofts — Tower C");
  await page.locator("[data-testid=property-save]").click();
  await page.locator("[data-testid=property-row]").nth(1).waitFor();
  const towerC = (
    await sql(`SELECT id FROM "Property" WHERE "organizationId"=$1 AND name LIKE '%Tower C%'`, [org])
  ).rows[0].id;
  await page.goto(`${BASE}/dashboard/projects/properties/${towerC}`);
  await page.locator("[data-testid=pick-jobs]").click();
  await page.getByRole("checkbox", { name: /Tower B rekey/ }).check();
  assert.match(
    await page.locator("[data-testid=pick-jobs-moving]").textContent(),
    /1 job will move here from another property/,
    "the screen says it is a move, not a copy",
  );
  await page.locator("[data-testid=pick-jobs-save]").click();
  await page.locator("[data-testid=property-job]").first().waitFor();
  assert.equal(
    (await sql(`SELECT "propertyId" FROM "Project" WHERE id='prj_b'`)).rows[0].propertyId,
    towerC,
    "the job moved",
  );

  log("and Tower B's total drops by exactly that job");
  await page.goto(`${BASE}/dashboard/projects/properties/${propertyId}`);
  assert.equal(
    await cents(page.locator("[data-testid=property-rollup]")),
    4600000,
    "5,600,000 less the 1,000,000 job that moved",
  );

  log("the job's own page picks its property, and links to it");
  await page.goto(`${BASE}/dashboard/projects/prj_c`);
  await page.locator("[data-testid=project-property]").selectOption(towerC);
  await waitForProperty(page, "prj_c", towerC);
  await page.locator("[data-testid=project-property]").selectOption(propertyId);
  await waitForProperty(page, "prj_c", propertyId);

  log("deleting a property leaves every job at it exactly as it was");
  await page.goto(`${BASE}/dashboard/projects/properties/${towerC}`);
  await page.locator("[data-testid=delete-record]").click();
  await page.waitForURL(/\/properties$/);
  assert.equal(
    (await sql(`SELECT count(*)::int AS n FROM "Property" WHERE id=$1`, [towerC])).rows[0].n,
    0,
  );
  assert.equal(
    (await sql(`SELECT count(*)::int AS n FROM "Project" WHERE id='prj_b'`)).rows[0].n,
    1,
    "its job is untouched",
  );
  assert.equal(
    (await sql(`SELECT "propertyId" FROM "Project" WHERE id='prj_b'`)).rows[0].propertyId,
    null,
    "and belongs to no property now",
  );

  log("notes on a job are kept with the job");
  await page.goto(`${BASE}/dashboard/projects/prj_a`);
  await page.locator("[data-testid=project-note-body]").fill("Owner wants the north side done first.");
  await page.locator("[data-testid=project-note-add]").click();
  await page.locator("[data-testid=project-note]").waitFor();
  assert.match(
    await page.locator("[data-testid=project-note]").textContent(),
    /Owner wants the north side done first/,
  );
  assert.equal(
    (await sql(`SELECT count(*)::int AS n FROM "Note" WHERE "projectId"='prj_a'`)).rows[0].n,
    1,
  );

  log("and can be removed again");
  await page.locator("[data-testid=project-note-delete]").click();
  await page.locator("[data-testid=project-note]").waitFor({ state: "detached" });
  assert.equal(
    (await sql(`SELECT count(*)::int AS n FROM "Note" WHERE "projectId"='prj_a'`)).rows[0].n,
    0,
  );

  log("Close out lists the loose ends without blocking on any of them");
  // Something real to be owed: a signed agreement with an unpaid row.
  await sql(
    `INSERT INTO "ContractTemplate" (id,"organizationId",name,type,body,"updatedAt")
     VALUES ('tpl_pr','${org}','Sales Order','Sales Order','Body',now())`,
  );
  await sql(
    `INSERT INTO "Contract" (id,"organizationId","contactId","companyId","projectId","templateId",number,title,type,payable,status,body,"publicToken","signedAt","updatedAt")
     VALUES ('con_pr','${org}','ctc_pr','cmp_pr','prj_b','tpl_pr',1000,'Tower B rekey','Sales Order',false,'SIGNED','Body','tok_con_pr_0123456',now(),now())`,
  );
  await sql(
    `INSERT INTO "ContractPayment" (id,"organizationId","contractId",label,kind,"amountCents",position)
     VALUES ('cp_pr','${org}','con_pr','Balance','BALANCE',400000,0)`,
  );
  // The app hands out contract numbers from this counter, so a contract
  // seeded by hand has to move it on — otherwise the next real one
  // collides on (organizationId, number).
  await sql(`UPDATE "Organization" SET "nextContractNumber"=1001 WHERE id=$1`, [org]);
  await sql(
    `INSERT INTO "ProjectTask" (id,"organizationId","projectId",title,position,"updatedAt")
     VALUES ('tsk_pr','${org}','prj_b','Call for the final inspection',0,now())`,
  );
  await page.goto(`${BASE}/dashboard/projects/prj_b`);
  await page.locator("[data-testid=close-out]").click();
  const items = page.locator("[data-testid=close-out-item]");
  await items.first().waitFor();
  const kinds = await items.evaluateAll((rows) => rows.map((row) => row.getAttribute("data-kind")));
  assert.ok(kinds.includes("owed"), `expected money owed in the list, got ${kinds.join(", ")}`);
  assert.ok(kinds.includes("tasks"), "and the thing still on the list");
  assert.match(
    await page.locator("[data-testid=close-out-open-items]").textContent(),
    /None of it stops you/,
    "the list informs, it does not block",
  );
  await shot(page, "02-close-out");

  log("closing it out records the note, the day, and the stage");
  await page.locator("[data-testid=close-out-note]").fill("Walked it with Dana. Punch list signed off.");
  await page.locator("[data-testid=close-out-confirm]").click();
  await page.locator("[data-testid=close-out-done]").waitFor();
  const closed = (
    await sql(`SELECT stage,"closedAt","closeOutNote" FROM "Project" WHERE id='prj_b'`)
  ).rows[0];
  assert.equal(closed.stage, "COMPLETED");
  assert.ok(closed.closedAt !== null, "the day it closed is stamped");
  assert.match(closed.closeOutNote, /Punch list signed off/);

  log("closing out twice is refused");
  const again = page.locator("[data-testid=close-out]");
  assert.equal(await again.count(), 0, "the button is gone once it is closed");

  log("reopening puts it back to Active and keeps the closing note as history");
  await page.locator("[data-testid=reopen-project]").click();
  await page.locator("[data-testid=close-out]").waitFor();
  const reopened = (
    await sql(`SELECT stage,"closedAt","closeOutNote" FROM "Project" WHERE id='prj_b'`)
  ).rows[0];
  assert.equal(reopened.stage, "ACTIVE");
  assert.equal(reopened.closedAt, null);
  assert.match(reopened.closeOutNote, /Punch list signed off/, "the note stays as history");

  log("work never given a day on the calendar counts as a loose end");
  await page.goto(`${BASE}/dashboard/projects/prj_c`);
  await page.locator("[data-testid=close-out]").click();
  const beforeSchedule = await page
    .locator("[data-testid=close-out-item]")
    .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-kind")));
  assert.deepEqual(beforeSchedule, ["unscheduled"], "nothing was ever scheduled on this one");

  log("a job with nothing open at all closes clean");
  // Book the install, and the last loose end goes away.
  await sql(
    `INSERT INTO "CalendarEvent" (id,"organizationId",title,type,"startOn","projectId","scopeId","updatedAt")
     VALUES ('evt_pr','${org}','Tower B lobby paint','Install','${today()}','prj_c','scp_prj_c',now())`,
  );
  await page.goto(`${BASE}/dashboard/projects/prj_c`);
  await page.locator("[data-testid=close-out]").click();
  await page.locator("[data-testid=close-out-clean]").waitFor();
  await page.locator("[data-testid=close-out-confirm]").click();
  await page.locator("[data-testid=close-out-done]").waitFor();
  assert.equal((await sql(`SELECT stage FROM "Project" WHERE id='prj_c'`)).rows[0].stage, "COMPLETED");

  log("{{project_number}} is offered as a merge field and resolves on a change order");
  await page.goto(`${BASE}/dashboard/contracts/templates/new`);
  await page.locator("h1").first().waitFor();
  const palette = await page.content();
  assert.ok(palette.includes("project_number"), "the job number is in the merge palette");
  await sql(
    `UPDATE "ContractTemplate" SET body='Job {{project_number}} — {{project_name}}'
     WHERE "organizationId"=$1 AND type='Change Order'`,
    [org],
  );
  await page.goto(`${BASE}/dashboard/projects/prj_a/money`);
  await page.locator("[data-testid=add-change-order]").click();
  await page.locator("[data-testid=change-description]").fill("Extra flashing");
  await page.locator("[data-testid=change-amount]").fill("1200");
  await page.locator("[data-testid=change-save]").click();
  await page.getByText(/added to/).first().waitFor();
  const body = (
    await sql(
      `SELECT body FROM "Contract" WHERE "organizationId"=$1 AND type='Change Order' ORDER BY number DESC LIMIT 1`,
      [org],
    )
  ).rows[0].body;
  assert.match(body, /Job PRJ-1000 — Tower B reroof/, `the job number merged in; got: ${body}`);

  log("recompute-projects catches numbers that no paperwork backs up");
  // This suite seeds its budgets by hand so the roll-up arithmetic is
  // exact, which means nothing on paper explains them — exactly the case
  // the drift check exists to catch. The other suites prove the opposite
  // direction, that money entered through the app always ties out.
  const { execSync } = require("node:child_process");
  const out = execSync("npm run recompute-projects --silent -- --check", {
    cwd: path.resolve(__dirname, "..", ".."),
    env: { ...process.env, DATABASE_URL: DB },
  }).toString();
  assert.match(out, /PRJ-1003 Tower B cameras/, `expected the hand-seeded job to be flagged:\n${out}`);
  assert.match(out, /would change/, "and --check reports rather than rewrites");
  // --check puts the stored numbers back, so the page still reads the
  // same afterwards.
  assert.equal(
    (await sql(`SELECT "awardedCents" FROM "Project" WHERE id='prj_d'`)).rows[0].awardedCents,
    900000,
    "--check left the stored numbers alone",
  );

  log("cross-tenant: another workspace's property is a 404");
  await sql(
    `INSERT INTO "Organization" (id,name,slug,status,"updatedAt")
     VALUES ('org_pr_other','Other Props Co','test-properties-co-other','ACTIVE',now())`,
  );
  await sql(
    `INSERT INTO "Property" (id,"organizationId",name,"updatedAt")
     VALUES ('prop_other','org_pr_other','Somebody elses tower',now())`,
  );
  const response = await page.goto(`${BASE}/dashboard/projects/properties/prop_other`);
  assert.equal(response.status(), 404, "another workspace's property is not reachable");
  await sql(`DELETE FROM "Organization" WHERE id='org_pr_other'`);

  log("the properties list and a property fit a phone screen");
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const small = await phone.newPage();
  await small.goto(`${BASE}/login`);
  await small.fill("#email", EMAIL);
  await small.fill("#password", PASSWORD);
  await small.click("button[type=submit]");
  await small.waitForURL(/\/dashboard$/);
  for (const [url, name] of [
    [`${BASE}/dashboard/projects/properties`, "03-phone-properties"],
    [`${BASE}/dashboard/projects/properties/${propertyId}`, "04-phone-property"],
    [`${BASE}/dashboard/projects/prj_a`, "05-phone-job"],
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

  await browser.close();

  // This suite is the one that cleans up after itself. Its budgets are
  // seeded by hand with no paperwork behind them, and every other suite
  // asserts that `recompute-projects --check` finds no drift across the
  // whole database — so leaving this workspace behind would fail them.
  await sql(`DELETE FROM "Organization" WHERE slug LIKE $1`, [SLUG_LIKE]);

  console.log(`\nALL ${step} STEPS PASSED · screenshots in ${OUT}`);
  process.exit(0);
})().catch(async (error) => {
  console.error(`\nFAILED at step ${step} \n`, error);
  process.exit(1);
});
