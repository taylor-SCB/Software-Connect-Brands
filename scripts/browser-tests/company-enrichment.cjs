/* Browser regression for company enrichment (Sept 14, 2026).
 *
 * Covers: the CSV import tagging every company the file leaves untagged
 * (including a supplier, whose "Distributor" type the pick list gains on
 * the spot) and copying a phone / website up from its people (never over
 * a value a person typed; a file's own tags win with no "auto" mark), the
 * "auto" marks on the Companies list, the Contacts list and the company
 * page, the Auto-filled filter toggle, "Fill in missing" on the Companies
 * list running in batches of 500 over 1,200 bare companies — stopped
 * after the first batch, then reopened and finished — without reshuffling
 * the list's order, "Looks right" clearing the marks, an edit clearing
 * only the mark of the field edited, a re-import that updates instead of
 * doubling, a later file replacing an auto-filled phone and an
 * auto-tagged industry, and Needs attention still finding the companies
 * nothing could fill.
 *
 * Runs against a built app (`npm run build:app && npx next start`) and a
 * local Postgres that has had `prisma migrate deploy` run against it. It
 * signs up its own workspace, activates it with SQL, and deletes it again
 * on the next run, so it never touches real data. Never point it at the
 * live database.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/scb_test \
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules \
 *   node scripts/browser-tests/company-enrichment.cjs
 *
 * Run alongside contacts-import-filters.cjs and companies-contacts.cjs
 * (one at a time) before anything touching Companies goes live.
 *
 * Steps:
 *   1  sign up + activate + log in; open the company form so pick lists seed
 *   2  import a CSV: an electrician, an apartment tower, an unplaceable
 *      name, a company the file already tags, a company with a typed phone,
 *      a roofer with an owner on file, a supplier with a sales rep
 *   3  SQL: tags, phones, websites and auto marks landed where the rules
 *      say; Uncategorized / General and Service Provider / Distributor
 *      were added to the pick lists once
 *   4  Companies list shows the marks; Industry filter, Auto-filled toggle,
 *      chips and Clear all; Contacts list marks the tags too
 *   5  seed 1,200 bare companies + 30 contacts in SQL; Fill in missing
 *      counts; Stop after this batch stops after the first 500 (SQL agrees,
 *      no "Done" box); reopened, it finishes; totals match SQL, list order
 *      unchanged
 *   6  company page: Looks right clears the marks; editing the website
 *      clears only the website mark; an untouched save keeps them
 *   7  re-import updates instead of doubling; a later file's phone replaces
 *      an auto-filled phone (not a typed one) and its industry replaces a
 *      guessed one
 *   8  Needs attention lists what nothing could fill and not what was filled
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
const OUT = process.env.SHOTS_DIR || path.join(os.tmpdir(), "scb-browser-shots-enrich");
fs.mkdirSync(OUT, { recursive: true });

const EMAIL = "test-enrich@example.com";
const PASSWORD = "password123";
const COMPANY = "Test Enrich Co";
const SLUG = "test-enrich-co";
const SEEDED = 1200;

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
async function pageSummary(page) {
  return (await page.getByTestId("page-summary").textContent()).trim();
}
async function importCsv(page, csvPath, expectedRows) {
  await page.goto(`${BASE}/dashboard/companies`);
  await page.getByTestId("import-csv").click();
  await page.getByTestId("import-file").setInputFiles(csvPath);
  await page.getByTestId("import-summary").waitFor();
  await page.getByTestId("import-start").click();
  await page.getByText(`Imported ${expectedRows} rows`).waitFor({ timeout: 60000 });
  const totals = await page.getByTestId("import-totals").textContent();
  const filled = await page.getByTestId("import-filled").textContent();
  await page.getByTestId("import-done").click();
  return { totals, filled };
}
// The "auto" marks in one element, as their field names, sorted.
async function pills(locator) {
  return (await locator.locator("[data-testid=auto-pill]").evaluateAll((els) => els.map((el) => el.getAttribute("data-field")))).sort();
}
async function company(org, name) {
  const rows = (
    await sql(
      `SELECT id, phone, website, industries, "companyTypes", "autoFilled", "enrichedAt", "updatedAt" FROM "Company" WHERE name=$2 AND "organizationId"=$1`,
      [org, name],
    )
  ).rows;
  assert.equal(rows.length, 1, `exactly one "${name}"`);
  return rows[0];
}

(async () => {
  await sql(`DELETE FROM "Organization" WHERE slug LIKE '${SLUG}%'`);

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (err) => console.error("PAGE ERROR:", err.message));

  log("signup + activate + login; open the company form so the pick lists seed");
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
  await page.goto(`${BASE}/dashboard/companies/new`);
  await page.getByRole("checkbox", { name: "MDU" }).waitFor();

  log("import a CSV: untagged electrician, tower, unplaceable name; a file-tagged company; a typed phone; a roofer with an owner; a supplier");
  // "Typed Co" already exists with a phone a person typed (no auto mark).
  await sql(
    `INSERT INTO "Company" (id, "organizationId", name, phone, "createdAt", "updatedAt") VALUES ('enrich-typed-co', $1, 'Typed Co', '555-0199', now(), now())`,
    [org],
  );
  const rows = [
    "Name,Title,Email,Phone,Company Name,Company Phone,Company Website,Industry,Company Type",
    "Dana Ruiz,Office Manager,dana@acmeelectric.com,555-0100,Acme Electric LLC,,,,",
    "Lee Park,,lee@lakesidetowers.com,,Lakeside Towers Apartments,,,,",
    "Mia Chen,,mia@lakesidetowers.com,,Lakeside Towers Apartments,,,,",
    ",,,,Zqx Zorblat,,,,",
    ",,,,Bluebird Supply,555-0400,bluebirdsupply.com,Construction,General",
    "Sam Typed,,,555-0177,Typed Co,,,,",
    "Ray Roof,Owner,ray@deltaroofing.com,555-0300,Delta Roofing,,,,",
    // "Sales Rep" is not a main-line title; Kim's is the only number, so it is the company's.
    "Kim Sales,Sales Rep,kim@zephyrsupply.com,555-0500,Zephyr Supply Co,,,,",
  ];
  const csvPath = path.join(OUT, "enrich.csv");
  fs.writeFileSync(csvPath, rows.join("\r\n") + "\r\n");
  const first = await importCsv(page, csvPath, 8);
  assert.match(first.totals, /Contacts added6/, first.totals);
  assert.match(first.totals, /Companies added6/, first.totals);
  assert.match(first.totals, /Companies updated0/, first.totals);
  // Acme, Lakeside, Zqx, Typed Co, Delta and Zephyr get tags; Bluebird brought its own.
  // Phones: Dana (Office Manager), Ray (Owner), Kim (the only number). Websites: acme, lakeside, delta, zephyr.
  assert.match(first.filled, /Tagged 6 · 3 phones · 4 websites filled in/, first.filled);
  await shot(page, "01-import-done");

  log("SQL: tags, phones, websites and auto marks landed where the rules say; the pick lists gained Uncategorized / General and Distributor once");
  const acme = await company(org, "Acme Electric LLC");
  assert.deepEqual(acme.industries, ["Service Provider"]);
  assert.deepEqual(acme.companyTypes, ["Electrician"]);
  assert.equal(acme.phone, "555-0100", "office manager's phone copied up");
  assert.equal(acme.website, "https://acmeelectric.com", "work-email domain became the website");
  assert.deepEqual([...acme.autoFilled].sort(), ["companyTypes", "industries", "phone", "website"]);
  assert.ok(acme.enrichedAt, "enrichedAt set");
  const lakeside = await company(org, "Lakeside Towers Apartments");
  assert.deepEqual(lakeside.industries, ["MDU"]);
  assert.deepEqual(lakeside.companyTypes, ["Property Management"]);
  assert.equal(lakeside.website, "https://lakesidetowers.com");
  assert.equal(lakeside.phone, null, "nobody at Lakeside has a phone");
  assert.deepEqual([...lakeside.autoFilled].sort(), ["companyTypes", "industries", "website"]);
  const zqx = await company(org, "Zqx Zorblat");
  assert.deepEqual(zqx.industries, ["Uncategorized"]);
  assert.deepEqual(zqx.companyTypes, ["General"]);
  const bluebird = await company(org, "Bluebird Supply");
  assert.deepEqual(bluebird.industries, ["Construction"]);
  assert.deepEqual(bluebird.companyTypes, ["General"]);
  assert.deepEqual(bluebird.autoFilled, [], "the file's own tags carry no auto mark");
  const typed = await company(org, "Typed Co");
  assert.equal(typed.phone, "555-0199", "a typed phone is never overwritten");
  assert.deepEqual([...typed.autoFilled].sort(), ["companyTypes", "industries"]);
  const delta = await company(org, "Delta Roofing");
  assert.deepEqual(delta.industries, ["Construction"]);
  assert.equal(delta.phone, "555-0300", "the owner's phone copied up");
  assert.equal(delta.website, "https://deltaroofing.com");
  const uncategorized = (
    await sql(
      `SELECT count(*)::int AS n FROM "CompanyTypeOption" t JOIN "IndustryOption" i ON i.id=t."industryId" WHERE i.name='Uncategorized' AND t.name='General' AND t."organizationId"=$1`,
      [org],
    )
  ).rows[0].n;
  assert.equal(uncategorized, 1, "Uncategorized / General added to the pick lists once");
  // "Distributor" is the one type in the rule table the seed lists lack; the
  // supplier proves it is created under Service Provider and written back.
  const zephyr = await company(org, "Zephyr Supply Co");
  assert.deepEqual(zephyr.industries, ["Service Provider"]);
  assert.deepEqual(zephyr.companyTypes, ["Distributor"]);
  assert.equal(zephyr.phone, "555-0500", "the one person's phone copied up");
  assert.equal(zephyr.website, "https://zephyrsupply.com");
  const distributor = (
    await sql(
      `SELECT count(*)::int AS n FROM "CompanyTypeOption" t JOIN "IndustryOption" i ON i.id=t."industryId" WHERE i.name='Service Provider' AND t.name='Distributor' AND t."organizationId"=$1`,
      [org],
    )
  ).rows[0].n;
  assert.equal(distributor, 1, "Service Provider / Distributor added to the pick lists once");

  log("Companies list shows the marks; Industry filter; Auto-filled toggle; chips + Clear all; Contacts list marks the tags");
  await page.goto(`${BASE}/dashboard/companies`);
  assert.equal(await pageSummary(page), "Showing 1–7 of 7 companies");
  const acmeRow = page.locator("tr", { hasText: "Acme Electric LLC" });
  assert.deepEqual(await pills(acmeRow), ["industries", "phone", "website"], "Acme wears three auto marks");
  const bluebirdRow = page.locator("tr", { hasText: "Bluebird Supply" });
  assert.deepEqual(await pills(bluebirdRow), [], "Bluebird wears none");
  const title = await acmeRow.locator("[data-testid=auto-pill][data-field=phone]").getAttribute("title");
  assert.match(title, /^Filled in by the app on [A-Z][a-z]{2} \d{1,2}, \d{4}$/, title);
  await shot(page, "02-companies-list-marks");
  await page.getByTestId("filter-auto").click();
  await page.waitForURL(/auto=1/);
  assert.equal(await pageSummary(page), "Showing 1–6 of 6 companies", "Auto-filled: everyone but Bluebird");
  assert.ok(await page.getByTestId("active-filters").getByText("Auto-filled").isVisible(), "toggle shows as a chip");
  await page.getByTestId("active-filters").locator("span.badge", { hasText: "Auto-filled" }).getByRole("button", { name: "Remove filter" }).click();
  await page.waitForURL(/^(?!.*auto=)/);
  assert.equal(await pageSummary(page), "Showing 1–7 of 7 companies");
  await page.getByTestId("filter-industry").click();
  await page.getByRole("checkbox", { name: "Service Provider" }).check();
  await page.waitForURL(/industry=Service/);
  assert.equal(await pageSummary(page), "Showing 1–2 of 2 companies", "the Industry filter finds the auto-tagged electrician and supplier");
  await page.getByTestId("filter-company-type").click();
  await page.getByRole("checkbox", { name: "Distributor" }).check();
  await page.waitForURL(/type=Distributor/);
  assert.equal(await pageSummary(page), "Showing 1–1 of 1 companies", "the new Distributor type is in the pick list and finds the supplier");
  await page.getByTestId("filter-auto").click();
  await page.waitForURL(/auto=1/);
  assert.equal(await pageSummary(page), "Showing 1–1 of 1 companies", "filters stack");
  await page.getByRole("button", { name: "Clear all" }).click();
  await page.waitForURL(/\/dashboard\/companies$/);
  assert.equal(await pageSummary(page), "Showing 1–7 of 7 companies");
  await page.goto(`${BASE}/dashboard/contacts?q=dana`);
  assert.deepEqual(await pills(page.locator("tr", { hasText: "Dana Ruiz" })), ["industries"], "the contact row marks the company's tags");
  // The toggle is companies-only: a pasted ?auto=1 on contacts filters nothing and claims nothing.
  await page.goto(`${BASE}/dashboard/contacts?auto=1`);
  assert.equal(await page.getByTestId("active-filters").count(), 0, "no Auto-filled chip on the contacts list");
  assert.equal(await page.getByTestId("filter-auto").count(), 0, "no Auto-filled toggle on the contacts list");

  log(`seed ${SEEDED.toLocaleString()} bare companies + 30 contacts in SQL; Fill in missing counts; stop after the first batch of 500; reopen and finish; totals match SQL; order unchanged`);
  await sql(
    `INSERT INTO "Company" (id, "organizationId", name, "createdAt", "updatedAt")
     SELECT 'enrich-seed-' || lpad(g::text, 5, '0'), $1, 'Seeded ' || g, now() - (g || ' minutes')::interval, now() - (g || ' minutes')::interval
     FROM generate_series(1, $2) g`,
    [org, SEEDED],
  );
  // One person at each of the first 30: every second one has a phone,
  // every fifth uses personal mail, every third is the owner.
  await sql(
    `INSERT INTO "Contact" (id, "organizationId", "companyId", name, title, email, phone, "createdAt", "updatedAt")
     SELECT 'enrich-person-' || lpad(g::text, 3, '0'), $1, 'enrich-seed-' || lpad(g::text, 5, '0'), 'Person ' || g,
       CASE WHEN g % 3 = 0 THEN 'Owner' ELSE 'Foreman' END,
       CASE WHEN g % 5 = 0 THEN 'p' || g || '@gmail.com' ELSE 'p' || g || '@seed' || g || '.test' END,
       CASE WHEN g % 2 = 0 THEN '555-1' || lpad(g::text, 3, '0') ELSE NULL END,
       now(), now()
     FROM generate_series(1, 30) g`,
    [org],
  );
  const expectedPhones = 15; // g even
  const expectedWebsites = 24; // g not a multiple of 5
  await page.goto(`${BASE}/dashboard/companies`);
  assert.equal(await pageSummary(page), `Showing 1–50 of ${(SEEDED + 7).toLocaleString()} companies`);
  const orderBefore = await page.locator("[data-testid=company-row] td:nth-child(2)").allTextContents();
  assert.equal(orderBefore.length, 50);
  await page.getByTestId("fill-missing-button").click();
  const plan = await page.getByTestId("fill-missing-plan").textContent();
  // Untagged: the 1,200 seeded. No phone: those + Lakeside + Zqx. No website: those + Zqx + Typed Co.
  assert.match(plan, /tag 1,200 companies and try to fill in 1,202 phones and 1,202 websites/, plan);
  await shot(page, "03-fill-missing-plan");
  await page.getByTestId("fill-missing-start").click();
  // Stop straight away: the first batch (the 500 oldest, Seeded 1200 down
  // to 701) still finishes, the other two never start.
  await page.getByTestId("fill-missing-stop").click();
  await page.getByText("Stopped after 500 of 1,203 companies").waitFor({ timeout: 60000 });
  await page.getByTestId("fill-missing-stopped").waitFor();
  assert.equal(await page.getByText("Done. Look for the small").count(), 0, "a stopped run does not say Done");
  const partial = await page.getByTestId("fill-missing-summary").textContent();
  // Tags only ("filled in" follows a phone or website count, not a tag count),
  // and every one of the 500 still lacks a phone and a website: none has a person.
  assert.match(partial, /^Tagged 500 · 500 still have a blank nobody on file could fill/, partial);
  await shot(page, "04a-fill-missing-stopped");
  await page.getByTestId("fill-missing-done").click();
  const afterStop = (
    await sql(
      `SELECT count(*) FILTER (WHERE 'industries' = ANY("autoFilled"))::int AS tagged,
              bool_or(name = 'Seeded 1200' AND cardinality(industries) = 1) AS oldest_tagged,
              bool_or(name = 'Seeded 700' AND cardinality(industries) = 0) AS next_untouched
       FROM "Company" WHERE "organizationId"=$1 AND name LIKE 'Seeded %'`,
      [org],
    )
  ).rows[0];
  assert.deepEqual(afterStop, { tagged: 500, oldest_tagged: true, next_untouched: true }, JSON.stringify(afterStop));
  // Reopened, the plan is what is left (every seeded company still lacks
  // a phone and a website, so it is 1,203 again) and the run finishes.
  await page.getByTestId("fill-missing-button").click();
  const rest = await page.getByTestId("fill-missing-plan").textContent();
  assert.match(rest, /tag 700 companies and try to fill in 1,202 phones and 1,202 websites/, rest);
  await page.getByTestId("fill-missing-start").click();
  await page.getByTestId("fill-missing-stop").waitFor();
  await page.getByText("Looked at 1,203 companies").waitFor({ timeout: 180000 });
  const summary = await page.getByTestId("fill-missing-summary").textContent();
  assert.match(summary, new RegExp(`Tagged 700 · ${expectedPhones} phones · ${expectedWebsites} websites filled in`), summary);
  assert.equal(await page.getByTestId("fill-missing-stopped").count(), 0, "a finished run does not say Stopped");
  await shot(page, "04-fill-missing-done");
  await page.getByTestId("fill-missing-done").click();
  const truth = (
    await sql(
      `SELECT count(*) FILTER (WHERE 'industries' = ANY("autoFilled"))::int AS tagged,
              count(*) FILTER (WHERE 'phone' = ANY("autoFilled"))::int AS phones,
              count(*) FILTER (WHERE 'website' = ANY("autoFilled"))::int AS websites,
              count(*) FILTER (WHERE cardinality(industries) = 0)::int AS untagged
       FROM "Company" WHERE "organizationId"=$1 AND name LIKE 'Seeded %'`,
      [org],
    )
  ).rows[0];
  assert.deepEqual(truth, { tagged: SEEDED, phones: expectedPhones, websites: expectedWebsites, untagged: 0 }, JSON.stringify(truth));
  const seed4 = await company(org, "Seeded 4");
  assert.equal(seed4.phone, "555-1004", "the one person's phone copied up");
  assert.equal(seed4.website, "https://seed4.test");
  const seed5 = await company(org, "Seeded 5");
  assert.equal(seed5.website, null, "a personal mail domain is never a website");
  assert.equal(seed5.phone, null);
  await page.goto(`${BASE}/dashboard/companies`);
  const orderAfter = await page.locator("[data-testid=company-row] td:nth-child(2)").allTextContents();
  assert.deepEqual(orderAfter, orderBefore, "filling in kept the list in the same order (updatedAt untouched)");
  const bumped = (
    await sql(`SELECT count(*)::int AS n FROM "Company" WHERE "organizationId"=$1 AND name LIKE 'Seeded %' AND "updatedAt" > now() - interval '30 seconds'`, [org])
  ).rows[0].n;
  assert.equal(bumped, 0, "no seeded company's updatedAt moved");

  log("company page: Looks right clears the marks; editing the website clears only its mark; an untouched save keeps them");
  await page.goto(`${BASE}/dashboard/companies/${acme.id}`);
  const details = page.locator("dl").first();
  assert.deepEqual(await pills(details), ["industries", "phone", "website"], "Details shows all three marks");
  await shot(page, "05-company-page-marks");
  await page.getByTestId("looks-right").click();
  await details.locator("[data-testid=auto-pill]").first().waitFor({ state: "detached" });
  assert.equal(await page.getByTestId("looks-right").count(), 0, "button gone once confirmed");
  const acmeConfirmed = await company(org, "Acme Electric LLC");
  assert.deepEqual(acmeConfirmed.autoFilled, []);
  assert.equal(acmeConfirmed.updatedAt.getTime(), acme.updatedAt.getTime(), "Looks right did not bump updatedAt");
  await page.goto(`${BASE}/dashboard/companies/${lakeside.id}/edit`);
  await page.fill("#website", "lakeside-towers.com");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByText("Company saved").waitFor();
  const lakesideEdited = await company(org, "Lakeside Towers Apartments");
  assert.equal(lakesideEdited.website, "https://lakeside-towers.com");
  assert.deepEqual([...lakesideEdited.autoFilled].sort(), ["companyTypes", "industries"], "only the website mark came off");
  await page.goto(`${BASE}/dashboard/companies/${delta.id}/edit`);
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByText("Company saved").waitFor();
  assert.deepEqual([...(await company(org, "Delta Roofing")).autoFilled].sort(), ["companyTypes", "industries", "phone", "website"], "untouched save keeps every mark");

  log("re-import updates instead of doubling; a later file's phone replaces an auto-filled phone but not a typed one; its industry replaces a guess");
  const again = await importCsv(page, csvPath, 8);
  assert.match(again.totals, /Contacts added0/, again.totals);
  assert.match(again.totals, /Contacts updated6/, again.totals);
  assert.match(again.totals, /Companies added0/, again.totals);
  // "Nothing to fill in" is the Fill in missing plan's line for a complete list; the
  // import's own zero line says the app added nothing, whether or not it looked.
  assert.match(again.filled, /Nothing filled in by the app/, again.filled);
  assert.equal((await sql(`SELECT count(*)::int AS n FROM "Company" WHERE name='Acme Electric LLC' AND "organizationId"=$1`, [org])).rows[0].n, 1, "Acme still one company");
  assert.equal((await company(org, "Typed Co")).phone, "555-0199");
  const later = [
    "Name,Company Name,Company Phone,Industry,Company Type",
    "Ray Roof,Delta Roofing,555-0301,,",
    "Sam Typed,Typed Co,555-0178,,",
    ",Zqx Zorblat,,Commercial,",
  ];
  const laterPath = path.join(OUT, "later.csv");
  fs.writeFileSync(laterPath, later.join("\r\n") + "\r\n");
  const third = await importCsv(page, laterPath, 3);
  assert.match(third.totals, /Companies updated2/, third.totals); // Delta and Zqx; Typed Co untouched
  const deltaLater = await company(org, "Delta Roofing");
  assert.equal(deltaLater.phone, "555-0301", "the file's phone replaced the auto-filled one");
  assert.deepEqual([...deltaLater.autoFilled].sort(), ["companyTypes", "industries", "website"], "phone mark dropped, the rest kept");
  assert.equal((await company(org, "Typed Co")).phone, "555-0199", "a typed phone still beats the file");
  const zqxLater = await company(org, "Zqx Zorblat");
  assert.deepEqual(zqxLater.industries, ["Commercial"], "the file's industry replaced the guess rather than joining it");
  assert.deepEqual(zqxLater.companyTypes, []);
  assert.deepEqual(zqxLater.autoFilled, []);

  log("Needs attention lists what nothing could fill (Zqx, Lakeside, seeded without a phone) and not what was filled");
  await page.goto(`${BASE}/dashboard/companies?attn=1&q=zqx`);
  assert.equal(await pageSummary(page), "Showing 1–1 of 1 companies");
  await page.goto(`${BASE}/dashboard/companies?attn=1&q=acme`);
  assert.equal(await pageSummary(page), "No companies", "Acme has a phone now");
  await page.goto(`${BASE}/dashboard/companies?attn=1`);
  // Seeded companies without a phone (no emails on any of them) + Lakeside + Zqx.
  const attn = SEEDED - expectedPhones + 2;
  assert.equal(await pageSummary(page), `Showing 1–50 of ${attn.toLocaleString()} companies`);
  await shot(page, "06-needs-attention");

  await browser.close();
  console.log(`\nALL ${step} STEPS PASSED. Screenshots in ${OUT}`);
})().catch((err) => {
  console.error("\nFAILED at step", step, "\n", err);
  process.exit(1);
});
