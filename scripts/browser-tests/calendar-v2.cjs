/* Browser regression for Calendar v2 (Sept 27, 2026).
 *
 * Covers: a call logged in the past from a contact's page lands on the
 * calendar on that day, ticked done, under whoever logged it, with the
 * time typed; logged on several contacts it is one entry with the others
 * expected; a call dated ahead is scheduled — on the calendar, open, and
 * NOT in anyone's history; marking a quote sent writes Quote sent, Quote
 * follow up and Quote due, accepting it takes the open follow-up and due
 * off and keeps the sent one; sending a contract writes Contract sent and
 * its follow-up, the customer signing writes Contract closed and takes
 * the follow-up off; the three layouts (Calendar, Log, Calendar + Log);
 * the Previous / Upcoming columns and their day groups; the company view —
 * Everyone, Just me, a pick of users including Unassigned — and the
 * Companies, Contacts (including a contact who is only expected) and
 * Projects filters, stacking; the owner picker on the form, defaulting
 * to whoever is logged in and keeping a removed teammate on their days;
 * the filter menus painting the opaque overlay colour; and the phone
 * layout.
 *
 * Runs against a built app (`bash scripts/dev-serve.sh`) and a local
 * Postgres that has had `prisma migrate deploy` run against it. It signs
 * up its own workspace, activates it with SQL, and deletes it again on
 * the next run, so it never touches real data. Never point it at the
 * live database.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/scb_test \
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules \
 *   node scripts/browser-tests/calendar-v2.cjs
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
const OUT = process.env.SHOTS_DIR || path.join(os.tmpdir(), "scb-browser-shots-calendar-v2");
fs.mkdirSync(OUT, { recursive: true });

const EMAIL = "test-calv2@example.com";
const PASSWORD = "password123";
const COMPANY = "Test Calendar Two Co";
const SLUG_LIKE = "test-calendar-two-co%";

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
async function signAs(browser, token, name) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${BASE}/c/${token}`);
  await page.fill("[name=signerName]", name);
  await page.check("[name=agree]");
  await page.click("button[type=submit]");
  await page.getByText("Accepted electronically").waitFor();
  await context.close();
}
// Days in the workspace's own zone (the default, America/Chicago), which
// is the clock the calendar keeps. Computing from the container's UTC
// clock would be a day off for a few hours every evening.
const ZONE = "America/Chicago";
function dayInZone(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
function shift(iso, days) {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
const TODAY = dayInZone(new Date());
const daysAgo = (n) => shift(TODAY, -n);
const daysOn = (n) => shift(TODAY, n);
const isoOf = (value) => (value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10));

(async () => {
  await sql(`DELETE FROM "Organization" WHERE slug LIKE $1`, [SLUG_LIKE]);

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1500, height: 1050 } });
  const page = await context.newPage();
  page.on("pageerror", (err) => console.error("PAGE ERROR:", err.message));
  page.on("dialog", (dialog) => dialog.accept());

  log("signup + activate + login, and a second teammate");
  await page.goto(`${BASE}/signup`);
  await page.fill("[name=companyName]", COMPANY);
  await page.fill("[name=name]", "Taylor Test");
  await page.fill("[name=email]", EMAIL);
  await page.fill("[name=phone]", "5550000000");
  await page.fill("[name=password]", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/signup\/submitted/);
  await sql(`UPDATE "Organization" SET status='ACTIVE', "reviewedAt"=now() WHERE slug LIKE $1`, [SLUG_LIKE]);
  const org = (await sql(`SELECT id FROM "Organization" WHERE slug LIKE $1`, [SLUG_LIKE])).rows[0].id;
  const me = (await sql(`SELECT id, "passwordHash" FROM "User" WHERE "organizationId"=$1`, [org])).rows[0];
  await sql(
    `INSERT INTO "User" (id,name,email,"passwordHash",role,"organizationId")
     VALUES ('usr_calv2_sam','Sam Teammate','test-calv2-sam@example.com',$1,'MEMBER',$2)`,
    [me.passwordHash, org],
  );
  await login(page);

  log("audit: the app writing a milestone before anyone opens the calendar still seeds the whole type list");
  // Sending paperwork first used to leave the list at "Contract sent"
  // alone, with no Install or Site walk to pick. Checked below, after the
  // quote goes out, by the form still offering the starting list.

  log("seed a customer, two contacts and a quote with a valid-until day");
  await sql(
    `INSERT INTO "Company" (id,"organizationId",name,city,state,"updatedAt")
     VALUES ('cmp_calv2','${org}','Harbor Property Group','Tampa','FL',now()),
            ('cmp_calv2_b','${org}','Bayside Dental','Tampa','FL',now())`,
  );
  await sql(
    `INSERT INTO "Contact" (id,"organizationId","companyId",name,title,email,"updatedAt")
     VALUES ('ctc_calv2','${org}','cmp_calv2','Dana Ruiz','Owner','dana@harbor.com',now()),
            ('ctc_calv2_pm','${org}','cmp_calv2','Priya Menon','Property manager','priya@harbor.com',now()),
            ('ctc_calv2_b','${org}','cmp_calv2_b','Ben Ortiz','Office manager','ben@bayside.com',now())`,
  );
  await sql(
    `INSERT INTO "Deal" (id,"organizationId","contactId",title,stage,"updatedAt")
     VALUES ('deal_calv2','${org}','ctc_calv2','Harbor reroof','CONTACTED',now())`,
  );
  await sql(
    `INSERT INTO "Quote" (id,"organizationId","contactId","dealId",number,title,status,"publicToken","validUntil","updatedAt")
     VALUES ('quo_calv2','${org}','ctc_calv2','deal_calv2',1000,'Harbor quote','DRAFT','tok_quo_calv2_0123456',$1,now())`,
    [`${daysOn(14)}T12:00:00.000Z`],
  );
  await sql(
    `INSERT INTO "QuoteLineItem" (id,"quoteId",name,quantity,"unitPriceCents",tag,"serviceType",position)
     VALUES ('qli_calv2_1','quo_calv2','Roof replacement',1,4000000,'PROJECT_SERVICES','Roofing',0)`,
  );

  /* ------------------------------ Logged calls ------------------------------ */

  log("a call logged five days ago, with a time, lands on the calendar that day, done");
  await page.goto(`${BASE}/dashboard/contacts/ctc_calv2`);
  const logForm = page.locator("[data-testid=log-activity-form]");
  await logForm.waitFor();
  assert.equal(await logForm.locator("[data-testid=activity-when]").inputValue(), TODAY, "When defaults to today");
  await logForm.getByRole("button", { name: "Phone Call", exact: true }).click();
  await logForm.locator("textarea[name=body]").fill("Walked through the roof scope on the phone");
  await logForm.locator("[data-testid=activity-when]").fill(daysAgo(5));
  await logForm.locator("[data-testid=activity-time]").fill("10:30");
  await logForm.locator("[data-testid=activity-submit]").click();
  await page.getByText("Walked through the roof scope on the phone").waitFor();
  const call = (
    await sql(
      `SELECT e.id, e.type, e.title, e."startOn", e."startTime", e."doneAt", e."ownerId", e.auto, e."contactId", e."companyId", e."activityId", a."occurredAt"
       FROM "CalendarEvent" e JOIN "Activity" a ON a.id = e."activityId"
       WHERE e."organizationId"=$1`,
      [org],
    )
  ).rows[0];
  assert.ok(call, "the logged call made a calendar entry");
  assert.equal(call.type, "Call");
  assert.equal(call.title, "Call · Dana Ruiz");
  assert.equal(isoOf(call.startOn), daysAgo(5), "on the day it happened, not the day it was logged");
  assert.equal(call.startTime, "10:30", "with the time typed");
  assert.ok(call.doneAt !== null, "a call that happened is done");
  assert.equal(call.ownerId, me.id, "on the calendar of whoever logged it");
  assert.equal(call.auto, true);
  assert.equal(call.contactId, "ctc_calv2");
  assert.equal(call.companyId, "cmp_calv2", "the contact's company came with it");
  assert.equal(dayInZone(call.occurredAt), daysAgo(5), "the Activity itself is dated that day too");

  log("logged on two contacts at once it is one entry, with the other expected");
  await logForm.getByRole("button", { name: "Meeting", exact: true }).click();
  await logForm.locator("textarea[name=body]").fill("Site meeting with both of them");
  await logForm.locator("[data-testid=activity-when]").fill(daysAgo(2));
  await logForm.getByRole("button", { name: "+ Include multiple contacts" }).click();
  await page.getByRole("dialog").getByLabel("Search contacts").fill("Priya");
  await page.getByRole("dialog").getByText("Priya Menon").click();
  await page.getByRole("dialog").getByRole("button", { name: "Done" }).click();
  await logForm.locator("[data-testid=activity-submit]").click();
  await page.getByText("Site meeting with both of them").first().waitFor();
  const meeting = (
    await sql(`SELECT id, type, title, "startTime" FROM "CalendarEvent" WHERE "organizationId"=$1 AND type='Meeting'`, [org])
  ).rows;
  assert.equal(meeting.length, 1, "one calendar entry for the batch, not one per person");
  assert.equal(meeting[0].startTime, null, "no time was typed, so none was made up");
  assert.equal(
    (await sql(`SELECT count(*)::int AS n FROM "_EventAttendees" WHERE "A"=$1`, [meeting[0].id])).rows[0].n,
    1,
    "Priya is expected at it",
  );
  assert.equal(
    (await sql(`SELECT count(*)::int AS n FROM "Activity" WHERE "organizationId"=$1 AND type='MEETING'`, [org])).rows[0].n,
    2,
    "and the history still has one line per person",
  );

  log("a call dated ahead is scheduled, not logged: on the calendar, open, nothing in the history");
  const activitiesBefore = (await sql(`SELECT count(*)::int AS n FROM "Activity" WHERE "organizationId"=$1`, [org])).rows[0].n;
  await logForm.getByRole("button", { name: "Phone Call", exact: true }).click();
  await logForm.locator("textarea[name=body]").fill("Call back about the deposit");
  await logForm.locator("[data-testid=activity-when]").fill(daysOn(4));
  await logForm.locator("[data-testid=activity-time]").fill("14:00");
  assert.match(await logForm.locator("[data-testid=activity-when-note]").textContent(), /ahead/, "the form says it is ahead");
  assert.match(await logForm.locator("[data-testid=activity-submit]").textContent(), /^Schedule/, "and offers to schedule");
  await logForm.locator("[data-testid=activity-submit]").click();
  await page.getByText(/Scheduled for/).waitFor();
  const scheduled = (
    await sql(`SELECT id,"startOn","startTime","doneAt",auto,"activityId","ownerId" FROM "CalendarEvent" WHERE "organizationId"=$1 AND title='Call · Dana Ruiz' AND "doneAt" IS NULL`, [org])
  ).rows[0];
  assert.ok(scheduled, "the future call is on the calendar");
  assert.equal(isoOf(scheduled.startOn), daysOn(4));
  assert.equal(scheduled.startTime, "14:00");
  assert.equal(scheduled.activityId, null, "it is not tied to a history line");
  assert.equal(scheduled.ownerId, me.id);
  const scheduledId = scheduled.id;
  assert.equal(
    (await sql(`SELECT count(*)::int AS n FROM "Activity" WHERE "organizationId"=$1`, [org])).rows[0].n,
    activitiesBefore,
    "nothing was written to the history for a call that has not happened",
  );
  const comingUp = await page.locator("[data-testid=upcoming-card]").textContent();
  assert.match(comingUp, /Call · Dana Ruiz/, "and Coming up on her page shows it");
  assert.doesNotMatch(comingUp, /Meeting · Dana Ruiz/, "the meeting that already happened is not coming up");

  /* ------------------------------- Quote milestones ------------------------------- */

  log("marking a quote sent puts Quote sent, Quote follow up and Quote due on the calendar");
  await page.goto(`${BASE}/dashboard/quotes/quo_calv2`);
  await page.getByRole("button", { name: "Mark as sent" }).click();
  await page.getByRole("button", { name: "Mark accepted" }).waitFor();
  const quoteRows = (
    await sql(
      `SELECT type, title, "startOn", "doneAt", "ownerId", "dealId", "contactId", "companyId", notes FROM "CalendarEvent"
       WHERE "organizationId"=$1 AND "quoteId"='quo_calv2' ORDER BY "startOn"`,
      [org],
    )
  ).rows;
  assert.deepEqual(
    quoteRows.map((row) => row.type),
    ["Quote sent", "Quote follow up", "Quote due"],
  );
  assert.equal(isoOf(quoteRows[0].startOn), TODAY, "sent today");
  assert.ok(quoteRows[0].doneAt !== null, "sending is done the moment it happens");
  assert.equal(isoOf(quoteRows[1].startOn), daysOn(3), "follow up three days on");
  assert.equal(quoteRows[1].doneAt, null, "and still to do");
  assert.equal(isoOf(quoteRows[2].startOn), daysOn(14), "due on the valid-until day");
  for (const row of quoteRows) {
    assert.equal(row.ownerId, me.id, `${row.type} is on the sender's calendar`);
    assert.equal(row.dealId, "deal_calv2");
    assert.equal(row.contactId, "ctc_calv2");
    assert.equal(row.companyId, "cmp_calv2");
    assert.match(row.notes, /QUO-1000/);
  }

  log("the type list still carries the starting kinds of day after the app wrote its first milestone");
  const types = (await sql(`SELECT name FROM "EventTypeOption" WHERE "organizationId"=$1 ORDER BY position`, [org])).rows.map((row) => row.name);
  for (const name of ["Install", "Site walk", "Call", "Quote sent", "Other"]) {
    assert.ok(types.includes(name), `${name} is on the list; got ${types.join(", ")}`);
  }
  assert.equal(types[types.length - 1], "Other", "Other stays last");

  log("sending it again does not double the milestones");
  await page.getByRole("button", { name: "Back to draft" }).click();
  await page.getByRole("button", { name: "Mark as sent" }).waitFor();
  assert.equal(
    (await sql(`SELECT count(*)::int AS n FROM "CalendarEvent" WHERE "quoteId"='quo_calv2'`)).rows[0].n,
    1,
    "back to draft takes the open follow-up and due off, and keeps the sent one",
  );
  await page.getByRole("button", { name: "Mark as sent" }).click();
  await page.getByRole("button", { name: "Mark accepted" }).waitFor();
  assert.equal(
    (await sql(`SELECT count(*)::int AS n FROM "CalendarEvent" WHERE "quoteId"='quo_calv2'`)).rows[0].n,
    3,
    "sent again: still one of each",
  );

  log("changing the quote's valid-until day moves Quote due");
  await page.locator("[name=validUntil]").fill(daysOn(20));
  await page.locator("[name=validUntil]").locator("xpath=ancestor::form").getByRole("button", { name: /Save/ }).click();
  await page.getByText("Quote details saved").waitFor();
  assert.equal(
    isoOf((await sql(`SELECT "startOn" FROM "CalendarEvent" WHERE "quoteId"='quo_calv2' AND type='Quote due'`)).rows[0].startOn),
    daysOn(20),
  );

  log("the Log layout: the call is in Previous, the follow-up and due are in Upcoming");
  await page.goto(`${BASE}/dashboard/calendar?layout=log`);
  await page.locator("[data-testid=log-columns]").waitFor();
  assert.equal(await page.locator("[data-testid=month-day]").count(), 0, "no grid in the Log layout");
  const previous = page.locator("[data-testid=log-previous]");
  const upcoming = page.locator("[data-testid=log-upcoming]");
  assert.match(await previous.textContent(), /Call · Dana Ruiz/);
  assert.match(await previous.textContent(), /Meeting · Dana Ruiz/);
  assert.match(await previous.textContent(), /10:30am/, "with its time");
  assert.match(await previous.textContent(), /Taylor Test/, "and whose it is");
  assert.match(await upcoming.textContent(), /Follow up on quote · Dana Ruiz/);
  assert.match(await upcoming.textContent(), /Quote due · Dana Ruiz/);
  assert.match(await upcoming.textContent(), /Call back|Call · Dana Ruiz/, "the scheduled call is ahead");
  // Previous reads newest first, Upcoming soonest first.
  const previousDays = await previous.locator("[data-testid=log-day]").evaluateAll((rows) => rows.map((row) => row.dataset.day));
  assert.deepEqual(previousDays, [...previousDays].sort().reverse(), "Previous is newest first");
  const upcomingDays = await upcoming.locator("[data-testid=log-day]").evaluateAll((rows) => rows.map((row) => row.dataset.day));
  assert.deepEqual(upcomingDays, [...upcomingDays].sort(), "Upcoming is soonest first");
  assert.match(await upcoming.textContent(), /QUO-1000/, "a milestone links back to its quote");
  await shot(page, "01-log");

  log("accepting the quote takes the open follow-up and due off, and keeps the sent one");
  await page.goto(`${BASE}/dashboard/quotes/quo_calv2`);
  await page.getByRole("button", { name: "Mark accepted" }).click();
  await page.getByText(/Accepted/).first().waitFor();
  assert.deepEqual(
    (await sql(`SELECT type FROM "CalendarEvent" WHERE "quoteId"='quo_calv2' ORDER BY type`)).rows.map((row) => row.type),
    ["Quote sent"],
  );

  /* ------------------------------ Contract milestones ------------------------------ */

  log("sending a contract puts Contract sent and Contract follow up on the calendar");
  await page.goto(`${BASE}/dashboard/deals/tracker?dealId=deal_calv2`);
  await page.locator("[data-testid=tracker-row]").first().waitFor();
  await page.getByRole("checkbox", { name: "Put Roof replacement on Contract A" }).check();
  await page.locator("[data-testid=create-contracts]").click();
  await page.waitForURL(/created=\d+/);
  const contract = (
    await sql(`SELECT id, "publicToken" FROM "Contract" WHERE "organizationId"=$1 AND payable=false ORDER BY number LIMIT 1`, [org])
  ).rows[0];
  await page.goto(`${BASE}/dashboard/contracts/${contract.id}`);
  await page.getByRole("button", { name: /Mark as sent|Send for signature/ }).first().click();
  // "Contract Sent" is already on the page as pipeline text, so wait for
  // the button that only exists once the status has really changed.
  await page.locator("[data-testid=mark-signed]").first().waitFor();
  const sentRows = (
    await sql(`SELECT type, "startOn", "doneAt", "ownerId", "contactId", "companyId", "dealId" FROM "CalendarEvent" WHERE "contractId"=$1 ORDER BY "startOn"`, [contract.id])
  ).rows;
  assert.deepEqual(sentRows.map((row) => row.type), ["Contract sent", "Contract follow up"]);
  assert.equal(isoOf(sentRows[0].startOn), TODAY);
  assert.ok(sentRows[0].doneAt !== null);
  assert.equal(isoOf(sentRows[1].startOn), daysOn(3));
  assert.equal(sentRows[1].doneAt, null);
  assert.equal(sentRows[0].ownerId, me.id);
  assert.equal(sentRows[0].contactId, "ctc_calv2");
  assert.equal(sentRows[0].companyId, "cmp_calv2");
  assert.equal(sentRows[0].dealId, "deal_calv2");

  log("the customer signing writes Contract closed and takes the follow-up off");
  await signAs(browser, contract.publicToken, "Dana Ruiz");
  const closedRows = (
    await sql(`SELECT type, "startOn", "doneAt", "ownerId", "projectId" FROM "CalendarEvent" WHERE "contractId"=$1 ORDER BY type`, [contract.id])
  ).rows;
  assert.deepEqual(closedRows.map((row) => row.type), ["Contract closed", "Contract sent"]);
  const closed = closedRows[0];
  assert.equal(isoOf(closed.startOn), TODAY, "closed on the day it was signed");
  assert.ok(closed.doneAt !== null);
  assert.equal(closed.ownerId, me.id, "nobody was logged in to sign, so it went to whoever sent it");
  const projectId = (await sql(`SELECT id FROM "Project" WHERE "organizationId"=$1`, [org])).rows[0].id;

  /* --------------------------------- Layouts --------------------------------- */

  log("the Calendar layout is the landing spot: the grid, no log");
  await page.goto(`${BASE}/dashboard/calendar`);
  await page.locator("[data-testid=cal-layout-calendar][aria-selected=true]").waitFor();
  assert.ok((await page.locator("[data-testid=month-day]").count()) === 42, "the six-week grid");
  assert.equal(await page.locator("[data-testid=log-columns]").count(), 0);
  const todayCell = page.locator(`[data-testid=month-day][data-day="${TODAY}"]`);
  // Quote sent, Contract sent, Contract closed all landed today.
  assert.ok(Number(await todayCell.getAttribute("data-count")) >= 3, "today carries the three milestones");
  await shot(page, "02-calendar");

  log("Calendar + Log puts the grid on top and the two columns beneath");
  await page.locator("[data-testid=cal-layout-both]").click();
  await page.waitForURL(/layout=both/);
  await page.locator("[data-testid=log-columns]").waitFor();
  assert.equal(await page.locator("[data-testid=month-day]").count(), 42, "the grid is still there");
  const gridBox = await page.locator("[data-testid=month-day]").first().boundingBox();
  const logBox = await page.locator("[data-testid=log-columns]").boundingBox();
  assert.ok(logBox.y > gridBox.y, "the log is beneath the calendar");
  const columns = await page.locator("[data-testid=log-previous], [data-testid=log-upcoming]").evaluateAll((els) =>
    els.map((el) => el.getBoundingClientRect().x),
  );
  assert.ok(columns[1] > columns[0] + 200, "Previous and Upcoming are side by side");
  await shot(page, "03-both");

  log("paging the grid does not move the logs off today");
  await page.locator("[data-testid=cal-next]").click();
  await page.waitForURL(/on=/);
  await page.locator("[data-testid=log-columns]").waitFor();
  assert.match(await page.locator("[data-testid=log-previous]").textContent(), /Call · Dana Ruiz/, "Previous still reads from today");

  /* ---------------------------------- Filters ---------------------------------- */

  log("the company view: Everyone shows both teammates' days, Just me shows mine");
  // Hand the meeting to Sam and leave one day with nobody.
  await sql(`UPDATE "CalendarEvent" SET "ownerId"='usr_calv2_sam' WHERE id=$1`, [meeting[0].id]);
  await sql(`UPDATE "CalendarEvent" SET "ownerId"=NULL WHERE id=$1`, [call.id]);
  await page.goto(`${BASE}/dashboard/calendar?layout=log`);
  await page.locator("[data-testid=cal-everyone][aria-pressed=true]").waitFor();
  const everyone = Number(await page.locator("[data-testid=log-previous]").getAttribute("data-count"));
  assert.equal(everyone, 2, "the company view has the call and the meeting");
  await page.locator("[data-testid=cal-just-me]").click();
  await page.waitForURL(new RegExp(`users=${me.id}`));
  await page.locator("[data-testid=cal-just-me][aria-pressed=true]").waitFor();
  assert.equal(await page.locator("[data-testid=log-previous]").getAttribute("data-count"), "0", "neither past day is mine now");
  assert.match(await page.locator("[data-testid=log-upcoming]").textContent(), /Call · Dana Ruiz/, "my upcoming days are (the call I scheduled)");
  assert.equal(await page.locator("[data-testid=log-upcoming]").locator("text=Sam Teammate").count(), 0);

  log("picking users: Sam alone, then Sam plus Unassigned");
  await page.goto(`${BASE}/dashboard/calendar?layout=log&users=usr_calv2_sam`);
  await page.locator("[data-testid=log-columns]").waitFor();
  assert.equal(await page.locator("[data-testid=log-previous]").getAttribute("data-count"), "1");
  assert.match(await page.locator("[data-testid=log-previous]").textContent(), /Meeting · Dana Ruiz/);
  assert.match(await page.locator("[data-testid=cal-active-filters]").textContent(), /Sam Teammate/, "a chip names the teammate");
  await page.locator("[data-testid=cal-users]").click();
  await page.getByRole("listbox", { name: "Users" }).getByText("Unassigned").click();
  await page.waitForURL(/users=usr_calv2_sam%2Cnone|users=usr_calv2_sam,none/);
  await page.locator("[data-testid=log-columns]").waitFor();
  assert.equal(await page.locator("[data-testid=log-previous]").getAttribute("data-count"), "2", "two users picked is both their days");
  await page.keyboard.press("Escape");

  log("the filter menu paints the opaque overlay colour, not the glass card");
  await page.locator("[data-testid=cal-companies]").click();
  const menu = page.locator(".popover").first();
  await menu.waitFor();
  const paint = await menu.evaluate((el) => {
    const styles = getComputedStyle(el);
    return { bg: styles.backgroundColor, overlay: getComputedStyle(document.documentElement).getPropertyValue("--overlay").trim() };
  });
  const hex = paint.overlay.replace("#", "");
  const rgb = `rgb(${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)})`;
  assert.equal(paint.bg, rgb, `the menu is painted --overlay (${paint.overlay}); got ${paint.bg}`);

  log("the Companies filter searches as you type and stacks with the user filter");
  await menu.getByLabel("Search companies").fill("Bayside");
  await menu.getByText("Bayside Dental").click();
  await page.waitForURL(/companies=cmp_calv2_b/);
  await page.locator("[data-testid=log-columns]").waitFor();
  assert.equal(await page.locator("[data-testid=log-previous]").getAttribute("data-count"), "0", "nothing with Bayside yet");
  assert.match(await page.locator("[data-testid=cal-active-filters]").textContent(), /Company: Bayside Dental/);
  await page.goto(`${BASE}/dashboard/calendar?layout=log&companies=cmp_calv2`);
  await page.locator("[data-testid=log-columns]").waitFor();
  assert.equal(await page.locator("[data-testid=log-previous]").getAttribute("data-count"), "2", "everything so far is with Harbor");
  assert.ok(Number(await page.locator("[data-testid=log-upcoming]").getAttribute("data-count")) >= 2);

  log("the Contacts filter counts a contact who is only expected at a day");
  await page.goto(`${BASE}/dashboard/calendar?layout=log&contacts=ctc_calv2_pm`);
  await page.locator("[data-testid=log-columns]").waitFor();
  assert.equal(await page.locator("[data-testid=log-previous]").getAttribute("data-count"), "1", "Priya was expected at the meeting");
  assert.match(await page.locator("[data-testid=log-previous]").textContent(), /Meeting · Dana Ruiz/);
  assert.match(await page.locator("[data-testid=cal-active-filters]").textContent(), /Contact: Priya Menon/);
  await page.goto(`${BASE}/dashboard/calendar?layout=log&contacts=ctc_calv2_pm,ctc_calv2`);
  await page.locator("[data-testid=log-columns]").waitFor();
  assert.equal(await page.locator("[data-testid=log-previous]").getAttribute("data-count"), "2", "two contacts picked is both");

  log("the Projects filter keeps the days on that job");
  await sql(`UPDATE "CalendarEvent" SET "projectId"=$1 WHERE "contractId"=$2`, [projectId, contract.id]);
  await page.goto(`${BASE}/dashboard/calendar?layout=log&projects=${projectId}`);
  await page.locator("[data-testid=log-columns]").waitFor();
  assert.equal(await page.locator("[data-testid=log-previous]").getAttribute("data-count"), "0");
  const onJob = await page.locator("[data-testid=log-upcoming]").textContent();
  assert.match(onJob, /Contract sent · Dana Ruiz/);
  assert.match(onJob, /Contract signed · Dana Ruiz/);
  assert.doesNotMatch(onJob, /Quote sent/, "the quote milestone is not on the job");
  assert.match(await page.locator("[data-testid=cal-active-filters]").textContent(), /PRJ-1000/);

  log("Clear takes every filter off at once");
  await page.goto(`${BASE}/dashboard/calendar?layout=log&projects=${projectId}&users=usr_calv2_sam&type=Call`);
  await page.locator("[data-testid=log-columns]").waitFor();
  await page.getByRole("button", { name: "Clear" }).click();
  await page.waitForURL((url) => !url.search.includes("projects=") && !url.search.includes("users=") && !url.search.includes("type="));
  await page.locator("[data-testid=cal-everyone][aria-pressed=true]").waitFor();

  log("the grid honours the same filters");
  await page.goto(`${BASE}/dashboard/calendar?on=${daysAgo(5)}&users=usr_calv2_sam`);
  await page.getByRole("heading", { name: "Calendar" }).waitFor();
  assert.equal(
    await page.locator(`[data-testid=month-day][data-day="${daysAgo(5)}"]`).getAttribute("data-count"),
    "0",
    "the unassigned call is not Sam's",
  );
  assert.equal(
    await page.locator(`[data-testid=month-day][data-day="${daysAgo(2)}"]`).getAttribute("data-count"),
    "1",
    "the meeting is",
  );

  /* --------------------------------- The form --------------------------------- */

  log("a new event goes on my calendar unless I say otherwise");
  await page.goto(`${BASE}/dashboard/calendar?on=${TODAY}`);
  await page.locator("[data-testid=cal-add-event]").click();
  const ownerPicked = await page.locator("[data-testid=event-form] [data-testid=event-owner] option:checked").textContent();
  assert.match(ownerPicked, /Taylor Test \(me\)/, `defaults to me; got "${ownerPicked}"`);
  await page.locator("[data-testid=event-title]").fill("Lunch with Ben");
  await page.locator("[data-testid=event-type]").selectOption("Meeting");
  await page.locator("[data-testid=event-start-on]").fill(daysOn(6));
  await page.locator("[data-testid=event-owner]").selectOption("usr_calv2_sam");
  await page.locator("[data-testid=event-company]").selectOption("cmp_calv2_b");
  await page.locator("[data-testid=event-contact]").selectOption("ctc_calv2_b");
  await page.locator("[data-testid=event-save]").click();
  await page.locator(`[data-testid=month-day][data-day="${daysOn(6)}"][data-count="1"]`).waitFor();
  const lunch = (
    await sql(`SELECT id, "ownerId", "companyId", "contactId", auto FROM "CalendarEvent" WHERE title='Lunch with Ben' AND "organizationId"=$1`, [org])
  ).rows[0];
  assert.equal(lunch.ownerId, "usr_calv2_sam", "handed to Sam from the picker");
  assert.equal(lunch.companyId, "cmp_calv2_b", "the company picker works from the calendar");
  assert.equal(lunch.contactId, "ctc_calv2_b", "and so does the contact picker");
  assert.equal(lunch.auto, false, "a day somebody typed is not the app's");

  log("a removed teammate stays on their days when one is edited");
  await sql(`UPDATE "User" SET "removedAt"=now() WHERE id='usr_calv2_sam'`);
  await page.goto(`${BASE}/dashboard/calendar?on=${TODAY}`);
  await page.locator(`[data-testid=month-day][data-day="${daysOn(6)}"]`).click();
  const lunchCard = page.locator("[data-testid=event-card]").filter({ hasText: "Lunch with Ben" });
  assert.match(await lunchCard.textContent(), /Sam Teammate/, "the card names whose day it is");
  await lunchCard.locator("[data-testid=event-edit]").click();
  const removedPicked = await page.locator("[data-testid=event-form] [data-testid=event-owner] option:checked").textContent();
  assert.match(removedPicked, /Sam Teammate/, `the removed teammate is still selected; got "${removedPicked}"`);
  await page.locator("[data-testid=event-form] [data-testid=event-notes]").fill("Bring the Bayside proposal");
  await page.locator("[data-testid=event-form] [data-testid=event-save]").click();
  await page.getByText("Bring the Bayside proposal").first().waitFor();
  assert.equal(
    (await sql(`SELECT "ownerId" FROM "CalendarEvent" WHERE id=$1`, [lunch.id])).rows[0].ownerId,
    "usr_calv2_sam",
    "the edit did not unlink Sam",
  );
  await sql(`UPDATE "User" SET "removedAt"=NULL WHERE id='usr_calv2_sam'`);

  log("a milestone the app wrote says where it came from on the form, and can be moved");
  await page.locator(`[data-testid=month-day][data-day="${TODAY}"]`).click();
  const sentCard = page.locator("[data-testid=event-card]").filter({ hasText: "Contract sent · Dana Ruiz" });
  assert.match(await sentCard.textContent(), /CON-1000/, "the card links the contract");
  await sentCard.locator("[data-testid=event-edit]").click();
  assert.match(await page.locator("[data-testid=event-form] [data-testid=event-source]").textContent(), /CON-1000/);
  await page.locator("[data-testid=event-form]").getByRole("button", { name: "Cancel" }).click();

  log("a log row can be ticked done and edited in place");
  await page.goto(`${BASE}/dashboard/calendar?layout=log`);
  const callRow = page.locator("[data-testid=log-upcoming] [data-testid=log-row]").filter({ hasText: "Call · Dana Ruiz" });
  await callRow.locator("[data-testid=log-done]").click();
  await callRow.locator("[data-testid=log-title].line-through").waitFor();
  assert.ok(
    (await sql(`SELECT "doneAt" FROM "CalendarEvent" WHERE id=$1`, [scheduledId])).rows[0].doneAt !== null,
    "the scheduled call is ticked done",
  );
  const lunchRow = page.locator("[data-testid=log-row]").filter({ hasText: "Lunch with Ben" });
  await lunchRow.locator("[data-testid=log-edit]").click();
  await page.locator("[data-testid=event-form] [data-testid=event-title]").fill("Lunch with Ben Ortiz");
  await page.locator("[data-testid=event-form] [data-testid=event-save]").click();
  await page.getByText("Lunch with Ben Ortiz").first().waitFor();

  log("deleting the quote takes its milestone off the calendar with it");
  await sql(`DELETE FROM "Quote" WHERE id='quo_calv2'`);
  assert.equal((await sql(`SELECT count(*)::int AS n FROM "CalendarEvent" WHERE "quoteId"='quo_calv2'`)).rows[0].n, 0);

  log("phone layout: the toolbar wraps and the two log columns stack");
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const small = await phone.newPage();
  await small.goto(`${BASE}/login`);
  await small.fill("#email", EMAIL);
  await small.fill("#password", PASSWORD);
  await small.click("button[type=submit]");
  await small.waitForURL(/\/dashboard$/);
  await small.goto(`${BASE}/dashboard/calendar?layout=both`);
  await small.locator("[data-testid=log-columns]").waitFor();
  const stacked = await small.locator("[data-testid=log-previous], [data-testid=log-upcoming]").evaluateAll((els) =>
    els.map((el) => el.getBoundingClientRect()),
  );
  assert.ok(stacked[1].y > stacked[0].y + 40, "Upcoming sits under Previous on a phone");
  const overflow = await small.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, `the page does not scroll sideways (${overflow}px over)`);
  await shot(small, "04-phone");
  await phone.close();

  await browser.close();
  console.log(`\nAll ${step} steps passed. Screenshots in ${OUT}`);
})().catch((err) => {
  console.error(`\nFAILED at step ${step}:`, err);
  process.exit(1);
});
