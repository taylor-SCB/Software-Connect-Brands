/* Browser regression for "Users vs Company", release 3 (Sept 30, 2026).
 *
 * Covers: the status ladder — a new contact starts Not Actioned, the first
 * logged touch makes them (and their company) Contacted, Interested set by
 * hand lands them on Interested Contacts / Interested Companies; the first
 * meeting booked makes them Meeting Set, credited to whoever booked it, and
 * a second meeting changes nothing; the Pipeline starting at Meeting Set
 * with contacts (not deals) in the first two columns and no deal made for
 * them; skipping ahead from the status button asks for each skipped step's
 * date, prefilled with the meeting date, and refuses dates out of order;
 * a deal moved on its tile asks the day and carries its contact with it;
 * the 90 / 180-day contract rule (Archived, then Lost); the edit forms no
 * longer offering Status; and the Stats page — tiles, funnel, close rate,
 * leaderboard, rep filter and periods.
 *
 * Runs against a built app (`bash scripts/dev-serve.sh`) and a local
 * Postgres that has had `prisma migrate deploy` run against it. It signs
 * up its own workspace and deletes it again on the next run. Never point
 * it at the live database.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/scb_test \
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules \
 *   node scripts/browser-tests/crm-pipeline-stats.cjs
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
const OUT = process.env.SHOTS_DIR || path.join(os.tmpdir(), "scb-browser-shots-pipeline-stats");
fs.mkdirSync(OUT, { recursive: true });

const EMAIL = "test-pipestats@example.com";
const NIC_EMAIL = "test-pipestats-nic@example.com";
const PASSWORD = "password123";
const COMPANY = "Test Pipeline Stats Co";

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
async function until(fn, what) {
  for (let i = 0; i < 40; i += 1) {
    if (await fn()) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`timed out waiting for ${what}`);
}
const status = async (table, id) => (await sql(`SELECT status FROM "${table}" WHERE id=$1`, [id])).rows[0].status;
function isoDaysAgo(n) {
  const d = new Date(Date.now() - n * 86_400_000);
  return d.toISOString().slice(0, 10);
}

(async () => {
  await sql(`DELETE FROM "Organization" WHERE slug LIKE 'test-pipeline-stats-co%'`);
  await sql(`DELETE FROM "User" WHERE email = $1`, [NIC_EMAIL]);

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
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
  await sql(`UPDATE "Organization" SET status='ACTIVE', "reviewedAt"=now() WHERE slug LIKE 'test-pipeline-stats-co%'`);
  await login(page, EMAIL);
  const org = (await sql(`SELECT id FROM "Organization" WHERE slug LIKE 'test-pipeline-stats-co%'`)).rows[0].id;
  const taylor = (await sql(`SELECT id, "passwordHash" FROM "User" WHERE email = $1`, [EMAIL])).rows[0];
  const nicId = "usr_pipestats_nic";
  await sql(
    `INSERT INTO "User" (id, name, email, "passwordHash", role, "organizationId") VALUES ($1, 'Nic Rivera', $2, $3, 'MEMBER', $4)`,
    [nicId, NIC_EMAIL, taylor.passwordHash, org],
  );

  log("the sidebar has Stats / Reporting and the Interested sub-panes");
  const aside = page.locator("aside");
  await aside.getByRole("link", { name: "Stats / Reporting" }).waitFor();
  await page.goto(`${BASE}/dashboard/contacts`);
  await aside.getByRole("link", { name: "Interested Contacts" }).waitFor();
  await page.goto(`${BASE}/dashboard/companies`);
  await aside.getByRole("link", { name: "Interested Companies" }).waitFor();

  log("a new contact starts Not Actioned; the new form offers only the pre-pipeline statuses");
  await page.goto(`${BASE}/dashboard/contacts/new`);
  const options = await page.locator("select[name=status] option").allTextContents();
  assert.deepEqual(options, ["Not Actioned", "Contacted", "Not Interested", "Interested"]);
  await page.fill("#companyName", "Aster Homes");
  await page.fill("#name", "Ava Stone");
  await page.getByRole("button", { name: "Save contact" }).click();
  await page.waitForURL(/\/dashboard\/contacts\/(?!new$)[a-z0-9]+$/);
  const ava = page.url().split("/").pop();
  const aster = (await sql(`SELECT "companyId" FROM "Contact" WHERE id=$1`, [ava])).rows[0].companyId;
  assert.equal(await status("Contact", ava), "NOT_ACTIONED");
  await page.locator("[data-testid=status-picker]").getByText("Not Actioned").waitFor();
  log("the edit form no longer carries a Status box — it's the button on the page");
  await page.goto(`${BASE}/dashboard/contacts/${ava}/edit`);
  assert.equal(await page.locator("select[name=status]").count(), 0);

  log("the first logged touch makes Ava — and Aster Homes — Contacted");
  await page.goto(`${BASE}/dashboard/contacts/${ava}`);
  const form = page.locator("[data-testid=log-activity-form]");
  await form.locator("textarea[name=body]").fill("Intro call");
  await form.locator("[data-testid=activity-submit]").click();
  await until(async () => (await status("Contact", ava)) === "CONTACTED", "Ava contacted");
  assert.equal(await status("Company", aster), "CONTACTED");
  const contactedRow = (await sql(`SELECT auto, "userId", "fromStatus" FROM "StatusChange" WHERE "contactId"=$1 AND "toStatus"='CONTACTED'`, [ava])).rows[0];
  assert.deepEqual(contactedRow, { auto: true, userId: taylor.id, fromStatus: "NOT_ACTIONED" });

  log("Interested, set by hand, lands on Interested Contacts and Interested Companies");
  await page.reload();
  await page.locator("[data-testid=status-picker]").click();
  await page.locator("[data-testid=status-option-INTERESTED]").click();
  await until(async () => (await status("Contact", ava)) === "INTERESTED", "Ava interested");
  await page.goto(`${BASE}/dashboard/contacts/interested`);
  await page.locator("[data-testid=contact-row]", { hasText: "Ava Stone" }).waitFor();
  await page.goto(`${BASE}/dashboard/companies/${aster}`);
  await page.locator("[data-testid=status-picker]").click();
  await page.locator("[data-testid=status-option-INTERESTED]").click();
  await until(async () => (await status("Company", aster)) === "INTERESTED", "Aster interested");
  await page.goto(`${BASE}/dashboard/companies/interested`);
  await page.locator("[data-testid=company-row]", { hasText: "Aster Homes" }).waitFor();

  // Nic books the meeting on his own login.
  const nicContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const nic = await nicContext.newPage();
  nic.on("pageerror", (err) => console.error("PAGE ERROR (Nic):", err.message));
  await login(nic, NIC_EMAIL);

  log("Nic books a meeting with Ava for next week: Meeting Set, credited to Nic, and no deal made");
  await nic.goto(`${BASE}/dashboard/contacts/${ava}`);
  const nicForm = nic.locator("[data-testid=log-activity-form]");
  await nicForm.getByRole("button", { name: "Meeting", exact: true }).click();
  await nicForm.locator("textarea[name=body]").fill("Walkthrough at their office");
  const nextWeek = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  await nicForm.locator("[data-testid=activity-when]").fill(nextWeek);
  await nicForm.locator("[data-testid=activity-submit]").click();
  await nic.getByText(/Scheduled for/).waitFor();
  assert.equal(await status("Contact", ava), "MEETING_SET");
  assert.equal(await status("Company", aster), "MEETING_SET");
  const setRow = (await sql(`SELECT "userId" FROM "StatusChange" WHERE "contactId"=$1 AND "toStatus"='MEETING_SET'`, [ava])).rows;
  assert.deepEqual(setRow, [{ userId: nicId }]);
  assert.equal((await sql(`SELECT count(*)::int n FROM "Deal" WHERE "organizationId"=$1`, [org])).rows[0].n, 0, "a meeting is not a deal");

  log("a second meeting changes nothing");
  await nicForm.getByRole("button", { name: "Meeting", exact: true }).click();
  await nicForm.locator("textarea[name=body]").fill("Follow-up walkthrough");
  await nicForm.locator("[data-testid=activity-when]").fill(nextWeek);
  await nicForm.locator("[data-testid=activity-submit]").click();
  await nic.getByText(/Scheduled for/).waitFor();
  assert.equal((await sql(`SELECT count(*)::int n FROM "StatusChange" WHERE "contactId"=$1 AND "toStatus"='MEETING_SET'`, [ava])).rows[0].n, 1);

  log("a meeting logged as held also sets it (Ben)");
  await sql(`INSERT INTO "Contact" (id,"organizationId",name,"updatedAt") VALUES ('ctc_ps_ben',$1,'Ben Ortiz',now())`, [org]);
  await page.goto(`${BASE}/dashboard/contacts/ctc_ps_ben`);
  await form.getByRole("button", { name: "Meeting", exact: true }).click();
  await form.locator("textarea[name=body]").fill("Coffee meeting");
  await form.locator("[data-testid=activity-submit]").click();
  await until(async () => (await status("Contact", "ctc_ps_ben")) === "MEETING_SET", "Ben meeting set");

  log("the Pipeline starts at Meeting Set, with Ava and Ben as contact cards and Nic as Ava's rep");
  await page.goto(`${BASE}/dashboard/deals`);
  const headers = (await page.locator("[data-testid^=pipeline-column-] h2").allTextContents()).map((t) => t.trim());
  assert.deepEqual(headers, ["Meeting Set", "Meeting Completed", "Quote Sent", "Contract Sent", "Signed / Won", "Lost"]);
  const meetingCol = page.locator("[data-testid=pipeline-column-MEETING_SET]");
  const avaCard = meetingCol.locator("[data-testid=pipeline-contact]", { hasText: "Ava Stone" });
  await avaCard.waitFor();
  assert.equal(await avaCard.locator("[data-testid=pipeline-contact-rep]").textContent(), "Nic Rivera");
  await meetingCol.locator("[data-testid=pipeline-contact]", { hasText: "Ben Ortiz" }).waitFor();
  await shot(page, "01-pipeline-meetings");

  log("Meeting Completed from the card moves Ben to the second column, no dates needed");
  const benCard = meetingCol.locator("[data-testid=pipeline-contact]", { hasText: "Ben Ortiz" });
  await benCard.locator("[data-testid=status-picker]").click();
  await benCard.locator("[data-testid=status-option-MEETING_COMPLETED]").click();
  await page.locator("[data-testid=pipeline-column-MEETING_COMPLETED] [data-testid=pipeline-contact]", { hasText: "Ben Ortiz" }).waitFor();

  log("skipping Ava from Meeting Set to Quote Sent asks both dates, prefilled with the meeting day");
  await sql(`UPDATE "StatusChange" SET "on" = now() - interval '6 days' WHERE "contactId"=$1 AND "toStatus"='MEETING_SET'`, [ava]);
  await page.goto(`${BASE}/dashboard/contacts/${ava}`);
  await page.locator("[data-testid=status-picker]").click();
  await page.locator("[data-testid=status-option-QUOTE_SENT]").click();
  const dates = page.locator("[data-testid=status-dates]");
  await dates.waitFor();
  const meetingDay = isoDaysAgo(6);
  assert.equal(await dates.locator("[data-testid=status-date-MEETING_COMPLETED]").inputValue(), meetingDay);
  assert.equal(await dates.locator("[data-testid=status-date-QUOTE_SENT]").inputValue(), meetingDay);
  log("…out of order is refused, with the reason on screen");
  await dates.locator("[data-testid=status-date-MEETING_COMPLETED]").fill(isoDaysAgo(2));
  await dates.locator("[data-testid=status-date-QUOTE_SENT]").fill(isoDaysAgo(4));
  await dates.locator("[data-testid=status-save]").click();
  await dates.getByText("Quote Sent can't be before Meeting Completed").waitFor();
  await dates.locator("[data-testid=status-date-QUOTE_SENT]").fill(isoDaysAgo(1));
  await shot(page, "02-skip-dates");
  await dates.locator("[data-testid=status-save]").click();
  await until(async () => (await status("Contact", ava)) === "QUOTE_SENT", "Ava quote sent");
  const written = (await sql(`SELECT "toStatus", to_char("on", 'YYYY-MM-DD') AS day, auto FROM "StatusChange" WHERE "contactId"=$1 AND "toStatus" IN ('MEETING_COMPLETED','QUOTE_SENT') ORDER BY "on"`, [ava])).rows;
  assert.deepEqual(written.map((r) => r.toStatus), ["MEETING_COMPLETED", "QUOTE_SENT"]);
  assert.equal(await status("Company", aster), "QUOTE_SENT", "the company comes along with a move made by hand");
  assert.ok(written.every((r) => r.auto === false));
  await page.goto(`${BASE}/dashboard/deals`);
  assert.equal(await page.locator("[data-testid=pipeline-column-MEETING_SET] [data-testid=pipeline-contact]", { hasText: "Ava Stone" }).count(), 0, "Ava left the meeting column");

  log("a deal on its tile asks the day it moved, and its contact moves with it");
  await sql(`INSERT INTO "Contact" (id,"organizationId",name,status,"updatedAt") VALUES ('ctc_ps_cara',$1,'Cara Diaz','QUOTE_SENT',now())`, [org]);
  await sql(
    `INSERT INTO "Deal" (id,"organizationId","contactId",title,"valueCents",stage,"ownerId","updatedAt") VALUES ('deal_ps_cara',$1,'ctc_ps_cara','Cara roof',500000,'QUOTE_SENT',$2,now())`,
    [org, nicId],
  );
  await page.reload();
  const tile = page.locator("[data-testid=pipeline-column-QUOTE_SENT] [data-testid=pipeline-deal]", { hasText: "Cara roof" });
  await tile.locator("[data-testid=deal-stage]").selectOption("WON");
  await tile.locator("[data-testid=deal-stage-date]").waitFor();
  await tile.locator("[data-testid=deal-stage-date] input").fill(isoDaysAgo(1));
  await tile.getByRole("button", { name: "Save" }).click();
  await until(async () => (await sql(`SELECT stage FROM "Deal" WHERE id='deal_ps_cara'`)).rows[0].stage === "WON", "Cara won");
  assert.equal(await status("Contact", "ctc_ps_cara"), "WON");
  await page.reload();
  await page.locator("[data-testid=pipeline-column-WON] [data-testid=pipeline-deal]", { hasText: "Cara roof" }).waitFor();

  log("a contract unanswered for 90 days is Archived and off the board; at 180 it is Lost");
  await sql(
    `INSERT INTO "Contact" (id,"organizationId",name,status,"updatedAt") VALUES
       ('ctc_ps_dee',$1,'Dee Park','CONTRACT_SENT',now()), ('ctc_ps_eli',$1,'Eli Fox','CONTRACT_SENT',now())`,
    [org],
  );
  await sql(
    `INSERT INTO "Deal" (id,"organizationId","contactId",title,stage,"ownerId","stageChangedAt","updatedAt") VALUES
       ('deal_ps_dee',$1,'ctc_ps_dee','Dee install','CONTRACT_SENT',$2,now() - interval '100 days',now()),
       ('deal_ps_eli',$1,'ctc_ps_eli','Eli install','CONTRACT_SENT',$2,now() - interval '200 days',now())`,
    [org, taylor.id],
  );
  await page.goto(`${BASE}/dashboard/deals`);
  // Eli passes both marks in one sweep: Archived, then Lost.
  assert.equal((await sql(`SELECT stage FROM "Deal" WHERE id='deal_ps_dee'`)).rows[0].stage, "ARCHIVED");
  assert.equal((await sql(`SELECT stage FROM "Deal" WHERE id='deal_ps_eli'`)).rows[0].stage, "LOST");
  assert.equal(await status("Contact", "ctc_ps_eli"), "LOST");
  assert.equal(await status("Contact", "ctc_ps_dee"), "CONTRACT_SENT", "archiving the deal leaves the person as they were");
  assert.equal(await page.locator("[data-testid=pipeline-deal]", { hasText: "Dee install" }).count(), 0, "archived is off the board");
  await page.locator("[data-testid=pipeline-column-LOST] [data-testid=pipeline-deal]", { hasText: "Eli install" }).waitFor();
  await page.locator("[data-testid=toggle-archived]", { hasText: "Show archived (1)" }).click();
  await page.locator("[data-testid=pipeline-deal]", { hasText: "Dee install" }).waitFor();
  await shot(page, "03-pipeline-deals");

  log("Stats: tiles, funnel and close rate count the people and money above");
  await page.goto(`${BASE}/dashboard/stats`);
  await page.locator("[data-testid=stats-page]").waitFor();
  const tiles = page.locator("[data-testid=stats-tile]");
  const tile2 = async (label) => (await tiles.filter({ hasText: label }).locator("[data-testid=stats-tile-value]").textContent()).trim();
  assert.equal(await tile2("Meetings set"), "2", "Ava and Ben");
  assert.equal(await tile2("Meetings held"), "2", "Ben by hand, Ava by the skipped step");
  assert.equal(await tile2("Signed / Won"), "$5,000.00");
  // Won: Cara. Lost: Eli. Close rate 50%.
  assert.match(await page.locator("[data-testid=stats-close-rate]").textContent(), /50%/);
  const funnelCounts = await page.locator("[data-testid=funnel-count]").allTextContents();
  assert.equal(funnelCounts.length, 7);
  await shot(page, "04-stats");

  log("the leaderboard credits Nic with Ava's meeting and Cara's win");
  const nicRow = page.locator("[data-testid=stats-rep-row]", { hasText: "Nic Rivera" });
  const cells = (await nicRow.locator("td").allTextContents()).map((t) => t.trim());
  // Rep, 4 activity kinds, Contacted, Mtg set, Mtg held, Quotes, Contracts, Won, Won $, Close rate
  assert.equal(cells[6], "1", "Nic set one meeting");
  assert.equal(cells[11], "$5,000.00", "Cara's deal is Nic's");

  log("the rep filter narrows every number to Nic");
  await page.locator("[data-testid=stats-rep]", { hasText: "Nic Rivera" }).click();
  await page.waitForURL(/reps=usr_pipestats_nic/);
  assert.equal(await page.locator("[data-testid=stats-rep-row]").count(), 1);
  assert.equal(await tile2("Meetings set"), "1");
  log("periods switch the window");
  await page.getByRole("link", { name: "7 days" }).click();
  await page.waitForURL(/period=7d/);
  await page.locator("[data-testid=stats-page]").waitFor();

  log("the Stats page at phone width does not scroll sideways");
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mobile = await phone.newPage();
  await login(mobile, EMAIL);
  await mobile.goto(`${BASE}/dashboard/stats`);
  await mobile.locator("[data-testid=stats-page]").waitFor();
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 1, `page scrolls sideways by ${overflow}px`);
  await shot(mobile, "05-stats-phone");

  await browser.close();
  console.log(`\nAll ${step} steps passed. Screenshots in ${OUT}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
