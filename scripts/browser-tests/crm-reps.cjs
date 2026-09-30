/* Browser regression for "Users vs Company", release 1 (Sept 30, 2026).
 *
 * Covers: the sidebar in Taylor's order with the CRM and Closer's Club
 * headings, Contract Coordinator under Contracts only; a second email and
 * phone on a contact with their Personal / Work tags, shown on the page,
 * kept by the edit form and found by the list search; "Last Contacted By"
 * as the first column on Contacts and Companies, naming the teammate who
 * logged the touch; a deal made by a teammate carrying their name on its
 * pipeline tile as "Rep", and handing it to someone else from the tile;
 * Delete in the contact and company page headers, with a confirm, and a
 * refusal when money is owed shown on the screen.
 *
 * Runs against a built app (`bash scripts/dev-serve.sh`) and a local
 * Postgres that has had `prisma migrate deploy` run against it. It signs
 * up its own workspace and deletes it again on the next run. Never point
 * it at the live database.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/scb_test \
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules \
 *   node scripts/browser-tests/crm-reps.cjs
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
const OUT = process.env.SHOTS_DIR || path.join(os.tmpdir(), "scb-browser-shots-crm-reps");
fs.mkdirSync(OUT, { recursive: true });

const EMAIL = "test-crmreps@example.com";
const NIC_EMAIL = "test-crmreps-nic@example.com";
const PASSWORD = "password123";
const COMPANY = "Test CRM Reps Co";

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
async function login(page, email) {
  await page.goto(`${BASE}/login`);
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/dashboard$/);
}

(async () => {
  await sql(`DELETE FROM "Organization" WHERE slug LIKE 'test-crm-reps-co%'`);
  await sql(`DELETE FROM "User" WHERE email = $1`, [NIC_EMAIL]);

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
  await sql(`UPDATE "Organization" SET status='ACTIVE', "reviewedAt"=now() WHERE slug LIKE 'test-crm-reps-co%'`);
  await login(page, EMAIL);
  const org = (await sql(`SELECT id FROM "Organization" WHERE slug LIKE 'test-crm-reps-co%'`)).rows[0].id;
  const taylor = (await sql(`SELECT id, "passwordHash" FROM "User" WHERE email = $1`, [EMAIL])).rows[0];

  // Nic is a Member on the same account, with the same password so the
  // suite can sign in as him. Seeded rather than invited: the invite flow
  // has its own suite.
  const nicId = "usr_crmreps_nic";
  await sql(
    `INSERT INTO "User" (id, name, email, "passwordHash", role, "organizationId") VALUES ($1, 'Nic Rivera', $2, $3, 'MEMBER', $4)`,
    [nicId, NIC_EMAIL, taylor.passwordHash, org],
  );

  log("the sidebar reads in Taylor's order, with CRM and Closer's Club headings");
  const aside = page.locator("aside");
  const order = (await aside.locator("nav").first().locator("a.nav-item, [data-testid=nav-group] > p").allTextContents()).map((t) =>
    t.trim(),
  );
  const expected = ["Overview", "Calendar", "CRM", "Contacts", "Companies", "Closer's Club", "Pipeline", "Quotes", "Contracts", "Products", "Projects", "Settings"];
  assert.deepEqual(order.filter((t) => expected.includes(t)), expected, `sidebar order was ${order.join(" / ")}`);

  log("Contract Coordinator sits under Contracts, and nowhere under Pipeline");
  await page.goto(`${BASE}/dashboard/deals`);
  assert.equal(await aside.getByRole("link", { name: "Contract Coordinator" }).count(), 0, "no coordinator under Pipeline");
  await page.goto(`${BASE}/dashboard/contracts`);
  assert.equal(await aside.getByRole("link", { name: "Contract Coordinator" }).count(), 1, "one coordinator under Contracts");
  await page.goto(`${BASE}/dashboard/projects`);
  const projectKids = (await aside.locator("a.nav-item").allTextContents()).map((t) => t.trim());
  const at = projectKids.indexOf("Projects");
  assert.deepEqual(projectKids.slice(at + 1, at + 4), ["Properties", "Budgets", "Crews"]);

  log("a contact with a second email and phone, each tagged Personal or Work");
  await page.goto(`${BASE}/dashboard/contacts/new`);
  await page.fill("#companyName", "Rivera Ventures");
  await page.fill("#name", "Alex Morgan");
  await page.fill("#email", "alex@riveraventures.com");
  await page.fill("#phone", "555-0100");
  await page.fill("#email2", "alex.morgan@gmail.com");
  await page.fill("#phone2", "555-0199");
  assert.equal(await page.locator("[data-testid=email2-label]").inputValue(), "PERSONAL", "second email defaults to Personal");
  assert.equal(await page.locator("[data-testid=email-label]").inputValue(), "WORK", "first email defaults to Work");
  await page.selectOption("[data-testid=phone2-label]", "WORK");
  await shot(page, "01-contact-form");
  await page.getByRole("button", { name: "Save contact" }).click();
  await page.waitForURL(/\/dashboard\/contacts\/(?!new$)[a-z0-9]+$/);
  const alexUrl = page.url();
  const alexId = alexUrl.split("/").pop();
  const details = page.locator("dl").first();
  await details.getByText("Email · Work").waitFor();
  assert.ok(await details.getByText("Email · Personal").isVisible());
  assert.equal(await page.locator("[data-testid=contact-email2]").textContent(), "alex.morgan@gmail.com");
  assert.equal(await page.locator("[data-testid=contact-phone2]").textContent(), "555-0199");
  // Both phones read Work, as picked.
  assert.equal(await details.getByText("Phone · Work").count(), 2);
  await shot(page, "02-contact-page");

  log("the edit form keeps both pairs and their tags");
  await page.goto(`${alexUrl}/edit`);
  assert.equal(await page.locator("#email2").inputValue(), "alex.morgan@gmail.com");
  assert.equal(await page.locator("#phone2").inputValue(), "555-0199");
  assert.equal(await page.locator("[data-testid=phone2-label]").inputValue(), "WORK");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByText("Contact saved").waitFor();
  const row = (await sql(`SELECT email2, "email2Label", phone2, "phone2Label" FROM "Contact" WHERE id = $1`, [alexId])).rows[0];
  assert.deepEqual(row, { email2: "alex.morgan@gmail.com", email2Label: "PERSONAL", phone2: "555-0199", phone2Label: "WORK" });

  log("the Contacts search finds someone by their second phone or email");
  await page.goto(`${BASE}/dashboard/contacts?q=555-0199`);
  await page.locator("[data-testid=contact-row]", { hasText: "Alex Morgan" }).waitFor();
  await page.goto(`${BASE}/dashboard/contacts?q=alex.morgan%40gmail`);
  await page.locator("[data-testid=contact-row]", { hasText: "Alex Morgan" }).waitFor();

  log("before anyone reaches out, Last Contacted By is the first column and reads Not yet");
  await page.goto(`${BASE}/dashboard/contacts`);
  const headers = (await page.locator("table thead th").allTextContents()).map((t) => t.trim());
  assert.equal(headers[1], "Last Contacted By", `first column was ${headers[1]}`);
  const alexRow = page.locator("[data-testid=contact-row]", { hasText: "Alex Morgan" });
  assert.ok(await alexRow.getByText("Not yet").isVisible());

  // Nic signs in on his own browser and does the work.
  const nicContext = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const nic = await nicContext.newPage();
  nic.on("pageerror", (err) => console.error("PAGE ERROR (Nic):", err.message));
  await login(nic, NIC_EMAIL);

  log("Nic logs a call on Alex");
  await nic.goto(alexUrl);
  const activityForm = nic.locator("[data-testid=log-activity-form]");
  await activityForm.locator("textarea[name=body]").fill("Intro call, wants a walkthrough");
  await activityForm.locator("[data-testid=activity-submit]").click();
  await nic.getByText("Intro call, wants a walkthrough").first().waitFor();

  log("Contacts and Companies both say Nic reached out, and when");
  await page.goto(`${BASE}/dashboard/contacts`);
  const alexCell = page.locator("[data-testid=contact-row]", { hasText: "Alex Morgan" }).locator("[data-testid=last-contacted]");
  await alexCell.getByText("Nic Rivera").waitFor();
  assert.match(await alexCell.textContent(), /\d{4}/, "a date under the name");
  await page.goto(`${BASE}/dashboard/companies`);
  const companyHeaders = (await page.locator("table thead th").allTextContents()).map((t) => t.trim());
  assert.equal(companyHeaders[1], "Last Contacted By");
  await page
    .locator("[data-testid=company-row]", { hasText: "Rivera Ventures" })
    .locator("[data-testid=last-contacted]")
    .getByText("Nic Rivera")
    .waitFor();
  await shot(page, "03-companies-last-contacted");

  log("a call dated ahead does not count as contacted");
  await sql(
    `INSERT INTO "Activity" (id, "organizationId", "contactId", "userId", type, body, "occurredAt") VALUES ('act_crmreps_future', $1, $2, $3, 'PHONE_CALL', 'future', now() + interval '3 days')`,
    [org, alexId, taylor.id],
  );
  await page.goto(`${BASE}/dashboard/contacts`);
  await page.locator("[data-testid=contact-row]", { hasText: "Alex Morgan" }).locator("[data-testid=last-contacted]").getByText("Nic Rivera").waitFor();
  await sql(`DELETE FROM "Activity" WHERE id = 'act_crmreps_future'`);

  log("Nic adds a deal; the pipeline tile names him as the rep");
  await nic.goto(alexUrl);
  await nic.fill("#deal-title", "Rivera office build-out");
  await nic.fill("#deal-value", "12000");
  await nic.getByRole("button", { name: "Add", exact: true }).click();
  await nic.getByText("Rivera office build-out").first().waitFor();
  const deal = (await sql(`SELECT id, "ownerId" FROM "Deal" WHERE "organizationId" = $1 AND title = 'Rivera office build-out'`, [org])).rows[0];
  assert.equal(deal.ownerId, nicId, "the deal belongs to whoever made it");

  // Deals join the board at Quote Sent (Sept 30, 2026); put this one there.
  await sql(`UPDATE "Deal" SET stage='QUOTE_SENT' WHERE id=$1`, [deal.id]);
  await page.goto(`${BASE}/dashboard/deals`);
  const tile = page.locator("div.rounded-lg", { hasText: "Rivera office build-out" });
  const rep = tile.locator("[data-testid=deal-owner] select");
  assert.equal(await rep.inputValue(), nicId);
  assert.equal(await rep.locator("option:checked").textContent(), "Nic Rivera");
  await shot(page, "04-pipeline-rep");

  log("Taylor hands the deal to himself from the tile, and it sticks");
  await rep.selectOption(taylor.id);
  for (let i = 0; i < 20; i += 1) {
    const now = (await sql(`SELECT "ownerId" FROM "Deal" WHERE id = $1`, [deal.id])).rows[0].ownerId;
    if (now === taylor.id) break;
    await page.waitForTimeout(150);
  }
  assert.equal((await sql(`SELECT "ownerId" FROM "Deal" WHERE id = $1`, [deal.id])).rows[0].ownerId, taylor.id);
  await page.reload();
  assert.equal(await page.locator("div.rounded-lg", { hasText: "Rivera office build-out" }).locator("[data-testid=deal-owner] select").inputValue(), taylor.id);

  log("a quote made on a brand-new deal names its maker as the rep");
  await nic.goto(`${BASE}/dashboard/quotes/new?contactId=${alexId}`);
  await nic.fill("#dealTitle", "Rivera phase two");
  await nic.locator("input[name=title]").fill("Rivera phase two quote");
  await nic.getByRole("button", { name: "Create quote" }).click();
  await nic.waitForURL(/\/dashboard\/quotes\/(?!new)[a-z0-9]+/);
  const quoteDeal = (
    await sql(`SELECT d."ownerId" FROM "Quote" q JOIN "Deal" d ON d.id = q."dealId" WHERE q."organizationId" = $1 AND q.title = 'Rivera phase two quote'`, [org])
  ).rows[0];
  assert.equal(quoteDeal.ownerId, nicId, "a deal made by the quote form belongs to its maker");

  log("Delete in the contact page header asks first, then deletes");
  await page.goto(`${BASE}/dashboard/contacts/new`);
  await page.fill("#name", "Throwaway Person");
  await page.getByRole("button", { name: "Save contact" }).click();
  await page.waitForURL(/\/dashboard\/contacts\/(?!new$)[a-z0-9]+$/);
  const throwawayId = page.url().split("/").pop();
  await page.locator("[data-testid=header-delete]").click();
  await page.getByText("Delete Throwaway Person, with their notes").waitFor();
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.locator("[data-testid=header-delete]").click();
  await page.locator("[data-testid=header-delete-yes]").click();
  await page.waitForURL(/\/dashboard\/contacts$/);
  assert.equal((await sql(`SELECT count(*)::int AS n FROM "Contact" WHERE id = $1`, [throwawayId])).rows[0].n, 0);

  log("Delete in the company page header keeps its people");
  await page.goto(`${BASE}/dashboard/companies`);
  await page.locator("[data-testid=company-row]", { hasText: "Rivera Ventures" }).getByRole("link", { name: "Rivera Ventures" }).click();
  await page.waitForURL(/\/dashboard\/companies\/[a-z0-9]+$/);
  const companyId = page.url().split("/").pop();
  await page.locator("[data-testid=header-delete]").click();
  await page.locator("[data-testid=header-delete-yes]").click();
  await page.waitForURL(/\/dashboard\/companies$/);
  assert.equal((await sql(`SELECT count(*)::int AS n FROM "Company" WHERE id = $1`, [companyId])).rows[0].n, 0);
  assert.equal((await sql(`SELECT "companyId" FROM "Contact" WHERE id = $1`, [alexId])).rows[0].companyId, null, "Alex stays, with no company");

  log("a refusal (money owed) shows under the header buttons");
  await sql(
    `INSERT INTO "Contract" (id,"organizationId","contactId",number,title,type,body,status,payable,"publicToken","signedAt","updatedAt")
     VALUES ('ctr_crmreps',$1,$2,990001,'Owed','Sales Order','Body','SIGNED',false,'tok_ctr_crmreps_0123456',now(),now())`,
    [org, alexId],
  );
  await sql(
    `INSERT INTO "ContractPayment" (id,"contractId","organizationId",label,kind,"amountCents","dueOn",position)
     VALUES ('cp_crmreps','ctr_crmreps',$1,'Deposit','FIXED',50000,current_date + 1,0)`,
    [org],
  );
  await sql(`UPDATE "Organization" SET "nextContractNumber" = GREATEST("nextContractNumber", 990002) WHERE id = $1`, [org]);
  await page.goto(alexUrl);
  await page.locator("[data-testid=header-delete]").click();
  await page.locator("[data-testid=header-delete-yes]").click();
  await page.locator("[data-testid=header-delete-error]").waitFor();
  assert.equal((await sql(`SELECT count(*)::int AS n FROM "Contact" WHERE id = $1`, [alexId])).rows[0].n, 1, "Alex was not deleted");
  await shot(page, "05-delete-refused");

  await browser.close();
  console.log(`\nAll ${step} steps passed. Screenshots in ${OUT}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
