/* Browser regression for Contacts + Companies v2 (Sept 13, 2026).
 *
 * Covers: Industry and Company Type on the company and contact forms
 * ("+ Add new industry", "+ Add new company type", General for new
 * industries, Individual / Personal for a contact with no company, tags
 * shared through the company), the favorite star and the Favorite
 * Contacts / Favorite Companies sub-panes, the Contacts with Deals /
 * Companies with Deals sub-panes, the filter bar (search, State,
 * Industry, Company Type, Company, Favorites, With deals, Needs attention,
 * chips, Clear all), paging at 10 / 50 / 100, the CSV import (one file,
 * batched, companies auto-created from a bare name, blanks filled, a
 * re-import that updates instead of doubling), the template download and
 * the paged People list on a company.
 *
 * Runs against a built app (`npm run build:app && npx next start`) and a
 * local Postgres that has had `prisma migrate deploy` run against it. It
 * signs up its own workspace, activates it with SQL, and deletes it again
 * on the next run, so it never touches real data. Never point it at the
 * live database.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/scb_test \
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules \
 *   node scripts/browser-tests/contacts-import-filters.cjs
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
const OUT = process.env.SHOTS_DIR || path.join(os.tmpdir(), "scb-browser-shots-cif");
fs.mkdirSync(OUT, { recursive: true });

const EMAIL = "test-cif@example.com";
const PASSWORD = "password123";
const COMPANY = "Test Import Filters Co";
const SLUG = "test-import-filters-co";

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
function chip(page, name) {
  return page.getByRole("checkbox", { name, exact: true });
}
async function pageSummary(page) {
  return (await page.getByTestId("page-summary").textContent()).trim();
}
async function rowCount(page, testId) {
  return page.getByTestId(testId).count();
}

(async () => {
  await sql(`DELETE FROM "Organization" WHERE slug LIKE '${SLUG}%'`);

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
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
  await sql(`UPDATE "Organization" SET status='ACTIVE', "reviewedAt"=now() WHERE slug LIKE '${SLUG}%'`);
  await login(page);
  const org = (await sql(`SELECT id FROM "Organization" WHERE slug LIKE '${SLUG}%'`)).rows[0].id;

  log("new company form: six industries seeded; MDU shows its four types; + Add new company type; + Add new industry gets General");
  await page.goto(`${BASE}/dashboard/companies/new`);
  for (const name of ["MDU", "Student", "Commercial", "Construction", "Small Business", "Service Provider"]) {
    await chip(page, name).waitFor();
  }
  await page.getByText("Pick an industry first").waitFor();
  await chip(page, "MDU").click();
  for (const name of ["Owner", "Capital Group", "Developer", "Property Management"]) await chip(page, name).waitFor();
  await chip(page, "Owner").click();
  await page.getByRole("button", { name: "Add new company type" }).click();
  await page.getByLabel("New company type under MDU").fill("REIT");
  await page.keyboard.press("Enter");
  assert.equal(await chip(page, "REIT").getAttribute("aria-checked"), "true", "new type is ticked");
  await page.getByRole("button", { name: "Add new industry" }).click();
  await page.getByLabel("New industry name").fill("Hospitality");
  await page.keyboard.press("Enter");
  assert.equal(await chip(page, "Hospitality").getAttribute("aria-checked"), "true", "new industry is ticked");
  await chip(page, "General").waitFor();
  await page.fill("#name", "Acme Towers");
  await page.fill("#state", "texas");
  await shot(page, "01-company-form-tags");
  await page.getByRole("button", { name: "Save company" }).click();
  await page.waitForURL(/\/dashboard\/companies\/(?!new$)[a-z0-9]+$/);
  const acmeUrl = page.url();
  const acmeDetails = page.locator("dl").first();
  for (const tag of ["MDU", "Hospitality", "Owner", "REIT"]) assert.ok(await acmeDetails.getByText(tag, { exact: true }).isVisible(), `${tag} on company page`);
  assert.ok(await acmeDetails.getByText("TX", { exact: true }).isVisible(), "'texas' saved as TX");
  const opts = await sql(
    `SELECT i.name AS industry, t.name AS type FROM "CompanyTypeOption" t JOIN "IndustryOption" i ON i.id=t."industryId" WHERE t."organizationId"=$1 AND (t.name='REIT' OR i.name='Hospitality')`,
    [org],
  );
  assert.deepEqual(
    opts.rows.map((r) => `${r.industry}:${r.type}`).sort(),
    ["Hospitality:General", "MDU:REIT"],
    "REIT filed under MDU; Hospitality got General",
  );

  log("star the company on its page; it lands in Favorite Companies");
  await page.getByTestId("star").first().click();
  await page.waitForTimeout(400);
  await page.locator("aside").getByRole("link", { name: "Favorite Companies" }).click();
  await page.waitForURL(/\/dashboard\/companies\/favorites$/);
  await page.locator("tr", { hasText: "Acme Towers" }).waitFor();
  assert.equal(await page.getByTestId("filter-fav").count(), 0, "Favorites toggle hidden on the sub-pane");
  await shot(page, "02-favorite-companies");

  log("new contact: no company = Individual / Personal; picking Acme loads its tags; save writes tags to the company");
  await page.goto(`${BASE}/dashboard/contacts/new`);
  await page.getByText("Individual / Personal").waitFor();
  await page.fill("#companyName", "Acme");
  await page.getByRole("option", { name: "Acme Towers" }).click();
  await page.getByText("Existing").waitFor();
  assert.equal(await chip(page, "MDU").getAttribute("aria-checked"), "true", "company's industry preloaded on the contact form");
  assert.equal(await chip(page, "Owner").getAttribute("aria-checked"), "true", "company's type preloaded");
  await chip(page, "Developer").click();
  await page.fill("#name", "Dana Owner");
  await page.fill("#email", "dana@acme.test");
  await page.fill("#state", "TX");
  await page.getByRole("button", { name: "Save contact" }).click();
  await page.waitForURL(/\/dashboard\/contacts\/(?!new$)[a-z0-9]+$/);
  const danaUrl = page.url();
  const danaDetails = page.locator("dl").first();
  assert.ok(await danaDetails.getByText("Developer", { exact: true }).isVisible(), "tag added from the contact form shows on the contact");
  const acmeTypes = (await sql(`SELECT "companyTypes" FROM "Company" WHERE name='Acme Towers' AND "organizationId"=$1`, [org])).rows[0].companyTypes;
  assert.ok(acmeTypes.includes("Developer"), "saving the contact tagged the company");

  log("a contact with no company reads Individual / Personal on its page");
  await page.goto(`${BASE}/dashboard/contacts/new`);
  await page.fill("#name", "Taylor Homeowner");
  await page.fill("#phone", "555-0199");
  await page.getByRole("button", { name: "Save contact" }).click();
  await page.waitForURL(/\/dashboard\/contacts\/(?!new$)[a-z0-9]+$/);
  assert.ok(await page.locator("dl").first().getByText("Individual / Personal").isVisible());

  log("template download has the system's field names, contact first then company");
  const template = await page.request.get(`${BASE}/dashboard/contacts/import-template`);
  assert.equal(template.status(), 200);
  const firstLine = (await template.text()).split("\r\n")[0];
  assert.equal(
    firstLine,
    "Name,Title,Email,Phone,Website,City,State,Birthday,Status,Company Name,Company Phone,Company Email,Company Website,Company City,Company State,Company Status,Industry,Company Type",
  );

  log("import a messy CSV: First/Last name, mixed headers, a company-only row, a duplicate, an individual, 60 people at one company");
  const rows = [
    "First Name,Last Name,Job Title,E-mail,Cell,ST,DOB,Lead Status,Company,Company Phone,Industry,Type",
    "Dana,Owner,CEO,dana@acme.test,555-1000,,,client,Acme Towers,555-2000,MDU,Owner",
    "Sam,Rivera,,sam@bluebird.test,555-1001,Texas,3/9/1984,Lead,Bluebird ISP,,Service Provider,Networks/ISP",
    "Sam,Rivera,,SAM@bluebird.test,,,,,Bluebird ISP,,,",
    "Pat,Solo,,,555-1002,CA,,,,,,",
    ",,,,,,,,Ghost Holdings LLC,555-3000,Commercial,",
    "Lee,Gates,Owner,lee@gates.test,,FL,,customer,Gates Co,,Service Provider,Gates; Access Control",
    "Ivy,Blank,,,,,,,,,,",
  ];
  for (let i = 1; i <= 60; i += 1) {
    rows.push(`Person,${String(i).padStart(2, "0")},,p${i}@bigco.test,,TX,,,Big Co,,Construction,`);
  }
  const csvPath = path.join(OUT, "import.csv");
  fs.writeFileSync(csvPath, rows.join("\r\n") + "\r\n");
  await page.goto(`${BASE}/dashboard/contacts`);
  await page.getByTestId("import-csv").click();
  await page.getByTestId("import-file").setInputFiles(csvPath);
  const summary = await page.getByTestId("import-summary").textContent();
  assert.match(summary, /65 contacts and 5 companies found/, summary); // Dana, Sam, Pat, Lee, Ivy + 60
  assert.match(summary, /1 rows are a company with no person/, summary);
  assert.match(summary, /1 duplicates skipped/, summary);
  await shot(page, "03-import-preview");
  await page.getByTestId("import-start").click();
  await page.getByText("Imported 66 rows").waitFor({ timeout: 60000 }); // 65 people + Ghost
  const totals = await page.getByTestId("import-totals").textContent();
  assert.match(totals, /Contacts added64/, totals); // everyone but Dana, who already existed
  assert.match(totals, /Contacts updated1/, totals);
  assert.match(totals, /Companies added4/, totals);
  assert.match(totals, /Companies updated1/, totals);
  await shot(page, "04-import-done");
  await page.getByTestId("import-done").click();
  const acme = (await sql(`SELECT phone, "companyTypes" FROM "Company" WHERE name='Acme Towers' AND "organizationId"=$1`, [org])).rows[0];
  assert.equal(acme.phone, "555-2000", "blank phone filled on the existing company");
  const dana = (await sql(`SELECT title, phone, "companyId" FROM "Contact" WHERE email='dana@acme.test' AND "organizationId"=$1`, [org])).rows;
  assert.equal(dana.length, 1, "Dana matched by email, not doubled");
  assert.equal(dana[0].title, "CEO");
  const sam = (await sql(`SELECT state, birthday::text AS birthday FROM "Contact" WHERE email='sam@bluebird.test' AND "organizationId"=$1`, [org])).rows[0];
  assert.equal(sam.state, "TX", "Texas normalised to TX on import");
  assert.equal(sam.birthday, "1984-03-09", "3/9/1984 read as a birthday");
  const gates = (await sql(`SELECT industries, "companyTypes" FROM "Company" WHERE name='Gates Co' AND "organizationId"=$1`, [org])).rows[0];
  assert.deepEqual(gates.industries, ["Service Provider"]);
  assert.deepEqual([...gates.companyTypes].sort(), ["Access Control", "Gates"]);
  const ghost = (await sql(`SELECT phone, industries FROM "Company" WHERE name='Ghost Holdings LLC' AND "organizationId"=$1`, [org])).rows[0];
  assert.equal(ghost.phone, "555-3000", "company-only row created the company");
  const seededGeneral = (await sql(`SELECT count(*)::int AS n FROM "CompanyTypeOption" t JOIN "IndustryOption" i ON i.id=t."industryId" WHERE i.name='Construction' AND t.name='General' AND t."organizationId"=$1`, [org])).rows[0].n;
  assert.equal(seededGeneral, 1, "Construction has General");

  log("re-importing the same file updates instead of doubling");
  await page.getByTestId("import-csv").click();
  await page.getByTestId("import-file").setInputFiles(csvPath);
  await page.getByTestId("import-start").click();
  await page.getByText("Imported 66 rows").waitFor({ timeout: 60000 });
  const totals2 = await page.getByTestId("import-totals").textContent();
  assert.match(totals2, /Contacts added0/, totals2);
  assert.match(totals2, /Contacts updated65/, totals2);
  assert.match(totals2, /Companies added0/, totals2);
  await page.getByTestId("import-done").click();
  const contactTotal = (await sql(`SELECT count(*)::int AS n FROM "Contact" WHERE "organizationId"=$1`, [org])).rows[0].n;
  assert.equal(contactTotal, 66, "66 contacts: 2 by hand + 64 imported");

  log("list pages 50 by default with a summary; per page 10 pages; page 2 keeps the setting");
  await page.goto(`${BASE}/dashboard/contacts`);
  assert.equal(await rowCount(page, "contact-row"), 50);
  assert.equal(await pageSummary(page), "Showing 1–50 of 66 contacts");
  await page.getByLabel("Rows per page").selectOption("10");
  await page.waitForURL(/per=10/);
  assert.equal(await rowCount(page, "contact-row"), 10);
  await page.getByRole("link", { name: "Page 2" }).click();
  await page.waitForURL(/page=2/);
  assert.equal(await pageSummary(page), "Showing 11–20 of 66 contacts");
  await page.getByLabel("Rows per page").selectOption("100");
  await page.waitForURL(/per=100/);
  assert.equal(await rowCount(page, "contact-row"), 66);
  await shot(page, "05-contacts-paged");

  log("search bar narrows by name, email and company");
  await page.goto(`${BASE}/dashboard/contacts`);
  await page.getByLabel("Search contacts…").fill("bluebird");
  await page.keyboard.press("Enter");
  await page.waitForURL(/q=bluebird/);
  assert.equal(await rowCount(page, "contact-row"), 1);
  assert.ok(await page.getByTestId("active-filters").getByText("“bluebird”").isVisible(), "search shows as a chip");

  log("State, Industry, Company Type and Company filters stack; Individual / Personal is a company type; chips remove; Clear all");
  await page.goto(`${BASE}/dashboard/contacts`);
  await page.getByTestId("filter-state").click();
  await page.getByRole("checkbox", { name: "TX" }).check();
  await page.waitForURL(/state=TX/);
  assert.equal(await pageSummary(page), "Showing 1–50 of 62 contacts", "TX: Dana + Sam + 60 at Big Co");
  await page.getByTestId("filter-industry").click();
  await page.getByRole("checkbox", { name: "Construction" }).check();
  await page.waitForURL(/industry=Construction/);
  assert.equal(await pageSummary(page), "Showing 1–50 of 60 contacts", "TX + Construction = Big Co");
  await page.getByTestId("filter-company-type").click();
  const typeChoices = await page.getByRole("listbox", { name: "Company type" }).getByRole("checkbox").allTextContents();
  void typeChoices;
  await page.getByRole("checkbox", { name: "Individual / Personal" }).check();
  await page.waitForURL(/type=Individual/);
  assert.equal(await pageSummary(page), "No contacts", "Construction AND Individual is empty");
  await shot(page, "06-filters-stacked");
  await page.getByTestId("active-filters").locator("span.badge", { hasText: "Industry: Construction" }).getByRole("button", { name: "Remove filter" }).click();
  await page.waitForURL(/^(?!.*industry=)/);
  await page.getByTestId("active-filters").locator("span.badge", { hasText: "State: TX" }).getByRole("button", { name: "Remove filter" }).click();
  await page.waitForURL(/^(?!.*state=)/);
  assert.equal(await pageSummary(page), "Showing 1–3 of 3 contacts", "Individual / Personal = Taylor Homeowner + Pat Solo + Ivy Blank");
  await page.getByRole("button", { name: "Clear all" }).click();
  await page.waitForURL(/\/dashboard\/contacts$/);
  assert.equal(await pageSummary(page), "Showing 1–50 of 66 contacts");
  await page.getByTestId("filter-company").click();
  await page.getByLabel("Search companies").fill("blue");
  await page.getByRole("checkbox", { name: /Bluebird ISP/ }).check();
  await page.waitForURL(/company=/);
  assert.equal(await pageSummary(page), "Showing 1–1 of 1 contacts");
  assert.ok(await page.getByTestId("active-filters").getByText("Company: Bluebird ISP").isVisible(), "company chip reads the name");

  log("Favorites toggle, Needs attention, With deals; the Deals sub-panes");
  await page.goto(`${BASE}/dashboard/contacts?q=rivera`);
  await page.locator("tr", { hasText: "Sam Rivera" }).getByTestId("star").click();
  await page.waitForTimeout(400);
  await page.goto(`${BASE}/dashboard/contacts`);
  await page.getByTestId("filter-fav").click();
  await page.waitForURL(/fav=1/);
  assert.equal(await pageSummary(page), "Showing 1–1 of 1 contacts");
  await page.locator("aside").getByRole("link", { name: "Favorite Contacts" }).click();
  await page.waitForURL(/\/dashboard\/contacts\/favorites$/);
  await page.locator("tr", { hasText: "Sam Rivera" }).waitFor();
  await page.goto(`${BASE}/dashboard/contacts?attn=1`);
  assert.equal(await pageSummary(page), "Showing 1–1 of 1 contacts", "needs attention: Ivy has no email and no phone");
  // Give Dana a deal, then the deal views light up.
  await page.goto(danaUrl);
  await page.fill("[name=title]", "Lobby access control");
  await page.fill("[name=value]", "2500");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByText("Lobby access control").first().waitFor();
  await page.goto(`${BASE}/dashboard/contacts?deals=1`);
  assert.equal(await pageSummary(page), "Showing 1–1 of 1 contacts");
  await page.locator("aside").getByRole("link", { name: "Contacts with Deals" }).click();
  await page.waitForURL(/\/dashboard\/contacts\/with-deals$/);
  await page.locator("tr", { hasText: "Dana Owner" }).waitFor();
  assert.equal(await page.getByTestId("filter-deals").count(), 0, "With deals toggle hidden on the sub-pane");
  await page.goto(`${BASE}/dashboard/companies/with-deals`);
  await page.locator("tr", { hasText: "Acme Towers" }).waitFor();
  assert.equal(await pageSummary(page), "Showing 1–1 of 1 companies");
  await shot(page, "07-companies-with-deals");

  log("companies list: filters and the Industry · Type column; a company page pages its people");
  await page.goto(`${BASE}/dashboard/companies`);
  assert.equal(await pageSummary(page), "Showing 1–5 of 5 companies");
  await page.getByTestId("filter-industry").click();
  await page.getByRole("checkbox", { name: "Service Provider" }).check();
  await page.waitForURL(/industry=Service/);
  assert.equal(await pageSummary(page), "Showing 1–2 of 2 companies", "Bluebird + Gates");
  await page.getByTestId("filter-company-type").click();
  await page.getByRole("checkbox", { name: "Gates" }).check();
  await page.waitForURL(/type=Gates/);
  assert.equal(await pageSummary(page), "Showing 1–1 of 1 companies");
  await page.goto(`${BASE}/dashboard/companies?attn=1`);
  assert.equal(await pageSummary(page), "Showing 1–3 of 3 companies", "Bluebird, Gates and Big Co have no phone or email");
  await page.goto(`${BASE}/dashboard/companies`);
  await page.locator("tr", { hasText: "Big Co" }).getByRole("link", { name: "Big Co" }).click();
  await page.waitForURL(/\/dashboard\/companies\/[a-z0-9]+$/);
  await page.getByText("60 at this company").waitFor();
  await page.getByText("Page 1 of 2").waitFor();
  await page.getByRole("link", { name: "Next people" }).click();
  await page.waitForURL(/people=2/);
  await page.getByText("Page 2 of 2").waitFor();
  assert.equal(await page.locator("#people li").count(), 10);
  await shot(page, "08-company-people-paged");

  log("mobile width: filter bar wraps, table scrolls, nothing overflows the page");
  await page.setViewportSize({ width: 400, height: 800 });
  await page.goto(`${BASE}/dashboard/contacts`);
  await page.getByTestId("filter-state").waitFor();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, `page scrolls sideways by ${overflow}px`);
  await shot(page, "09-mobile");

  void acmeUrl;
  await browser.close();
  console.log(`\nALL ${step} STEPS PASSED. Screenshots in ${OUT}`);
})().catch((err) => {
  console.error("\nFAILED at step", step, "\n", err);
  process.exit(1);
});
