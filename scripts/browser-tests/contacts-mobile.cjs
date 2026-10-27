/* Browser regression for a contact's Mobile number (Oct 27, 2026).
 *
 * Taylor's import rules: a file's Mobile column lands in Mobile and
 * nowhere else (never Phone, never the company's phone); Phone is the
 * file's Phone, or its Other Number when Phone is blank or a placeholder;
 * a placeholder is blank, words, under 10 digits, every digit the same
 * (111-111-1111, 888-888-8888) or a straight count (123-456-7890).
 * Covers: the template's columns, the preview's Mobile column and its
 * notes, a re-import over a contact an older import left with a fake
 * Phone and no Mobile (filled in, not doubled), a mobile-only person whose
 * new company stays without a phone, "Cell" read as Mobile, the contact
 * page, the edit form round trip, the list search, and a merge keeping it.
 *
 * Runs against a built app (`npm run build:app && npx next start`) and a
 * local Postgres that has had `prisma migrate deploy` run against it. It
 * signs up its own workspace and deletes it on the next run. Never point
 * it at the live database.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/scb_test \
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules \
 *   node scripts/browser-tests/contacts-mobile.cjs
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
const OUT = process.env.SHOTS_DIR || path.join(os.tmpdir(), "scb-browser-shots-mobile");
fs.mkdirSync(OUT, { recursive: true });

const EMAIL = "test-mobile@example.com";
const PASSWORD = "password123";
const COMPANY = "Test Mobile Co";
const SLUG = "test-mobile-co";

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
async function contact(org, email) {
  return (await sql(`SELECT id, name, phone, mobile, "companyId" FROM "Contact" WHERE email=$2 AND "organizationId"=$1`, [org, email])).rows;
}
async function importFile(page, name, lines) {
  const file = path.join(OUT, name);
  fs.writeFileSync(file, lines.join("\r\n") + "\r\n");
  await page.goto(`${BASE}/dashboard/contacts`);
  await page.getByTestId("import-csv").click();
  await page.getByTestId("import-file").setInputFiles(file);
  await page.getByTestId("import-summary").waitFor();
}
async function runImport(page, rows) {
  await page.getByTestId("import-start").click();
  await page.getByText(`Imported ${rows} row`).waitFor({ timeout: 60000 });
  const totals = await page.getByTestId("import-totals").textContent();
  await page.getByTestId("import-done").click();
  return totals;
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

  log("an older import's contact: a placeholder Phone and no Mobile");
  await sql(
    `INSERT INTO "Company" (id, "organizationId", name, "createdAt", "updatedAt") VALUES ('mob-acme', $1, 'Acme Mobile', now(), now())`,
    [org],
  );
  await sql(
    `INSERT INTO "Contact" (id, "organizationId", "companyId", name, email, phone, "createdAt", "updatedAt")
     VALUES ('mob-ann', $1, 'mob-acme', 'Ann Real', 'ann@mobile.test', '111-111-1111', now(), now())`,
    [org],
  );

  log("the template carries Mobile and Other Number after Phone");
  const template = await page.request.get(`${BASE}/dashboard/contacts/import-template`);
  const headers = (await template.text()).split("\r\n")[0].split(",");
  assert.deepEqual(headers.slice(2, 6), ["Email", "Phone", "Mobile", "Other Number"]);

  log("preview: Mobile has its own column, placeholders are named in the notes");
  const file = [
    "First Name,Last Name,Email,Phone,Mobile,Other Number,Company Name",
    "Ann,Real,ann@mobile.test,111-111-1111,512-555-0101,(512) 555-0102,Acme Mobile",
    "Bob,Fake,bob@mobile.test,512-555-0201,888-888-8888,,Acme Mobile",
    "Cal,Count,cal@mobile.test,123-456-7890,,,Acme Mobile",
    "Dee,Cell,dee@mobile.test,,512-555-0401,,Dee Mobile Only LLC",
    "Eve,Blank,eve@mobile.test,N/A,555-0101,missing number,",
  ];
  await importFile(page, "mobile.csv", file);
  assert.match(await page.getByTestId("import-summary").textContent(), /5 contacts and 2 companies found/);
  const previewMobiles = await page.getByTestId("import-preview-mobile").allTextContents();
  assert.deepEqual(previewMobiles, ["512-555-0101", "—", "—", "512-555-0401", "—"]);
  await page.getByText(`Phone "111-111-1111" isn't a real number — used Other Number`).waitFor();
  await page.getByText(`Mobile "888-888-8888" isn't a real number — left blank`).waitFor();
  await shot(page, "01-preview");

  log("import: Ann updated (Mobile filled, fake Phone replaced by Other Number), four added");
  const totals = await runImport(page, 5);
  assert.match(totals, /Contacts added4/, totals);
  assert.match(totals, /Contacts updated1/, totals);
  const expected = {
    "ann@mobile.test": { phone: "(512) 555-0102", mobile: "512-555-0101" },
    "bob@mobile.test": { phone: "512-555-0201", mobile: null },
    "cal@mobile.test": { phone: null, mobile: null },
    "dee@mobile.test": { phone: null, mobile: "512-555-0401" },
    "eve@mobile.test": { phone: null, mobile: null },
  };
  for (const [email, want] of Object.entries(expected)) {
    const rows = await contact(org, email);
    assert.equal(rows.length, 1, `${email} is one contact`);
    assert.deepEqual({ phone: rows[0].phone, mobile: rows[0].mobile }, want, email);
  }

  log("a mobile never becomes the company's phone, even for a company whose only person has one");
  const dee = (await sql(`SELECT phone FROM "Company" WHERE name='Dee Mobile Only LLC' AND "organizationId"=$1`, [org])).rows[0];
  assert.equal(dee.phone, null);
  const acme = (await sql(`SELECT phone FROM "Company" WHERE id='mob-acme'`)).rows[0];
  assert.notEqual(acme.phone, "512-555-0101", "Ann's mobile not on Acme");

  log("re-importing the same file updates all five and adds nobody");
  await importFile(page, "mobile.csv", file);
  const again = await runImport(page, 5);
  assert.match(again, /Contacts added0/, again);
  assert.match(again, /Contacts updated5/, again);
  assert.equal((await sql(`SELECT count(*)::int AS n FROM "Contact" WHERE "organizationId"=$1`, [org])).rows[0].n, 5);

  log("a file with only a Cell column fills Mobile, not Phone");
  await importFile(page, "cell.csv", ["Name,Email,Cell", "Cy Cell,cy@mobile.test,(214) 555-0909"]);
  await runImport(page, 1);
  assert.deepEqual(
    (await contact(org, "cy@mobile.test")).map((r) => ({ phone: r.phone, mobile: r.mobile })),
    [{ phone: null, mobile: "(214) 555-0909" }],
  );

  log("the contact page shows Mobile; the edit form keeps and saves it");
  await page.goto(`${BASE}/dashboard/contacts/mob-ann`);
  assert.equal(await page.getByTestId("contact-mobile").textContent(), "512-555-0101");
  await shot(page, "02-contact-page");
  await page.goto(`${BASE}/dashboard/contacts/mob-ann/edit`);
  assert.equal(await page.locator("#mobile").inputValue(), "512-555-0101");
  await page.fill("#mobile", "512-555-0111");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByText("Contact saved").waitFor();
  assert.equal((await contact(org, "ann@mobile.test"))[0].mobile, "512-555-0111");
  assert.equal((await contact(org, "ann@mobile.test"))[0].phone, "(512) 555-0102", "Phone untouched");

  log("a new contact typed by hand keeps its Mobile");
  await page.goto(`${BASE}/dashboard/contacts/new`);
  await page.fill("#name", "Hand Typed");
  await page.fill("#mobile", "512-555-0777");
  await page.getByRole("button", { name: "Save contact" }).click();
  await page.waitForURL(/\/dashboard\/contacts\/(?!new$)[a-z0-9]+$/);
  assert.equal(await page.getByTestId("contact-mobile").textContent(), "512-555-0777");

  log("the Contacts search finds someone by their mobile");
  await page.goto(`${BASE}/dashboard/contacts?q=555-0111`);
  await page.locator("[data-testid=contact-row]", { hasText: "Ann Real" }).waitFor();
  assert.equal(await page.locator("[data-testid=contact-row]").count(), 1);

  log("merging keeps a mobile the kept contact lacked");
  const bob = (await contact(org, "bob@mobile.test"))[0];
  await page.goto(`${BASE}/dashboard/contacts`);
  await page.locator("[data-testid=merge-open]").click();
  const merge = page.locator("[data-testid=merge-dialog]");
  const results = merge.locator("[data-testid=merge-results] label");
  // The first ticked is kept: Bob, who has no mobile.
  for (const [query, email] of [["Bob Fake", "bob@mobile.test"], ["Cy Cell", "cy@mobile.test"]]) {
    await merge.locator("[data-testid=merge-search]").fill(query);
    await results.filter({ hasText: email }).waitFor();
    await results.filter({ hasText: email }).locator("input").check();
  }
  await merge.locator("[data-testid=merge-go]").click();
  await merge.locator("[data-testid=merge-yes]").click();
  await page.waitForURL(new RegExp(`/dashboard/contacts/${bob.id}$`));
  await shot(page, "03-merged");
  const left = (await sql(`SELECT name, phone, mobile FROM "Contact" WHERE "organizationId"=$1 AND name IN ('Bob Fake','Cy Cell')`, [org])).rows;
  assert.equal(left.length, 1, `one left after merge: ${JSON.stringify(left)}`);
  assert.deepEqual({ ...left[0] }, { name: "Bob Fake", phone: "512-555-0201", mobile: "(214) 555-0909" }, "the mobile came across");

  log("phone width: the contact page fits without sideways scrolling");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/dashboard/contacts/mob-ann`);
  await page.getByTestId("contact-mobile").waitFor();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, `page scrolls sideways by ${overflow}px`);
  await shot(page, "04-phone");

  await browser.close();
  console.log(`\nALL ${step} STEPS PASSED. Screenshots in ${OUT}`);
})().catch((err) => {
  console.error("\nFAILED at step", step, "\n", err);
  process.exit(1);
});
