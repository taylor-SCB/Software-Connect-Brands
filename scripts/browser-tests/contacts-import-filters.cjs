/* Browser regression for Contacts + Companies v2 (Sept 13, 2026).
 *
 * Covers: Industry and Company Type on the company and contact forms
 * ("+ Custom industry", "+ Custom company type", General for new
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
 * And the UX review fixes (Nov 10, 2026), each an "audit fixes (UX
 * review):" step: the search box finding a phone number however it is
 * typed (phone, second phone, mobile, a company's phone; digits-only, never
 * across two numbers), matching word by word (a name and a company, a name
 * in either order, a job title) with % _ and \ as plain characters, and a
 * word of only punctuation ("&", "-") left out, so a company's full name
 * finds its people past 500 "&" companies; every filter menu on Contacts
 * and Companies opening inside a phone's screen and a 1440 window, its
 * names whole, and worked from the keyboard (Enter to the first choice, Tab
 * through it and on to the next filter, Shift+Tab and Escape back to the
 * button, Tab into a clicked-open menu, a date box's parts); and the
 * Companies list keeping a phone number on one line with its last columns
 * reached by scrolling the table, as on Contacts.
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
// A filter menu, opened and placed (FloatingMenu draws it hidden until it
// has measured where it fits).
async function openMenu(page, id) {
  if (id.startsWith("filter-")) await openFilters(page);
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
  const page_ = await page.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(page_ <= width + 1, `${what} widens the page to ${page_}px`);
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
  await page.getByRole("button", { name: "Custom company type" }).click();
  await page.getByLabel("New company type under MDU").fill("REIT");
  // Sept 30, 2026: a custom value only joins the pick list when "Save for
  // Future Use" is ticked.
  await page.getByTestId("save-type").locator("input").check();
  await page.getByLabel("New company type under MDU").press("Enter");
  assert.equal(await chip(page, "REIT").getAttribute("aria-checked"), "true", "new type is ticked");
  await page.getByRole("button", { name: "Custom industry" }).click();
  await page.getByLabel("New industry name").fill("Hospitality");
  await page.getByTestId("save-industry").locator("input").check();
  await page.getByLabel("New industry name").press("Enter");
  assert.equal(await chip(page, "Hospitality").getAttribute("aria-checked"), "true", "new industry is ticked");
  await chip(page, "General").waitFor();
  await page.fill("#name", "Acme Towers");
  await page.fill("#state", "texas");
  await shot(page, "01-company-form-tags");
  await page.getByRole("button", { name: "Save company" }).click();
  await page.waitForURL(/\/dashboard\/companies\/(?!new$)[a-z0-9]+$/);
  const acmeUrl = page.url();
  // The company page's Details card opens closed (company page redesign).
  await page.getByTestId("company-details-toggle").click();
  const acmeDetails = page.getByTestId("company-details").locator("dl").first();
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
  await openFilters(page);
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
  // Industry · Type sits under More details on the contact page now.
  await page.getByTestId("more-details").click();
  const danaDetails = page.getByTestId("more-details-list");
  assert.ok(await danaDetails.getByText("Developer", { exact: true }).isVisible(), "tag added from the contact form shows on the contact");
  const acmeTypes = (await sql(`SELECT "companyTypes" FROM "Company" WHERE name='Acme Towers' AND "organizationId"=$1`, [org])).rows[0].companyTypes;
  assert.ok(acmeTypes.includes("Developer"), "saving the contact tagged the company");

  log("a contact with no company reads Individual / Personal on its page");
  await page.goto(`${BASE}/dashboard/contacts/new`);
  await page.fill("#name", "Taylor Homeowner");
  await page.fill("#phone", "512-555-0199");
  await page.getByRole("button", { name: "Save contact" }).click();
  await page.waitForURL(/\/dashboard\/contacts\/(?!new$)[a-z0-9]+$/);
  await page.getByTestId("more-details").click();
  assert.ok(await page.getByTestId("more-details-list").getByText("Individual / Personal").isVisible());

  log("template download has the system's field names, contact first then company");
  const template = await page.request.get(`${BASE}/dashboard/contacts/import-template`);
  assert.equal(template.status(), 200);
  const firstLine = (await template.text()).split("\r\n")[0];
  assert.equal(
    firstLine,
    "Name,Title,Email,Phone,Mobile,Other Number,Website,City,State,Birthday,Status,Company Name,Company Phone,Company Email,Company Website,Company City,Company State,Company Status,Industry,Company Type",
  );

  log("import a messy CSV: First/Last name, mixed headers, a company-only row, a duplicate, an individual, 60 people at one company");
  const rows = [
    "First Name,Last Name,Job Title,E-mail,Phone,ST,DOB,Lead Status,Company,Company Phone,Industry,Type",
    "Dana,Owner,CEO,dana@acme.test,512-555-1000,,,client,Acme Towers,512-555-2000,MDU,Owner",
    "Sam,Rivera,,sam@bluebird.test,512-555-1001,Texas,3/9/1984,Lead,Bluebird ISP,,Service Provider,Networks/ISP",
    "Sam,Rivera,,SAM@bluebird.test,,,,,Bluebird ISP,,,",
    "Pat,Solo,,,512-555-1002,CA,,,,,,",
    ",,,,,,,,Ghost Holdings LLC,512-555-3000,Commercial,",
    "Lee,Gates,Owner,lee@gates.test,,FL,,customer,Gates Co,,Service Provider,Gates; Access Control",
    "Ivy,Blank,,,,,,,,,,",
  ];
  for (let i = 1; i <= 60; i += 1) {
    rows.push(`Person,${String(i).padStart(2, "0")},,p${i}@bigco.test,,TX,,,Big Co,,Construction,`);
  }
  const csvPath = path.join(OUT, "import.csv");
  fs.writeFileSync(csvPath, rows.join("\r\n") + "\r\n");
  await page.goto(`${BASE}/dashboard/contacts`);
  await cleanUp(page, "import");
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
  assert.equal(acme.phone, "512-555-2000", "blank phone filled on the existing company");
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
  assert.equal(ghost.phone, "512-555-3000", "company-only row created the company");
  const seededGeneral = (await sql(`SELECT count(*)::int AS n FROM "CompanyTypeOption" t JOIN "IndustryOption" i ON i.id=t."industryId" WHERE i.name='Construction' AND t.name='General' AND t."organizationId"=$1`, [org])).rows[0].n;
  assert.equal(seededGeneral, 1, "Construction has General");

  log("re-importing the same file updates instead of doubling");
  await cleanUp(page, "import");
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
  await openFilters(page); await page.getByTestId("filter-state").click();
  await page.getByRole("checkbox", { name: "TX" }).check();
  await page.waitForURL(/state=TX/);
  assert.equal(await pageSummary(page), "Showing 1–50 of 62 contacts", "TX: Dana + Sam + 60 at Big Co");
  await openFilters(page); await page.getByTestId("filter-industry").click();
  await page.getByRole("checkbox", { name: "Construction" }).check();
  await page.waitForURL(/industry=Construction/);
  assert.equal(await pageSummary(page), "Showing 1–50 of 60 contacts", "TX + Construction = Big Co");
  await openFilters(page); await page.getByTestId("filter-company-type").click();
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
  await page.waitForURL(/\/dashboard\/contacts(\?scope=\w+)?$/);
  assert.equal(await pageSummary(page), "Showing 1–50 of 66 contacts");
  await openFilters(page); await page.getByTestId("filter-company").click();
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
  await openFilters(page); await page.getByTestId("filter-fav").click();
  await page.waitForURL(/fav=1/);
  assert.equal(await pageSummary(page), "Showing 1–1 of 1 contacts");
  await page.locator("aside").getByRole("link", { name: "Favorite Contacts" }).click();
  await page.waitForURL(/\/dashboard\/contacts\/favorites$/);
  await page.locator("tr", { hasText: "Sam Rivera" }).waitFor();
  await page.goto(`${BASE}/dashboard/contacts?attn=1`);
  assert.equal(await pageSummary(page), "Showing 1–1 of 1 contacts", "needs attention: Ivy has no email and no phone");
  // Give Dana a deal, then the deal views light up.
  await page.goto(danaUrl);
  // Add deal sits under the header's ⋯ More (or the Paperwork card's ⋯
  // from Meeting Completed on) since the contact page redesign.
  await page.locator("[data-testid=contact-header]").waitFor();
  if (await page.locator("[data-testid=paperwork-more]").count()) {
    await page.locator("[data-testid=paperwork-more]").click();
    await page.locator("[data-testid=paperwork-add-deal-open]").click();
  } else {
    await page.locator("[data-testid=record-more]").click();
    await page.locator("[data-testid=more-add-deal]").click();
  }
  await page.fill("#deal-title", "Lobby access control");
  await page.fill("[name=value]", "2500");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByText("Lobby access control").first().waitFor();
  await page.goto(`${BASE}/dashboard/contacts?deals=1`);
  assert.equal(await pageSummary(page), "Showing 1–1 of 1 contacts");
  await page.locator("aside").getByRole("link", { name: "Contacts with Deals" }).click();
  await page.waitForURL(/\/dashboard\/contacts\/with-deals$/);
  await page.locator("tr", { hasText: "Dana Owner" }).waitFor();
  await openFilters(page);
  assert.equal(await page.getByTestId("filter-deals").count(), 0, "With deals toggle hidden on the sub-pane");
  await page.goto(`${BASE}/dashboard/companies/with-deals`);
  await page.locator("tr", { hasText: "Acme Towers" }).waitFor();
  assert.equal(await pageSummary(page), "Showing 1–1 of 1 companies");
  await shot(page, "07-companies-with-deals");

  log("companies list: filters and the Industry · Type column; a company page pages its people");
  await page.goto(`${BASE}/dashboard/companies`);
  assert.equal(await pageSummary(page), "Showing 1–5 of 5 companies");
  await openFilters(page); await page.getByTestId("filter-industry").click();
  await page.getByRole("checkbox", { name: "Service Provider" }).check();
  await page.waitForURL(/industry=Service/);
  assert.equal(await pageSummary(page), "Showing 1–2 of 2 companies", "Bluebird + Gates");
  await openFilters(page); await page.getByTestId("filter-company-type").click();
  await page.getByRole("checkbox", { name: "Gates" }).check();
  await page.waitForURL(/type=Gates/);
  assert.equal(await pageSummary(page), "Showing 1–1 of 1 companies");
  await page.goto(`${BASE}/dashboard/companies?attn=1`);
  // Was 3 before Sept 14, 2026: the import now copies Sam's phone up to Bluebird ISP (its one person with a number), so only Gates and Big Co are left unreachable.
  assert.equal(await pageSummary(page), "Showing 1–2 of 2 companies", "Gates and Big Co have no phone or email");
  const bluebirdPhone = (await sql(`SELECT phone, "autoFilled" FROM "Company" WHERE name='Bluebird ISP' AND "organizationId"=$1`, [org])).rows[0];
  assert.equal(bluebirdPhone.phone, "512-555-1001", "Bluebird's phone copied up from Sam");
  assert.ok(bluebirdPhone.autoFilled.includes("phone"), "and marked as filled in by the app");
  await page.goto(`${BASE}/dashboard/companies`);
  await page.locator("tr", { hasText: "Big Co" }).getByRole("link", { name: "Big Co" }).click();
  await page.waitForURL(/\/dashboard\/companies\/[a-z0-9]+$/);
  // The People card (Who to call, company page redesign) shows the first
  // few and "Show all 60", which opens the paged list.
  assert.equal((await page.getByTestId("who-show-all").textContent()).trim(), "Show all 60");
  await page.getByTestId("who-show-all").click();
  await page.getByText("Page 1 of 2").waitFor();
  await page.getByRole("link", { name: "Next people" }).click();
  await page.waitForURL(/people=2/);
  await page.getByText("Page 2 of 2").waitFor();
  assert.equal(await page.locator("#people [data-testid=person-row]").count(), 10);
  await shot(page, "08-company-people-paged");

  log("audit fixes: Enter-key save with a typed company name keeps the company's tags; an untouched edit keeps them too");
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(`${BASE}/dashboard/contacts/new`);
  await page.fill("#name", "Enter Key");
  await page.fill("#companyName", "Acme Towers");
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/dashboard\/contacts\/(?!new$)[a-z0-9]+$/);
  let acmeTags = (await sql(`SELECT industries, "companyTypes" FROM "Company" WHERE name='Acme Towers' AND "organizationId"=$1`, [org])).rows[0];
  assert.ok(acmeTags.industries.includes("MDU") && acmeTags.companyTypes.includes("Owner"), `Enter-save wiped tags: ${JSON.stringify(acmeTags)}`);
  await page.goto(`${acmeUrl}/edit`);
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByText("Company saved").waitFor();
  acmeTags = (await sql(`SELECT industries, "companyTypes" FROM "Company" WHERE name='Acme Towers' AND "organizationId"=$1`, [org])).rows[0];
  assert.ok(acmeTags.industries.includes("MDU") && acmeTags.companyTypes.includes("Owner"), `untouched save wiped tags: ${JSON.stringify(acmeTags)}`);

  log("audit fixes: messy exports import correctly (owner column, Google-style labels, Inactive, company-only rows, orphan type, name update, phone list, bad birthday, stray quote)");
  const messy = [
    "First Name,Last Name,Contact owner,E-mail 1 - Label,E-mail 1 - Value,Phone 1 - Label,Phone 1 - Value,Status,Company,Type,Birthday,Title",
    'Hub,Spot,Taylor Owner,Work,hub@spot.test,Mobile,512-555-7001,Inactive,Spot Co,Integrator,March 9,12" pipe guy',
    "Dana,Renamed,Taylor Owner,,dana@acme.test,,,,Acme Towers,,,",
    "Sam,Rivera,Taylor Owner,,,,512-555-7002,,Bluebird ISP,,,",
    ",,,,office@plain.test,,512-555-7003,Customer,Plain Company Row,,,",
    "After,Quote,Taylor Owner,,after@quote.test,,,,,,,",
  ];
  const messyPath = path.join(OUT, "messy.csv");
  fs.writeFileSync(messyPath, messy.join("\r\n") + "\r\n");
  await page.goto(`${BASE}/dashboard/contacts`);
  await cleanUp(page, "import");
  await page.getByTestId("import-file").setInputFiles(messyPath);
  const messySummary = await page.getByTestId("import-summary").textContent();
  assert.match(messySummary, /4 contacts and 4 companies found/, messySummary);
  assert.ok(await page.getByText(/Couldn't read birthday "March 9"/).isVisible(), "year-less birthday flagged");
  await page.getByTestId("import-start").click();
  await page.getByText("Imported 5 rows").waitFor({ timeout: 60000 });
  await page.getByTestId("import-done").click();
  const hub = (await sql(`SELECT name, email, phone, status, title, birthday FROM "Contact" WHERE email='hub@spot.test' AND "organizationId"=$1`, [org])).rows[0];
  assert.ok(hub, "Hub Spot imported");
  assert.equal(hub.name, "Hub Spot", "First + Last used, not the owner column");
  assert.equal(hub.phone, "512-555-7001", "Phone 1 - Value, not the label");
  assert.equal(hub.status, "ARCHIVED", "Inactive is archived, not customer");
  assert.equal(hub.title, '12" pipe guy', "stray quote is a character");
  assert.equal(hub.birthday, null, "year-less birthday left blank");
  const spot = (await sql(`SELECT industries, "companyTypes" FROM "Company" WHERE name='Spot Co' AND "organizationId"=$1`, [org])).rows[0];
  assert.deepEqual(spot.industries, ["Service Provider"], "Integrator with no industry lands on Service Provider");
  assert.deepEqual(spot.companyTypes, ["Integrator"]);
  const danaNow = (await sql(`SELECT name FROM "Contact" WHERE email='dana@acme.test' AND "organizationId"=$1`, [org])).rows;
  assert.equal(danaNow.length, 1);
  assert.equal(danaNow[0].name, "Dana Renamed", "email match updates the name");
  const sams = (await sql(`SELECT count(*)::int AS n FROM "Contact" WHERE name='Sam Rivera' AND "organizationId"=$1`, [org])).rows[0].n;
  assert.equal(sams, 1, "phone-list row without email matched Sam by name + company");
  const plain = (await sql(`SELECT phone, email, status FROM "Company" WHERE name='Plain Company Row' AND "organizationId"=$1`, [org])).rows[0];
  assert.equal(plain.phone, "512-555-7003", "company-only row keeps bare phone");
  assert.equal(plain.email, "office@plain.test", "company-only row keeps bare email");
  assert.equal(plain.status, "WON", "a Customer status imports as Signed / Won");
  assert.equal((await sql(`SELECT count(*)::int AS n FROM "Contact" WHERE email='after@quote.test' AND "organizationId"=$1`, [org])).rows[0].n, 1, "row after the stray quote still imported");
  assert.equal((await sql(`SELECT count(*)::int AS n FROM "IndustryOption" WHERE name='Imported' AND "organizationId"=$1`, [org])).rows[0].n, 0, "no hidden Imported industry");
  // Spot Co's orphan type stays through an untouched edit save.
  await page.goto(`${BASE}/dashboard/companies?q=spot`);
  await page.locator("tr", { hasText: "Spot Co" }).getByRole("link", { name: "Spot Co" }).click();
  await page.waitForURL(/\/dashboard\/companies\/[a-z0-9]+$/);
  await page.goto(`${page.url()}/edit`);
  assert.equal(await chip(page, "Integrator").getAttribute("aria-checked"), "true", "orphan-free: type shows ticked under its inferred industry");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByText("Company saved").waitFor();
  const spotAfter = (await sql(`SELECT "companyTypes" FROM "Company" WHERE name='Spot Co' AND "organizationId"=$1`, [org])).rows[0];
  assert.deepEqual(spotAfter.companyTypes, ["Integrator"], "untouched save keeps the imported type");

  log("audit fixes: a comma in an industry name still filters; % in search is not a wildcard; two quick filter clicks both stick");
  await page.goto(`${BASE}/dashboard/companies/new`);
  await page.fill("#name", "Comma Industries");
  await page.getByRole("button", { name: "Custom industry" }).click();
  await page.getByLabel("New industry name").fill("Food, Beverage");
  await page.getByTestId("save-industry").locator("input").check();
  await page.getByLabel("New industry name").press("Enter");
  await page.getByRole("button", { name: "Save company" }).click();
  await page.waitForURL(/\/dashboard\/companies\/(?!new$)[a-z0-9]+$/);
  await page.goto(`${BASE}/dashboard/companies?industry=${encodeURIComponent("Food, Beverage")}`);
  assert.equal(await pageSummary(page), "Showing 1–1 of 1 companies", "comma industry filters as one value");
  // As a wildcard "r%a" would match "Rivera"; as text it matches nobody.
  await page.goto(`${BASE}/dashboard/contacts?q=r%25a`);
  assert.equal(await pageSummary(page), "No contacts", "% is not a wildcard");
  await page.goto(`${BASE}/dashboard/contacts`);
  await openFilters(page); await page.getByTestId("filter-fav").click();
  await openFilters(page); await page.getByTestId("filter-attn").click();
  await page.waitForURL(/fav=1.*attn=1|attn=1.*fav=1/);

  log("import v2 (Sept 27, 2026): Mailing City / Mailing State and a Location column land in City and State, Job Title beats Outlook's Mr./Ms. Title, the preview shows Title and City, State and names the columns it leaves out");
  const v2 = [
    "Name,Title,Email,Mailing City,Mailing State,Favorite Color",
    "Mia Mailing,Operations Manager,mia@mailing.test,Austin,texas,Blue",
  ];
  const v2Path = path.join(OUT, "mailing.csv");
  fs.writeFileSync(v2Path, v2.join("\r\n") + "\r\n");
  await page.goto(`${BASE}/dashboard/contacts`);
  await cleanUp(page, "import");
  await page.getByTestId("import-file").setInputFiles(v2Path);
  await page.getByTestId("import-summary").waitFor();
  const previewRow = page.locator("tr", { hasText: "Mia Mailing" });
  assert.ok(await previewRow.getByText("Operations Manager").isVisible(), "preview shows the Title");
  assert.ok(await previewRow.getByText("Austin, TX").isVisible(), "preview shows City, State");
  assert.match(await page.getByTestId("import-unused").textContent(), /"Favorite Color"/, "unused column named");
  await shot(page, "08b-import-v2-preview");
  await page.getByTestId("import-start").click();
  await page.getByText("Imported 1 row").waitFor({ timeout: 60000 });
  await page.getByTestId("import-done").click();
  const mia = (await sql(`SELECT title, city, state FROM "Contact" WHERE email='mia@mailing.test' AND "organizationId"=$1`, [org])).rows[0];
  assert.deepEqual({ ...mia }, { title: "Operations Manager", city: "Austin", state: "TX" }, "Mailing City / State imported");
  const v2b = [
    "Title,First Name,Last Name,Job Title,E-mail Address,Location",
    'Mr.,Lou,Location,Site Lead,lou@location.test,"Dallas, Texas, United States"',
  ];
  fs.writeFileSync(v2Path, v2b.join("\r\n") + "\r\n");
  await cleanUp(page, "import");
  await page.getByTestId("import-file").setInputFiles(v2Path);
  await page.getByTestId("import-start").click();
  await page.getByText("Imported 1 row").waitFor({ timeout: 60000 });
  await page.getByTestId("import-done").click();
  const lou = (await sql(`SELECT title, city, state FROM "Contact" WHERE email='lou@location.test' AND "organizationId"=$1`, [org])).rows[0];
  assert.deepEqual({ ...lou }, { title: "Site Lead", city: "Dallas", state: "TX" }, "Job Title over Mr., Location split");

  log("mobile width: filter bar wraps, table scrolls, nothing overflows the page");
  await page.setViewportSize({ width: 400, height: 800 });
  await page.goto(`${BASE}/dashboard/contacts`);
  await openFilters(page); await page.getByTestId("filter-state").waitFor();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, `page scrolls sideways by ${overflow}px`);
  await shot(page, "09-mobile");

  // ---------------------------------------------------------------------
  // UX review fixes (Nov 10, 2026): one step per confirmed defect.
  log("audit fixes (UX review): search finds a phone number however it is typed — phone, second phone, mobile and a company's phone — never across two numbers");
  await page.setViewportSize({ width: 1400, height: 900 });
  await sql(
    `INSERT INTO "Company" (id, "organizationId", name, phone, website, "updatedAt")
     VALUES ('cif_ux_delta', $1, 'Delta Door & Hardware', '(870) 555-0367', 'https://deltadoorhw.com', now())`,
    [org],
  );
  await sql(
    `INSERT INTO "Contact" (id, "organizationId", "companyId", name, title, phone, phone2, mobile, "updatedAt") VALUES
       ('cif_ux_alan', $1, 'cif_ux_delta', 'Alan Osborne', 'Operations Manager', NULL, NULL, '(870) 555-0123', now()),
       ('cif_ux_denise', $1, NULL, 'Denise Howard', 'Property Manager', NULL, '512 555 0125', '999 000 1111', now()),
       ('cif_ux_phil', $1, NULL, 'Phil Dotted', NULL, '512.555.0177', NULL, NULL, now())`,
    [org],
  );
  const found = async (list, q) => {
    await page.goto(`${BASE}/dashboard/${list}?q=${encodeURIComponent(q)}`);
    await page.getByTestId("page-summary").waitFor();
    const cell = list === "contacts" ? "[data-testid=contact-row] td:nth-child(2) a.link" : "[data-testid=company-row] td:nth-child(2) a.link";
    return (await page.locator(cell).allTextContents()).map((t) => t.trim()).sort();
  };
  for (const typed of ["(870) 555-0123", "870-555-0123", "8705550123", "870.555.0123", "+1 870 555 0123", "555-0123"]) {
    assert.deepEqual(await found("contacts", typed), ["Alan Osborne"], `a mobile stored as (870) 555-0123, typed ${typed}`);
  }
  for (const typed of ["512-555-0125", "(512) 555-0125", "5125550125"]) {
    assert.deepEqual(await found("contacts", typed), ["Denise Howard"], `a second phone stored as 512 555 0125, typed ${typed}`);
  }
  for (const typed of ["(512) 555-0177", "512-555-0177", "5125550177"]) {
    assert.deepEqual(await found("contacts", typed), ["Phil Dotted"], `a phone stored as 512.555.0177, typed ${typed}`);
  }
  assert.deepEqual(await found("contacts", "0125999"), [], "the end of one number and the start of the next are not a number");
  assert.equal(await pageSummary(page), "No contacts");
  for (const typed of ["8705550367", "870-555-0367", "870.555.0367", "(870) 555-0367"]) {
    assert.deepEqual(await found("companies", typed), ["Delta Door & Hardware"], `a company phone typed ${typed}`);
  }

  log("audit fixes (UX review): search matches word by word — a name and a company, a name in either order, a job title — and % _ \\ stay plain characters");
  assert.deepEqual(await found("contacts", "alan delta"), ["Alan Osborne"], "a first name and the company");
  assert.deepEqual(await found("contacts", "osborne alan"), ["Alan Osborne"], "a name in either order");
  assert.deepEqual(await found("contacts", "howard denise"), ["Denise Howard"]);
  assert.deepEqual(await found("contacts", "Property Manager"), ["Denise Howard"], "a job title");
  assert.deepEqual(await found("contacts", "operations manager"), ["Alan Osborne", "Mia Mailing"]);
  assert.ok((await page.getByTestId("active-filters").textContent()).includes("“operations manager”"), "the chip reads what was typed");
  assert.deepEqual(await found("companies", "delta door"), ["Delta Door & Hardware"]);
  for (const typed of ["r%a", "r_a", "blue\\"]) {
    assert.deepEqual(await found("contacts", typed), [], `${typed} is matched as typed, not as a wildcard`);
    assert.equal(await pageSummary(page), "No contacts");
  }
  assert.deepEqual(await found("contacts", "sam rivera"), ["Sam Rivera"], "a plain two-word name still finds one person");

  log("audit fixes (UX review): a word that is only punctuation ('&', '-') is left out of the search, so a company's full name finds its people however many '&' companies there are");
  // 600 companies with & in the name, then Zeta Gate & Fence and Gina at it.
  // The & word used to need a company-name match of its own, and those stop
  // at 500, so Gina could be left out of a search for her company's name.
  await sql(
    `INSERT INTO "Company" (id, "organizationId", name, "updatedAt")
     SELECT 'cif_ux_amp_' || n, $1, 'Filler & Sons ' || n, now() FROM generate_series(1, 600) AS n`,
    [org],
  );
  await sql(`INSERT INTO "Company" (id, "organizationId", name, "updatedAt") VALUES ('cif_ux_zeta', $1, 'Zeta Gate & Fence', now())`, [org]);
  await sql(`INSERT INTO "Contact" (id, "organizationId", "companyId", name, "updatedAt") VALUES ('cif_ux_gina', $1, 'cif_ux_zeta', 'Gina Gatewood', now())`, [org]);
  const amps = (await sql(`SELECT count(*)::int AS n FROM "Company" WHERE "organizationId"=$1 AND name LIKE '%&%'`, [org])).rows[0].n;
  assert.ok(amps > 500, `${amps} companies carry an & — more than the 500 a word's company matches stop at`);
  const capped = (await sql(`SELECT id FROM "Company" WHERE "organizationId"=$1 AND name ILIKE '%&%' LIMIT 500`, [org])).rows.map((r) => r.id);
  console.log(`     (the old 500-company lookup for "&" ${capped.includes("cif_ux_zeta") ? "happened to include" : "left out"} Zeta Gate & Fence)`);
  assert.deepEqual(await found("contacts", "Zeta Gate & Fence"), ["Gina Gatewood"], "the full company name, & and all");
  assert.deepEqual(await found("contacts", "gina & zeta"), ["Gina Gatewood"]);
  assert.deepEqual(await found("contacts", "Delta Door & Hardware"), ["Alan Osborne"]);
  assert.deepEqual(await found("contacts", "alan - delta"), ["Alan Osborne"], "a dash between words");
  assert.deepEqual(await found("companies", "Zeta Gate & Fence"), ["Zeta Gate & Fence"]);
  // Only marks: matched as typed, and the chip reads what was typed.
  await found("contacts", "&");
  assert.ok((await page.getByTestId("active-filters").textContent()).includes("“&”"), "a search of just & still runs");
  await sql(`DELETE FROM "Contact" WHERE id='cif_ux_gina'`);
  await sql(`DELETE FROM "Company" WHERE id='cif_ux_zeta' OR id LIKE 'cif_ux_amp_%'`);

  log("audit fixes (UX review): every filter menu on Contacts and Companies opens inside a phone's screen and a 1440 window, names whole, the page no wider");
  const menus = {
    contacts: ["filter-state", "filter-industry", "filter-company-type", "filter-company", "filter-status", "filter-activity", "filter-job-title", "filter-rep", "filter-added-by", "filter-added", "filter-contact-info", "filter-lead-label"],
    companies: ["filter-state", "filter-industry", "filter-company-type", "filter-status", "filter-activity", "filter-rep", "filter-added-by", "filter-added", "filter-contact-info", "filter-lead-label"],
  };
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    for (const [list, ids] of Object.entries(menus)) {
      await page.goto(`${BASE}/dashboard/${list}`);
      for (const id of ids) {
        const menu = await openMenu(page, id);
        await assertMenuInside(page, menu, `${width}px ${list} ${id}`);
        if (id === "filter-company" || id === "filter-job-title") {
          // Focused on the frame after the menu shows (a hidden box can't take focus).
          await page
            .waitForFunction(() => document.activeElement?.getAttribute("type") === "search", null, { timeout: 3000 })
            .catch(() => assert.fail(`${id}'s search box doesn't take the cursor`));
        }
        await page.keyboard.press("Escape");
        await menu.waitFor({ state: "detached" });
      }
    }
  }
  // The reported ones, by name: Companies' Status on a phone reads Meeting
  // Completed whole, and Contact info's None buttons can be pressed.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/dashboard/companies`);
  const status = await openMenu(page, "filter-status");
  const completed = await status.locator("label", { hasText: "Meeting Completed" }).boundingBox();
  assert.ok(completed.x >= 0 && completed.x + completed.width <= 390, "Meeting Completed is on the screen");
  await shot(page, "10-ux-status-menu-phone");
  await page.keyboard.press("Escape");
  await page.goto(`${BASE}/dashboard/contacts`);
  await openMenu(page, "filter-contact-info");
  for (const field of ["mobile", "email"]) {
    const none = await page.getByTestId(`presence-${field}-no`).boundingBox();
    assert.ok(none.x >= 0 && none.x + none.width <= 390, `${field}'s None is on the screen at ${Math.round(none.x)}`);
  }
  await page.getByTestId("presence-email-no").click();
  await page.waitForURL(/email=no/);
  await page.keyboard.press("Escape");

  log("audit fixes (UX review): the filter menus work from the keyboard — Enter puts the cursor on the first choice, Tab walks the choices and past the last moves on to the next filter, Shift+Tab and Escape go back to the button, Tab from a clicked-open button goes in");
  await page.setViewportSize({ width: 1440, height: 900 });
  // Where the cursor is: the element's testid, its label's words, and the
  // menu it sits in (the menus are drawn at the end of the page).
  const cursor = () =>
    page.evaluate(() => {
      const el = document.activeElement;
      return { id: el?.getAttribute("data-testid") ?? "", label: (el?.closest("label")?.textContent ?? "").trim(), menu: el?.closest("[data-testid$='-menu']")?.getAttribute("data-testid") ?? "" };
    });
  const keyOpen = async (id) => {
    await openFilters(page);
    await page.getByTestId(id).focus();
    await page.keyboard.press("Enter");
    const menu = page.getByTestId(`${id}-menu`);
    await menu.waitFor();
    await page
      .waitForFunction((m) => document.querySelector(`[data-testid="${m}"]`)?.contains(document.activeElement), `${id}-menu`, { timeout: 3000 })
      .catch(() => assert.fail(`${id}: Enter left the cursor outside its menu`));
    return menu;
  };
  for (const list of ["contacts", "companies"]) {
    await page.goto(`${BASE}/dashboard/${list}`);
    for (const id of menus[list]) {
      const menu = await keyOpen(id);
      // The first choice (Company's and Job title's search box), on screen in its menu.
      const first = await menu.evaluate((el) => {
        const active = document.activeElement;
        const box = active.getBoundingClientRect();
        const panel = el.getBoundingClientRect();
        return { inside: box.top >= panel.top - 1 && box.bottom <= panel.bottom + 1 && box.width > 0, firstInput: el.querySelector("input, button") === active };
      });
      assert.ok(first.inside && first.firstInput, `${list} ${id}: the cursor is on the first choice (${JSON.stringify(first)})`);
      await page.keyboard.press("Escape");
      await menu.waitFor({ state: "detached" });
      assert.equal((await cursor()).id, id, `${list} ${id}: Escape puts the cursor back on the button`);
    }
  }
  await page.goto(`${BASE}/dashboard/contacts`);
  const state = await keyOpen("filter-state");
  const states = (await state.locator("label").allTextContents()).map((t) => t.trim());
  assert.ok(states.length >= 2, `states listed: ${states}`);
  assert.equal((await cursor()).label, states[0]);
  await page.keyboard.press("Tab");
  assert.deepEqual(await cursor(), { id: "", label: states[1], menu: "filter-state-menu" }, "Tab walks to the second state, not the next filter");
  await page.keyboard.press("Space");
  await page.waitForURL(new RegExp(`state=${states[1]}`));
  assert.equal((await cursor()).label, states[1], "the cursor stays on the ticked state");
  await page.keyboard.press("Escape");
  assert.equal((await cursor()).id, "filter-state");
  await page.goto(`${BASE}/dashboard/contacts`);
  await keyOpen("filter-state");
  await page.keyboard.press("Shift+Tab");
  await page.getByTestId("filter-state-menu").waitFor({ state: "detached" });
  assert.equal((await cursor()).id, "filter-state", "Shift+Tab before the first state closes the menu onto its button");
  // Activity is one radio group, so one stop: Tab past it moves on to the
  // filter after Activity, as if the menu sat beside its button.
  await keyOpen("filter-activity");
  assert.equal((await cursor()).label, "Touched in the last 7 days");
  await page.keyboard.press("Tab");
  await page.getByTestId("filter-activity-menu").waitFor({ state: "detached" });
  // Activity sits in the Filters panel's Stage group, before Lead Label (Nov 11, 2026).
  assert.equal((await cursor()).id, "filter-lead-label", "Tab past the last choice moves on to the next filter");
  // A date box's month / day / year are walked by the browser, inside the menu.
  await keyOpen("filter-added");
  assert.equal((await cursor()).id, "added-from");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  assert.deepEqual(await cursor(), { id: "added-from", label: "From", menu: "filter-added-menu" }, "Shift+Tab inside the From date stays in it");
  await page.keyboard.press("Shift+Tab");
  await page.getByTestId("filter-added-menu").waitFor({ state: "detached" });
  assert.equal((await cursor()).id, "filter-added");
  // Opened with a click the cursor stays on the button, as before; Tab goes in.
  await openFilters(page); await page.getByTestId("filter-rep").click();
  await page.getByTestId("filter-rep-menu").waitFor();
  await page.waitForTimeout(100);
  assert.equal((await cursor()).id, "filter-rep", "a click leaves the cursor on the button");
  await page.keyboard.press("Tab");
  // "Me" is the Rep filter's first choice since Nov 11, 2026.
  const firstRep = await cursor();
  assert.equal(firstRep.menu, "filter-rep-menu", "Tab from the clicked-open button goes into its menu");
  assert.match(firstRep.label, /^Me \(/, "Me comes first");
  await page.keyboard.press("Space");
  await page.waitForURL(/rep=/);
  await page.keyboard.press("Escape");
  await page.getByTestId("filter-rep-menu").waitFor({ state: "detached" });
  assert.equal((await cursor()).id, "filter-rep");

  log("audit fixes (UX review): Companies list phone numbers stay on one line; its last columns are reached by scrolling the table, as on Contacts");
  // Phone and Status are Columns-menu columns since the BDR redesign (Nov
  // 11, 2026), and below 768px the list is cards with a Call button.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}/dashboard/companies`);
  for (const key of ["phone", "status"]) {
    await page.getByTestId("columns").click();
    const box = page.getByTestId(`column-${key}`);
    if (!(await box.isChecked())) await box.check();
    await page.keyboard.press("Escape");
  }
  await page.locator("thead th", { hasText: "Status" }).waitFor();
  {
    const phones = await page.locator("[data-testid=company-row-phone] a").evaluateAll((links) => links.map((a) => [a.textContent.trim(), a.getClientRects().length]));
    assert.ok(phones.length >= 4, `phones listed: ${JSON.stringify(phones)}`);
    for (const [number, lines] of phones) assert.equal(lines, 1, `${number} breaks onto ${lines} lines at 1440px`);
    const reach = await page.evaluate(() => {
      const box = document.querySelector("table").parentElement;
      box.scrollLeft = box.scrollWidth;
      const edge = box.getBoundingClientRect();
      const heads = [...document.querySelectorAll("thead th")];
      const last = heads[heads.length - 1];
      const at = last.getBoundingClientRect();
      return { name: last.textContent.trim(), overflow: getComputedStyle(box).overflowX, inside: at.left >= edge.left - 1 && at.right <= edge.right + 1, page: document.documentElement.scrollWidth, window: document.documentElement.clientWidth };
    });
    assert.equal(reach.name, "Status");
    assert.equal(reach.overflow, "auto", "the table scrolls inside its card, like the Contacts list");
    assert.ok(reach.inside, "at 1440px the Status column can be scrolled into view");
    assert.ok(reach.page <= reach.window + 1, `at 1440px the page itself scrolls sideways (${reach.page}px)`);
  }
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(`${BASE}/dashboard/companies`);
  await page.locator("[data-testid=company-card]").first().waitFor();
  const calls = await page.locator("[data-testid=company-card] [data-testid=card-call]").evaluateAll((links) =>
    links.map((a) => ({ height: a.getBoundingClientRect().height, right: a.getBoundingClientRect().right })),
  );
  assert.ok(calls.length >= 4, `Call buttons on the cards: ${calls.length}`);
  for (const call of calls) {
    assert.ok(call.height >= 44, `a Call button is ${call.height}px tall`);
    assert.ok(call.right <= 390, "and on the screen");
  }
  assert.ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= 391, "the page doesn't scroll sideways at 390px");
  await shot(page, "11-ux-companies-phone");

  void acmeUrl;
  await browser.close();
  console.log(`\nALL ${step} STEPS PASSED. Screenshots in ${OUT}`);
})().catch((err) => {
  console.error("\nFAILED at step", step, "\n", err);
  process.exit(1);
});

// The list filters sit in the Filters panel since the BDR redesign (Nov 11,
// 2026): open it when it isn't already.
async function openFilters(p) {
  // Only the Contacts and Companies lists have the panel (the Pipeline's
  // bar keeps its filters on the bar).
  if ((await p.getByTestId("filters-toggle").count()) === 0) return;
  const panel = p.getByTestId("filters-panel");
  if (await panel.isVisible().catch(() => false)) return;
  await p.getByTestId("filters-toggle").click();
  await panel.waitFor();
}
// Import CSV, Merge and Fill in missing sit under "Clean up" (Nov 11, 2026).
async function cleanUp(p, item) {
  await p.getByTestId("cleanup").click();
  await p.getByTestId(`cleanup-${item}`).click();
}
