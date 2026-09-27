/* Browser regression for a big import against a database that is far
 * away (Sept 27, 2026). The live database answers in milliseconds, not
 * microseconds, and an 1,800-row import on the live site stopped after
 * the first 500: the step that fills in each company's blanks ran every
 * write in one database transaction, which Prisma gives five seconds.
 * Locally every write is instant, so no other suite could see it.
 *
 * Start the slow proxy first, then the server pointed through it:
 *
 *   node scripts/browser-tests/slow-db-proxy.cjs &          # :5434 -> :5433, 8 ms each way
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5434/scb_test npx next start
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/scb_test \
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules \
 *   node scripts/browser-tests/import-slow-db.cjs
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
const OUT = process.env.SHOTS_DIR || path.join(os.tmpdir(), "scb-browser-shots-slow");
fs.mkdirSync(OUT, { recursive: true });

const EMAIL = "test-slow@example.com";
const PASSWORD = "password123";
const COMPANY = "Test Slow Import Co";
const SLUG = "test-slow-import-co";
const ROWS = 1800;

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

(async () => {
  await sql(`DELETE FROM "Organization" WHERE slug LIKE '${SLUG}%'`);
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
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

  log(`${ROWS} rows, each at its own company with blanks for the app to fill, import to the end with no error`);
  const titles = ["Property Manager", "Owner", "General Contractor", "Leasing Agent", "Facilities Director"];
  const lines = ["Name,Title,Email,Phone,Mailing City,Mailing State,Company Name"];
  for (let i = 1; i <= ROWS; i += 1) {
    lines.push(`Slow Person ${i},${titles[i % titles.length]},slow${i}@slowco${i}.test,555-${String(i).padStart(4, "0")},Austin,TX,Slow Company ${i}`);
  }
  const csvPath = path.join(OUT, "slow.csv");
  fs.writeFileSync(csvPath, lines.join("\r\n") + "\r\n");
  await page.goto(`${BASE}/dashboard/contacts`);
  await page.getByTestId("import-csv").click();
  await page.getByTestId("import-file").setInputFiles(csvPath);
  await page.getByTestId("import-start").click();
  const started = Date.now();
  await page.getByTestId("import-done").waitFor({ timeout: 280000 });
  await page.screenshot({ path: path.join(OUT, "01-finished.png") });
  const progress = await page.getByTestId("import-progress").textContent();
  console.log(`   ${progress} in ${Math.round((Date.now() - started) / 1000)}s`);
  assert.equal(progress, `Imported ${ROWS.toLocaleString()} rows`, "import ran to the end");
  const contacts = (await sql(`SELECT count(*)::int AS n FROM "Contact" WHERE "organizationId"=$1`, [org])).rows[0].n;
  assert.equal(contacts, ROWS, "every contact landed");
  const filled = (await sql(`SELECT count(*)::int AS n FROM "Company" WHERE "organizationId"=$1 AND phone IS NOT NULL`, [org])).rows[0].n;
  assert.equal(filled, ROWS, "every company got its phone filled in from its person");

  log("re-importing the same file updates all of them, still no error");
  await page.getByTestId("import-done").click();
  await page.getByTestId("import-csv").click();
  await page.getByTestId("import-file").setInputFiles(csvPath);
  await page.getByTestId("import-start").click();
  await page.getByTestId("import-done").waitFor({ timeout: 280000 });
  assert.equal(await page.getByTestId("import-progress").textContent(), `Imported ${ROWS.toLocaleString()} rows`);
  assert.equal((await sql(`SELECT count(*)::int AS n FROM "Contact" WHERE "organizationId"=$1`, [org])).rows[0].n, ROWS, "no doubles");

  await sql(`DELETE FROM "Organization" WHERE id=$1`, [org]);
  await browser.close();
  console.log(`\nALL ${step} STEPS PASSED. Screenshots in ${OUT}`);
})().catch((err) => {
  console.error("\nFAILED at step", step, "\n", err);
  process.exit(1);
});
