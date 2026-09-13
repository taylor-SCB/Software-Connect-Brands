/* Load test for the Contacts + Companies lists at CRM-migration scale.
 *
 * Signs up a workspace, fills it with 40,000 companies and 200,000
 * contacts straight in SQL (a CSV import of that size is exercised by
 * the 20,000-row import step below, which is enough to time a batch),
 * then times the pages a user would actually open and fails if any of
 * them is slower than the budget. Run it before anything touching these
 * lists goes live.
 *
 * Runs against a built app (`npm run build:app && npx next start`) and a
 * local Postgres that has had `prisma migrate deploy` run against it.
 * Never point it at the live database.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/scb_test \
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules \
 *   node scripts/browser-tests/load-test.cjs
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
const OUT = process.env.SHOTS_DIR || path.join(os.tmpdir(), "scb-browser-shots-load");
fs.mkdirSync(OUT, { recursive: true });

const EMAIL = "test-load@example.com";
const PASSWORD = "password123";
const COMPANY = "Test Load Co";
const SLUG = "test-load-co";
const COMPANIES = Number(process.env.LOAD_COMPANIES || 40000);
const CONTACTS = Number(process.env.LOAD_CONTACTS || 200000);
const IMPORT_ROWS = Number(process.env.LOAD_IMPORT_ROWS || 20000);
// Seconds a page may take, measured from navigation to the table being on screen.
const BUDGET_S = Number(process.env.LOAD_BUDGET_S || 2);

let step = 0;
function log(msg) {
  step += 1;
  console.log(`[${String(step).padStart(2, "0")}] ${msg}`);
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
const timings = [];
async function timed(page, label, url, ready, budget = BUDGET_S) {
  const started = Date.now();
  await page.goto(url);
  await page.locator(ready).first().waitFor({ timeout: 60000 });
  const seconds = (Date.now() - started) / 1000;
  timings.push({ label, seconds });
  console.log(`     ${seconds.toFixed(2)}s  ${label}`);
  assert.ok(seconds <= budget, `${label} took ${seconds.toFixed(2)}s, budget ${budget}s`);
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
  await page.goto(`${BASE}/login`);
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/dashboard$/);
  const org = (await sql(`SELECT id FROM "Organization" WHERE slug LIKE '${SLUG}%'`)).rows[0].id;
  // Opening any form seeds the industry pick list.
  await page.goto(`${BASE}/dashboard/companies/new`);
  await page.getByRole("checkbox", { name: "MDU" }).waitFor();

  log(`seed ${COMPANIES.toLocaleString()} companies and ${CONTACTS.toLocaleString()} contacts in SQL`);
  const seedStart = Date.now();
  await sql(
    `INSERT INTO "Company" (id, "organizationId", name, phone, email, city, state, industries, "companyTypes", status, favorite, "createdAt", "updatedAt")
     SELECT 'lc' || lpad(g::text, 8, '0'), $1,
       (ARRAY['Acme','Bluebird','Cedar','Delta','Evergreen','Falcon','Granite','Harbor','Iron','Juniper'])[1 + g % 10] || ' ' ||
       (ARRAY['Towers','Holdings','Partners','Group','Properties','Networks','Electric','Builders','Living','Capital'])[1 + (g / 10) % 10] || ' ' || g,
       CASE WHEN g % 3 = 0 THEN NULL ELSE '555-' || lpad((g % 10000)::text, 4, '0') END,
       CASE WHEN g % 4 = 0 THEN NULL ELSE 'office' || g || '@example.test' END,
       (ARRAY['Austin','Dallas','Houston','Denver','Phoenix','Atlanta','Nashville','Tampa','Raleigh','Columbus'])[1 + g % 10],
       (ARRAY['TX','TX','TX','CO','AZ','GA','TN','FL','NC','OH'])[1 + g % 10],
       CASE g % 6 WHEN 0 THEN ARRAY['MDU'] WHEN 1 THEN ARRAY['Student'] WHEN 2 THEN ARRAY['Commercial'] WHEN 3 THEN ARRAY['Construction'] WHEN 4 THEN ARRAY['Small Business'] ELSE ARRAY['Service Provider'] END,
       CASE g % 6 WHEN 0 THEN ARRAY['Owner'] WHEN 1 THEN ARRAY['Developer'] WHEN 5 THEN ARRAY['Integrator'] ELSE ARRAY['General'] END,
       CASE WHEN g % 5 = 0 THEN 'CUSTOMER'::"ContactStatus" ELSE 'LEAD'::"ContactStatus" END,
       g % 97 = 0, now() - (g || ' seconds')::interval, now() - (g || ' seconds')::interval
     FROM generate_series(1, $2) g`,
    [org, COMPANIES],
  );
  await sql(
    `INSERT INTO "Contact" (id, "organizationId", "companyId", name, title, email, phone, city, state, status, favorite, "createdAt", "updatedAt")
     SELECT 'lp' || lpad(g::text, 8, '0'), $1,
       CASE WHEN g % 20 = 0 THEN NULL ELSE 'lc' || lpad((1 + g % $2)::text, 8, '0') END,
       (ARRAY['Alex','Blake','Casey','Dana','Emerson','Finley','Gray','Harper','Indigo','Jordan'])[1 + g % 10] || ' ' ||
       (ARRAY['Rivera','Nguyen','Patel','Okafor','Schmidt','Garcia','Kim','Rossi','Hansen','Ibrahim'])[1 + (g / 10) % 10] || ' ' || g,
       (ARRAY['Owner','Office Manager','Foreman','Buyer','Director','Estimator'])[1 + g % 6],
       CASE WHEN g % 7 = 0 THEN NULL ELSE 'person' || g || '@example.test' END,
       CASE WHEN g % 5 = 0 THEN NULL ELSE '555-' || lpad(((g * 7) % 10000)::text, 4, '0') END,
       (ARRAY['Austin','Dallas','Houston','Denver','Phoenix','Atlanta','Nashville','Tampa','Raleigh','Columbus'])[1 + g % 10],
       CASE WHEN g % 9 = 0 THEN NULL ELSE (ARRAY['TX','TX','TX','CO','AZ','GA','TN','FL','NC','OH'])[1 + g % 10] END,
       CASE WHEN g % 5 = 0 THEN 'CUSTOMER'::"ContactStatus" ELSE 'LEAD'::"ContactStatus" END,
       g % 101 = 0, now() - (g || ' seconds')::interval, now() - (g || ' seconds')::interval
     FROM generate_series(1, $3) g`,
    [org, COMPANIES, CONTACTS],
  );
  // A handful of deals so "With deals" has something to find.
  await sql(
    `INSERT INTO "Deal" (id, "organizationId", "contactId", title, "valueCents", stage, "createdAt", "updatedAt")
     SELECT 'ld' || lpad(g::text, 8, '0'), $1, 'lp' || lpad((g * 1000 + 1)::text, 8, '0'), 'Deal ' || g, 250000, 'LEAD', now(), now()
     FROM generate_series(1, 150) g`,
    [org],
  );
  await sql(`ANALYZE "Contact"; ANALYZE "Company"; ANALYZE "Deal";`);
  console.log(`     seeded in ${((Date.now() - seedStart) / 1000).toFixed(1)}s`);
  const counts = (await sql(`SELECT (SELECT count(*) FROM "Contact" WHERE "organizationId"=$1)::int AS c, (SELECT count(*) FROM "Company" WHERE "organizationId"=$1)::int AS co`, [org])).rows[0];
  assert.equal(counts.c, CONTACTS);
  assert.equal(counts.co, COMPANIES);

  log("time the pages a user opens");
  await timed(page, "Contacts list, first page of 50", `${BASE}/dashboard/contacts`, "[data-testid=contact-row]");
  await timed(page, "Contacts list, page 2,000", `${BASE}/dashboard/contacts?page=2000`, "[data-testid=contact-row]");
  await timed(page, "Contacts list, 100 per page", `${BASE}/dashboard/contacts?per=100`, "[data-testid=contact-row]");
  await timed(page, "Contacts search 'rivera'", `${BASE}/dashboard/contacts?q=rivera`, "[data-testid=contact-row]");
  await timed(page, "Contacts search by email fragment", `${BASE}/dashboard/contacts?q=person1234`, "[data-testid=contact-row]");
  await timed(page, "Contacts filtered State=TX + Industry=MDU", `${BASE}/dashboard/contacts?state=TX&industry=MDU`, "[data-testid=contact-row]");
  await timed(page, "Contacts filtered Company type=Individual / Personal", `${BASE}/dashboard/contacts?type=Individual%20%2F%20Personal`, "[data-testid=contact-row]");
  await timed(page, "Contacts Favorites", `${BASE}/dashboard/contacts/favorites`, "[data-testid=contact-row]");
  await timed(page, "Contacts with Deals", `${BASE}/dashboard/contacts/with-deals`, "[data-testid=contact-row]");
  await timed(page, "Contacts Needs attention", `${BASE}/dashboard/contacts?attn=1`, "[data-testid=contact-row]");
  await timed(page, "Companies list, first page", `${BASE}/dashboard/companies`, "[data-testid=company-row]");
  await timed(page, "Companies search 'granite'", `${BASE}/dashboard/companies?q=granite`, "[data-testid=company-row]");
  await timed(page, "Companies filtered Industry=Service Provider + type=Integrator", `${BASE}/dashboard/companies?industry=Service%20Provider&type=Integrator`, "[data-testid=company-row]");
  await timed(page, "Companies with Deals", `${BASE}/dashboard/companies/with-deals`, "[data-testid=company-row]");
  await timed(page, "A company page (5 people)", `${BASE}/dashboard/companies/lc00000001`, "#people");
  await timed(page, "A contact page", `${BASE}/dashboard/contacts/lp00000001`, "dl");
  await timed(page, "New contact form (pick list, no company dump)", `${BASE}/dashboard/contacts/new`, "#companyName");
  await timed(page, "Dashboard overview", `${BASE}/dashboard`, "main");

  log("type-to-search answers fast");
  for (const [label, url] of [
    ["company search 'granite hold'", `${BASE}/dashboard/companies/search?q=granite%20hold`],
    ["contact search 'harper kim'", `${BASE}/dashboard/contacts/search?q=harper%20kim`],
  ]) {
    const started = Date.now();
    const response = await page.request.get(url);
    const seconds = (Date.now() - started) / 1000;
    assert.equal(response.status(), 200);
    const rows = await response.json();
    console.log(`     ${seconds.toFixed(2)}s  ${label} → ${rows.length} rows`);
    assert.ok(rows.length > 0, `${label} found nothing`);
    assert.ok(seconds <= 1, `${label} took ${seconds.toFixed(2)}s`);
  }

  log(`import a ${IMPORT_ROWS.toLocaleString()}-row CSV on top of it and time the whole run`);
  const lines = ["Name,Email,Phone,State,Company Name,Industry,Company Type"];
  for (let i = 1; i <= IMPORT_ROWS; i += 1) {
    const fresh = i % 2 === 0;
    lines.push(
      fresh
        ? `Import Person ${i},import${i}@example.test,555-${String(i % 10000).padStart(4, "0")},TX,Imported Co ${Math.ceil(i / 25)},Small Business,General`
        : `Alex Rivera ${i},person${i}@example.test,,CO,,,`,
    );
  }
  const csvPath = path.join(OUT, "load-import.csv");
  fs.writeFileSync(csvPath, lines.join("\r\n") + "\r\n");
  await page.goto(`${BASE}/dashboard/contacts`);
  await page.getByTestId("import-csv").click();
  const readStart = Date.now();
  await page.getByTestId("import-file").setInputFiles(csvPath);
  await page.getByTestId("import-summary").waitFor({ timeout: 120000 });
  console.log(`     ${((Date.now() - readStart) / 1000).toFixed(1)}s  read + plan in the browser`);
  const importStart = Date.now();
  await page.getByTestId("import-start").click();
  await page.getByText(`Imported ${IMPORT_ROWS.toLocaleString()} rows`).waitFor({ timeout: 30 * 60 * 1000 });
  const importSeconds = (Date.now() - importStart) / 1000;
  const totals = await page.getByTestId("import-totals").textContent();
  console.log(`     ${importSeconds.toFixed(1)}s  import (${(IMPORT_ROWS / importSeconds).toFixed(0)} rows/s) — ${totals.replace(/\s+/g, " ").trim()}`);
  // Odd rows reuse a seeded email, except the seeded contacts that have
  // no email (every seventh), which can only be created.
  let updated = 0;
  for (let i = 1; i <= IMPORT_ROWS; i += 2) if (i % 7 !== 0) updated += 1;
  assert.match(totals, new RegExp(`Contacts added${(IMPORT_ROWS - updated).toLocaleString()}`), totals);
  assert.match(totals, new RegExp(`Contacts updated${updated.toLocaleString()}`), totals);
  await page.getByTestId("import-done").click();
  console.log(`     at that rate 200,000 rows take about ${Math.round((200000 / IMPORT_ROWS) * importSeconds / 60)} minutes`);

  await timed(page, "Contacts list after the import", `${BASE}/dashboard/contacts`, "[data-testid=contact-row]");

  await browser.close();
  console.log(`\nALL ${step} STEPS PASSED. Slowest page: ${timings.sort((a, b) => b.seconds - a.seconds)[0].label} (${timings[0].seconds.toFixed(2)}s)`);
})().catch((err) => {
  console.error("\nFAILED at step", step, "\n", err);
  process.exit(1);
});
