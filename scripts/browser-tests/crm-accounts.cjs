/* Browser regression for "Users vs Company", release 2 (Sept 30, 2026).
 *
 * Covers: "+ Additional Account" on a contact — the company search shows
 * City, State, several can be ticked at once, a new company can be added
 * on the spot, the links show on the contact and tag the person on each
 * company's People list, and one can be unlinked; the company page's Add
 * person search — existing people with their email and phone, linking
 * someone with no company as their main one and someone with a company
 * as an additional account; the duplicate check on a new contact's name;
 * a custom industry and company type left unsaved (on the company, not on
 * the pick list, marked Custom) and saved (on the pick list); an activity
 * logged from a company page on people ticked there, including a contact
 * added on the spot; Merge Contacts and Merge Companies moving everything
 * onto the one kept.
 *
 * Runs against a built app (`bash scripts/dev-serve.sh`) and a local
 * Postgres that has had `prisma migrate deploy` run against it. It signs
 * up its own workspace and deletes it again on the next run. Never point
 * it at the live database.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/scb_test \
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules \
 *   node scripts/browser-tests/crm-accounts.cjs
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
const OUT = process.env.SHOTS_DIR || path.join(os.tmpdir(), "scb-browser-shots-crm-accounts");
fs.mkdirSync(OUT, { recursive: true });

const EMAIL = "test-crmaccounts@example.com";
const PASSWORD = "password123";
const COMPANY = "Test CRM Accounts Co";

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
function chip(page, name) {
  return page.getByRole("checkbox", { name, exact: true });
}
async function until(fn, what) {
  for (let i = 0; i < 40; i += 1) {
    if (await fn()) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`timed out waiting for ${what}`);
}

(async () => {
  await sql(`DELETE FROM "Organization" WHERE slug LIKE 'test-crm-accounts-co%'`);

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (err) => console.error("PAGE ERROR:", err.message));

  log("signup + activate + login");
  await page.goto(`${BASE}/signup`);
  await page.fill("[name=companyName]", COMPANY);
  await page.fill("[name=name]", "Taylor Test");
  await page.fill("[name=email]", EMAIL);
  await page.fill("[name=phone]", "5550000000");
  await page.fill("[name=password]", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/signup\/submitted/);
  await sql(`UPDATE "Organization" SET status='ACTIVE', "reviewedAt"=now() WHERE slug LIKE 'test-crm-accounts-co%'`);
  await page.goto(`${BASE}/login`);
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/dashboard$/);
  const org = (await sql(`SELECT id FROM "Organization" WHERE slug LIKE 'test-crm-accounts-co%'`)).rows[0].id;
  const me = (await sql(`SELECT id FROM "User" WHERE email = $1`, [EMAIL])).rows[0].id;

  // Two companies with the same name in different cities, a main company
  // for Jordan, and two Matt Smiths — one at Acme Austin, one with none.
  await sql(
    `INSERT INTO "Company" (id,"organizationId",name,city,state,industries,"updatedAt") VALUES
       ('cmp_acc_austin',$1,'Acme Roofing','Austin','TX','{MDU}',now()),
       ('cmp_acc_dallas',$1,'Acme Roofing','Dallas','TX','{Commercial}',now()),
       ('cmp_acc_main',$1,'Jordan Main LLC','Tulsa','OK','{}',now())`,
    [org],
  );
  await sql(
    `INSERT INTO "Contact" (id,"organizationId","companyId",name,email,phone,"updatedAt") VALUES
       ('ctc_acc_jordan',$1,'cmp_acc_main','Jordan Blake','jordan@main.com','555-2000',now()),
       ('ctc_acc_matt1',$1,'cmp_acc_austin','Matt Smith','matt@acme.com','555-3001',now()),
       ('ctc_acc_matt2',$1,NULL,'Matt Smith','mattsmith@gmail.com','555-3002',now())`,
    [org],
  );

  log("+ Additional Account searches companies with City, State and links several at once");
  await page.goto(`${BASE}/dashboard/contacts/ctc_acc_jordan`);
  await page.locator("[data-testid=additional-account]").click();
  const dialog = page.locator("[data-testid=additional-account-dialog]");
  await dialog.locator("[data-testid=account-search]").fill("Acme");
  await dialog.getByText("Acme Roofing · Austin, TX").waitFor();
  await dialog.getByText("Acme Roofing · Dallas, TX").waitFor();
  await dialog.locator("[data-testid=account-row]", { hasText: "Austin" }).locator("input").check();
  await dialog.locator("[data-testid=account-row]", { hasText: "Dallas" }).locator("input").check();
  log("a brand-new company can be added from the same box");
  await dialog.locator("[data-testid=account-search]").fill("Blake Ventures");
  await dialog.locator("[data-testid=account-add-new]").click();
  assert.equal(await dialog.getByLabel("New company name").inputValue(), "Blake Ventures", "the typed name carries over");
  await dialog.getByLabel("New company city").fill("Austin");
  await dialog.getByLabel("New company state").fill("texas");
  await shot(page, "01-additional-account");
  await dialog.locator("[data-testid=account-save]").click();
  await dialog.waitFor({ state: "detached" });
  const accounts = page.locator("[data-testid=additional-accounts]");
  await accounts.getByText("Blake Ventures").waitFor();
  assert.equal(await accounts.locator("li").count(), 3);
  const links = await sql(`SELECT c.name, c.city, c.state FROM "ContactAccount" ca JOIN "Company" c ON c.id = ca."companyId" WHERE ca."contactId" = 'ctc_acc_jordan' ORDER BY c.city, c.name`);
  assert.deepEqual(
    links.rows.map((r) => `${r.name}/${r.city}/${r.state}`),
    ["Acme Roofing/Austin/TX", "Blake Ventures/Austin/TX", "Acme Roofing/Dallas/TX"],
  );
  assert.equal((await sql(`SELECT "companyId" FROM "Contact" WHERE id='ctc_acc_jordan'`)).rows[0].companyId, "cmp_acc_main", "main company unchanged");

  log("the main company and linked ones show as already linked next time");
  await page.locator("[data-testid=additional-account]").click();
  await dialog.locator("[data-testid=account-search]").fill("Acme");
  await dialog.locator("[data-testid=account-row]", { hasText: "Dallas" }).getByText("already linked").waitFor();
  await page.keyboard.press("Escape");

  log("the company's People list shows Jordan tagged Additional account");
  await page.goto(`${BASE}/dashboard/companies/cmp_acc_dallas`);
  const people = page.locator("#people");
  await people.getByText("Jordan Blake").waitFor();
  assert.ok(await people.locator("li", { hasText: "Jordan Blake" }).locator("[data-testid=linked-person]").isVisible());

  log("unlinking takes the link away and nothing else");
  await page.goto(`${BASE}/dashboard/contacts/ctc_acc_jordan`);
  await accounts.locator("li", { hasText: "Dallas" }).locator("[data-testid=unlink-account]").click();
  await until(async () => (await accounts.locator("li").count()) === 2, "the Dallas link to go");
  assert.equal((await sql(`SELECT count(*)::int n FROM "Company" WHERE id='cmp_acc_dallas'`)).rows[0].n, 1);

  log("Add person on a company page searches everyone first, with email and phone");
  await page.goto(`${BASE}/dashboard/companies/cmp_acc_dallas`);
  await page.locator("[data-testid=add-person]").click();
  await page.locator("[data-testid=add-person-input]").fill("Matt Smith");
  const hits = page.locator("[data-testid=add-person-hit]");
  await hits.filter({ hasText: "mattsmith@gmail.com · 555-3002" }).waitFor();
  await hits.filter({ hasText: "matt@acme.com · 555-3001" }).waitFor();
  assert.match(await page.locator("[data-testid=add-person-new]").textContent(), /Add new person “Matt Smith” to Acme Roofing/);
  await shot(page, "02-add-person-search");
  log("someone with no company joins as their main company");
  await hits.filter({ hasText: "mattsmith@gmail.com" }).click();
  await people.getByText("Matt Smith").first().waitFor();
  assert.equal((await sql(`SELECT "companyId" FROM "Contact" WHERE id='ctc_acc_matt2'`)).rows[0].companyId, "cmp_acc_dallas");
  log("someone at another company joins as an additional account");
  await page.locator("[data-testid=add-person]").click();
  await page.locator("[data-testid=add-person-input]").fill("matt@acme");
  await hits.filter({ hasText: "matt@acme.com" }).click();
  await until(async () => (await people.locator("li", { hasText: "Matt Smith" }).count()) === 2, "both Matts listed");
  assert.equal((await sql(`SELECT "companyId" FROM "Contact" WHERE id='ctc_acc_matt1'`)).rows[0].companyId, "cmp_acc_austin", "main company kept");
  assert.equal((await sql(`SELECT count(*)::int n FROM "ContactAccount" WHERE "contactId"='ctc_acc_matt1' AND "companyId"='cmp_acc_dallas'`)).rows[0].n, 1);

  log("a new contact's name is checked against who already exists");
  await page.locator("[data-testid=add-person]").click();
  await page.locator("[data-testid=add-person-input]").fill("Jordan Bl");
  await page.locator("[data-testid=add-person-new]").click();
  await page.waitForURL(/\/dashboard\/contacts\/new\?companyId=cmp_acc_dallas&name=Jordan/);
  assert.equal(await page.locator("#name").inputValue(), "Jordan Bl");
  const dupes = page.locator("[data-testid=duplicate-matches]");
  await dupes.getByText("Jordan Blake").waitFor();
  assert.match(await dupes.textContent(), /jordan@main\.com · 555-2000 · Jordan Main LLC/);
  await shot(page, "03-duplicate-check");
  log("…and can be added to the company instead of made twice");
  await dupes.locator("[data-testid=duplicate-link]").click();
  await page.waitForURL(/\/dashboard\/companies\/cmp_acc_dallas/);
  await people.locator("li", { hasText: "Jordan Blake" }).waitFor();
  assert.equal((await sql(`SELECT count(*)::int n FROM "Contact" WHERE "organizationId"=$1 AND name LIKE 'Jordan%'`, [org])).rows[0].n, 1, "no duplicate made");

  // Regression (Sept 30, 2026): the form matched the company by name, so
  // with two Acme Roofings a person added from Dallas was filed at Austin.
  log("a new person added from one of two same-named companies is filed at that one");
  await page.goto(`${BASE}/dashboard/contacts/new?companyId=cmp_acc_dallas&name=Robin%20Hale`);
  await page.getByText("Existing").waitFor();
  await page.getByRole("button", { name: "Save contact" }).click();
  await page.waitForURL(/\/dashboard\/contacts\/(?!new)[a-z0-9]+$/);
  assert.equal(
    (await sql(`SELECT "companyId" FROM "Contact" WHERE "organizationId"=$1 AND name='Robin Hale'`, [org])).rows[0].companyId,
    "cmp_acc_dallas",
  );
  log("the company box's dropdown tells the two apart by City, State");
  await page.goto(`${BASE}/dashboard/contacts/new`);
  await page.fill("#companyName", "Acme");
  await page.getByRole("option", { name: /Acme Roofing\s*Dallas, TX/ }).waitFor();
  await page.getByRole("option", { name: /Acme Roofing\s*Austin, TX/ }).click();
  await page.fill("#name", "Casey Austin");
  await page.getByRole("button", { name: "Save contact" }).click();
  await page.waitForURL(/\/dashboard\/contacts\/(?!new)[a-z0-9]+$/);
  assert.equal(
    (await sql(`SELECT "companyId" FROM "Contact" WHERE "organizationId"=$1 AND name='Casey Austin'`, [org])).rows[0].companyId,
    "cmp_acc_austin",
  );

  log("a custom industry and type left unsaved tag the company only, marked Custom");
  await page.goto(`${BASE}/dashboard/companies/new`);
  await page.fill("#name", "Orbit Mining");
  await page.getByRole("button", { name: "Custom industry" }).click();
  await page.getByLabel("New industry name").fill("Space Mining");
  assert.equal(await page.getByTestId("save-industry").locator("input").isChecked(), false, "Save for Future Use starts unticked");
  await page.getByLabel("New industry name").press("Enter");
  await page.getByRole("checkbox", { name: /^Space Mining/ }).waitFor();
  assert.match(await page.getByRole("checkbox", { name: /^Space Mining/ }).textContent(), /Custom/);
  await chip(page, "MDU").click();
  await page.locator("[role=group][aria-label='MDU company types']").getByRole("button", { name: "Custom company type" }).click();
  await page.getByLabel("New company type under MDU").fill("Co-op Board");
  await page.getByLabel("New company type under MDU").press("Enter");
  log("…and a saved one joins the pick list");
  await page.locator("[role=group][aria-label='MDU company types']").getByRole("button", { name: "Custom company type" }).click();
  await page.getByLabel("New company type under MDU").fill("Condo HOA");
  await page.getByTestId("save-type").locator("input").check();
  await page.getByLabel("New company type under MDU").press("Enter");
  await shot(page, "04-custom-industry");
  await page.getByRole("button", { name: "Save company" }).click();
  await page.waitForURL(/\/dashboard\/companies\/(?!new$)[a-z0-9]+$/);
  const orbitId = page.url().split("/").pop();
  const orbit = (await sql(`SELECT industries, "companyTypes" FROM "Company" WHERE id=$1`, [orbitId])).rows[0];
  assert.deepEqual(orbit.industries.sort(), ["MDU", "Space Mining"]);
  assert.deepEqual(orbit.companyTypes.sort(), ["Co-op Board", "Condo HOA"]);
  const options = await sql(
    `SELECT (SELECT count(*)::int FROM "IndustryOption" WHERE "organizationId"=$1 AND name='Space Mining') AS industry,
            (SELECT count(*)::int FROM "CompanyTypeOption" WHERE "organizationId"=$1 AND name='Co-op Board') AS unsaved,
            (SELECT count(*)::int FROM "CompanyTypeOption" WHERE "organizationId"=$1 AND name='Condo HOA') AS saved`,
    [org],
  );
  assert.deepEqual(options.rows[0], { industry: 0, unsaved: 0, saved: 1 });
  log("the edit form still shows the unsaved industry, ticked and marked Custom");
  await page.goto(`${BASE}/dashboard/companies/${orbitId}/edit`);
  const space = page.getByRole("checkbox", { name: /^Space Mining/ });
  assert.equal(await space.getAttribute("aria-checked"), "true");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByText(/saved/i).first().waitFor();
  assert.equal((await sql(`SELECT count(*)::int n FROM "IndustryOption" WHERE "organizationId"=$1 AND name='Space Mining'`, [org])).rows[0].n, 0, "an edit does not save it either");

  log("an activity on a company page can be put on its people, including one added on the spot");
  await page.goto(`${BASE}/dashboard/companies/cmp_acc_dallas`);
  const form = page.locator("[data-testid=log-activity-form]");
  const picker = form.locator("[data-testid=company-people-picker]");
  await picker.locator("[data-testid=company-person-chip]", { hasText: "Jordan Blake" }).click();
  await picker.locator("[data-testid=company-person-add]").click();
  await picker.getByLabel("New contact name").fill("Pat Lee");
  await picker.getByLabel("New contact email").fill("pat@acme.com");
  await picker.locator("[data-testid=company-person-save]").click();
  await picker.locator("[data-testid=company-person-chip][aria-checked=true]", { hasText: "Pat Lee" }).waitFor();
  assert.equal(await picker.locator("[data-testid=company-person-chip][aria-checked=true]").count(), 2);
  await shot(page, "05-company-activity-people");
  await form.locator("textarea[name=body]").fill("Site walk with Jordan and Pat");
  await form.locator("[data-testid=activity-submit]").click();
  await page.getByText("Site walk with Jordan and Pat").first().waitFor();
  const pat = (await sql(`SELECT id, "companyId", email FROM "Contact" WHERE "organizationId"=$1 AND name='Pat Lee'`, [org])).rows[0];
  assert.deepEqual({ companyId: pat.companyId, email: pat.email }, { companyId: "cmp_acc_dallas", email: "pat@acme.com" });
  const logged = await sql(`SELECT "contactId", "companyId", "batchId" FROM "Activity" WHERE "organizationId"=$1 AND body='Site walk with Jordan and Pat' ORDER BY "contactId"`, [org]);
  assert.equal(logged.rows.length, 2);
  assert.deepEqual(logged.rows.map((r) => r.contactId).sort(), ["ctc_acc_jordan", pat.id].sort());
  assert.ok(logged.rows.every((r) => r.companyId === null && r.batchId && r.batchId === logged.rows[0].batchId), "one batch, on the people");
  log("nobody ticked: refused until the bypass box is ticked, then it lands on the company");
  await form.locator("textarea[name=body]").fill("Left a message at the front desk");
  await form.locator("[data-testid=activity-submit]").click();
  await form.getByRole("alert").waitFor();
  assert.match(await form.getByRole("alert").textContent(), /Tick who at this company/);
  assert.equal(await form.locator("textarea[name=body]").inputValue(), "Left a message at the front desk", "what was typed is kept");
  await form.locator("[data-testid=company-bypass-tick]").check();
  await form.locator("[data-testid=activity-submit]").click();
  // The typed text is still in the box after the refusal, so wait for the
  // follow-up box the save opens, not for the words.
  await page.locator("[data-testid=follow-up-prompt]").waitFor();
  await page.locator("[data-testid=follow-up-skip]").click();
  await page.locator("#activity li", { hasText: "Left a message at the front desk" }).waitFor();
  const onCompany = await sql(`SELECT "contactId", "companyId" FROM "Activity" WHERE "organizationId"=$1 AND body='Left a message at the front desk'`, [org]);
  assert.deepEqual(onCompany.rows, [{ contactId: null, companyId: "cmp_acc_dallas" }]);

  log("Merge Contacts: pick the two Matt Smiths, keep one, everything moves onto it");
  await sql(
    `INSERT INTO "Deal" (id,"organizationId","contactId",title,stage,"ownerId","updatedAt") VALUES ('deal_acc_m2',$1,'ctc_acc_matt2','Matt garage','LEAD',$2,now())`,
    [org, me],
  );
  await sql(`INSERT INTO "Note" (id,"organizationId","contactId","authorId",body) VALUES ('note_acc_m2',$1,'ctc_acc_matt2',$2,'Prefers texts')`, [org, me]);
  // The duplicate is further along; the merged person keeps that.
  await sql(`UPDATE "Contact" SET status='MEETING_SET' WHERE id='ctc_acc_matt2'`);
  await sql(
    `INSERT INTO "StatusChange" (id,"organizationId","contactId","toStatus","on") VALUES ('sc_acc_m2',$1,'ctc_acc_matt2','MEETING_SET',now())`,
    [org],
  );
  await page.goto(`${BASE}/dashboard/contacts`);
  await page.locator("[data-testid=merge-open]").click();
  const merge = page.locator("[data-testid=merge-dialog]");
  await merge.locator("[data-testid=merge-search]").fill("Matt Smith");
  const results = merge.locator("[data-testid=merge-results] label");
  await results.filter({ hasText: "matt@acme.com" }).waitFor();
  await results.filter({ hasText: "matt@acme.com" }).locator("input").check();
  await results.filter({ hasText: "mattsmith@gmail.com" }).locator("input").check();
  await shot(page, "06-merge-contacts");
  // The first ticked is kept by default; keep it.
  await merge.locator("[data-testid=merge-go]").click();
  await merge.locator("[data-testid=merge-confirm]").getByText("1 will be folded into Matt Smith").waitFor();
  await merge.locator("[data-testid=merge-yes]").click();
  await page.waitForURL(/\/dashboard\/contacts\/ctc_acc_matt1$/);
  const kept = (await sql(`SELECT email, email2, phone, phone2, "companyId" FROM "Contact" WHERE id='ctc_acc_matt1'`)).rows[0];
  assert.deepEqual(kept, { email: "matt@acme.com", email2: "mattsmith@gmail.com", phone: "555-3001", phone2: "555-3002", companyId: "cmp_acc_austin" });
  assert.equal((await sql(`SELECT count(*)::int n FROM "Contact" WHERE id='ctc_acc_matt2'`)).rows[0].n, 0, "the other one is gone");
  assert.equal((await sql(`SELECT "contactId" FROM "Deal" WHERE id='deal_acc_m2'`)).rows[0].contactId, "ctc_acc_matt1", "the deal moved");
  assert.equal((await sql(`SELECT "contactId" FROM "Note" WHERE id='note_acc_m2'`)).rows[0].contactId, "ctc_acc_matt1", "the note moved");
  assert.equal((await sql(`SELECT status FROM "Contact" WHERE id='ctc_acc_matt1'`)).rows[0].status, "MEETING_SET", "the furthest status wins");
  assert.equal((await sql(`SELECT "contactId" FROM "StatusChange" WHERE id='sc_acc_m2'`)).rows[0].contactId, "ctc_acc_matt1", "status history moved");
  // The other Matt's main company (Dallas) becomes an additional account.
  assert.equal((await sql(`SELECT count(*)::int n FROM "ContactAccount" WHERE "contactId"='ctc_acc_matt1' AND "companyId"='cmp_acc_dallas'`)).rows[0].n, 1);
  await page.getByText("Matt garage").first().waitFor();

  log("Merge Companies: the two Acme Roofings become one, people and tags together");
  await page.goto(`${BASE}/dashboard/companies`);
  await page.locator("[data-testid=merge-open]").click();
  await merge.locator("[data-testid=merge-search]").fill("Acme");
  await results.filter({ hasText: "Dallas, TX" }).locator("input").check();
  await results.filter({ hasText: "Austin, TX" }).locator("input").check();
  // Keep Austin this time: pick it in the "Keep which one?" list.
  await merge.locator("[data-testid=merge-picked] label", { hasText: "Austin, TX" }).locator("input[type=radio]").check();
  await merge.locator("[data-testid=merge-go]").click();
  await merge.locator("[data-testid=merge-yes]").click();
  await page.waitForURL(/\/dashboard\/companies\/cmp_acc_austin$/);
  assert.equal((await sql(`SELECT count(*)::int n FROM "Company" WHERE id='cmp_acc_dallas'`)).rows[0].n, 0);
  const austin = (await sql(`SELECT industries FROM "Company" WHERE id='cmp_acc_austin'`)).rows[0];
  assert.deepEqual(austin.industries.sort(), ["Commercial", "MDU"]);
  assert.equal((await sql(`SELECT "companyId" FROM "Contact" WHERE id=$1`, [pat.id])).rows[0].companyId, "cmp_acc_austin", "Pat moved");
  assert.equal(
    (await sql(`SELECT count(*)::int n FROM "Activity" WHERE "companyId"='cmp_acc_austin' AND body='Left a message at the front desk'`)).rows[0].n,
    1,
    "the company's own activity moved",
  );
  // Matt's main company is Austin now, so his link there is dropped, not doubled.
  assert.equal((await sql(`SELECT count(*)::int n FROM "ContactAccount" WHERE "contactId"='ctc_acc_matt1'`)).rows[0].n, 0);
  // Jordan's link to Austin survives the merge, once.
  assert.equal((await sql(`SELECT count(*)::int n FROM "ContactAccount" WHERE "contactId"='ctc_acc_jordan' AND "companyId"='cmp_acc_austin'`)).rows[0].n, 1);
  await people.getByText("Pat Lee").waitFor();
  await shot(page, "07-merged-company");

  await browser.close();
  console.log(`\nAll ${step} steps passed. Screenshots in ${OUT}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
