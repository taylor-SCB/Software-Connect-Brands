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
 * leaderboard, rep filter and periods. Three "audit fixes (UX review)"
 * steps (Nov 10, 2026): a tile whose period before had none reads "▲ up
 * from 0" (never "▲ 100% vs before"); at 1440 nothing on Stats is cut off
 * or wrapped — every Time between steps name in full, the last day under
 * Touches per day inside the chart, each leaderboard name on one line
 * with the table not scrolling sideways; and on a phone (isMobile, 390)
 * the Touches per day and Activity by rep charts are drawn at the phone's
 * width, so every label measures 11px (the fixed 640-wide drawing put
 * them at about 5px) and sits inside its chart, day labels apart, the
 * same measured again at 1440.
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
// A day as the workspace sees it, in its time zone (America/Chicago unless
// changed): a UTC date runs a day ahead every evening after 7 pm Central,
// and the suite failed between then and midnight (Oct 24, 2026).
function isoDaysAgo(n) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(Date.now() - n * 86_400_000),
  );
}


// The log is the How did it go? sheet behind the "What happened with …?"
// bar, with When behind "Just now ▾" (BDR redesign, Nov 11, 2026): open
// it unless it is open, and show When.
async function openLog(p) {
  const sheet = p.locator("[data-testid=log-activity-form]");
  if (!(await sheet.isVisible().catch(() => false))) await p.locator("[data-testid=log-bar]").click();
  await sheet.waitFor();
  if (await sheet.locator("[data-testid=activity-when-toggle]").isVisible().catch(() => false)) {
    await sheet.locator("[data-testid=activity-when-toggle]").click();
  }
  return sheet;
}
// New quote, Additional Account, the status picker and Delete sit under
// ⋯ More on the contact page (BDR redesign, Release 4).
async function openMore(p) {
  const more = p.locator("[data-testid=record-more]");
  if ((await more.count()) && !(await p.locator("[data-testid=record-more-menu]").count())) await more.click();
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
  assert.deepEqual(options, ["Not Actioned", "Attempted", "Connected", "Not Interested", "Interested"]);
  await page.fill("#companyName", "Aster Homes");
  await page.fill("#name", "Ava Stone");
  await page.getByRole("button", { name: "Save contact" }).click();
  await page.waitForURL(/\/dashboard\/contacts\/(?!new$)[a-z0-9]+$/);
  const ava = page.url().split("/").pop();
  const aster = (await sql(`SELECT "companyId" FROM "Contact" WHERE id=$1`, [ava])).rows[0].companyId;
  assert.equal(await status("Contact", ava), "NOT_ACTIONED");
  await openMore(page);
  await page.locator("[data-testid=status-picker]").getByText("Not Actioned").waitFor();
  await page.keyboard.press("Escape");
  log("the edit form no longer carries a Status box — it's the button on the page");
  await page.goto(`${BASE}/dashboard/contacts/${ava}/edit`);
  assert.equal(await page.locator("select[name=status]").count(), 0);

  log("the first logged touch makes Ava — and Aster Homes — Contacted");
  await page.goto(`${BASE}/dashboard/contacts/${ava}`);
  const form = await openLog(page);
  await form.locator("textarea[name=body]").fill("Intro call");
  await form.locator("[data-testid=activity-submit]").click();
  await until(async () => (await status("Contact", ava)) === "CONTACTED", "Ava contacted");
  assert.equal(await status("Company", aster), "CONTACTED");
  const contactedRow = (await sql(`SELECT auto, "userId", "fromStatus" FROM "StatusChange" WHERE "contactId"=$1 AND "toStatus"='CONTACTED'`, [ava])).rows[0];
  assert.deepEqual(contactedRow, { auto: true, userId: taylor.id, fromStatus: "NOT_ACTIONED" });

  log("Interested, set by hand, lands on Interested Contacts and Interested Companies");
  await page.reload();
  await openMore(page);
  await page.locator("[data-testid=status-picker]").click();
  await page.locator("[data-testid=status-option-INTERESTED]").click();
  await until(async () => (await status("Contact", ava)) === "INTERESTED", "Ava interested");
  log("Sprint: Interested from Attempted passes through Connected the same day, for Ava and Aster Homes");
  const avaSteps = (await sql(`SELECT "fromStatus", "toStatus", auto, to_char("on", 'YYYY-MM-DD') AS day FROM "StatusChange" WHERE "contactId"=$1 ORDER BY "createdAt", "toStatus" = 'INTERESTED'`, [ava])).rows;
  assert.deepEqual(avaSteps.map((r) => `${r.fromStatus}>${r.toStatus}`), ["NOT_ACTIONED>CONTACTED", "CONTACTED>CONNECTED", "CONNECTED>INTERESTED"]);
  assert.equal(avaSteps[1].day, avaSteps[2].day, "Connected is dated the day Interested was");
  assert.deepEqual([avaSteps[1].auto, avaSteps[2].auto], [true, false], "the pass-through is the app's step; Interested is the person's");
  const asterSteps = (await sql(`SELECT "toStatus" FROM "StatusChange" WHERE "companyId"=$1 ORDER BY "createdAt", "toStatus" = 'INTERESTED'`, [aster])).rows.map((r) => r.toStatus);
  assert.deepEqual(asterSteps, ["CONTACTED", "CONNECTED", "INTERESTED"]);
  await page.goto(`${BASE}/dashboard/contacts/interested`);
  await page.locator("[data-testid=contact-row]", { hasText: "Ava Stone" }).waitFor();
  await page.goto(`${BASE}/dashboard/companies/${aster}`);
  // Set status by hand sits under the header's ⋯ More (Nov 11, 2026).
  await page.locator("[data-testid=company-more]").click();
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
  const nicForm = await openLog(nic);
  await nicForm.getByRole("button", { name: "Meeting", exact: true }).click();
  await nicForm.locator("textarea[name=body]").fill("Walkthrough at their office");
  const nextWeek = isoDaysAgo(-7);
  await nicForm.locator("[data-testid=activity-when]").fill(nextWeek);
  await nicForm.locator("[data-testid=activity-submit]").click();
  await nic.getByText(/Scheduled for/).waitFor();
  assert.equal(await status("Contact", ava), "MEETING_SET");
  assert.equal(await status("Company", aster), "MEETING_SET");
  const setRow = (await sql(`SELECT "userId" FROM "StatusChange" WHERE "contactId"=$1 AND "toStatus"='MEETING_SET'`, [ava])).rows;
  assert.deepEqual(setRow, [{ userId: nicId }]);
  assert.equal((await sql(`SELECT count(*)::int n FROM "Deal" WHERE "organizationId"=$1`, [org])).rows[0].n, 0, "a meeting is not a deal");

  log("a second meeting changes nothing");
  await nicForm.waitFor({ state: "detached" });
  await openLog(nic);
  await nicForm.getByRole("button", { name: "Meeting", exact: true }).click();
  await nicForm.locator("textarea[name=body]").fill("Follow-up walkthrough");
  await nicForm.locator("[data-testid=activity-when]").fill(nextWeek);
  await nicForm.locator("[data-testid=activity-submit]").click();
  await nic.getByText(/Scheduled for/).waitFor();
  assert.equal((await sql(`SELECT count(*)::int n FROM "StatusChange" WHERE "contactId"=$1 AND "toStatus"='MEETING_SET'`, [ava])).rows[0].n, 1);

  log("a meeting logged as held also sets it, and completes it (Ben, decision 4): Meeting Set then Meeting Completed, and his Opportunity Created line");
  await sql(`INSERT INTO "Contact" (id,"organizationId",name,"updatedAt") VALUES ('ctc_ps_ben',$1,'Ben Ortiz',now())`, [org]);
  await page.goto(`${BASE}/dashboard/contacts/ctc_ps_ben`);
  await openLog(page);
  await form.getByRole("button", { name: "Meeting", exact: true }).click();
  await form.locator("textarea[name=body]").fill("Coffee meeting");
  await form.locator("[data-testid=activity-submit]").click();
  await until(async () => (await status("Contact", "ctc_ps_ben")) === "MEETING_COMPLETED", "Ben meeting completed");
  const benMoves = (await sql(`SELECT "fromStatus", "toStatus", auto FROM "StatusChange" WHERE "contactId"='ctc_ps_ben' AND "toStatus" IN ('MEETING_SET','MEETING_COMPLETED')`)).rows;
  const benSet = benMoves.filter((row) => row.toStatus === "MEETING_SET");
  const benDone = benMoves.filter((row) => row.toStatus === "MEETING_COMPLETED");
  assert.equal(benSet.length, 1, `one Meeting Set row: ${JSON.stringify(benMoves)}`);
  assert.deepEqual(benDone.map((row) => ({ ...row })), [{ fromStatus: "MEETING_SET", toStatus: "MEETING_COMPLETED", auto: true }], "Meeting Completed follows from Meeting Set, set by the app");
  assert.equal((await sql(`SELECT outcome FROM "Activity" WHERE "contactId"='ctc_ps_ben' AND type='MEETING'`)).rows.map((row) => row.outcome).join(), "HELD");
  const benOpp = (await sql(`SELECT o.id, o.stage FROM "Opportunity" o JOIN "OpportunityContact" oc ON oc."opportunityId"=o.id WHERE oc."contactId"='ctc_ps_ben'`)).rows;
  assert.deepEqual(benOpp.map((row) => row.stage), ["MEETING_COMPLETED"], "his tile is completed with him");
  assert.deepEqual(
    (await sql(`SELECT kind FROM "OpportunityLog" WHERE "contactId"='ctc_ps_ben' AND "opportunityId"=$1`, [benOpp[0].id])).rows.map((row) => row.kind),
    ["OPPORTUNITY_CREATED"],
  );

  log("the Pipeline starts at Meeting Set, with Ava and Bea as opportunity tiles there (Nic as Ava's rep) and Ben's held one at Meeting Completed");
  // Bea's meeting is booked ahead (a day ahead on the log schedules it:
  // Meeting Set, nothing held), then its day goes by with nobody saying
  // how it went.
  await sql(`INSERT INTO "Contact" (id,"organizationId",name,"updatedAt") VALUES ('ctc_ps_bea',$1,'Bea Lane',now())`, [org]);
  await page.goto(`${BASE}/dashboard/contacts/ctc_ps_bea`);
  await openLog(page);
  await form.getByRole("button", { name: "Meeting", exact: true }).click();
  await form.locator("textarea[name=body]").fill("Site visit");
  await form.locator("[data-testid=activity-when]").fill(isoDaysAgo(-1));
  await form.locator("[data-testid=activity-submit]").click();
  await page.getByText(/Scheduled for/).waitFor();
  assert.equal(await status("Contact", "ctc_ps_bea"), "MEETING_SET");
  assert.deepEqual(
    (await sql(`SELECT "toStatus" FROM "StatusChange" WHERE "contactId"='ctc_ps_bea' AND "toStatus" IN ('MEETING_SET','MEETING_COMPLETED')`)).rows.map((row) => row.toStatus),
    ["MEETING_SET"],
    "a booking sets it and completes nothing",
  );
  const beaMeeting = (await sql(
    `SELECT m.id, m."eventId" FROM "OpportunityMeeting" m JOIN "OpportunityContact" oc ON oc."opportunityId"=m."opportunityId" WHERE oc."contactId"='ctc_ps_bea'`,
  )).rows;
  assert.equal(beaMeeting.length, 1);
  await sql(`UPDATE "OpportunityMeeting" SET "on" = "on" - interval '3 days' WHERE id=$1`, [beaMeeting[0].id]);
  await sql(`UPDATE "CalendarEvent" SET "startOn" = "startOn" - 3 WHERE id=$1`, [beaMeeting[0].eventId]);
  await page.goto(`${BASE}/dashboard/deals`);
  const headers = (await page.locator("[data-testid^=pipeline-column-] h2").allTextContents()).map((t) => t.trim());
  assert.deepEqual(headers, ["Meeting Set", "Meeting Completed", "Quote Sent", "Contract Sent", "Signed / Won", "Lost"]);
  const meetingCol = page.locator("[data-testid=pipeline-column-MEETING_SET]");
  const avaCard = meetingCol.locator("[data-testid=pipeline-tile]", { hasText: "Ava Stone" });
  await avaCard.waitFor();
  // The rep shows as initials since the BDR redesign (edited in the panel).
  assert.equal(await avaCard.locator("[data-testid=tile-rep]").getAttribute("title"), "Rep: Nic Rivera");
  assert.equal(await avaCard.locator("[data-testid=tile-rep]").textContent(), "NR");
  await meetingCol.locator("[data-testid=pipeline-tile]", { hasText: "Bea Lane" }).waitFor();
  await page.locator("[data-testid=pipeline-column-MEETING_COMPLETED] [data-testid=pipeline-tile]", { hasText: "Ben Ortiz" }).waitFor();
  assert.equal(await meetingCol.locator("[data-testid=pipeline-tile]", { hasText: "Ben Ortiz" }).count(), 0, "Ben's held meeting completed his tile");
  await shot(page, "01-pipeline-meetings");

  log("Meeting Completed from the tile's Move to… moves Bea to the second column, no prompt, and her meeting is marked Held");
  const beaCard = meetingCol.locator("[data-testid=pipeline-tile]", { hasText: "Bea Lane" });
  await beaCard.locator("[data-testid=tile-more]").click();
  await page.locator("[data-testid=tile-move-menu] [data-testid=tile-move-MEETING_COMPLETED]").click();
  await page.locator("[data-testid=pipeline-column-MEETING_COMPLETED] [data-testid=pipeline-tile]", { hasText: "Bea Lane" }).waitFor();
  assert.equal(await page.getByTestId("early-dialog").count(), 0, "her meeting has gone by: nothing asks if it happened early");
  assert.equal(await page.locator("[data-testid=convert-dialog]").count(), 0);
  await until(async () => (await status("Contact", "ctc_ps_bea")) === "MEETING_COMPLETED", "Bea meeting completed");
  assert.equal((await sql(`SELECT outcome FROM "OpportunityMeeting" WHERE id=$1`, [beaMeeting[0].id])).rows[0].outcome, "HELD");

  log("skipping Ava from Meeting Set to Quote Sent asks both dates, prefilled with the meeting day");
  await sql(`UPDATE "StatusChange" SET "on" = now() - interval '6 days' WHERE "contactId"=$1 AND "toStatus"='MEETING_SET'`, [ava]);
  await page.goto(`${BASE}/dashboard/contacts/${ava}`);
  await openMore(page);
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
  log("audit fixes: the dates panel stays open through a window resize, and a scroll while typing in it");
  // A phone's keyboard opening for a date box is a resize; the browser
  // then scrolls the box into view. Either closed the panel and the dates.
  await dates.locator("[data-testid=status-date-QUOTE_SENT]").focus();
  await page.setViewportSize({ width: 1440, height: 60 });
  await page.waitForTimeout(300);
  assert.equal(await dates.count(), 1, "a resize that hides the status button doesn't close it");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => window.scrollBy(0, 600));
  await page.waitForTimeout(300);
  assert.equal(await dates.count(), 1, "nor does a scroll while typing in it");
  await page.evaluate(() => window.scrollTo(0, 0));
  await dates.locator("[data-testid=status-date-QUOTE_SENT]").fill(isoDaysAgo(1));
  await shot(page, "02-skip-dates");
  await dates.locator("[data-testid=status-save]").click();
  await until(async () => (await status("Contact", ava)) === "QUOTE_SENT", "Ava quote sent");
  const written = (await sql(`SELECT "toStatus", to_char("on", 'YYYY-MM-DD') AS day, auto FROM "StatusChange" WHERE "contactId"=$1 AND "toStatus" IN ('MEETING_COMPLETED','QUOTE_SENT') ORDER BY "on"`, [ava])).rows;
  assert.deepEqual(written.map((r) => r.toStatus), ["MEETING_COMPLETED", "QUOTE_SENT"]);
  assert.equal(await status("Company", aster), "QUOTE_SENT", "the company comes along with a move made by hand");
  assert.ok(written.every((r) => r.auto === false));
  await page.goto(`${BASE}/dashboard/deals`);
  // Oct 27, 2026: she no longer vanishes. Only a deal sits in Quote Sent,
  // so her tile stays at Meeting Completed until it is converted.
  await page.locator("[data-testid=pipeline-column-MEETING_COMPLETED] [data-testid=pipeline-tile]", { hasText: "Ava Stone" }).waitFor();
  assert.equal(await page.locator("[data-testid=pipeline-column-QUOTE_SENT] [data-testid=pipeline-tile]", { hasText: "Ava Stone" }).count(), 0);
  assert.equal(await page.locator("[data-testid=pipeline-column-MEETING_SET] [data-testid=pipeline-tile]", { hasText: "Ava Stone" }).count(), 0, "Ava left the meeting column");

  log("a deal moved from its tile's menu needs no date, and its contact moves with it");
  await sql(`INSERT INTO "Contact" (id,"organizationId",name,status,"updatedAt") VALUES ('ctc_ps_cara',$1,'Cara Diaz','QUOTE_SENT',now())`, [org]);
  await sql(
    `INSERT INTO "Deal" (id,"organizationId","contactId",title,"valueCents",stage,"ownerId","updatedAt") VALUES ('deal_ps_cara',$1,'ctc_ps_cara','Cara roof',500000,'QUOTE_SENT',$2,now())`,
    [org, nicId],
  );
  await page.reload();
  const tile = page.locator("[data-testid=pipeline-column-QUOTE_SENT] [data-testid=pipeline-tile]", { hasText: "Cara roof" });
  await tile.locator("[data-testid=tile-more]").click();
  await page.locator("[data-testid=tile-move-menu] [data-testid=tile-move-WON]").click();
  await until(async () => (await sql(`SELECT stage FROM "Deal" WHERE id='deal_ps_cara'`)).rows[0].stage === "WON", "Cara won");
  assert.equal(await status("Contact", "ctc_ps_cara"), "WON");
  await page.reload();
  await page.locator("[data-testid=pipeline-column-WON] [data-testid=pipeline-tile]", { hasText: "Cara roof" }).waitFor();

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
  assert.equal(await page.locator("[data-testid=pipeline-tile]", { hasText: "Dee install" }).count(), 0, "archived is off the board");
  await page.locator("[data-testid=pipeline-column-LOST] [data-testid=pipeline-tile]", { hasText: "Eli install" }).waitFor();
  // Show archived sits under the header's ⋯ since the BDR redesign.
  await page.locator("[data-testid=pipeline-more]").click();
  await page.locator("[data-testid=toggle-archived]", { hasText: "Show archived (1)" }).click();
  await page.locator("[data-testid=pipeline-tile]", { hasText: "Dee install" }).waitFor();
  await shot(page, "03-pipeline-deals");

  log("Stats: tiles, funnel and close rate count the people and money above");
  await page.goto(`${BASE}/dashboard/stats`);
  await page.locator("[data-testid=stats-page]").waitFor();
  const tiles = page.locator("[data-testid=stats-tile]");
  const tile2 = async (id) => (await page.locator(`[data-testid=stats-tile][data-id=${id}] [data-testid=stats-tile-value]`).textContent()).trim();
  // Sprint (Nov 11, 2026): Tries · Talks · Connect rate · Meetings booked · Show rate · Won $.
  assert.deepEqual(
    (await tiles.locator("p:first-child").allTextContents()).map((t) => t.trim().toLowerCase()),
    ["tries", "talks", "connect rate", "meetings booked", "show rate", "won $"],
  );
  const booked = Number((await sql(
    `SELECT COUNT(*)::int AS n FROM "OpportunityMeeting" om JOIN "Opportunity" o ON o.id=om."opportunityId" WHERE o."organizationId"=$1`,
    [org],
  )).rows[0].n);
  assert.equal(await tile2("booked"), String(booked), "every meeting booked in the period");
  assert.ok(booked >= 3, "Ava's, Ben's and Bea's");
  assert.equal(await tile2("won"), "$5,000.00");
  // Won: Cara. Lost: Eli. Close rate 50%.
  assert.match(await page.locator("[data-testid=stats-close-rate]").textContent(), /50%/);
  const funnelSteps = await page.locator("[data-testid=funnel-step]").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-step")));
  assert.deepEqual(funnelSteps, ["CONTACTED", "CONNECTED", "MEETING_SET", "MEETING_COMPLETED", "QUOTE_SENT", "CONTRACT_SENT", "WON"], "Attempted → Connected → … → Won");
  const funnelCounts = await page.locator("[data-testid=funnel-count]").allTextContents();
  // A step counts everyone who reached it or a later one (audit, Nov 11,
  // 2026): Cara, won in the period, reached Meeting Set on her way to Won.
  assert.equal(funnelCounts[2], "4", "Ava, Ben and Bea reached Meeting Set, and Cara on her way to Won");
  assert.equal(funnelCounts[3], "4", "Ben by his held meeting, Bea by hand, Ava by the skipped step, Cara on her way to Won");
  assert.equal(funnelCounts[6], "1", "Cara is the one Won");
  await shot(page, "04-stats");

  log("the leaderboard credits Nic with the meeting he booked and Cara's win");
  const nicRow = page.locator("[data-testid=stats-rep-row]", { hasText: "Nic Rivera" });
  const cells = (await nicRow.locator("td").allTextContents()).map((t) => t.trim());
  // Rep, Tries, Talks, Connect rate, Meetings booked, Held, Won $
  assert.deepEqual(
    await page.locator("[data-testid=stats-leaderboard] th").allTextContents(),
    ["Rep", "Tries", "Talks", "Connect rate", "Meetings booked", "Held", "Won $"],
  );
  const nicBooked = (await sql(
    `SELECT COUNT(*)::int AS n FROM "OpportunityMeeting" om JOIN "Opportunity" o ON o.id=om."opportunityId" WHERE o."organizationId"=$1 AND om."bookedById"=$2`,
    [org, nicId],
  )).rows[0].n;
  assert.equal(nicBooked, 2, "the meeting in step 8 and the second one in step 9, both booked by Nic");
  assert.equal(cells[4], String(nicBooked), "both credited to Nic, who booked them");
  assert.equal(cells[6], "$5,000.00", "Cara's deal is Nic's");

  log("Sprint: a tile whose period before had none reads 'new this period', never '▲ 100% vs before' (plan R0)");
  const change = async (id) => (await page.locator(`[data-testid=stats-tile][data-id=${id}] [data-testid=stats-tile-change]`).textContent()).trim();
  assert.equal(await change("booked"), "new this period", "booked against none in the 30 days before");
  assert.equal(await change("won"), "new this period");
  for (const text of await tiles.locator("[data-testid=stats-tile-change]").allTextContents()) assert.doesNotMatch(text, /100%/, text);

  log("audit fixes (UX review): at 1440 no Stats label is cut off — each step name, the last day under Touches per day, every rep's name on one line");
  const today = new Date(`${isoDaysAgo(0)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const layout = await page.evaluate(() => {
    const steps = [...document.querySelectorAll("[data-testid=stats-velocity] > div > span:first-child")]
      .filter((el) => el.textContent.includes("→"))
      .map((el) => ({ text: el.textContent, cut: el.scrollWidth > el.clientWidth + 0.5 }));
    const svg = document.querySelector("svg[aria-label='Team activity per day']");
    const box = svg.getBoundingClientRect();
    const days = [...svg.querySelectorAll("text")].filter((t) => /^[A-Z][a-z]{2} \d{1,2}$/.test(t.textContent));
    const last = days.at(-1);
    const names = [...document.querySelectorAll("[data-testid=stats-rep-row] td:first-child")].map((td) => {
      const range = document.createRange();
      range.selectNodeContents(td);
      return { name: td.textContent.trim(), lines: new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size };
    });
    const wrap = document.querySelector("[data-testid=stats-leaderboard]").parentElement;
    return {
      steps,
      last: last.textContent,
      lastRight: last.getBoundingClientRect().right,
      svgRight: box.right,
      names,
      sideways: wrap.scrollWidth - wrap.clientWidth,
    };
  });
  assert.equal(layout.steps.length, 6, JSON.stringify(layout.steps));
  for (const s of layout.steps) assert.ok(!s.cut, `"${s.text}" is cut off`);
  assert.equal(layout.last, today, "the last label is today");
  assert.ok(layout.lastRight <= layout.svgRight + 0.5, `"${layout.last}" runs ${Math.round(layout.lastRight - layout.svgRight)}px past the chart`);
  assert.ok(layout.names.length >= 2);
  for (const n of layout.names) assert.equal(n.lines, 1, `${n.name} wraps onto ${n.lines} lines`);
  assert.ok(layout.sideways <= 0, `the leaderboard scrolls sideways by ${layout.sideways}px at 1440`);

  log("the rep filter narrows every number to Nic");
  await page.locator("[data-testid=stats-rep]", { hasText: "Nic Rivera" }).click();
  await page.waitForURL(/reps=usr_pipestats_nic/);
  assert.equal(await page.locator("[data-testid=stats-rep-row]").count(), 1);
  assert.equal(await tile2("booked"), String(nicBooked), "only Nic's bookings");
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

  log("audit fixes (UX review): on a phone the Stats charts' labels are 11px, not shrunk to about 5px — Touches per day and Activity by rep are drawn at the phone's width");
  const truck = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const thumb = await truck.newPage();
  await login(thumb, EMAIL);
  const statsCharts = async (p) => {
    await p.goto(`${BASE}/dashboard/stats`);
    await p.locator("[data-testid=stats-page]").waitFor();
    const out = {};
    for (const label of ["Team activity per day", "Activity by rep"]) {
      const selector = `svg[aria-label='${label}']`;
      await p.locator(selector).waitFor();
      // Drawn at the box's own width once the browser has measured it.
      await p
        .waitForFunction((sel) => {
          const svg = document.querySelector(sel);
          return svg && Math.abs(svg.viewBox.baseVal.width - svg.getBoundingClientRect().width) < 1;
        }, selector, { timeout: 5000 })
        .catch(() => {});
      out[label] = await p.locator(selector).evaluate((svg) => {
        const box = svg.getBoundingClientRect();
        const scale = box.width / svg.viewBox.baseVal.width;
        const texts = [...svg.querySelectorAll("text")];
        const rects = texts.map((t) => t.getBoundingClientRect());
        const days = texts.filter((t) => /^[A-Z][a-z]{2} \d{1,2}$/.test(t.textContent)).map((t) => t.getBoundingClientRect());
        return {
          inner: window.innerWidth,
          sizes: texts.map((t) => Math.round(parseFloat(getComputedStyle(t).fontSize) * scale * 10) / 10),
          inside: rects.every((r) => r.left >= box.left - 0.5 && r.right <= box.right + 0.5),
          apart: days.every((r, i) => i === 0 || r.left >= days[i - 1].right + 2),
          days: days.length,
          spans: `${Math.round(box.left)}..${Math.round(box.right)}: ${texts.map((t, i) => `${t.textContent} ${Math.round(rects[i].left)}-${Math.round(rects[i].right)}`).join(" | ")}`,
        };
      });
    }
    return out;
  };
  const truckCharts = await statsCharts(thumb);
  const deskCharts = await statsCharts(page);
  assert.equal(truckCharts["Activity by rep"].inner, 390, "Stats lays out at the phone's own width");
  for (const [where, charts] of [["phone", truckCharts], ["1440", deskCharts]]) {
    for (const [label, c] of Object.entries(charts)) {
      assert.ok(c.sizes.length && c.sizes.every((px) => px >= 10.5 && px <= 11.5), `${where} ${label}: labels drawn at ${c.sizes.join(", ")}px`);
      assert.ok(c.inside, `${where} ${label}: a label runs out of the chart (${c.spans})`);
      assert.ok(c.apart, `${where} ${label}: day labels overlap (${c.spans})`);
    }
    assert.ok(charts["Team activity per day"].days >= 2, `${where}: Touches per day labels its days`);
  }
  await shot(thumb, "06-stats-phone-charts");
  await truck.close();

  log("Sprint: the persona chips are gone, and the per-day numbers are behind Show numbers");
  await page.goto(`${BASE}/dashboard/stats`);
  await page.locator("[data-testid=stats-page]").waitFor();
  const chips = await page.locator(".stats-panel span").evaluateAll((spans) => spans.map((el) => el.textContent.trim()).filter((t) => /^(VP|BDR|CRO|AE)$/.test(t)));
  assert.deepEqual(chips, []);
  const dayNumbers = page.locator("[data-testid=stats-daily-numbers]");
  assert.equal(await dayNumbers.locator("[data-testid=stats-daily-table]").isVisible(), false);
  await dayNumbers.locator("summary").click();
  await dayNumbers.locator("[data-testid=stats-daily-table]").waitFor();

  log("Sprint: tries and talks count each save once — a call logged on three people is one try and one talk");
  const repCells = async (name) => (await page.locator("[data-testid=stats-rep-row]", { hasText: name }).locator("td").allTextContents()).map((t) => t.trim());
  const nicBefore = await repCells("Nic Rivera");
  const people = (await sql(`SELECT id FROM "Contact" WHERE "organizationId"=$1 ORDER BY "createdAt" LIMIT 3`, [org])).rows.map((r) => r.id);
  assert.equal(people.length, 3);
  await sql(
    `INSERT INTO "Activity" (id,"organizationId","contactId","userId",type,body,outcome,marketing,"batchId","occurredAt")
     SELECT 'a_ps_sprint_' || i, $1, ($3::text[])[i], $2, 'PHONE_CALL', 'Group call', 'TALKED', false, 'b_ps_sprint', now() - interval '1 hour'
       FROM generate_series(1, 3) AS i`,
    [org, nicId, people],
  );
  await sql(
    `INSERT INTO "Activity" (id,"organizationId","contactId","userId",type,body,outcome,marketing,"occurredAt") VALUES
       ('a_ps_sprint_vm',$1,$3,$2,'PHONE_CALL','Voicemail','VOICEMAIL',false,now() - interval '1 hour'),
       ('a_ps_sprint_ns',$1,$3,$2,'MEETING','No-show','NO_SHOW',false,now() - interval '1 hour')`,
    [org, nicId, people[0]],
  );
  await page.reload();
  await page.locator("[data-testid=stats-page]").waitFor();
  const nicAfter = await repCells("Nic Rivera");
  assert.equal(Number(nicAfter[1]), Number(nicBefore[1]) + 2, "tries: the group call once and the voicemail; never the no-show");
  assert.equal(Number(nicAfter[2]), Number(nicBefore[2]) + 1, "talks: the group call once");
  assert.equal(nicAfter[3], `${Math.round((Number(nicAfter[2]) / Number(nicAfter[1])) * 100)}%`, "connect rate is talks ÷ tries");

  log("Sprint: show rate is held ÷ booked meetings that came due, and a no-show counts against the rep who booked it");
  const showText = async () => (await page.locator("[data-testid=stats-tile][data-id=show-rate]").textContent()).replace(/\s+/g, " ");
  const before = (await showText()).match(/(\d+) held of (\d+) that came due/);
  assert.ok(before, await showText());
  const nicMeeting = (await sql(
    `SELECT om."opportunityId" FROM "OpportunityMeeting" om JOIN "Opportunity" o ON o.id=om."opportunityId" WHERE o."organizationId"=$1 AND om."bookedById"=$2 LIMIT 1`,
    [org, nicId],
  )).rows[0];
  assert.ok(nicMeeting, "Nic's booking is credited to him");
  await sql(
    `INSERT INTO "OpportunityMeeting" (id,"opportunityId","on","bookedById",outcome,"createdAt") VALUES ('om_ps_sprint',$1,now() - interval '2 hours',$2,'NO_SHOW',now() - interval '1 day')`,
    [nicMeeting.opportunityId, nicId],
  );
  await page.reload();
  await page.locator("[data-testid=stats-page]").waitFor();
  const after = (await showText()).match(/(\d+) held of (\d+) that came due/);
  assert.equal(Number(after[1]), Number(before[1]), "a no-show isn't held");
  assert.equal(Number(after[2]), Number(before[2]) + 1, "but it came due");
  const showRate = Number(after[2]) ? `${Math.round((Number(after[1]) / Number(after[2])) * 100)}%` : "—";
  assert.equal(await tile2("show-rate"), showRate);
  const nicNow = await repCells("Nic Rivera");
  assert.equal(nicNow[4], String(Number(nicAfter[4]) + 1), "the booking is Nic's");

  log("Sprint: Columns adds Show rate and Calls to the leaderboard, remembered after a reload, and puts the usual ones back");
  await page.getByTestId("stats-columns").click();
  await page.getByTestId("stats-column-showRate").check();
  await page.getByTestId("stats-column-calls").check();
  await until(
    async () => {
      const prefs = (await sql(`SELECT "uiPrefs" FROM "User" WHERE email=$1`, [EMAIL])).rows[0].uiPrefs;
      const cols = prefs && prefs.stats && prefs.stats.columns;
      return Array.isArray(cols) && cols.includes("showRate") && cols.includes("calls");
    },
    "the columns to be saved",
  );
  await page.keyboard.press("Escape");
  await page.reload();
  await page.locator("[data-testid=stats-page]").waitFor();
  assert.deepEqual(
    await page.locator("[data-testid=stats-leaderboard] th").allTextContents(),
    ["Rep", "Tries", "Talks", "Connect rate", "Meetings booked", "Held", "Won $", "Show rate", "Calls"],
  );
  await page.getByTestId("stats-columns").click();
  await page.getByTestId("stats-columns-reset").click();
  await until(
    async () => (((await sql(`SELECT "uiPrefs" FROM "User" WHERE email=$1`, [EMAIL])).rows[0].uiPrefs.stats || {}).columns || []).length === 6,
    "the usual columns to be saved",
  );
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("[data-testid=stats-leaderboard] th").count(), 7);

  log("Sprint (integration): the columns live in uiPrefs stats.columns beside other screens' choices, and a choice saved at the top level by the earlier build still opens");
  const savedPrefs = (await sql(`SELECT "uiPrefs" FROM "User" WHERE email=$1`, [EMAIL])).rows[0].uiPrefs;
  assert.equal(savedPrefs.statsColumns, undefined, "nothing written at the top level");
  await sql(`UPDATE "User" SET "uiPrefs" = jsonb_build_object('statsColumns', jsonb_build_array('tries', 'calls'), 'calendar', jsonb_build_object('scope', 'team')) WHERE email=$1`, [EMAIL]);
  await page.reload();
  await page.locator("[data-testid=stats-page]").waitFor();
  assert.deepEqual(await page.locator("[data-testid=stats-leaderboard] th").allTextContents(), ["Rep", "Tries", "Calls"], "the old top-level choice is read");
  await page.getByTestId("stats-columns").click();
  await page.getByTestId("stats-column-talks").check();
  await until(
    async () => {
      const prefs = (await sql(`SELECT "uiPrefs" FROM "User" WHERE email=$1`, [EMAIL])).rows[0].uiPrefs;
      return JSON.stringify(prefs.stats && prefs.stats.columns) === JSON.stringify(["tries", "talks", "calls"]) && prefs.calendar && prefs.calendar.scope === "team";
    },
    "the namespaced save, with the calendar's choice kept",
  );
  await page.keyboard.press("Escape");
  await sql(`UPDATE "User" SET "uiPrefs" = jsonb_build_object('statsColumns', jsonb_build_array('won')) || "uiPrefs" WHERE email=$1`, [EMAIL]);
  await page.reload();
  await page.locator("[data-testid=stats-page]").waitFor();
  assert.deepEqual(await page.locator("[data-testid=stats-leaderboard] th").allTextContents(), ["Rep", "Tries", "Talks", "Calls"], "once saved, stats.columns wins over the old value");
  await sql(`UPDATE "User" SET "uiPrefs" = NULL WHERE email=$1`, [EMAIL]);
  await page.reload();
  await page.locator("[data-testid=stats-page]").waitFor();

  log("Sprint (integration): anything drawn on <body> — here the Columns menu — carries the tenant's brand colour");
  const brandBefore = (await sql(`SELECT "primaryColor" FROM "Organization" WHERE id=$1`, [org])).rows[0].primaryColor;
  await sql(`UPDATE "Organization" SET "primaryColor" = '#e11d48' WHERE id=$1`, [org]);
  await page.reload();
  await page.locator("[data-testid=stats-page]").waitFor();
  await page.getByTestId("stats-columns").click();
  const menuBrand = await page.getByTestId("stats-columns-menu").evaluate((el) => ({
    onBody: el.closest("[data-theme]") === null,
    brand: getComputedStyle(el).getPropertyValue("--brand").trim(),
  }));
  assert.ok(menuBrand.onBody, "the menu is drawn outside the shell");
  assert.equal(menuBrand.brand.toLowerCase(), "#e11d48");
  await page.keyboard.press("Escape");
  await sql(`UPDATE "Organization" SET "primaryColor" = $2 WHERE id=$1`, [org, brandBefore]);

  log("Sprint: 'Talks counted from' shows only when the period starts before outcomes were recorded");
  const since = (await sql(`SELECT "outcomesSince" FROM "Organization" WHERE id=$1`, [org])).rows[0].outcomesSince;
  await sql(`UPDATE "Organization" SET "outcomesSince" = now() - interval '1 day' WHERE id=$1`, [org]);
  await page.reload();
  assert.match(await page.locator("[data-testid=stats-talks-since]").textContent(), /^Talks counted from [A-Z][a-z]{2} \d{1,2}, \d{4}/);
  await sql(`UPDATE "Organization" SET "outcomesSince" = '2020-01-01' WHERE id=$1`, [org]);
  await page.reload();
  await page.locator("[data-testid=stats-page]").waitFor();
  assert.equal(await page.locator("[data-testid=stats-talks-since]").count(), 0);
  await sql(`UPDATE "Organization" SET "outcomesSince" = $2 WHERE id=$1`, [org, since]);

  log("Sprint: a Member opens Stats on their own numbers, with Everyone one tap away");
  const memberStatsContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const nicStatsPage = await memberStatsContext.newPage();
  await login(nicStatsPage, NIC_EMAIL);
  await nicStatsPage.goto(`${BASE}/dashboard/stats`);
  await nicStatsPage.locator("[data-testid=stats-page]").waitFor();
  assert.equal(await nicStatsPage.getByTestId("stats-me").getAttribute("aria-current"), "true");
  assert.deepEqual(
    (await nicStatsPage.locator("[data-testid=stats-rep-row] td:first-child").allTextContents()).map((t) => t.trim()),
    ["Nic Rivera"],
  );
  await nicStatsPage.getByTestId("stats-everyone").click();
  await nicStatsPage.waitForURL(/reps=all/);
  await nicStatsPage.locator("[data-testid=stats-rep-row]", { hasText: "Taylor Test" }).waitFor();
  assert.equal(await nicStatsPage.getByTestId("stats-everyone").getAttribute("aria-current"), "true");
  await nicStatsPage.getByRole("link", { name: "7 days" }).click();
  await nicStatsPage.waitForURL(/period=7d/);
  assert.match(nicStatsPage.url(), /reps=all/, "Everyone stays picked when the period changes");
  await memberStatsContext.close();

  log("Sprint: on a phone the funnel is a list with each step's number and rate, and each rep is a card");
  const pocket = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const pocketPage = await pocket.newPage();
  await login(pocketPage, EMAIL);
  await pocketPage.goto(`${BASE}/dashboard/stats`);
  await pocketPage.locator("[data-testid=stats-page]").waitFor();
  assert.equal(await pocketPage.locator("[data-testid=stats-leaderboard]").isVisible(), false, "no wide table on a phone");
  const cards = pocketPage.locator("[data-testid=stats-rep-card]");
  assert.ok((await cards.count()) >= 3, "Taylor, Nic and the team");
  await cards.first().waitFor();
  assert.match(await cards.filter({ hasText: "Nic Rivera" }).textContent(), /Tries.*Talks.*Connect rate.*Meetings booked.*Held.*Won \$/);
  assert.equal(await pocketPage.locator("[data-testid=funnel-step]").count(), 7);
  assert.ok((await pocketPage.locator("[data-testid=funnel-rate]").count()) >= 1, "each step past the first says its rate");
  await pocketPage.locator("[data-testid=stats-daily-numbers] summary").click();
  const dayList = await pocketPage.locator("[data-testid=stats-daily-table]").evaluate((table) => ({
    head: getComputedStyle(table.querySelector("thead")).display,
    rows: [...table.querySelectorAll("tbody tr")].map((row) => getComputedStyle(row).display),
    labels: [...table.querySelectorAll("tbody td[data-label]")].map((td) => td.dataset.label),
  }));
  assert.equal(dayList.head, "none", "Sprint: the per-day numbers are a two-column list on a phone");
  assert.ok(dayList.rows.length > 0 && dayList.rows.every((d) => d === "grid"), JSON.stringify(dayList));
  assert.deepEqual([...new Set(dayList.labels)], ["Tries", "Talks", "Calls", "Texts", "Emails", "Meetings"]);
  const pocketOverflow = await pocketPage.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(pocketOverflow <= 1, `page scrolls sideways by ${pocketOverflow}px`);
  await shot(pocketPage, "07-stats-phone-cards");
  await pocket.close();
  await sql(`DELETE FROM "Activity" WHERE id LIKE 'a_ps_sprint_%'`);
  await sql(`DELETE FROM "OpportunityMeeting" WHERE id='om_ps_sprint'`);

  log("audit fixes: the funnel counts everyone who reached a step or a later one, so no step reads more people than the one before and no rate passes 100%");
  // Three people booked straight from a first call: the only moves written
  // in the period go into Meeting Set (two of them) and Quote Sent (one).
  // Counting moves into each step alone gave Meeting Set more people than
  // Attempted and Connected ("120% from Attempted").
  await sql(
    `INSERT INTO "Contact" (id,"organizationId",name,status,"updatedAt") VALUES
       ('ctc_ps_jump1',$1,'Jump One','MEETING_SET',now()),
       ('ctc_ps_jump2',$1,'Jump Two','MEETING_SET',now()),
       ('ctc_ps_jump3',$1,'Jump Three','QUOTE_SENT',now())`,
    [org],
  );
  await sql(
    `INSERT INTO "StatusChange" (id,"organizationId","contactId","userId","fromStatus","toStatus","on") VALUES
       ('sc_ps_jump1',$1,'ctc_ps_jump1',$2,'NOT_ACTIONED','MEETING_SET',now() - interval '2 days'),
       ('sc_ps_jump2',$1,'ctc_ps_jump2',$2,'NOT_ACTIONED','MEETING_SET',now() - interval '2 days'),
       ('sc_ps_jump3',$1,'ctc_ps_jump3',$2,'NOT_ACTIONED','QUOTE_SENT',now() - interval '2 days')`,
    [org, taylor.id],
  );
  await page.goto(`${BASE}/dashboard/stats?reps=all`);
  await page.locator("[data-testid=stats-page]").waitFor();
  const reached = (await page.locator("[data-testid=funnel-count]").allTextContents()).map((t) => Number(t.replace(/,/g, "")));
  for (let i = 1; i < reached.length; i += 1) assert.ok(reached[i] <= reached[i - 1], `step ${i} has ${reached[i]} people, the step before ${reached[i - 1]}: ${reached.join(" / ")}`);
  const viaSql = (await sql(
    `SELECT COUNT(DISTINCT "contactId")::int AS n FROM "StatusChange" WHERE "organizationId"=$1 AND "contactId" IS NOT NULL AND "on" >= now() - interval '30 days'
       AND "toStatus" IN ('CONTACTED','CONNECTED','INTERESTED','MEETING_SET','MEETING_COMPLETED','QUOTE_SENT','CONTRACT_SENT','WON')`,
    [org],
  )).rows[0].n;
  assert.equal(reached[0], viaSql, "Attempted is everyone who moved anywhere up the ladder in the period");
  for (const text of await page.locator("[data-testid=funnel-rate]").allTextContents()) {
    const pctValue = Number((text.match(/(\d+)%/) || [])[1]);
    assert.ok(!(pctValue > 100), `a step rate reads ${text}`);
  }
  for (const text of await page.locator("[data-testid=stats-rates]").allTextContents()) {
    for (const m of text.matchAll(/(\d+)%/g)) assert.ok(Number(m[1]) <= 100, `a conversion reads ${m[0]}`);
  }
  await sql(`DELETE FROM "Contact" WHERE id LIKE 'ctc_ps_jump%'`);

  log("audit fixes: Meetings booked counts a meeting when it was put down, once, not when the Pipeline wrote a row for an old meeting or a second tile carries it");
  {
    const bookedNow = async () => {
      await page.goto(`${BASE}/dashboard/stats?reps=all`);
      await page.locator("[data-testid=stats-page]").waitFor();
      return Number((await page.locator("[data-testid=stats-tile][data-id=booked] [data-testid=stats-tile-value]").textContent()).trim());
    };
    const dueText = async () => (await page.locator("[data-testid=stats-tile][data-id=show-rate]").textContent()).match(/(\d+) held of (\d+)/).slice(1).map(Number);
    const bookedBefore = await bookedNow();
    const [heldBefore, dueBefore] = await dueText();
    await sql(
      `INSERT INTO "Activity" (id,"organizationId","contactId","userId",type,body,marketing,"occurredAt","createdAt") VALUES
         ('a_ps_au_old',$1,'ctc_ps_ben',$2,'MEETING','Old site walk',false,now() - interval '70 days',now() - interval '70 days'),
         ('a_ps_au_new',$1,'ctc_ps_ben',$2,'MEETING','Site walk',false,now() - interval '3 days',now() - interval '5 days')`,
      [org, taylor.id],
    );
    await sql(
      `INSERT INTO "Opportunity" (id,"organizationId",title,stage,"updatedAt") VALUES
         ('opp_ps_au1',$1,'Audit tile one','LOST',now()), ('opp_ps_au2',$1,'Audit tile two','MEETING_COMPLETED',now())`,
      [org],
    );
    // The Pipeline's reconcile writes rows today for meetings long past;
    // the newer meeting sits on two tiles.
    await sql(
      `INSERT INTO "OpportunityMeeting" (id,"opportunityId","on","activityId","createdAt") VALUES
         ('om_ps_au_old','opp_ps_au2',now() - interval '70 days','a_ps_au_old',now()),
         ('om_ps_au_n1','opp_ps_au1',now() - interval '3 days','a_ps_au_new',now() - interval '5 days'),
         ('om_ps_au_n2','opp_ps_au2',now() - interval '3 days','a_ps_au_new',now())`,
    );
    assert.equal(await bookedNow(), bookedBefore + 1, "only the one new meeting is booked in the period");
    assert.deepEqual(await dueText(), [heldBefore + 1, dueBefore + 1], "the meeting on two tiles came due and was held once");
    await sql(`DELETE FROM "Opportunity" WHERE id IN ('opp_ps_au1','opp_ps_au2')`);
    await sql(`DELETE FROM "Activity" WHERE id IN ('a_ps_au_old','a_ps_au_new')`);
  }

  log("Sprint: label-old-attempts.cjs — a dry run by default, refuses --apply without --org, labels only plain old voicemail / no-answer calls in the named workspace");
  const { spawnSync } = require("node:child_process");
  const script = path.join(__dirname, "..", "label-old-attempts.cjs");
  const runScript = (...args) => spawnSync(process.execPath, [script, ...args], { env: { ...process.env, DATABASE_URL: DB }, encoding: "utf8" });
  const slug = (await sql(`SELECT slug FROM "Organization" WHERE id=$1`, [org])).rows[0].slug;
  const savedSince = (await sql(`SELECT "outcomesSince" FROM "Organization" WHERE id=$1`, [org])).rows[0].outcomesSince;
  await sql(`UPDATE "Organization" SET "outcomesSince" = now() - interval '1 day' WHERE id=$1`, [org]);
  const someone = (await sql(`SELECT id FROM "Contact" WHERE "organizationId"=$1 ORDER BY "createdAt" LIMIT 1`, [org])).rows[0].id;
  await sql(`DELETE FROM "Organization" WHERE slug = 'test-label-other'`);
  await sql(`INSERT INTO "Organization" (id,name,slug,status,"updatedAt") VALUES ('org_label_other','Test Label Other','test-label-other','ACTIVE',now())`);
  await sql(`UPDATE "Organization" SET "outcomesSince" = now() WHERE id='org_label_other'`);
  await sql(
    `INSERT INTO "Activity" (id,"organizationId","contactId","userId",type,body,outcome,marketing,"occurredAt") VALUES
       ('lo_1',$1,$2,$3,'PHONE_CALL','No answer',NULL,false,now() - interval '3 days'),
       ('lo_2',$1,$2,$3,'PHONE_CALL','Left VM about the quote',NULL,false,now() - interval '3 days'),
       ('lo_3',$1,$2,$3,'PHONE_CALL','Line busy',NULL,false,now() - interval '3 days'),
       ('lo_4',$1,$2,$3,'PHONE_CALL','No answer, then she called back and we talked',NULL,false,now() - interval '3 days'),
       ('lo_5',$1,$2,$3,'EMAIL','voicemail',NULL,false,now() - interval '3 days'),
       ('lo_6',$1,$2,$3,'PHONE_CALL','No answer',NULL,false,now() - interval '1 hour'),
       ('lo_7',$1,$2,$3,'PHONE_CALL','Voicemail',  'TALKED',false,now() - interval '3 days'),
       ('lo_8','org_label_other',NULL,$3,'PHONE_CALL','No answer',NULL,false,now() - interval '3 days')`,
    [org, someone, taylor.id],
  );
  const outcomes = async () =>
    Object.fromEntries((await sql(`SELECT id, outcome FROM "Activity" WHERE id LIKE 'lo\\_%' ORDER BY id`)).rows.map((r) => [r.id, r.outcome]));
  const untouched = { lo_1: null, lo_2: null, lo_3: null, lo_4: null, lo_5: null, lo_6: null, lo_7: "TALKED", lo_8: null };

  const dry = runScript();
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /Dry run — nothing is written/);
  assert.match(dry.stdout, new RegExp(`${slug}: 1 voicemail, 2 no answer`));
  assert.match(dry.stdout, /test-label-other: 0 voicemail, 1 no answer/);
  assert.deepEqual(await outcomes(), untouched, "a dry run writes nothing");

  const refused = runScript("--apply");
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /needs --org/);
  assert.deepEqual(await outcomes(), untouched, "refused without --org");
  assert.equal(runScript("--apply", "--org", "no-such-workspace").status, 2, "an unknown slug is refused");
  assert.deepEqual(await outcomes(), untouched);

  const applied = runScript("--apply", "--org", slug);
  assert.equal(applied.status, 0, applied.stderr);
  assert.match(applied.stdout, new RegExp(`${slug}: 1 voicemail, 2 no answer — written`));
  assert.deepEqual(await outcomes(), { ...untouched, lo_1: "NO_ANSWER", lo_2: "VOICEMAIL", lo_3: "NO_ANSWER" }, "only the plain old calls of the named workspace; never TALKED or REPLIED");
  assert.match(runScript("--apply", "--org", slug).stdout, /Labelled 0 calls in all/, "a second run finds nothing left");
  await sql(`DELETE FROM "Activity" WHERE id LIKE 'lo\\_%'`);
  await sql(`DELETE FROM "Organization" WHERE id='org_label_other'`);
  await sql(`UPDATE "Organization" SET "outcomesSince" = $2 WHERE id=$1`, [org, savedSince]);

  await browser.close();
  console.log(`\nAll ${step} steps passed. Screenshots in ${OUT}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
