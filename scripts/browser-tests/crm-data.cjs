/* Browser regression for "Clean CRM data and sharper filters" (Nov 10, 2026).
 *
 * Covers: a marketing send that leaves Last Contacted By, the status and the
 * activity counts alone but shows in the Marketing column and on the feed
 * with a Marketing badge; new records Unassigned with "Added by" on their
 * page; the Rep picker on the page and the edit form; the import's "Assign
 * everyone in this file to" (and a re-import with Unassigned keeping a rep);
 * bulk Assign to me / Assign to… / Unassign on ticked rows and on "all
 * matching" with the 1,000 cap; every new filter (Activity, Job title, Rep,
 * Added by, Added, Contact info, Lead Label) and stacking them; the Labels
 * screen's Rename / Merge into… / Retire for Industry ("Student Housing" →
 * "Student"), Company Type, Lead Label and Job Title; a Member who can look
 * but not change; the duplicate finder's groups for contacts and companies
 * and a merge from it; the phone width; and the Nov 10 audit fixes (the
 * edit form's Rep box on a second save, bulk all-matching run twice, a
 * second merge from one duplicate group, the finder past its last page,
 * label renames onto another's capitals, a stray "distributor", job titles
 * with doubled spaces, and a touch dated ahead).
 *
 * And the UX review fixes (Nov 10, 2026), each an "audit fixes (UX
 * review):" step: the Rep, Added by, Contact info and Lead Label menus
 * opening inside a 1440 window with every name whole; on a phone, Contact
 * info's None buttons on the screen and pressable, and the Pipeline's Lead
 * Label menu on the screen without widening the board; and the search box
 * finding a job title and a person by their name plus their company.
 *
 * Needs email switched on like email-marketing-users.cjs, with the catcher
 * on CATCHER_PORT (default 3999): the server's .env carries RESEND_API_KEY,
 * EMAIL_FROM and RESEND_ENDPOINT=http://localhost:<CATCHER_PORT>/emails.
 * Fake values are right; nothing leaves the machine.
 *
 *   BASE=http://localhost:3000 \
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/scb_test \
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules \
 *   node scripts/browser-tests/crm-data.cjs
 */
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS on purpose: NODE_PATH only resolves the global playwright for require() */
const os = require("node:os");
const http = require("node:http");
const { chromium } = require("playwright");
const { Client } = require("pg");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const BASE = process.env.BASE || "http://localhost:3000";
const DB = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5433/scb_test";
const CATCHER_PORT = Number(process.env.CATCHER_PORT || 3999);
const OUT = process.env.SHOTS_DIR || path.join(os.tmpdir(), "scb-browser-shots-crm-data");
fs.mkdirSync(OUT, { recursive: true });

const EMAIL = "test-crmdata@example.com";
const NIC_EMAIL = "test-crmdata-nic@example.com";
const PASSWORD = "password123";
const COMPANY = "Test CRM Data Co";
const SLUG = "test-crm-data-co%";

let step = 0;
function log(msg) {
  step += 1;
  console.log(`[${String(step).padStart(2, "0")}] ${msg}`);
}
async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
}
const db = new Client({ connectionString: DB });
const sql = (text, params) => db.query(text, params);
async function login(page, email) {
  await page.goto(`${BASE}/login`);
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/dashboard$/);
}

const inbox = [];
function startCatcher() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        try {
          inbox.push(JSON.parse(body));
        } catch {
          inbox.push({ raw: body });
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: `caught-${inbox.length}` }));
      });
    });
    server.listen(CATCHER_PORT, () => resolve(server));
  });
}

let seq = 0;
let org;
let taylor;
const nicId = "usr_crmdata_nic";
// A contact straight in SQL; createdAt / updatedAt default to now.
async function seedContact(fields) {
  seq += 1;
  const id = fields.id ?? `cd_contact_${seq}`;
  const row = { title: null, email: null, phone: null, mobile: null, companyId: null, ownerId: null, createdById: null, createdAt: null, ...fields };
  await sql(
    `INSERT INTO "Contact" (id, "organizationId", name, title, email, phone, mobile, "companyId", "ownerId", "createdById", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11::timestamptz, now()), now() - ($12 || ' seconds')::interval)`,
    [id, org, row.name, row.title, row.email, row.phone, row.mobile, row.companyId, row.ownerId, row.createdById, row.createdAt, String(seq)],
  );
  return id;
}
async function seedCompany(fields) {
  seq += 1;
  const id = fields.id ?? `cd_company_${seq}`;
  const row = { phone: null, email: null, website: null, industries: [], companyTypes: [], ownerId: null, createdById: null, ...fields };
  await sql(
    `INSERT INTO "Company" (id, "organizationId", name, phone, email, website, industries, "companyTypes", "ownerId", "createdById", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now() - ($11 || ' seconds')::interval)`,
    [id, org, row.name, row.phone, row.email, row.website, row.industries, row.companyTypes, row.ownerId, row.createdById, String(seq)],
  );
  return id;
}
async function seedActivity(contactId, daysAgo, marketing = false, companyId = null) {
  seq += 1;
  await sql(
    `INSERT INTO "Activity" (id, "organizationId", "contactId", "companyId", "userId", type, body, marketing, "occurredAt")
     VALUES ($1, $2, $3, $4, $5, 'PHONE_CALL', 'Seeded call', $6, now() - ($7 || ' days')::interval)`,
    [`cd_act_${seq}`, org, contactId, companyId, taylor.id, marketing, String(daysAgo)],
  );
}

// The names in the Contacts / Companies table on the page now.
async function contactNames(page) {
  await page.locator("[data-testid=page-summary]").waitFor();
  return (await page.locator("[data-testid=contact-row] td:nth-child(4) a.link").allTextContents()).map((t) => t.trim()).sort();
}
async function companyNames(page) {
  await page.locator("[data-testid=page-summary]").waitFor();
  return (await page.locator("[data-testid=company-row] td:nth-child(3) a.link").allTextContents()).map((t) => t.trim()).sort();
}
async function contactsAt(page, query) {
  await page.goto(`${BASE}/dashboard/contacts?${query}`);
  return contactNames(page);
}
async function companiesAt(page, query) {
  await page.goto(`${BASE}/dashboard/companies?${query}`);
  return companyNames(page);
}
// A filter menu, opened and placed (FloatingMenu draws it hidden until it
// has measured where it fits).
async function openMenu(page, id) {
  await page.getByTestId(id).click();
  const menu = page.getByTestId(`${id}-menu`);
  await menu.waitFor();
  await page.waitForFunction((sel) => {
    const el = document.querySelector(sel);
    return el && getComputedStyle(el).visibility === "visible";
  }, `[data-testid="${id}-menu"]`);
  return menu;
}
// Inside the window, every choice's name whole, and the page no wider.
async function assertMenuInside(page, menu, what) {
  const width = page.viewportSize().width;
  const box = await menu.boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= width, `${what} spans ${Math.round(box.x)}–${Math.round(box.x + box.width)} in a ${width}px window`);
  const cut = await menu.evaluate((el) => [...el.querySelectorAll("span.truncate")].filter((span) => span.scrollWidth > span.clientWidth + 1).map((span) => span.textContent));
  assert.deepEqual(cut, [], `${what} cuts names off`);
  const wide = await page.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(wide <= width + 1, `${what} widens the page to ${wide}px`);
}
const rowOf = (page, name) => page.locator("[data-testid=contact-row]", { has: page.locator(`td:nth-child(4) a.link:text-is("${name}")`) });

