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
       CASE WHEN g % 5 = 0 THEN 'WON'::"ContactStatus" ELSE 'NOT_ACTIONED'::"ContactStatus" END,
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
       CASE WHEN g % 5 = 0 THEN 'WON'::"ContactStatus" ELSE 'NOT_ACTIONED'::"ContactStatus" END,
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
  // Clean CRM data (Nov 10, 2026): a touch on every other person spread
  // over the last 200 days, a marketing send on every tenth, a rep on a
  // third of them, and a Client opportunity on a few hundred, so the
  // Activity, Rep, Lead Label filters and the duplicate finder have
  // something real to chew through.
  const owner = (await sql(`SELECT id FROM "User" WHERE email = $1`, [EMAIL])).rows[0].id;
  await sql(
    `INSERT INTO "Activity" (id, "organizationId", "contactId", "userId", type, body, marketing, "occurredAt")
     SELECT 'la' || lpad(g::text, 8, '0'), $1, 'lp' || lpad(g::text, 8, '0'), $2,
       (ARRAY['PHONE_CALL','EMAIL','TEXT','MEETING']::"ActivityType"[])[1 + g % 4], 'Seeded touch', false,
       now() - ((g % 200) || ' days')::interval
     FROM generate_series(2, $3, 2) g`,
    [org, owner, CONTACTS],
  );
  await sql(
    `INSERT INTO "Activity" (id, "organizationId", "contactId", "userId", type, body, marketing, "occurredAt")
     SELECT 'lm' || lpad(g::text, 8, '0'), $1, 'lp' || lpad(g::text, 8, '0'), $2, 'EMAIL', 'Emailed “Seeded”', true,
       now() - ((g % 30) || ' days')::interval
     FROM generate_series(10, $3, 10) g`,
    [org, owner, CONTACTS],
  );
  await sql(`UPDATE "Contact" SET "ownerId" = $2, "createdById" = $2 WHERE "organizationId" = $1 AND right(id, 1) IN ('0','3','6')`, [org, owner]);
  await sql(
    `INSERT INTO "Opportunity" (id, "organizationId", title, "leadLabel", "updatedAt")
     SELECT 'lo' || lpad(g::text, 8, '0'), $1, 'Seeded opportunity ' || g, 'Client', now() FROM generate_series(1, 500) g`,
    [org],
  );
  await sql(
    `INSERT INTO "OpportunityContact" (id, "opportunityId", "contactId", role)
     SELECT 'loc' || lpad(g::text, 8, '0'), 'lo' || lpad(g::text, 8, '0'), 'lp' || lpad((g * 397)::text, 8, '0'), 'PRIMARY'
     FROM generate_series(1, 500) g`,
  );
  await sql(`ANALYZE "Contact"; ANALYZE "Company"; ANALYZE "Deal"; ANALYZE "Activity"; ANALYZE "Opportunity"; ANALYZE "OpportunityContact";`);
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
  // The search box after the UX review (Nov 10, 2026): a phone number typed
  // another way than it is stored (digits-only, on its own trigram index),
  // a first name plus a company, and a job title.
  await timed(page, "Contacts search a phone typed without its dash", `${BASE}/dashboard/contacts?q=5550007`, "[data-testid=contact-row]");
  await timed(page, "Contacts search a phone typed with a dot", `${BASE}/dashboard/contacts?q=555.0007`, "[data-testid=contact-row]");
  await timed(page, "Contacts search a name and a company 'finley granite'", `${BASE}/dashboard/contacts?q=finley%20granite`, "[data-testid=contact-row]");
  await timed(page, "Contacts search a job title 'office manager'", `${BASE}/dashboard/contacts?q=office%20manager`, "[data-testid=contact-row]");
  await timed(page, "Companies search a phone typed without its dash", `${BASE}/dashboard/companies?q=5550007`, "[data-testid=company-row]");
  await timed(page, "Contacts filtered State=TX + Industry=MDU", `${BASE}/dashboard/contacts?state=TX&industry=MDU`, "[data-testid=contact-row]");
  await timed(page, "Contacts filtered Company type=Individual / Personal", `${BASE}/dashboard/contacts?type=Individual%20%2F%20Personal`, "[data-testid=contact-row]");
  await timed(page, "Contacts Favorites", `${BASE}/dashboard/contacts/favorites`, "[data-testid=contact-row]");
  await timed(page, "Contacts with Deals", `${BASE}/dashboard/contacts/with-deals`, "[data-testid=contact-row]");
  await timed(page, "Contacts Needs attention", `${BASE}/dashboard/contacts?attn=1`, "[data-testid=contact-row]");
  // "Owes money" is the one filter that cannot be a where-clause: the
  // figure is the rows less the payments against them, so it goes through
  // a grouped aggregate (owingIds in src/lib/money.ts). It has to stay
  // inside the budget at this size like everything else. Both pages
  // legitimately come back empty here — nothing is billed in the seed —
  // so the wait is on the page's own heading, not on a row.
  await timed(page, "Contacts Owes money", `${BASE}/dashboard/contacts?owed=1`, "h1");
  await timed(page, "Companies Owes money", `${BASE}/dashboard/companies?owed=1`, "h1");
  await timed(page, "Companies list, first page", `${BASE}/dashboard/companies`, "[data-testid=company-row]");
  await timed(page, "Companies search 'granite'", `${BASE}/dashboard/companies?q=granite`, "[data-testid=company-row]");
  await timed(page, "Companies filtered Industry=Service Provider + type=Integrator", `${BASE}/dashboard/companies?industry=Service%20Provider&type=Integrator`, "[data-testid=company-row]");
  await timed(page, "Companies with Deals", `${BASE}/dashboard/companies/with-deals`, "[data-testid=company-row]");
  await timed(page, "A company page (5 people)", `${BASE}/dashboard/companies/lc00000001`, "#people");
  await timed(page, "A contact page", `${BASE}/dashboard/contacts/lp00000001`, "dl");
  await timed(page, "New contact form (pick list, no company dump)", `${BASE}/dashboard/contacts/new`, "#companyName");
  await timed(page, "Dashboard overview", `${BASE}/dashboard`, "main");

  // BDR redesign, release 5 (Nov 11, 2026): My day ranks Up next from a
  // rep's whole book (here the owner holds 60,000 of the 200,000, with
  // 140,000 nobody owns for "Take 10"), Team today reads every rep's
  // week and book health, and the calendar opens on the Agenda.
  log("Sprint: My day's Up next for a rep with 60,000 people, Team today and the Agenda, inside budget");
  await timed(page, "My day (Up next from a 60,000-person book)", `${BASE}/dashboard?view=myday`, "[data-testid=up-next-row]");
  assert.match(await page.locator("[data-testid=unowned-count]").textContent(), /^1\d\d,?\d{3} new leads nobody owns|^\d+ new leads nobody owns/);
  await timed(page, "Daily Rundown with Team today", `${BASE}/dashboard?report=daily`, "[data-testid=team-row]");
  await timed(page, "Calendar Agenda", `${BASE}/dashboard/calendar?view=agenda`, "[data-testid=agenda]");

  log("time the Clean CRM data filters, the Labels screen and the duplicate finder");
  const ownerId = (await sql(`SELECT id FROM "User" WHERE email = $1`, [EMAIL])).rows[0].id;
  for (const [label, url, ready] of [
    ["Contacts touched in the last 30 days", "/dashboard/contacts?act=t30", "[data-testid=contact-row]"],
    ["Contacts not touched in the last 30 days", "/dashboard/contacts?act=n30", "[data-testid=contact-row]"],
    ["Contacts never touched", "/dashboard/contacts?act=never", "[data-testid=contact-row]"],
    ["Contacts Job title = owner", "/dashboard/contacts?title=owner", "[data-testid=contact-row]"],
    ["Contacts Rep = Unassigned", "/dashboard/contacts?rep=none", "[data-testid=contact-row]"],
    ["Contacts Rep = the owner", `/dashboard/contacts?rep=${ownerId}`, "[data-testid=contact-row]"],
    ["Contacts Added by the owner", `/dashboard/contacts?by=${ownerId}`, "[data-testid=contact-row]"],
    ["Contacts Added this year", "/dashboard/contacts?from=2026-01-01", "[data-testid=contact-row]"],
    ["Contacts with no mobile and an email", "/dashboard/contacts?mobile=no&email=yes", "[data-testid=contact-row]"],
    ["Contacts Lead Label = Client", "/dashboard/contacts?label=Client", "[data-testid=contact-row]"],
    ["Contacts stacked: Rep + title + not touched 90 days + State", `/dashboard/contacts?rep=${ownerId}&title=Owner&act=n90&state=TX`, "[data-testid=contact-row]"],
    ["Companies touched in the last 7 days", "/dashboard/companies?act=t7", "[data-testid=company-row]"],
    ["Companies not touched in the last 90 days", "/dashboard/companies?act=n90", "h1"],
    ["Companies Lead Label = Client", "/dashboard/companies?label=Client", "[data-testid=company-row]"],
    ["Companies Rep = Unassigned + has phone", "/dashboard/companies?rep=none&phone=yes", "[data-testid=company-row]"],
    ["CRM Labels screen", "/dashboard/labels", "[data-testid=label-row]"],
    ["Duplicate contacts by email", "/dashboard/contacts/duplicates?by=email", "h1"],
    ["Duplicate contacts by phone", "/dashboard/contacts/duplicates?by=phone", "h1"],
    ["Duplicate contacts by name at a company", "/dashboard/contacts/duplicates?by=name", "h1"],
    ["Duplicate companies by name", "/dashboard/companies/duplicates?by=name", "h1"],
    ["Duplicate companies by phone", "/dashboard/companies/duplicates?by=phone", "h1"],
  ]) {
    await timed(page, label, `${BASE}${url}`, ready);
  }
  {
    const started = Date.now();
    const response = await page.request.get(`${BASE}/dashboard/contacts/titles?q=`);
    const seconds = (Date.now() - started) / 1000;
    const rows = await response.json();
    console.log(`     ${seconds.toFixed(2)}s  job title choices → ${rows.length} rows`);
    assert.ok(rows.length > 0 && seconds <= 1, `job title choices took ${seconds.toFixed(2)}s`);
  }
  log("Sprint: the lists' presets, sorts and scopes at 200,000 contacts, with 3,000 calendar entries late, ahead and this week");
  await sql(
    `INSERT INTO "CalendarEvent" (id, "organizationId", title, type, "startOn", "contactId", "updatedAt")
     SELECT 'lev' || lpad(g::text, 8, '0'), $1, 'Seeded', (ARRAY['Call','Meeting','Email'])[1 + g % 3],
       current_date + ((g % 21) - 10), 'lp' || lpad((g * 61)::text, 8, '0'), now()
     FROM generate_series(1, 3000) g ON CONFLICT DO NOTHING`,
    [org],
  );
  await sql(`UPDATE "Contact" SET status = (ARRAY['NOT_ACTIONED','CONTACTED','CONNECTED','INTERESTED','MEETING_SET']::"ContactStatus"[])[1 + (right(id, 2)::int % 5)] WHERE "organizationId" = $1`, [org]);
  await sql(`ANALYZE "CalendarEvent"; ANALYZE "Contact";`);
  for (const [label, url, ready] of [
    ["Contacts My call list (Mine)", "/dashboard/contacts?scope=mine&preset=call", "[data-testid=contact-row]"],
    ["Contacts My call list (Everyone) — the health sort, late follow-ups first", "/dashboard/contacts?scope=all&preset=call", "[data-testid=contact-row]"],
    ["Contacts My call list, page 50", "/dashboard/contacts?scope=all&preset=call&page=50", "[data-testid=contact-row]"],
    ["Contacts Never touched", "/dashboard/contacts?scope=all&preset=never", "[data-testid=contact-row]"],
    ["Contacts Talked — no meeting", "/dashboard/contacts?scope=all&preset=talked", "[data-testid=contact-row]"],
    ["Contacts Meetings this week", "/dashboard/contacts?scope=all&preset=week", "h1"],
    ["Contacts Unowned", "/dashboard/contacts?scope=unowned", "[data-testid=contact-row]"],
    ["Contacts sorted Oldest touch first (late first)", "/dashboard/contacts?scope=all&sort=touch", "[data-testid=contact-row]"],
    ["Contacts sorted Recently touched", "/dashboard/contacts?scope=all&sort=recent", "[data-testid=contact-row]"],
    ["Contacts sorted Name", "/dashboard/contacts?scope=all&sort=name", "[data-testid=contact-row]"],
    ["Contacts sorted Recently edited", "/dashboard/contacts?scope=all&sort=edited", "[data-testid=contact-row]"],
    ["Contacts Not connected in 30 days", "/dashboard/contacts?scope=all&act=nc30", "[data-testid=contact-row]"],
    ["Contacts Never connected", "/dashboard/contacts?scope=all&act=nconn", "[data-testid=contact-row]"],
    ["Contacts with every extra column", "/dashboard/contacts?scope=all&per=100", "[data-testid=contact-row]"],
    ["Companies My accounts", "/dashboard/companies?scope=mine&preset=accounts", "h1"],
    ["Companies Going quiet", "/dashboard/companies?scope=all&preset=quiet", "[data-testid=company-row]"],
    ["Companies Talked — no meeting", "/dashboard/companies?scope=all&preset=talked", "h1"],
    ["Companies Never touched", "/dashboard/companies?scope=all&preset=never", "h1"],
    ["Companies sorted Oldest touch first", "/dashboard/companies?scope=all&sort=touch", "[data-testid=company-row]"],
    ["Companies sorted Name", "/dashboard/companies?scope=all&sort=name", "[data-testid=company-row]"],
  ]) {
    if (label === "Contacts with every extra column")
      await sql(`UPDATE "User" SET "uiPrefs" = $2::jsonb WHERE id = $1`, [ownerId, JSON.stringify({ "contacts.columns": ["email", "phone2", "location", "industry", "notes", "marketing", "added", "addedBy", "status"] })]);
    await timed(page, label, `${BASE}${url}`, ready);
  }
  await sql(`UPDATE "User" SET "uiPrefs" = NULL WHERE id = $1`, [ownerId]);
  log("Sprint: Warmest first and the Pulse filter (the SQL twin of the health rules) at 200,000 contacts, inside the 2-second budget");
  for (const [label, url] of [
    ["Contacts sorted Warmest first (Everyone)", "/dashboard/contacts?scope=all&sort=pulse"],
    ["Contacts Warmest first, page 2,000", "/dashboard/contacts?scope=all&sort=pulse&page=2000"],
    ["Contacts Warmest first, 100 per page, page 600", "/dashboard/contacts?scope=all&sort=pulse&per=100&page=600"],
    ["Contacts Warmest first (Mine)", "/dashboard/contacts?scope=mine&sort=pulse"],
    ["Contacts Pulse = Cold", "/dashboard/contacts?scope=all&pulse=cold"],
    ["Contacts Pulse = Warm + Cooling", "/dashboard/contacts?scope=all&pulse=warm&pulse=cooling"],
    ["Contacts Pulse = Trying + stalled, Warmest first", "/dashboard/contacts?scope=all&pulse=trying&pulse=stalled&sort=pulse"],
    ["Contacts Pulse = New + State TX", "/dashboard/contacts?scope=all&pulse=new&state=TX"],
  ]) {
    await timed(page, label, `${BASE}${url}`, "h1");
  }
  {
    // Every pulse, counted through the list, adds up to the whole workspace:
    // nobody is lost or doubled by the id lists at this size.
    let sum = 0;
    for (const key of ["won", "owes", "warm", "cooling", "cold", "trying", "stalled", "new", "closed"]) {
      await page.goto(`${BASE}/dashboard/contacts?scope=all&pulse=${key}`);
      const text = (await page.getByTestId("page-summary").textContent()).replace(/,/g, "");
      const match = text.match(/of (\d+) contacts/);
      sum += match ? Number(match[1]) : 0;
    }
    const all = (await sql(`SELECT count(*)::int AS n FROM "Contact" WHERE "organizationId" = $1`, [org])).rows[0].n;
    console.log(`     every pulse adds up to ${sum} of ${all}`);
    assert.equal(sum, all, "every person is under exactly one pulse");
  }
  await sql(`DELETE FROM "CalendarEvent" WHERE "organizationId" = $1 AND id LIKE 'lev%'`, [org]);

  log("bulk assign the first 1,000 of every Unassigned contact in one go");
  await page.goto(`${BASE}/dashboard/contacts?rep=none`);
  await page.getByTestId("page-check").check();
  await page.getByTestId("bulk-all").click();
  const assignStart = Date.now();
  await page.getByTestId("bulk-me").click();
  await page.getByTestId("bulk-message").filter({ hasText: "1,000 records" }).waitFor({ timeout: 60000 });
  const assignSeconds = (Date.now() - assignStart) / 1000;
  console.log(`     ${assignSeconds.toFixed(2)}s  assign 1,000 of all Unassigned`);
  assert.ok(assignSeconds <= BUDGET_S * 2, `bulk assign took ${assignSeconds.toFixed(2)}s`);

  // BDR redesign (Nov 11, 2026): lastConnectAt rides the same statement
  // triggers as lastTouchAt. Outcomes written in bulk, a connect dated
  // ahead coming due, and the "not connected in 30 days" range all stay
  // inside budget at this size, and the rows agree with Activity.
  log("Sprint: lastConnectAt at 200,000 — 20,000 calls marked Talked in one UPDATE keep both dates, inside budget");
  const bulkStart = Date.now();
  await sql(
    `UPDATE "Activity" SET outcome = 'TALKED'
      WHERE id IN (SELECT id FROM "Activity" WHERE "organizationId" = $1 AND type = 'PHONE_CALL' AND marketing = false ORDER BY id LIMIT 20000)`,
    [org],
  );
  const bulkSeconds = (Date.now() - bulkStart) / 1000;
  console.log(`     ${bulkSeconds.toFixed(2)}s  20,000 outcomes written, both dates recomputed`);
  assert.ok(bulkSeconds <= BUDGET_S * 5, `the bulk outcome update took ${bulkSeconds.toFixed(2)}s`);
  const agree = (
    await sql(
      `SELECT (SELECT count(*) FROM "Contact" WHERE "organizationId" = $1 AND "lastConnectAt" IS NOT NULL)::int AS rows,
              (SELECT count(DISTINCT "contactId") FROM "Activity" WHERE "organizationId" = $1 AND marketing = false AND "occurredAt" <= now()
                  AND (outcome IN ('TALKED','REPLIED','HELD') OR (type = 'MEETING' AND outcome IS NULL)))::int AS truth,
              (SELECT count(*) FROM "Company" WHERE "organizationId" = $1 AND "lastConnectAt" IS NOT NULL)::int AS companies,
              (SELECT count(DISTINCT c."companyId") FROM "Contact" c WHERE c."organizationId" = $1 AND c."lastConnectAt" IS NOT NULL AND c."companyId" IS NOT NULL)::int AS companyTruth,
              (SELECT count(*) FROM "Contact" c WHERE c."organizationId" = $1 AND c."lastConnectAt" IS NOT NULL AND c."lastConnectAt" > c."lastTouchAt")::int AS ahead`,
      [org],
    )
  ).rows[0];
  assert.equal(agree.rows, agree.truth, "every connected person has the date, and nobody else");
  assert.equal(agree.companies, agree.companytruth, "and every company with a connected person");
  assert.equal(agree.ahead, 0, "a connect is never later than the last touch");
  assert.ok(agree.rows >= 19000, `${agree.rows} people connected`);

  log("Sprint: a talk dated ahead comes due through crm_touch_due, and the not-connected-in-30-days range answers fast");
  await sql(
    `INSERT INTO "Activity" (id, "organizationId", "contactId", "userId", type, body, outcome, "occurredAt", "createdAt")
     SELECT 'lt' || lpad(g::text, 8, '0'), $1, 'lp' || lpad((g * 2 + 1)::text, 8, '0'), $2, 'PHONE_CALL', 'Talk for later', 'TALKED',
            now() + interval '1 second', now()
       FROM generate_series(1, 2000) g`,
    [org, owner],
  );
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const dueStart = Date.now();
  await sql(`SELECT crm_touch_due($1)`, [org]);
  const dueSeconds = (Date.now() - dueStart) / 1000;
  const due = (await sql(`SELECT count(*)::int AS n FROM "Contact" WHERE "organizationId" = $1 AND id IN (SELECT "contactId" FROM "Activity" WHERE id LIKE 'lt%') AND "lastConnectAt" IS NOT NULL`, [org])).rows[0].n;
  console.log(`     ${dueSeconds.toFixed(2)}s  crm_touch_due brought ${due} talks on`);
  assert.equal(due, 2000);
  assert.ok(dueSeconds <= BUDGET_S, `crm_touch_due took ${dueSeconds.toFixed(2)}s`);
  const rangeStart = Date.now();
  const quiet = (
    await sql(
      `SELECT count(*)::int AS n FROM "Contact" WHERE "organizationId" = $1 AND ("lastConnectAt" IS NULL OR "lastConnectAt" < now() - interval '30 days')`,
      [org],
    )
  ).rows[0].n;
  const rangeSeconds = (Date.now() - rangeStart) / 1000;
  console.log(`     ${rangeSeconds.toFixed(2)}s  ${quiet.toLocaleString()} not connected in 30 days`);
  assert.ok(rangeSeconds <= 1, `the not-connected range took ${rangeSeconds.toFixed(2)}s`);

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
        ? `Import Person ${i},import${i}@example.test,512-555-${String(i % 10000).padStart(4, "0")},TX,Imported Co ${Math.ceil(i / 25)},Small Business,General`
        : `Alex Rivera ${i},person${i}@example.test,,CO,,,`,
    );
  }
  const csvPath = path.join(OUT, "load-import.csv");
  fs.writeFileSync(csvPath, lines.join("\r\n") + "\r\n");
  await page.goto(`${BASE}/dashboard/contacts`);
  await cleanUp(page, "import");
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

// Import CSV sits under "Clean up" since Nov 11, 2026.
async function cleanUp(p, item) {
  await p.getByTestId("cleanup").click();
  await p.getByTestId(`cleanup-${item}`).click();
}