(async () => {
  await db.connect();
  await sql(`DELETE FROM "Organization" WHERE slug LIKE $1`, [SLUG]);
  await sql(`DELETE FROM "User" WHERE email = $1`, [NIC_EMAIL]);
  const catcher = await startCatcher();

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const page = await context.newPage();
  page.on("pageerror", (err) => console.error("PAGE ERROR:", err.message));

  log("signup + activate + login; Nic is a Member");
  await page.goto(`${BASE}/signup`);
  await page.fill("[name=companyName]", COMPANY);
  await page.fill("[name=name]", "Taylor Test");
  await page.fill("[name=email]", EMAIL);
  await page.fill("[name=phone]", "5550000000");
  await page.fill("[name=password]", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/signup\/submitted/);
  await sql(
    `UPDATE "Organization" SET status='ACTIVE', "reviewedAt"=now(), "addressLine1"='12 Main St', city='Austin', state='TX', "postalCode"='78701' WHERE slug LIKE $1`,
    [SLUG],
  );
  await login(page, EMAIL);
  org = (await sql(`SELECT id FROM "Organization" WHERE slug LIKE $1`, [SLUG])).rows[0].id;
  taylor = (await sql(`SELECT id, "passwordHash" FROM "User" WHERE email = $1`, [EMAIL])).rows[0];
  await sql(`INSERT INTO "User" (id, name, email, "passwordHash", role, "organizationId") VALUES ($1, 'Nic Rivera', $2, $3, 'MEMBER', $4)`, [
    nicId,
    NIC_EMAIL,
    taylor.passwordHash,
    org,
  ]);

  // ---------------------------------------------------------------------
  log("a contact added by hand starts Unassigned and reads Added by Taylor Test");
  await page.goto(`${BASE}/dashboard/contacts/new`);
  await page.fill("#companyName", "Ann Holdings");
  await page.fill("[name=name]", "Ann Added");
  assert.equal(await page.locator("[data-testid=rep-field]").inputValue(), "", "the form opens on Unassigned");
  assert.deepEqual(
    (await page.locator("[data-testid=rep-field] option").allTextContents()).slice(0, 1),
    ["Unassigned"],
    "Unassigned is first",
  );
  await page.click("button:has-text('Save contact')");
  await page.waitForURL(/\/dashboard\/contacts\/(?!new)[^/]+$/);
  const annId = page.url().split("/").pop();
  await page.locator("[data-testid=added-by]").waitFor();
  assert.match(await page.locator("[data-testid=added-by]").textContent(), /^Added by Taylor Test · /);
  assert.equal(await page.locator("[data-testid=rep-picker]").inputValue(), "");
  let row = (await sql(`SELECT "ownerId", "createdById", "companyId" FROM "Contact" WHERE id=$1`, [annId])).rows[0];
  assert.equal(row.ownerId, null);
  assert.equal(row.createdById, taylor.id);
  const annCo = (await sql(`SELECT "ownerId", "createdById" FROM "Company" WHERE id=$1`, [row.companyId])).rows[0];
  assert.equal(annCo.ownerId, null, "the company made on the way is Unassigned too");
  assert.equal(annCo.createdById, taylor.id);
  await page.goto(`${BASE}/dashboard/contacts`);
  assert.equal((await rowOf(page, "Ann Added").locator("[data-testid=rep-cell]").textContent()).trim(), "Unassigned");

  log("the Rep picker on the page saves at once; the edit form keeps it and can change it");
  await page.goto(`${BASE}/dashboard/contacts/${annId}`);
  await page.selectOption("[data-testid=rep-picker]", nicId);
  for (let i = 0; i < 40; i++) {
    row = (await sql(`SELECT "ownerId" FROM "Contact" WHERE id=$1`, [annId])).rows[0];
    if (row.ownerId === nicId) break;
    await page.waitForTimeout(150);
  }
  assert.equal(row.ownerId, nicId);
  await page.goto(`${BASE}/dashboard/contacts/${annId}/edit`);
  assert.equal(await page.locator("[data-testid=rep-field]").inputValue(), nicId);
  await page.fill("[name=title]", "Owner");
  await page.click("button:has-text('Save changes')");
  await page.waitForSelector("text=Contact saved");
  // A second save after React reset the form must not write the old rep back.
  await page.click("button:has-text('Save changes')");
  await page.waitForTimeout(800);
  assert.equal((await sql(`SELECT "ownerId" FROM "Contact" WHERE id=$1`, [annId])).rows[0].ownerId, nicId, "an untouched rep box writes nothing");
  await page.goto(`${BASE}/dashboard/contacts/${annId}/edit`);
  await page.selectOption("[data-testid=rep-field]", taylor.id);
  await page.click("button:has-text('Save changes')");
  await page.waitForSelector("text=Contact saved");
  assert.equal((await sql(`SELECT "ownerId" FROM "Contact" WHERE id=$1`, [annId])).rows[0].ownerId, taylor.id);
  await page.goto(`${BASE}/dashboard/contacts`);
  assert.equal((await rowOf(page, "Ann Added").locator("[data-testid=rep-cell]").textContent()).trim(), "Taylor Test");

  log("a company: Added by on its page, the Rep box on its form, a removed rep shown labelled");
  await page.goto(`${BASE}/dashboard/companies/new`);
  await page.fill("[name=name]", "Bolt Builders");
  await page.selectOption("[data-testid=rep-field]", nicId);
  await page.click("button:has-text('Save company')");
  await page.waitForURL(/\/dashboard\/companies\/(?!new)[^/]+$/);
  const boltId = page.url().split("/").pop();
  assert.match(await page.locator("[data-testid=added-by]").textContent(), /^Added by Taylor Test · /);
  assert.equal(await page.locator("[data-testid=rep-picker]").inputValue(), nicId);
  await sql(`UPDATE "User" SET "removedAt"=now() WHERE id=$1`, [nicId]);
  await page.reload();
  assert.equal(await page.locator("[data-testid=rep-picker]").inputValue(), nicId, "a removed rep stays picked");
  assert.match(await page.locator("[data-testid=rep-picker] option:checked").textContent(), /Nic Rivera \(removed\)/);
  await page.goto(`${BASE}/dashboard/companies/${boltId}/edit`);
  await page.click("button:has-text('Save changes')");
  await page.waitForSelector("text=Company saved");
  assert.equal((await sql(`SELECT "ownerId" FROM "Company" WHERE id=$1`, [boltId])).rows[0].ownerId, nicId, "saving the form keeps the removed rep");
  await sql(`UPDATE "User" SET "removedAt"=NULL WHERE id=$1`, [nicId]);

  // ---------------------------------------------------------------------
  log("a marketing send: in the Marketing column and on the feed, never a touch");
  const markCo = await seedCompany({ name: "Mail Co" });
  const markId = await seedContact({ name: "Mark Mailer", email: "mark@crmdata.example.com", companyId: markCo });
  const sent = await page.evaluate(async (id) => {
    const response = await fetch("/dashboard/email/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contactIds: [id], subject: "Fall offer", body: "Hi {{first_name}}", templateId: null, fileIds: [] }),
    });
    return response.json();
  }, markId);
  assert.ok(sent.ok !== false, `the send went: ${JSON.stringify(sent)}`);
  assert.equal(inbox.length, 1, "one email caught");
  const markActs = (await sql(`SELECT type, marketing FROM "Activity" WHERE "contactId"=$1`, [markId])).rows;
  assert.deepEqual(markActs, [{ type: "EMAIL", marketing: true }]);
  assert.equal((await sql(`SELECT status FROM "Contact" WHERE id=$1`, [markId])).rows[0].status, "NOT_ACTIONED", "status untouched");
  await page.goto(`${BASE}/dashboard/contacts?q=Mark%20Mailer`);
  const markRow = rowOf(page, "Mark Mailer");
  assert.equal((await markRow.locator("td:nth-child(2)").textContent()).trim(), "Not yet", "Last Contacted By is untouched");
  assert.match(await markRow.locator("[data-testid=marketing-cell]").textContent(), /^1 email\s*last /);
  assert.deepEqual((await markRow.locator("a[title$='logged']").allTextContents()).map((t) => t.trim()), ["0", "0", "0", "0"], "no activity counted");
  await page.goto(`${BASE}/dashboard/companies?q=Mail%20Co`);
  assert.match(await page.locator("[data-testid=company-row] [data-testid=marketing-cell]").textContent(), /^1 email/);
  assert.equal((await page.locator("[data-testid=company-row] td:nth-child(2)").textContent()).trim(), "Not yet");
  await page.goto(`${BASE}/dashboard/contacts/${markId}`);
  const line = page.locator("[data-testid=activity-line][data-marketing='1']");
  await line.waitFor();
  assert.match(await line.textContent(), /Emailed “Fall offer”/);
  assert.equal(await line.locator("[data-testid=marketing-badge]").count(), 1, "the feed line wears a Marketing badge");
  await page.locator("text=No touches yet").waitFor();
  assert.deepEqual(await contactsAt(page, "q=Mark%20Mailer&act=never"), ["Mark Mailer"], "a marketing send leaves them Never touched");
  assert.deepEqual(await contactsAt(page, "q=Mark%20Mailer&act=t7"), [], "and not Touched in the last 7 days");
  await shot(page, "01-marketing");

  // ---------------------------------------------------------------------
  log("Import: assign everyone in the file to Nic, then a re-import with Unassigned keeps him");
  const fileA = path.join(OUT, "assign-a.csv");
  fs.writeFileSync(fileA, "Name,Email,Company Name\nIvy Import,ivy@crmdata.example.com,Import Co\nIan Import,ian@crmdata.example.com,Import Co\n");
  await page.goto(`${BASE}/dashboard/contacts`);
  await page.getByTestId("import-csv").click();
  await page.getByTestId("import-file").setInputFiles(fileA);
  await page.getByTestId("import-summary").waitFor();
  assert.equal(await page.getByTestId("import-assign").inputValue(), "", "the file starts Unassigned");
  await page.getByTestId("import-assign").selectOption(nicId);
  await page.getByTestId("import-start").click();
  await page.getByText("Imported 2 rows").waitFor();
  await page.getByTestId("import-done").click();
  let imported = (await sql(`SELECT name, "ownerId", "createdById" FROM "Contact" WHERE "organizationId"=$1 AND name LIKE 'I% Import' ORDER BY name`, [org])).rows;
  assert.deepEqual(imported.map((r) => [r.name, r.ownerId, r.createdById]), [
    ["Ian Import", nicId, taylor.id],
    ["Ivy Import", nicId, taylor.id],
  ]);
  const importCo = (await sql(`SELECT "ownerId", "createdById" FROM "Company" WHERE "organizationId"=$1 AND name='Import Co'`, [org])).rows[0];
  assert.deepEqual([importCo.ownerId, importCo.createdById], [nicId, taylor.id], "the new company goes to Nic too");
  const fileB = path.join(OUT, "assign-b.csv");
  fs.writeFileSync(fileB, "Name,Email,Title\nIvy Import,ivy@crmdata.example.com,Buyer\nIke Import,ike@crmdata.example.com,\n");
  await page.getByTestId("import-csv").click();
  await page.getByTestId("import-file").setInputFiles(fileB);
  await page.getByTestId("import-summary").waitFor();
  await page.getByTestId("import-start").click();
  await page.getByText("Imported 2 rows").waitFor();
  await page.getByTestId("import-done").click();
  imported = (await sql(`SELECT name, "ownerId", title FROM "Contact" WHERE "organizationId"=$1 AND name IN ('Ivy Import','Ike Import') ORDER BY name`, [org])).rows;
  assert.deepEqual(imported.map((r) => [r.name, r.ownerId, r.title]), [
    ["Ike Import", null, null],
    ["Ivy Import", nicId, "Buyer"],
  ], "an Unassigned re-import never takes a rep away");

  // ---------------------------------------------------------------------
  log("bulk Assign to me / Assign to… / Unassign on ticked rows");
  await page.goto(`${BASE}/dashboard/contacts?q=Import`);
  await rowOf(page, "Ike Import").locator("[data-testid=row-check]").check();
  await rowOf(page, "Ivy Import").locator("[data-testid=row-check]").check();
  assert.equal((await page.getByTestId("bulk-count").textContent()).trim(), "2 selected");
  await page.getByTestId("bulk-me").click();
  await page.getByTestId("bulk-message").filter({ hasText: "2 records → Taylor Test." }).waitFor();
  const owners = async () =>
    Object.fromEntries((await sql(`SELECT name, "ownerId" FROM "Contact" WHERE "organizationId"=$1 AND name LIKE 'I% Import'`, [org])).rows.map((r) => [r.name, r.ownerId]));
  assert.deepEqual(await owners(), { "Ike Import": taylor.id, "Ivy Import": taylor.id, "Ian Import": nicId });
  await page.reload();
  await rowOf(page, "Ike Import").locator("[data-testid=row-check]").check();
  await page.getByTestId("bulk-to").selectOption(nicId);
  await page.getByTestId("bulk-assign").click();
  await page.getByTestId("bulk-message").filter({ hasText: "1 record → Nic Rivera." }).waitFor();
  await page.reload();
  await page.getByTestId("page-check").check();
  assert.equal((await page.getByTestId("bulk-count").textContent()).trim(), "3 selected");
  await page.getByTestId("bulk-unassign").click();
  await page.getByTestId("bulk-message").filter({ hasText: "3 records → Unassigned." }).waitFor();
  assert.deepEqual(await owners(), { "Ike Import": null, "Ivy Import": null, "Ian Import": null });
  await page.reload();
  assert.deepEqual(
    (await page.locator("[data-testid=contact-row] [data-testid=rep-cell]").allTextContents()).map((t) => t.trim()),
    ["Unassigned", "Unassigned", "Unassigned"],
  );

  log("bulk on every record matching the filters, 1,000 at a go");
  await sql(
    `INSERT INTO "Contact" (id, "organizationId", name, title, "updatedAt")
     SELECT 'cd_bulk_' || g, $1, 'Bulk Person ' || g, 'Bulk Tester', now() - (g || ' minutes')::interval FROM generate_series(1, 1005) g`,
    [org],
  );
  await page.goto(`${BASE}/dashboard/contacts?q=Bulk%20Person`);
  await page.getByTestId("page-check").check();
  await page.getByTestId("bulk-all").click();
  assert.equal((await page.getByTestId("bulk-count").textContent()).trim(), "The first 1,000 of 1,005 matching");
  await page.getByTestId("bulk-me").click();
  await page.getByTestId("bulk-message").filter({ hasText: "1,000 records → Taylor Test. 5 more still match" }).waitFor();
  const bulkMine = async () => Number((await sql(`SELECT count(*) FROM "Contact" WHERE "organizationId"=$1 AND id LIKE 'cd_bulk_%' AND "ownerId"=$2`, [org, taylor.id])).rows[0].count);
  assert.equal(await bulkMine(), 1000, "exactly 1,000 in one go");
  // The rest: Rep = Unassigned plus the search, all matching.
  await page.goto(`${BASE}/dashboard/contacts?q=Bulk%20Person&rep=none&per=10`);
  assert.match(await page.getByTestId("page-summary").textContent(), /of 5 contacts/);
  await page.getByTestId("page-check").check();
  await page.getByTestId("bulk-to").selectOption(nicId);
  await page.getByTestId("bulk-assign").click();
  await page.getByTestId("bulk-message").filter({ hasText: "5 records → Nic Rivera." }).waitFor();
  assert.equal(Number((await sql(`SELECT count(*) FROM "Contact" WHERE "organizationId"=$1 AND id LIKE 'cd_bulk_%' AND "ownerId"=$2`, [org, nicId])).rows[0].count), 5);
  // And back: the whole page of Nic's five, Unassign.
  await page.goto(`${BASE}/dashboard/contacts?q=Bulk%20Person&rep=${nicId}&per=10`);
  await page.getByTestId("page-check").check();
  await page.getByTestId("bulk-unassign").click();
  await page.getByTestId("bulk-message").filter({ hasText: "5 records → Unassigned." }).waitFor();
  await sql(`DELETE FROM "Contact" WHERE "organizationId"=$1 AND id LIKE 'cd_bulk_%'`, [org]);

  log("bulk assign on Companies");
  await page.goto(`${BASE}/dashboard/companies?q=Import%20Co`);
  await page.locator("[data-testid=company-row] [data-testid=row-check]").first().check();
  await page.getByTestId("bulk-me").click();
  await page.getByTestId("bulk-message").filter({ hasText: "1 record → Taylor Test." }).waitFor();
  assert.equal((await sql(`SELECT "ownerId" FROM "Company" WHERE "organizationId"=$1 AND name='Import Co'`, [org])).rows[0].ownerId, taylor.id);

  // ---------------------------------------------------------------------
  log("filters: seed a small cast");
  const towerCo = await seedCompany({ name: "Tower Living", email: "office@tower.example.com", phone: "512-555-0101", industries: ["Student"], companyTypes: ["Owner"] });
  const quietCo = await seedCompany({ name: "Quiet Partners", industries: ["MDU"] });
  const fresh = await seedContact({ name: "Fay Fresh", title: "Owner", mobile: "512-555-1001", email: "fay@x.example.com", companyId: towerCo, ownerId: nicId, createdById: nicId });
  const month = await seedContact({ name: "Moe Month", title: "OWNER", companyId: quietCo, createdById: taylor.id, createdAt: "2026-01-15T12:00:00Z" });
  const mkt = await seedContact({ name: "Max Marketing", title: "Property Manager", mobile: "512-555-1003", ownerId: nicId, createdById: taylor.id, createdAt: "2026-01-20T12:00:00Z" });
  const nobody = await seedContact({ name: "Ned Never", title: "Property Manager", email: "ned@x.example.com", createdById: nicId });
  await seedActivity(fresh, 3);
  await seedActivity(month, 40);
  await seedActivity(mkt, 1, true);
  const opp = "cd_opp_1";
  await sql(`INSERT INTO "Opportunity" (id, "organizationId", title, "leadLabel", "updatedAt") VALUES ($1, $2, 'Tower deal', 'Client', now())`, [opp, org]);
  await sql(`INSERT INTO "OpportunityContact" (id, "opportunityId", "contactId", role) VALUES ('cd_oc_1', $1, $2, 'PRIMARY')`, [opp, fresh]);
  await sql(`INSERT INTO "Opportunity" (id, "organizationId", title, "leadLabel", "updatedAt") VALUES ('cd_opp_2', $1, 'Ned deal', 'Hot Lead', now())`, [org]);
  await sql(`INSERT INTO "OpportunityContact" (id, "opportunityId", "contactId", role) VALUES ('cd_oc_2', 'cd_opp_2', $1, 'PRIMARY')`, [nobody]);
  await sql(`INSERT INTO "LeadLabelOption" (id, "organizationId", name) VALUES ('cd_ll_1', $1, 'Hot Lead'), ('cd_ll_2', $1, 'Warm')`, [org]);
  const cast = ["Fay Fresh", "Max Marketing", "Moe Month", "Ned Never"];
  const only = (names) => names.filter((n) => cast.includes(n));

  log("filter: Activity touched / not touched / never, a marketing send never counting");
  assert.deepEqual(only(await contactsAt(page, "act=t7")), ["Fay Fresh"]);
  assert.deepEqual(only(await contactsAt(page, "act=t90")), ["Fay Fresh", "Moe Month"]);
  assert.deepEqual(only(await contactsAt(page, "act=n30")), ["Max Marketing", "Moe Month", "Ned Never"]);
  assert.deepEqual(only(await contactsAt(page, "act=never")), ["Max Marketing", "Ned Never"]);
  assert.deepEqual((await companiesAt(page, "act=t7")).filter((n) => ["Tower Living", "Quiet Partners"].includes(n)), ["Tower Living"], "a company is touched through its people");
  assert.deepEqual((await companiesAt(page, "act=n7")).filter((n) => ["Tower Living", "Quiet Partners"].includes(n)), ["Quiet Partners"]);
  // From the bar itself.
  await page.goto(`${BASE}/dashboard/contacts`);
  await page.getByTestId("filter-activity").click();
  await page.getByRole("radio", { name: "Not touched in the last 90 days" }).click();
  await page.waitForURL(/act=n90/);
  await page.locator("[data-testid=active-filters]", { hasText: "Not touched in the last 90 days" }).waitFor();
  assert.deepEqual(only(await contactNames(page)), ["Max Marketing", "Ned Never"]);

  log("filter: Job title, ignoring case, with counts in the dropdown");
  assert.deepEqual(only(await contactsAt(page, "title=OWNER")), ["Fay Fresh", "Moe Month"]);
  await page.goto(`${BASE}/dashboard/contacts`);
  await page.getByTestId("filter-job-title").click();
  await page.getByRole("searchbox", { name: "Search job titles" }).fill("prop");
  const pmOption = page.locator("[aria-label='Job title'] label", { hasText: "Property Manager" });
  await pmOption.waitFor();
  assert.match(await pmOption.textContent(), /Property Manager\s*2/);
  await pmOption.locator("input").check();
  await page.waitForURL(/title=Property/);
  assert.deepEqual(only(await contactNames(page)), ["Max Marketing", "Ned Never"]);

  log("filter: Rep including Unassigned, Added by, Added between two days");
  assert.deepEqual(only(await contactsAt(page, `rep=${nicId}`)), ["Fay Fresh", "Max Marketing"]);
  assert.deepEqual(only(await contactsAt(page, "rep=none")), ["Moe Month", "Ned Never"]);
  assert.deepEqual(only(await contactsAt(page, `rep=none&rep=${nicId}`)), cast);
  assert.deepEqual(only(await contactsAt(page, `by=${nicId}`)), ["Fay Fresh", "Ned Never"]);
  assert.deepEqual(only(await contactsAt(page, "from=2026-01-01&to=2026-01-16")), ["Moe Month"]);
  assert.deepEqual(only(await contactsAt(page, "to=2026-01-31")), ["Max Marketing", "Moe Month"]);
  await page.goto(`${BASE}/dashboard/contacts`);
  await page.getByTestId("filter-added").click();
  await page.getByTestId("added-from").fill("2026-01-18");
  await page.getByTestId("added-to").fill("2026-01-25");
  await page.getByTestId("added-apply").click();
  await page.waitForURL(/from=2026-01-18&to=2026-01-25/);
  assert.deepEqual(only(await contactNames(page)), ["Max Marketing"]);
  assert.deepEqual(await companiesAt(page, `rep=${nicId}`), ["Bolt Builders"]);
  assert.deepEqual((await companiesAt(page, `by=${taylor.id}`)).sort(), ["Ann Holdings", "Bolt Builders", "Import Co"]);

  log("filter: has / has no mobile and email; companies' email and phone");
  assert.deepEqual(only(await contactsAt(page, "mobile=yes")), ["Fay Fresh", "Max Marketing"]);
  assert.deepEqual(only(await contactsAt(page, "mobile=no")), ["Moe Month", "Ned Never"]);
  assert.deepEqual(only(await contactsAt(page, "email=yes")), ["Fay Fresh", "Ned Never"]);
  assert.deepEqual(only(await contactsAt(page, "email=no")), ["Max Marketing", "Moe Month"]);
  assert.deepEqual((await companiesAt(page, "phone=yes")), ["Tower Living"]);
  assert.ok((await companiesAt(page, "email=no")).includes("Quiet Partners"));
  await page.goto(`${BASE}/dashboard/contacts`);
  await page.getByTestId("filter-contact-info").click();
  await page.getByTestId("presence-mobile-no").click();
  await page.waitForURL(/mobile=no/);
  await page.locator("[data-testid=active-filters]", { hasText: "No mobile" }).waitFor();

  log("filter: Lead Label on contacts and their companies");
  assert.deepEqual(only(await contactsAt(page, "label=Client")), ["Fay Fresh"]);
  assert.deepEqual(only(await contactsAt(page, "label=Client&label=Hot%20Lead")), ["Fay Fresh", "Ned Never"]);
  assert.deepEqual(await companiesAt(page, "label=Client"), ["Tower Living"]);

  log("a call logged from the page counts at once for the person and their company");
  await page.goto(`${BASE}/dashboard/contacts/${month}`);
  await page.locator("textarea[name=body]").first().fill("Called about the renewal");
  await page.click("button:has-text('Log phone call')");
  for (let i = 0; i < 40; i++) {
    if ((await sql(`SELECT "lastTouchAt" > now() - interval '1 hour' AS t FROM "Company" WHERE id=$1`, [quietCo])).rows[0].t) break;
    await page.waitForTimeout(150);
  }
  assert.deepEqual(only(await contactsAt(page, "act=t7")), ["Fay Fresh", "Moe Month"]);
  assert.ok((await companiesAt(page, "act=t7")).includes("Quiet Partners"));

  log("filters stack, and Clear all takes every one off");
  assert.deepEqual(only(await contactsAt(page, `rep=${nicId}&mobile=yes&title=owner&act=t30&label=Client&by=${nicId}`)), ["Fay Fresh"]);
  assert.deepEqual(only(await contactsAt(page, `rep=${nicId}&mobile=yes&title=owner&act=never`)), []);
  await page.goto(`${BASE}/dashboard/contacts?rep=${nicId}&title=Owner&mobile=yes&label=Client&act=t7&from=2026-01-01`);
  const chips = await page.locator("[data-testid=active-filters]").textContent();
  for (const text of ["Rep: Nic Rivera", "Title: Owner", "Has mobile", "Lead Label: Client", "Touched in the last 7 days", "Added from 2026-01-01"]) {
    assert.ok(chips.includes(text), `chip ${text} in ${chips}`);
  }
  await page.locator("[data-testid=active-filters] button:has-text('Clear all')").click();
  await page.waitForURL(/\/dashboard\/contacts$/);

  // ---------------------------------------------------------------------
  log("Labels: Industry — merge Student Housing into Student, de-duplicated, off the pick list");
  await sql(`INSERT INTO "IndustryOption" (id, "organizationId", name, "sortOrder") VALUES ('cd_ind_sh', $1, 'Student Housing', 50)`, [org]);
  await sql(`INSERT INTO "CompanyTypeOption" (id, "organizationId", "industryId", name) VALUES ('cd_type_sh', $1, 'cd_ind_sh', 'Dorm Operator')`, [org]);
  const sh1 = await seedCompany({ name: "Campus Beds", industries: ["Student Housing"] });
  const sh2 = await seedCompany({ name: "Uni Flats", industries: ["Student Housing", "Student"], companyTypes: ["Owner"] });
  const sh3 = await seedCompany({ name: "Retail Row", industries: ["Retail"] });
  await page.goto(`${BASE}/dashboard/labels`);
  const industryRow = (name) => page.locator(`[data-testid=labels-industry] [data-testid=label-row][data-name="${name}"]`);
  assert.match(await industryRow("Student Housing").getByTestId("label-count").textContent(), /^2 companies$/);
  await industryRow("Student Housing").getByTestId("label-merge").click();
  await industryRow("Student Housing").getByTestId("label-merge-into").selectOption("Student");
  await industryRow("Student Housing").getByTestId("label-merge-save").click();
  await page.locator("[data-testid=labels-industry] [data-testid=labels-result]", { hasText: 'Merged "Student Housing" into "Student": 2 companies changed.' }).waitFor();
  const inds = Object.fromEntries((await sql(`SELECT id, industries FROM "Company" WHERE id = ANY($1)`, [[sh1, sh2]])).rows.map((r) => [r.id, r.industries]));
  assert.deepEqual(inds[sh1], ["Student"]);
  assert.deepEqual(inds[sh2], ["Student"], "one Student, not two");
  assert.equal((await sql(`SELECT count(*)::int n FROM "IndustryOption" WHERE "organizationId"=$1 AND name='Student Housing'`, [org])).rows[0].n, 0, "off the pick list");
  assert.equal(
    (await sql(`SELECT i.name FROM "CompanyTypeOption" t JOIN "IndustryOption" i ON i.id = t."industryId" WHERE t.id='cd_type_sh'`)).rows[0].name,
    "Student",
    "its company types move under Student",
  );
  await industryRow("Student Housing").waitFor({ state: "detached" });

  log("Labels: Industry — rename, refused onto a name in use, and Retire / Restore");
  await industryRow("Retail").getByTestId("label-rename").click();
  await industryRow("Retail").getByTestId("label-rename-input").fill("student");
  await industryRow("Retail").getByTestId("label-rename-save").click();
  await page.locator("[data-testid=labels-industry]", { hasText: '"Student" already exists. Use Merge into…' }).waitFor();
  await industryRow("Retail").getByTestId("label-rename-input").fill("Retail Stores");
  await industryRow("Retail").getByTestId("label-rename-save").click();
  await page.locator("[data-testid=labels-result]", { hasText: 'Renamed "Retail" to "Retail Stores": 1 company changed.' }).waitFor();
  assert.deepEqual((await sql(`SELECT industries FROM "Company" WHERE id=$1`, [sh3])).rows[0].industries, ["Retail Stores"]);
  await industryRow("Construction").getByTestId("label-retire").click();
  await industryRow("Construction").getByTestId("label-retired").waitFor();
  await page.goto(`${BASE}/dashboard/companies/new`);
  await page.getByRole("checkbox", { name: "MDU" }).waitFor();
  assert.equal(await page.getByRole("checkbox", { name: "Construction" }).count(), 0, "a retired industry is off the form's pick list");
  const conCo = await seedCompany({ name: "Concrete Kings", industries: ["Construction"] });
  await page.goto(`${BASE}/dashboard/companies/${conCo}/edit`);
  await page.click("button:has-text('Save changes')");
  await page.waitForSelector("text=Company saved");
  assert.deepEqual((await sql(`SELECT industries FROM "Company" WHERE id=$1`, [conCo])).rows[0].industries, ["Construction"], "records keep a retired value");
  assert.ok((await companiesAt(page, "industry=Construction")).includes("Concrete Kings"), "and can still be filtered on");
  await page.goto(`${BASE}/dashboard/labels`);
  await industryRow("Construction").getByTestId("label-retire").click();
  await page.locator("[data-testid=labels-result]", { hasText: '"Construction" is back on the pick lists.' }).waitFor();

  log("Labels: Company Type — rename, merge into one an industry already has, retire");
  const typeRow = (name) => page.locator(`[data-testid=labels-type] [data-testid=label-row][data-name="${name}"]`);
  await sql(`UPDATE "Company" SET "companyTypes" = ARRAY['Capital Group','Developer'] WHERE id=$1`, [sh1]);
  await typeRow("Capital Group").getByTestId("label-rename").click();
  await typeRow("Capital Group").getByTestId("label-rename-input").fill("Capital Partners");
  await typeRow("Capital Group").getByTestId("label-rename-save").click();
  await page.locator("[data-testid=labels-type] [data-testid=labels-result]", { hasText: "1 company changed" }).waitFor();
  assert.deepEqual((await sql(`SELECT "companyTypes" FROM "Company" WHERE id=$1`, [sh1])).rows[0].companyTypes, ["Capital Partners", "Developer"]);
  assert.equal((await sql(`SELECT count(*)::int n FROM "CompanyTypeOption" WHERE "organizationId"=$1 AND name='Capital Partners'`, [org])).rows[0].n, 2, "under MDU and Student");
  await typeRow("Developer").getByTestId("label-merge").click();
  await typeRow("Developer").getByTestId("label-merge-into").selectOption("Owner");
  await typeRow("Developer").getByTestId("label-merge-save").click();
  await page.locator("[data-testid=labels-type] [data-testid=labels-result]", { hasText: 'Merged "Developer" into "Owner"' }).waitFor();
  assert.deepEqual((await sql(`SELECT "companyTypes" FROM "Company" WHERE id=$1`, [sh1])).rows[0].companyTypes, ["Capital Partners", "Owner"]);
  assert.equal((await sql(`SELECT count(*)::int n FROM "CompanyTypeOption" WHERE "organizationId"=$1 AND name='Developer'`, [org])).rows[0].n, 0);
  assert.equal(await typeRow("Distributor").getByTestId("label-rename").count(), 0, "Distributor is kept for the supplier pickers");
  await typeRow("Gates").getByTestId("label-retire").click();
  await typeRow("Gates").getByTestId("label-retired").waitFor();

  log("Labels: Lead Label — custom merged into a built-in, renamed, retired; built-ins can't be renamed");
  const leadRow = (name) => page.locator(`[data-testid=labels-lead] [data-testid=label-row][data-name="${name}"]`);
  assert.equal(await leadRow("Client").getByTestId("label-rename").count(), 0, "a built-in has no Rename");
  await leadRow("Hot Lead").getByTestId("label-merge").click();
  await leadRow("Hot Lead").getByTestId("label-merge-into").selectOption("Client");
  await leadRow("Hot Lead").getByTestId("label-merge-save").click();
  await page.locator("[data-testid=labels-lead] [data-testid=labels-result]", { hasText: 'Merged "Hot Lead" into "Client": 1 opportunity changed.' }).waitFor();
  assert.equal((await sql(`SELECT "leadLabel" FROM "Opportunity" WHERE id='cd_opp_2'`)).rows[0].leadLabel, "Client");
  assert.equal((await sql(`SELECT count(*)::int n FROM "LeadLabelOption" WHERE "organizationId"=$1 AND name='Hot Lead'`, [org])).rows[0].n, 0);
  await leadRow("Warm").getByTestId("label-rename").click();
  await leadRow("Warm").getByTestId("label-rename-input").fill("Warm Lead");
  await leadRow("Warm").getByTestId("label-rename-save").click();
  await leadRow("Warm Lead").waitFor();
  await leadRow("Warm Lead").getByTestId("label-retire").click();
  await leadRow("Warm Lead").getByTestId("label-retired").waitFor();
  assert.equal((await sql(`SELECT "retiredAt" IS NOT NULL r FROM "LeadLabelOption" WHERE "organizationId"=$1 AND name='Warm Lead'`, [org])).rows[0].r, true);

  log("Labels: Job Title — merge spellings ignoring case, and rename");
  const titleRow = (name) => page.locator(`[data-testid=labels-title] [data-testid=label-row][data-name="${name}"]`);
  assert.match(await titleRow("Owner").getByTestId("label-count").textContent(), /^3 contacts$/, "Owner and OWNER are one title");
  await titleRow("Property Manager").getByTestId("label-merge").click();
  await titleRow("Property Manager").getByTestId("label-merge-into").selectOption("Owner");
  await titleRow("Property Manager").getByTestId("label-merge-save").click();
  await page.locator("[data-testid=labels-title] [data-testid=labels-result]", { hasText: 'Merged "Property Manager" into "Owner": 2 contacts changed.' }).waitFor();
  await titleRow("Owner").getByTestId("label-rename").click();
  await titleRow("Owner").getByTestId("label-rename-input").fill("Property Owner");
  await titleRow("Owner").getByTestId("label-rename-save").click();
  await page.locator("[data-testid=labels-title] [data-testid=labels-result]", { hasText: "5 contacts changed" }).waitFor();
  const titles = (await sql(`SELECT DISTINCT title FROM "Contact" WHERE id = ANY($1)`, [[fresh, month, mkt, nobody, annId]])).rows.map((r) => r.title);
  assert.deepEqual(titles, ["Property Owner"]);
  assert.equal(await titleRow("Owner").getByTestId("label-retire").count(), 0, "a job title has nothing to retire");
  await shot(page, "02-labels");

  log("a Member sees the Labels screen and its counts, with nothing to change");
  const memberCtx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const member = await memberCtx.newPage();
  await login(member, NIC_EMAIL);
  await member.goto(`${BASE}/dashboard/labels`);
  await member.getByTestId("labels-readonly").waitFor();
  assert.ok((await member.locator("[data-testid=label-row]").count()) > 5);
  assert.equal(await member.getByTestId("label-rename").count(), 0);
  assert.equal(await member.getByTestId("label-merge").count(), 0);
  assert.equal(await member.getByTestId("label-retire").count(), 0);
  await member.locator("aside nav a.nav-item", { hasText: "Labels" }).waitFor();
  await memberCtx.close();

  // ---------------------------------------------------------------------
  log("duplicate finder: contacts by email, phone and name at the same company");
  const dupCo = await seedCompany({ name: "Acme, Inc.", website: "https://www.acme.example.com/about", phone: "(512) 555-0199" });
  await seedCompany({ name: "acme inc", website: "acme.example.com", phone: "+1 512.555.0199" });
  await seedCompany({ name: "ACME Inc", website: "http://other.example.com" });
  const d1 = await seedContact({ name: "Dee Dupe", email: "Dee@Dupe.example.com", phone: "(512) 555-7000", companyId: dupCo, createdAt: "2026-02-01T00:00:00Z" });
  const d2 = await seedContact({ name: "Dee  Dupe", email: "dee@dupe.example.com", mobile: "512.555.7000", companyId: dupCo });
  const d3 = await seedContact({ name: "D. Dupe", phone: "+1 512 555 7000" });
  await page.goto(`${BASE}/dashboard/contacts`);
  await page.getByTestId("find-duplicates").click();
  await page.waitForURL(/\/dashboard\/contacts\/duplicates/);
  const groupFor = (key) => page.locator("[data-testid=dup-group]", { has: page.locator(`[data-testid=dup-key]:text-is("${key}")`) });
  await groupFor("dee@dupe.example.com").waitFor();
  assert.equal(await groupFor("dee@dupe.example.com").locator("[data-testid=dup-record]").count(), 2);
  await page.getByTestId("dup-tab-phone").click();
  await groupFor("5125557000").waitFor();
  assert.equal(await groupFor("5125557000").locator("[data-testid=dup-record]").count(), 3, "three ways of writing one number");
  await page.getByTestId("dup-tab-name").click();
  await groupFor("dee dupe").waitFor();
  assert.equal(await groupFor("dee dupe").locator("[data-testid=dup-record]").count(), 2);
  await shot(page, "03-duplicates");

  log("merging from a group uses the Merge flow with the group picked, and the group goes");
  await page.getByTestId("dup-tab-email").click();
  await groupFor("dee@dupe.example.com").getByTestId("duplicate-merge").click();
  const dialog = page.getByTestId("merge-dialog");
  assert.equal(await dialog.locator("[data-testid=merge-picked] li").count(), 2, "both pre-picked");
  assert.equal(await dialog.locator("input[type=radio]:checked").count(), 1);
  await dialog.getByTestId("merge-go").click();
  await dialog.getByTestId("merge-yes").click();
  await dialog.waitFor({ state: "detached" });
  await page.waitForURL(/duplicates/);
  await page.locator("text=No duplicates found").waitFor();
  const left = (await sql(`SELECT id FROM "Contact" WHERE id = ANY($1)`, [[d1, d2, d3]])).rows.map((r) => r.id).sort();
  assert.deepEqual(left, [d1, d3].sort(), "the oldest is kept");

  log("duplicate finder: companies by name ignoring punctuation, website domain and phone");
  await page.goto(`${BASE}/dashboard/companies/duplicates`);
  await groupFor("acmeinc").waitFor();
  assert.equal(await groupFor("acmeinc").locator("[data-testid=dup-record]").count(), 3);
  await page.getByTestId("dup-tab-domain").click();
  await groupFor("acme.example.com").waitFor();
  assert.equal(await groupFor("acme.example.com").locator("[data-testid=dup-record]").count(), 2);
  await page.getByTestId("dup-tab-phone").click();
  await groupFor("5125550199").waitFor();

  // ---------------------------------------------------------------------
  // Audit fixes (Nov 10, 2026): one step per confirmed defect.
  log("audit fixes: the edit form's Rep box keeps a rep changed on it through the next save");
  const rex = await seedContact({ name: "Rex Rep", ownerId: taylor.id });
  await page.goto(`${BASE}/dashboard/contacts/${rex}/edit`);
  await page.selectOption("[data-testid=rep-field]", nicId);
  await page.click("button:has-text('Save changes')");
  await page.waitForSelector("text=Contact saved");
  assert.equal((await sql(`SELECT "ownerId" FROM "Contact" WHERE id=$1`, [rex])).rows[0].ownerId, nicId);
  await page.waitForFunction(() => document.querySelector("[data-testid=rep-field]")?.value === "usr_crmdata_nic");
  await page.fill("[name=title]", "Second Save");
  await page.click("button:has-text('Save changes')");
  for (let i = 0; i < 40; i++) {
    if ((await sql(`SELECT title FROM "Contact" WHERE id=$1`, [rex])).rows[0].title === "Second Save") break;
    await page.waitForTimeout(150);
  }
  const rexRow = (await sql(`SELECT title, "ownerId" FROM "Contact" WHERE id=$1`, [rex])).rows[0];
  assert.equal(rexRow.title, "Second Save");
  assert.equal(rexRow.ownerId, nicId, "the second save doesn't put the old rep back");

  log("audit fixes: bulk all-matching run again reaches the next 1,000, not the same ones");
  await sql(
    `INSERT INTO "Contact" (id, "organizationId", name, "updatedAt")
     SELECT 'cd_again_' || g, $1, 'Again Person ' || g, now() - (g || ' minutes')::interval FROM generate_series(1, 1005) g`,
    [org],
  );
  for (const expected of ["1,000 records → Taylor Test. 5 more still match", "5 records → Taylor Test."]) {
    await page.goto(`${BASE}/dashboard/contacts?q=Again%20Person`);
    await page.getByTestId("page-check").check();
    await page.getByTestId("bulk-all").click();
    await page.getByTestId("bulk-me").click();
    await page.getByTestId("bulk-message").filter({ hasText: expected }).waitFor();
  }
  assert.equal(
    Number((await sql(`SELECT count(*) FROM "Contact" WHERE "organizationId"=$1 AND id LIKE 'cd_again_%' AND "ownerId"=$2`, [org, taylor.id])).rows[0].count),
    1005,
    "two runs cover all 1,005",
  );
  await sql(`DELETE FROM "Contact" WHERE "organizationId"=$1 AND id LIKE 'cd_again_%'`, [org]);

  log("audit fixes: Find duplicates — a second merge on a group still listed picks the records left");
  const seven = [];
  for (let i = 1; i <= 7; i++) seven.push(await seedContact({ name: `Sev Dupe ${i}`, email: "seven@dupe.example.com", createdAt: `2026-0${i}-01T00:00:00Z` }));
  await page.goto(`${BASE}/dashboard/contacts/duplicates?by=email`);
  await groupFor("seven@dupe.example.com").getByTestId("duplicate-merge").click();
  assert.equal(await dialog.locator("[data-testid=merge-picked] li").count(), 5, "the first five");
  await dialog.getByTestId("merge-go").click();
  await dialog.getByTestId("merge-yes").click();
  await dialog.waitFor({ state: "detached" });
  await groupFor("seven@dupe.example.com").locator("[data-testid=dup-record]").nth(2).waitFor();
  assert.equal(await groupFor("seven@dupe.example.com").locator("[data-testid=dup-record]").count(), 3);
  await groupFor("seven@dupe.example.com").getByTestId("duplicate-merge").click();
  const pickedNow = (await dialog.locator("[data-testid=merge-picked] li .font-medium").allTextContents()).map((t) => t.trim());
  assert.deepEqual(pickedNow, ["Sev Dupe 1", "Sev Dupe 6", "Sev Dupe 7"], "the kept one and the two left, not the five merged");
  await dialog.getByTestId("merge-go").click();
  await dialog.getByTestId("merge-yes").click();
  await dialog.waitFor({ state: "detached" });
  assert.deepEqual((await sql(`SELECT id FROM "Contact" WHERE id = ANY($1)`, [seven])).rows.map((r) => r.id), [seven[0]]);

  log("audit fixes: Find duplicates past the last page shows the last page there is, not 0 groups");
  await seedContact({ name: "Pair One", email: "pair@dupe.example.com" });
  await seedContact({ name: "Pair Two", email: "pair@dupe.example.com" });
  await page.goto(`${BASE}/dashboard/contacts/duplicates?by=email&page=9`);
  await groupFor("pair@dupe.example.com").waitFor();
  assert.equal(await page.locator("text=No duplicates found").count(), 0);
  assert.equal(await page.getByText(/^0 groups that look like/).count(), 0, "the count comes from the page shown");

  log("audit fixes: Labels — a lead label renamed onto another's capitals says Merge into…, then merges");
  await sql(`INSERT INTO "LeadLabelOption" (id, "organizationId", name) VALUES ('cd_lead_vip1', $1, 'vip'), ('cd_lead_vip2', $1, 'VIP')`, [org]);
  await sql(`UPDATE "Opportunity" SET "leadLabel"='vip' WHERE id='cd_opp_1'`);
  await page.goto(`${BASE}/dashboard/labels`);
  await leadRow("vip").getByTestId("label-rename").click();
  await leadRow("vip").getByTestId("label-rename-input").fill("VIP");
  await leadRow("vip").getByTestId("label-rename-save").click();
  await page.locator("[data-testid=labels-lead]", { hasText: '"VIP" already exists. Use Merge into… to fold "vip" into it.' }).waitFor();
  await page.goto(`${BASE}/dashboard/labels`);
  await leadRow("vip").getByTestId("label-merge").click();
  await leadRow("vip").getByTestId("label-merge-into").selectOption("VIP");
  await leadRow("vip").getByTestId("label-merge-save").click();
  await page.locator("[data-testid=labels-lead] [data-testid=labels-result]", { hasText: 'Merged "vip" into "VIP": 1 opportunity changed.' }).waitFor();
  assert.equal((await sql(`SELECT "leadLabel" FROM "Opportunity" WHERE id='cd_opp_1'`)).rows[0].leadLabel, "VIP");

  log("audit fixes: Labels — a stray 'distributor' folds into Distributor; Service Provider stays put");
  const mduId = (await sql(`SELECT id FROM "IndustryOption" WHERE "organizationId"=$1 AND name='MDU'`, [org])).rows[0].id;
  await sql(`INSERT INTO "CompanyTypeOption" (id, "organizationId", "industryId", name) VALUES ('cd_type_dist', $1, $2, 'distributor')`, [org, mduId]);
  const strayCo = await seedCompany({ name: "Stray Supply", industries: ["MDU"], companyTypes: ["distributor"] });
  await page.goto(`${BASE}/dashboard/labels`);
  assert.equal(await typeRow("Distributor").getByTestId("label-merge").count(), 0, "the real one stays locked");
  assert.equal(await industryRow("Service Provider").getByTestId("label-merge").count(), 0, "where new suppliers are filed");
  assert.equal(await industryRow("Service Provider").getByTestId("label-rename").count(), 0);
  await typeRow("distributor").getByTestId("label-merge").click();
  await typeRow("distributor").getByTestId("label-merge-into").selectOption("Distributor");
  await typeRow("distributor").getByTestId("label-merge-save").click();
  await page.locator("[data-testid=labels-type] [data-testid=labels-result]", { hasText: 'Merged "distributor" into "Distributor": 1 company changed.' }).waitFor();
  assert.deepEqual((await sql(`SELECT "companyTypes" FROM "Company" WHERE id=$1`, [strayCo])).rows[0].companyTypes, ["Distributor"]);

  log("audit fixes: Labels — a job title with doubled spaces is one group and can be merged into");
  const sm1 = await seedContact({ name: "Sam Spaces", title: "Sales  Manager" });
  const sm2 = await seedContact({ name: "Sal Spaces", title: "Sales  Manager" });
  const sm3 = await seedContact({ name: "Sid Short", title: "Sales Mgr" });
  await page.goto(`${BASE}/dashboard/labels`);
  assert.match(await titleRow("Sales Manager").getByTestId("label-count").textContent(), /^2 contacts$/);
  await titleRow("Sales Mgr").getByTestId("label-merge").click();
  await titleRow("Sales Mgr").getByTestId("label-merge-into").selectOption("Sales Manager");
  await titleRow("Sales Mgr").getByTestId("label-merge-save").click();
  await page.locator("[data-testid=labels-title] [data-testid=labels-result]", { hasText: 'Merged "Sales Mgr" into "Sales Manager": 1 contact changed.' }).waitFor();
  await page.goto(`${BASE}/dashboard/labels`);
  assert.match(await titleRow("Sales Manager").getByTestId("label-count").textContent(), /^3 contacts$/, "one group of three");
  assert.equal((await sql(`SELECT count(*)::int n FROM "Contact" WHERE id = ANY($1) AND title='Sales Mgr'`, [[sm1, sm2, sm3]])).rows[0].n, 0);

  log("audit fixes: a touch dated ahead isn't a touch until its time comes");
  const fu = await seedContact({ name: "Fu Future" });
  const sue = await seedContact({ name: "Sue Soon" });
  await sql(
    `INSERT INTO "Activity" (id, "organizationId", "contactId", "userId", type, body, "occurredAt")
     VALUES ('cd_act_future', $1, $2, $3, 'PHONE_CALL', 'Follow-up ticked Done early', now() + interval '14 days'),
            ('cd_act_soon', $1, $4, $3, 'PHONE_CALL', 'Logged for a few seconds from now', now() + interval '4 seconds')`,
    [org, fu, taylor.id, sue],
  );
  assert.equal((await sql(`SELECT "lastTouchAt" FROM "Contact" WHERE id=$1`, [sue])).rows[0].lastTouchAt, null, "not yet");
  const neverNow = await contactsAt(page, "act=never");
  assert.ok(neverNow.includes("Fu Future"), "a call two weeks out leaves them never touched");
  assert.ok(!(await contactsAt(page, "act=t7")).includes("Fu Future"));
  await page.waitForTimeout(4500);
  assert.ok((await contactsAt(page, "act=t7")).includes("Sue Soon"), "once its time has passed it counts");
  assert.notEqual((await sql(`SELECT "lastTouchAt" FROM "Contact" WHERE id=$1`, [sue])).rows[0].lastTouchAt, null);

  // ---------------------------------------------------------------------
  // UX review fixes (Nov 10, 2026): one step per confirmed defect.
  log("audit fixes (UX review): Rep, Added by, Contact info and Lead Label open inside a 1440 window, every name whole");
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const list of ["contacts", "companies"]) {
    await page.goto(`${BASE}/dashboard/${list}`);
    for (const id of ["filter-rep", "filter-added-by", "filter-contact-info", "filter-lead-label"]) {
      const menu = await openMenu(page, id);
      await assertMenuInside(page, menu, `${list} ${id}`);
      if (id === "filter-rep") {
        const names = (await menu.locator("label span").allTextContents()).map((t) => t.trim());
        assert.equal(names[0], "Unassigned");
        assert.deepEqual(names.slice(1).sort(), ["Nic Rivera", "Taylor Test"], "every rep listed by their whole name");
      }
      await page.keyboard.press("Escape");
      await menu.waitFor({ state: "detached" });
    }
  }
  await page.goto(`${BASE}/dashboard/contacts`);
  const repMenu = await openMenu(page, "filter-rep");
  await repMenu.getByText("Nic Rivera", { exact: true }).click();
  await page.waitForURL(new RegExp(`rep=${nicId}`));
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1500, height: 950 });

  log("audit fixes (UX review): on a phone, Contact info's None buttons can be pressed and the Pipeline's Lead Label menu stays on the screen");
  const uxPhone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const up = await uxPhone.newPage();
  await login(up, EMAIL);
  await up.goto(`${BASE}/dashboard/contacts`);
  const info = await openMenu(up, "filter-contact-info");
  await assertMenuInside(up, info, "phone Contact info");
  for (const field of ["mobile", "email"]) {
    const none = await up.getByTestId(`presence-${field}-no`).boundingBox();
    assert.ok(none.x >= 0 && none.x + none.width <= 390, `${field}'s None at ${Math.round(none.x)}–${Math.round(none.x + none.width)}`);
  }
  await up.getByTestId("presence-mobile-no").tap();
  await up.waitForURL(/mobile=no/);
  await up.locator("[data-testid=active-filters]", { hasText: "No mobile" }).waitFor();
  await up.keyboard.press("Escape");
  for (const id of ["filter-rep", "filter-added-by", "filter-lead-label"]) {
    const menu = await openMenu(up, id);
    await assertMenuInside(up, menu, `phone ${id}`);
    await up.keyboard.press("Escape");
    await menu.waitFor({ state: "detached" });
  }
  await up.goto(`${BASE}/dashboard/deals`);
  const leadMenu = await openMenu(up, "filter-lead-label");
  await assertMenuInside(up, leadMenu, "phone Pipeline Lead Label");
  const integration = await leadMenu.locator("label", { hasText: "Software Integration" }).boundingBox();
  assert.ok(integration.x >= 0 && integration.x + integration.width <= 390, "Software Integration is on the screen");
  await shot(up, "05-ux-pipeline-lead-label-phone");
  await uxPhone.close();

  log("audit fixes (UX review): search finds a job title, and a person by their name plus their company");
  assert.deepEqual(await contactsAt(page, "q=sales%20manager"), ["Sal Spaces", "Sam Spaces", "Sid Short"], "Sales Manager, doubled spaces and all");
  assert.deepEqual(await contactsAt(page, "q=fay%20tower"), ["Fay Fresh"], "Fay at Tower Living");
  assert.deepEqual(await contactsAt(page, "q=living%20fay"), ["Fay Fresh"], "either order");

  // ---------------------------------------------------------------------
  log("the phone width: lists, Labels and duplicates stay inside the screen");
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await phone.newPage();
  await login(p, EMAIL);
  for (const url of ["/dashboard/contacts", "/dashboard/companies", "/dashboard/labels", "/dashboard/contacts/duplicates?by=phone"]) {
    await p.goto(`${BASE}${url}`);
    await p.locator("h1").first().waitFor();
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 1, `${url} scrolls sideways by ${overflow}px`);
  }
  await p.goto(`${BASE}/dashboard/contacts`);
  await p.locator("[data-testid=contact-row] [data-testid=row-check]").first().check();
  await p.getByTestId("bulk-bar").waitFor();
  const bar = await p.getByTestId("bulk-bar").boundingBox();
  assert.ok(bar.x >= 0 && bar.x + bar.width <= 391, "the bulk bar fits the phone");
  await shot(p, "04-phone");
  await phone.close();

  await browser.close();
  catcher.close();
  await db.end();
  console.log(`\nALL ${step} STEPS PASSED`);
})().catch(async (err) => {
  console.error("\nFAILED at step", step, "\n", err);
  process.exit(1);
});
