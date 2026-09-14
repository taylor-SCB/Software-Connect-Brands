/* Browser regression for the Calendar and a job's Schedule (Sept 14, 2026).
 *
 * Covers: booking install days off a scope of work, which takes the crew
 * already on that scope and flips an Awarded job to Active with its start
 * date; events of any kind put on by hand, with or without a clock on
 * them, over one day or several; a new event type added from the form;
 * attendees; the month grid and the week view, paging and Today; the crew
 * and type filters; moving a day, ticking one done, and deleting it;
 * "Copy this week into next"; the crew double-booking note and the
 * absence of one when the times do not touch; a job's checklist with an
 * optional day and its overdue mark; and the phone layout.
 *
 * Runs against a built app (`bash scripts/dev-serve.sh`) and a local
 * Postgres that has had `prisma migrate deploy` run against it. It signs
 * up its own workspace, activates it with SQL, and deletes it again on
 * the next run, so it never touches real data. Never point it at the
 * live database.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/scb_test \
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules \
 *   node scripts/browser-tests/calendar.cjs
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
const OUT = process.env.SHOTS_DIR || path.join(os.tmpdir(), "scb-browser-shots-calendar");
fs.mkdirSync(OUT, { recursive: true });

const EMAIL = "test-cal@example.com";
const PASSWORD = "password123";
const COMPANY = "Test Calendar Co";
const SLUG_LIKE = "test-calendar-co%";

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
// Every date in this suite is inside one fixed month, so paging and the
// month grid are exact rather than dependent on the day it is run.
const MONTH = "2026-11";
const day = (n) => `${MONTH}-${String(n).padStart(2, "0")}`;
// A day that has definitely gone, for the overdue marks. The fixed month
// above is in the future, which is the point of it.
function daysAgo(n) {
  const date = new Date();
  date.setDate(date.getDate() - n);
  return date.toISOString().slice(0, 10);
}

(async () => {
  await sql(`DELETE FROM "Organization" WHERE slug LIKE $1`, [SLUG_LIKE]);

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1500, height: 1050 } });
  const page = await context.newPage();
  page.on("pageerror", (err) => console.error("PAGE ERROR:", err.message));
  page.on("dialog", (dialog) => dialog.accept());

  log("signup + activate + login");
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
  await login(page);

  log("seed a customer and a job split into roofing and smart locks");
  await sql(
    `INSERT INTO "Company" (id,"organizationId",name,city,state,"updatedAt")
     VALUES ('cmp_cal','${org}','Harbor Property Group','Tampa','FL',now())`,
  );
  await sql(
    `INSERT INTO "Contact" (id,"organizationId","companyId",name,title,email,"updatedAt")
     VALUES ('ctc_cal','${org}','cmp_cal','Dana Ruiz','Owner','dana@harbor.com',now()),
            ('ctc_cal_pm','${org}','cmp_cal','Priya Menon','Property manager','priya@harbor.com',now())`,
  );
  await sql(
    `INSERT INTO "Deal" (id,"organizationId","contactId",title,stage,"updatedAt")
     VALUES ('deal_cal','${org}','ctc_cal','Harbor reroof and locks','QUOTE_SENT',now())`,
  );
  await sql(
    `INSERT INTO "Quote" (id,"organizationId","contactId","dealId",number,title,status,"publicToken","updatedAt")
     VALUES ('quo_cal','${org}','ctc_cal','deal_cal',1000,'Harbor quote','SENT','tok_quo_cal_012345678',now())`,
  );
  await sql(
    `INSERT INTO "QuoteLineItem" (id,"quoteId",name,quantity,"unitPriceCents",tag,"serviceType",position)
     VALUES ('qli_cal1','quo_cal','Roof replacement',1,4000000,'PROJECT_SERVICES','Roofing',0),
            ('qli_cal2','quo_cal','Smart lock install',1,1000000,'PROJECT_SERVICES','Smart Locks',1)`,
  );
  await page.goto(`${BASE}/dashboard/deals/tracker?dealId=deal_cal`);
  await page.locator("[data-testid=tracker-row]").first().waitFor();
  await page.getByRole("checkbox", { name: "Put Roof replacement on Contract A" }).check();
  await page.getByRole("checkbox", { name: "Put Smart lock install on Contract A" }).check();
  await page.locator("[data-testid=create-contracts]").click();
  await page.waitForURL(/created=\d+/);
  const sales = (
    await sql(
      `SELECT id, "publicToken" FROM "Contract" WHERE "organizationId"=$1 AND payable=false ORDER BY number LIMIT 1`,
      [org],
    )
  ).rows[0];
  await page.goto(`${BASE}/dashboard/contracts/${sales.id}`);
  await page.getByRole("button", { name: /Mark as sent|Send for signature/ }).first().click();
  await page.getByText(/Sent/).first().waitFor();
  await signAs(browser, sales.publicToken, "Dana Ruiz");
  const projectId = (await sql(`SELECT id FROM "Project" WHERE "organizationId"=$1`, [org])).rows[0].id;

  log("build two crews and put one on each scope");
  await sql(
    `INSERT INTO "Crew" (id,"organizationId",name,kind,"dailyRateCents","serviceTypes","updatedAt")
     VALUES ('crw_cal_roof','${org}','Ridgeline Roofing','SUBCONTRACTOR',240000,'{"Roofing"}',now()),
            ('crw_cal_locks','${org}','Install Team A','OWN',52000,'{"Smart Locks"}',now())`,
  );
  await sql(
    `UPDATE "ProjectScope" SET "crewId"='crw_cal_roof' WHERE "projectId"='${projectId}' AND name='Roofing'`,
  );
  await sql(
    `UPDATE "ProjectScope" SET "crewId"='crw_cal_locks' WHERE "projectId"='${projectId}' AND name='Smart Locks'`,
  );

  log("the job starts out Awarded with nothing on the calendar");
  await page.goto(`${BASE}/dashboard/projects/${projectId}/schedule`);
  await page.locator("[data-testid=tab-schedule]").waitFor();
  assert.equal(
    (await sql(`SELECT stage, "startOn" FROM "Project" WHERE id=$1`, [projectId])).rows[0].stage,
    "AWARDED",
  );
  const unscheduled = await page.locator("[data-testid=scope-schedule]").allTextContents();
  assert.ok(
    unscheduled.every((text) => text.includes("Not scheduled yet")),
    "both scopes read as unscheduled",
  );

  log("booking the roofing install takes the crew on that scope, over three days");
  const roofRow = page.locator("[data-testid=scope-schedule]").filter({ hasText: "Ridgeline Roofing" });
  await roofRow.locator("[data-testid=schedule-install]").click();
  await roofRow.locator("[data-testid=install-more-days]").check();
  await roofRow.locator("[data-testid=install-start]").fill(day(2));
  await roofRow.locator("[data-testid=install-end]").fill(day(4));
  await roofRow.locator("[data-testid=install-start-time]").fill("07:00");
  await roofRow.locator("[data-testid=install-save]").click();
  await roofRow.getByText("3 days booked").waitFor();
  const booked = (
    await sql(
      `SELECT title, type, "startOn", "endOn", "startTime", "crewId", "scopeId" FROM "CalendarEvent" WHERE "organizationId"=$1`,
      [org],
    )
  ).rows[0];
  assert.equal(booked.type, "Install");
  assert.equal(booked.crewId, "crw_cal_roof", "the crew already on the scope got the day");
  assert.equal(booked.startTime, "07:00");
  assert.match(booked.title, /^Roofing — /, "named after the work, not the app");

  log("dating work flips the job from Awarded to Active and sets its start day");
  const started = (await sql(`SELECT stage, "startOn" FROM "Project" WHERE id=$1`, [projectId])).rows[0];
  assert.equal(started.stage, "ACTIVE");
  assert.equal(started.startOn.toISOString().slice(0, 10), day(2), "the start is the first day on site");

  log("booking the locks install after it does not move the start day back");
  const lockRow = page.locator("[data-testid=scope-schedule]").filter({ hasText: "Install Team A" });
  await lockRow.locator("[data-testid=schedule-install]").click();
  await lockRow.locator("[data-testid=install-start]").fill(day(5));
  await lockRow.locator("[data-testid=install-save]").click();
  await lockRow.getByText("1 day booked").waitFor();
  assert.equal(
    (await sql(`SELECT "startOn" FROM "Project" WHERE id=$1`, [projectId])).rows[0].startOn
      .toISOString()
      .slice(0, 10),
    day(2),
    "the earliest install is still the start",
  );

  log("the Schedule tab counts the days and names what is next");
  await page.reload();
  const tiles = (await page.locator("[data-testid=stat-tile]").allTextContents()).join(" | ");
  assert.match(tiles, /Install days booked/);
  assert.match(tiles, /4/, "three roofing days plus one of locks");

  log("a last day before the first one is refused");
  await roofRow.locator("[data-testid=schedule-install]").click();
  await roofRow.locator("[data-testid=install-more-days]").check();
  await roofRow.locator("[data-testid=install-start]").fill(day(10));
  await roofRow.locator("[data-testid=install-end]").fill(day(8));
  await roofRow.locator("[data-testid=install-save]").click();
  await page.getByText("The last day cannot be before the first one.").waitFor();

  log("the calendar shows both installs in the right month");
  await page.goto(`${BASE}/dashboard/calendar?on=${day(1)}`);
  await page.getByRole("heading", { name: "Calendar" }).waitFor();
  await page.getByText("November 2026").waitFor();
  for (const n of [2, 3, 4]) {
    const cell = page.locator(`[data-testid=month-day][data-day="${day(n)}"]`);
    assert.equal(await cell.getAttribute("data-count"), "1", `${day(n)} carries the three-day roofing install`);
  }
  assert.equal(
    await page.locator(`[data-testid=month-day][data-day="${day(5)}"]`).getAttribute("data-count"),
    "1",
  );
  // Days means days: the three-day roofing install is three of them, not
  // one, and the two events are counted separately.
  assert.match(
    await page.locator("[data-testid=cal-count]").textContent(),
    /4 days booked · 2 things on/,
  );
  await shot(page, "01-month");

  log("a site walk added by hand, with a time, attendees and no job behind it");
  await page.locator("[data-testid=cal-add-event]").click();
  await page.locator("[data-testid=event-title]").fill("Site walk with the property manager");
  await page.locator("[data-testid=event-type]").selectOption("Site walk");
  await page.locator("[data-testid=event-start-on]").fill(day(6));
  await page.locator("[data-testid=event-timed]").check();
  await page.locator("[data-testid=event-start-time]").fill("09:30");
  await page.locator("[data-testid=event-end-time]").fill("10:30");
  await page.locator("[data-testid=event-attendees]").getByRole("button", { name: "Priya Menon" }).click();
  await page.locator("[data-testid=event-location]").fill("1400 Harbor Blvd");
  await page.locator("[data-testid=event-save]").click();
  await page.locator(`[data-testid=month-day][data-day="${day(6)}"][data-count="1"]`).waitFor();
  const walk = (
    await sql(`SELECT id, "startTime","endTime",location,"projectId" FROM "CalendarEvent" WHERE type='Site walk' AND "organizationId"=$1`, [org])
  ).rows[0];
  assert.equal(walk.startTime, "09:30");
  assert.equal(walk.endTime, "10:30");
  assert.equal(walk.projectId, null, "a site walk needs no job behind it");
  const attending = (
    await sql(`SELECT count(*)::int AS n FROM "_EventAttendees" WHERE "A"=$1`, [walk.id])
  ).rows[0].n;
  assert.equal(attending, 1, "the property manager is expected");

  log("a finish time before the start time is refused");
  await page.locator("[data-testid=cal-add-event]").click();
  await page.locator("[data-testid=event-title]").fill("Backwards day");
  await page.locator("[data-testid=event-start-on]").fill(day(7));
  await page.locator("[data-testid=event-timed]").check();
  await page.locator("[data-testid=event-start-time]").fill("14:00");
  await page.locator("[data-testid=event-end-time]").fill("09:00");
  await page.locator("[data-testid=event-save]").click();
  await page.getByText("The finish time is before the start time.").waitFor();
  await page.locator("[data-testid=cal-add-event]").click();

  log("the workspace's own event type can be added from the form");
  await page.locator("[data-testid=cal-add-event]").click();
  await page.locator("[data-testid=event-title]").fill("Warranty check");
  await page.locator("[data-testid=event-type]").selectOption("__new__");
  await page.locator("[data-testid=event-type-new]").fill("Warranty visit");
  await page.locator("[data-testid=event-start-on]").fill(day(9));
  await page.locator("[data-testid=event-save]").click();
  await page.locator(`[data-testid=month-day][data-day="${day(9)}"][data-count="1"]`).waitFor();
  assert.equal(
    (await sql(`SELECT count(*)::int AS n FROM "EventTypeOption" WHERE "organizationId"=$1 AND name='Warranty visit'`, [org]))
      .rows[0].n,
    1,
    "the new type joined the workspace's list",
  );

  log("clicking a day opens it, with everything on it");
  await page.locator(`[data-testid=month-day][data-day="${day(6)}"]`).click();
  const panel = page.locator("[data-testid=day-panel]");
  await panel.waitFor();
  assert.match(await panel.textContent(), /Site walk with the property manager/);
  assert.match(await panel.textContent(), /9:30am – 10:30am/, "the time reads the way anyone writes it");
  assert.match(await panel.textContent(), /Priya Menon/, "and who else is expected");
  await shot(page, "02-day-panel");

  log("the crew filter keeps only that crew's days");
  await page.locator("[data-testid=cal-crew-filter]").selectOption({ label: "Install Team A" });
  await page.waitForURL(/crew=/);
  assert.equal(
    await page.locator(`[data-testid=month-day][data-day="${day(2)}"]`).getAttribute("data-count"),
    "0",
    "the roofing days belong to the other crew",
  );
  assert.equal(
    await page.locator(`[data-testid=month-day][data-day="${day(5)}"]`).getAttribute("data-count"),
    "1",
  );

  log("the type filter does the same, and Clear puts everything back");
  await page.locator("[data-testid=cal-crew-filter]").selectOption("");
  await page.locator("[data-testid=cal-type-filter]").selectOption("Site walk");
  await page.waitForURL(/type=Site/);
  assert.equal(
    await page.locator(`[data-testid=month-day][data-day="${day(2)}"]`).getAttribute("data-count"),
    "0",
  );
  await page.getByRole("button", { name: "Clear" }).click();
  await page.locator(`[data-testid=month-day][data-day="${day(2)}"][data-count="1"]`).waitFor();

  log("paging goes back a month and forward again, and Today comes home");
  await page.locator("[data-testid=cal-prev]").click();
  await page.getByText("October 2026").waitFor();
  await page.locator("[data-testid=cal-next]").click();
  await page.getByText("November 2026").waitFor();
  await page.locator("[data-testid=cal-today]").click();
  await page.waitForURL(/on=\d{4}-\d{2}-01/);

  log("the week view lists the days in full");
  await page.goto(`${BASE}/dashboard/calendar?view=week&on=${day(3)}`);
  await page.locator("[data-testid=cal-view-week][aria-selected=true]").waitFor();
  // The week of Nov 3 2026 runs Sunday Nov 1 to Saturday Nov 7.
  assert.equal(
    await page.locator(`[data-testid=week-day][data-day="${day(2)}"]`).getAttribute("data-count"),
    "1",
  );
  assert.match(
    await page.locator(`[data-testid=week-day][data-day="${day(6)}"]`).textContent(),
    /Site walk/,
  );
  await shot(page, "03-week");

  log("Copy this week into next repeats the same days a week on");
  const beforeCopy = (await sql(`SELECT count(*)::int AS n FROM "CalendarEvent" WHERE "organizationId"=$1`, [org]))
    .rows[0].n;
  await page.locator("[data-testid=cal-copy-week]").click();
  await page.getByText(/days copied into the week of/).waitFor();
  const afterCopy = (await sql(`SELECT count(*)::int AS n FROM "CalendarEvent" WHERE "organizationId"=$1`, [org]))
    .rows[0].n;
  assert.ok(afterCopy > beforeCopy, "the week was copied");
  const copied = (
    await sql(
      `SELECT "startOn","endOn","startTime","crewId" FROM "CalendarEvent"
       WHERE "organizationId"=$1 AND "startOn"=$2 AND type='Install'`,
      [org, day(9)],
    )
  ).rows[0];
  assert.ok(copied, "the three-day roofing install landed a week on");
  assert.equal(copied.endOn.toISOString().slice(0, 10), day(11), "and kept its length");
  assert.equal(copied.startTime, "07:00", "and its time");
  assert.equal(copied.crewId, "crw_cal_roof", "and its crew");

  log("an empty week has nothing to copy, and says so");
  await page.goto(`${BASE}/dashboard/calendar?view=week&on=2027-03-03`);
  await page.locator("[data-testid=cal-copy-week]").click();
  await page.getByText("There is nothing in that week to copy.").waitFor();

  log("a crew in two places at once on one day is flagged");
  await sql(
    `INSERT INTO "CalendarEvent" (id,"organizationId",title,type,"startOn","startTime","endTime","crewId","updatedAt")
     VALUES ('evt_cal_clash','${org}','Emergency leak call','Service call','${day(2)}','08:00','12:00','crw_cal_roof',now())`,
  );
  await page.goto(`${BASE}/dashboard/calendar?on=${day(1)}`);
  assert.match(
    await page.locator("[data-testid=overlap-note]").textContent(),
    /Ridgeline Roofing is in 2 places on Nov 2, 2026/,
    "the double booking is called out, with the day in plain English",
  );

  log("two days on the same date whose times do not touch are not flagged");
  await sql(`UPDATE "CalendarEvent" SET "startTime"='13:00', "endTime"='16:00' WHERE id='evt_cal_clash'`);
  await sql(
    `UPDATE "CalendarEvent" SET "endTime"='12:00' WHERE type='Install' AND "startOn"='${day(2)}' AND "organizationId"='${org}'`,
  );
  await page.reload();
  assert.equal(
    await page.locator("[data-testid=overlap-note]").count(),
    0,
    "7am to noon and 1pm to 4pm is just a day",
  );

  log("moving a day keeps its length and its crew");
  await page.goto(`${BASE}/dashboard/calendar?view=week&on=${day(3)}`);
  const walkCard = page.locator("[data-testid=event-card]").filter({ hasText: "Site walk with the property" });
  await walkCard.locator("[data-testid=event-move]").click();
  await walkCard.locator("[data-testid=event-move-date]").fill(day(7));
  await page.locator(`[data-testid=week-day][data-day="${day(7)}"][data-count="1"]`).waitFor();
  assert.equal(
    (await sql(`SELECT "startOn" FROM "CalendarEvent" WHERE id=$1`, [walk.id])).rows[0].startOn
      .toISOString()
      .slice(0, 10),
    day(7),
  );

  log("ticking a day done strikes it through, and untucking puts it back");
  const moved = page.locator("[data-testid=event-card]").filter({ hasText: "Site walk with the property" });
  await moved.locator("[data-testid=event-done]").click();
  await moved.getByText("Not done").waitFor();
  assert.ok(
    (await sql(`SELECT "doneAt" FROM "CalendarEvent" WHERE id=$1`, [walk.id])).rows[0].doneAt !== null,
  );
  await moved.locator("[data-testid=event-done]").click();
  await moved.getByText("Done", { exact: true }).waitFor();

  log("editing a day changes it in place");
  await moved.locator("[data-testid=event-edit]").click();
  await page.locator("[data-testid=event-form] [data-testid=event-title]").fill("Walk-through with Priya");
  await page.locator("[data-testid=event-form] [data-testid=event-save]").click();
  await page.getByText("Walk-through with Priya").first().waitFor();

  log("Coming up is in day order, not clock order");
  await page.goto(`${BASE}/dashboard/projects/${projectId}/schedule`);
  const order = await page.locator("[data-testid=event-card]").evaluateAll((cards) =>
    cards.map((card) => card.getAttribute("data-start")),
  );
  // A 7am day next month must never sort above a 9:30am day tomorrow, so
  // the list has to run in date order regardless of the times on it.
  assert.deepEqual(
    order,
    [...order].sort(),
    `Coming up is out of date order: ${order.join(" | ")}`,
  );
  assert.ok(order.length >= 3, "there is enough on the job for the order to mean something");

  log("deleting a day takes it off, and the job's start day follows the installs");
  const cardsBefore = await page.locator("[data-testid=event-card]").count();
  const firstInstall = page.locator("[data-testid=event-card]").filter({ hasText: "Roofing — " }).first();
  await firstInstall.locator("[data-testid=event-delete]").click();
  // "Coming up" is already on the screen, so wait for the list to
  // actually shrink rather than for a heading that never moved.
  await page
    .locator("[data-testid=event-card]")
    .nth(cardsBefore - 1)
    .waitFor({ state: "detached" });
  const afterDelete = (await sql(`SELECT "startOn" FROM "Project" WHERE id=$1`, [projectId])).rows[0];
  assert.equal(
    afterDelete.startOn.toISOString().slice(0, 10),
    day(5),
    "with the first roofing days gone, the locks day is the start",
  );

  log("a job's checklist takes a thing to do, with an optional day");
  await page.locator("[data-testid=task-title]").fill("Pull the electrical permit");
  await page.locator("[data-testid=task-with-date]").check();
  await page.locator("[data-testid=task-due]").fill(daysAgo(3));
  await page.locator("[data-testid=task-add]").click();
  await page.getByText("Pull the electrical permit").waitFor();
  await page.locator("[data-testid=task-title]").fill("Order the lift");
  await page.locator("[data-testid=task-add]").click();
  await page.getByText("Order the lift").waitFor();
  assert.equal(
    (await sql(`SELECT count(*)::int AS n FROM "ProjectTask" WHERE "projectId"=$1`, [projectId])).rows[0].n,
    2,
  );

  log("a task whose day has gone reads as overdue");
  const permit = page.locator("[data-testid=task-row]").filter({ hasText: "Pull the electrical permit" });
  assert.match(await permit.textContent(), /was due/, "a day in the past says so");

  log("ticking a task moves it into the done list; deleting one removes it");
  await permit.locator("[data-testid=task-check]").click();
  // The done ones fold away behind a summary, so open it to see them.
  await page.getByText("1 done").click();
  await page.locator("[data-testid=task-done] [data-testid=task-row]").first().waitFor();
  assert.ok(
    (
      await sql(`SELECT "doneAt" FROM "ProjectTask" WHERE title='Pull the electrical permit' AND "projectId"=$1`, [
        projectId,
      ])
    ).rows[0].doneAt !== null,
  );
  const lift = page.locator("[data-testid=task-row]").filter({ hasText: "Order the lift" });
  await lift.locator("[data-testid=task-delete]").click();
  await page.getByText("Order the lift").waitFor({ state: "detached" });
  assert.equal(
    (await sql(`SELECT count(*)::int AS n FROM "ProjectTask" WHERE "projectId"=$1`, [projectId])).rows[0].n,
    1,
  );
  await shot(page, "04-schedule");

  log("a day can be booked from the contact's own page, and reads on theirs");
  await page.goto(`${BASE}/dashboard/contacts/ctc_cal_pm`);
  await page.locator("[data-testid=upcoming-add-event]").click();
  await page.locator("[data-testid=event-title]").fill("Coffee about the next building");
  await page.locator("[data-testid=event-type]").selectOption("Project meeting");
  await page.locator("[data-testid=event-start-on]").fill(day(20));
  await page.locator("[data-testid=event-save]").click();
  await page.locator("[data-testid=upcoming-row]").filter({ hasText: "Coffee about" }).waitFor();
  const fromContact = (
    await sql(`SELECT "contactId","companyId" FROM "CalendarEvent" WHERE title='Coffee about the next building' AND "organizationId"=$1`, [org])
  ).rows[0];
  assert.equal(fromContact.contactId, "ctc_cal_pm", "the page it was booked from is who it is with");
  assert.equal(fromContact.companyId, "cmp_cal", "and their company came with them");

  log("a contact sees days they are only an attendee on");
  // The site walk was booked with nobody as its contact, but Priya is
  // expected at it, so it belongs on her page too.
  assert.match(
    await page.locator("[data-testid=upcoming-card]").textContent(),
    /Walk-through with Priya/,
    "a day she is expected at shows on her page",
  );

  log("the company's page shows the same day");
  await page.goto(`${BASE}/dashboard/companies/cmp_cal`);
  assert.match(
    await page.locator("[data-testid=upcoming-card]").textContent(),
    /Coffee about the next building/,
  );

  log("audit fixes: a refused save keeps every field that was typed");
  await page.goto(`${BASE}/dashboard/calendar?on=${day(1)}`);
  await page.locator("[data-testid=cal-add-event]").click();
  await page.locator("[data-testid=event-title]").fill("Walk with the super");
  await page.locator("[data-testid=event-start-on]").fill(day(18));
  await page.locator("[data-testid=event-notes]").fill("Gate code 4412");
  await page.locator("[data-testid=event-timed]").check();
  await page.locator("[data-testid=event-start-time]").fill("16:00");
  await page.locator("[data-testid=event-end-time]").fill("09:00");
  await page.locator("[data-testid=event-save]").click();
  await page.getByText("The finish time is before the start time.").waitFor();
  // The whole event used to be wiped along with the refusal.
  assert.equal(await page.locator("[data-testid=event-title]").inputValue(), "Walk with the super");
  assert.equal(await page.locator("[data-testid=event-start-on]").inputValue(), day(18));
  assert.equal(await page.locator("[data-testid=event-notes]").inputValue(), "Gate code 4412");
  assert.equal(await page.locator("[data-testid=event-start-time]").inputValue(), "16:00");
  // And fixing the one wrong field is enough to save it.
  await page.locator("[data-testid=event-end-time]").fill("17:00");
  await page.locator("[data-testid=event-save]").click();
  await page.locator(`[data-testid=month-day][data-day="${day(18)}"][data-count="1"]`).waitFor();

  log("audit fixes: two open new-event forms do not share DOM ids");
  await page.locator("[data-testid=cal-add-event]").click();
  await page.locator(`[data-testid=month-day][data-day="${day(20)}"]`).click();
  await page.locator("[data-testid=day-add-event]").click();
  const dupes = await page.evaluate(() => {
    const seen = new Map();
    for (const el of document.querySelectorAll("[id]")) {
      seen.set(el.id, (seen.get(el.id) ?? 0) + 1);
    }
    return [...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id);
  });
  assert.deepEqual(dupes, [], `ids are shared between the two forms: ${dupes.join(", ")}`);
  await page.goto(`${BASE}/dashboard/calendar?on=${day(1)}`);

  log("audit fixes: editing a day on a finished job keeps it on that job");
  await sql(`UPDATE "Project" SET stage='COMPLETED' WHERE id=$1`, [projectId]);
  await page.goto(`${BASE}/dashboard/projects/${projectId}/schedule`);
  const onClosed = page.locator("[data-testid=event-card]").first();
  // The exact day being edited, so the before-and-after is about it and
  // not about whichever of the job's days the database hands back first.
  const closedEventId = await onClosed.getAttribute("data-event-id");
  const before = (
    await sql(`SELECT "projectId","scopeId" FROM "CalendarEvent" WHERE id=$1`, [closedEventId])
  ).rows[0];
  await onClosed.locator("[data-testid=event-edit]").click();
  // The job is off the picker now, so it is offered back, marked.
  const jobPicked = await page
    .locator("[data-testid=event-form] [data-testid=event-project] option:checked")
    .textContent();
  assert.match(jobPicked, /finished/, `the finished job is still selected; got "${jobPicked}"`);
  await page.locator("[data-testid=event-form] [data-testid=event-notes]").fill("Warranty visit booked");
  await page.locator("[data-testid=event-form] [data-testid=event-save]").click();
  await page.getByText("Warranty visit booked").first().waitFor();
  const afterEdit = (
    await sql(`SELECT "projectId","scopeId",notes FROM "CalendarEvent" WHERE id=$1`, [closedEventId])
  ).rows[0];
  assert.equal(afterEdit.notes, "Warranty visit booked", "the edit landed on that day");
  assert.equal(afterEdit.projectId, projectId, "the day is still on the job");
  assert.equal(afterEdit.scopeId, before.scopeId, "and still on its scope");
  await sql(`UPDATE "Project" SET stage='ACTIVE' WHERE id=$1`, [projectId]);

  log("audit fixes: editing a day keeps a retired crew on it");
  await sql(`UPDATE "Crew" SET active=false WHERE id='crw_cal_roof'`);
  await page.goto(`${BASE}/dashboard/calendar?on=${day(1)}`);
  await page.locator(`[data-testid=month-day][data-day="${day(9)}"]`).click();
  const subDay = page.locator("[data-testid=event-card]").filter({ hasText: "Roofing — " }).first();
  await subDay.locator("[data-testid=event-edit]").click();
  const crewPicked = await page
    .locator("[data-testid=event-form] [data-testid=event-crew] option:checked")
    .textContent();
  assert.match(crewPicked, /retired/, `the retired crew is still selected; got "${crewPicked}"`);
  await page.locator("[data-testid=event-form] [data-testid=event-save]").click();
  await page.waitForTimeout(600);
  assert.equal(
    (
      await sql(
        `SELECT count(*)::int AS n FROM "CalendarEvent" WHERE "organizationId"=$1 AND "crewId"='crw_cal_roof'`,
        [org],
      )
    ).rows[0].n > 0,
    true,
    "the crew is still on its days",
  );
  await sql(`UPDATE "Crew" SET active=true WHERE id='crw_cal_roof'`);

  log("audit fixes: moving a day to another job recomputes the job it left");
  await sql(
    `INSERT INTO "Project" (id,"organizationId",number,name,stage,"contactId","customerName","awardedAt","updatedAt")
     VALUES ('prj_cal_other','${org}',2000,'Second building','AWARDED','ctc_cal','Harbor Property Group',now(),now())`,
  );
  await sql(
    `INSERT INTO "ProjectScope" (id,"projectId",name,"isDefault",position)
     VALUES ('scp_cal_other','prj_cal_other','Whole job',true,0)`,
  );
  const startBefore = (await sql(`SELECT "startOn" FROM "Project" WHERE id=$1`, [projectId])).rows[0].startOn;
  assert.ok(startBefore, "the first job has a start day to lose");
  // Move every install off it, and its start day must go with them.
  await sql(
    `UPDATE "CalendarEvent" SET "projectId"='prj_cal_other', "scopeId"=NULL
      WHERE "organizationId"=$1 AND "projectId"=$2 AND type='Install' AND id <> (
        SELECT id FROM "CalendarEvent" WHERE "organizationId"=$1 AND "projectId"=$2 AND type='Install'
         ORDER BY "startOn" LIMIT 1)`,
    [org, projectId],
  );
  await page.goto(`${BASE}/dashboard/projects/${projectId}/schedule`);
  const lastInstall = page.locator("[data-testid=event-card]").filter({ hasText: "Install" }).first();
  await lastInstall.locator("[data-testid=event-edit]").click();
  await page.locator("[data-testid=event-form] [data-testid=event-project]").selectOption("prj_cal_other");
  await page.locator("[data-testid=event-form] [data-testid=event-save]").click();
  for (let tries = 0; tries < 40; tries += 1) {
    const row = await sql(`SELECT "startOn" FROM "Project" WHERE id=$1`, [projectId]);
    if (row.rows[0].startOn === null) break;
    await page.waitForTimeout(250);
  }
  assert.equal(
    (await sql(`SELECT "startOn" FROM "Project" WHERE id=$1`, [projectId])).rows[0].startOn,
    null,
    "the job it left has no start day left on it",
  );
  assert.ok(
    (await sql(`SELECT "startOn" FROM "Project" WHERE id='prj_cal_other'`)).rows[0].startOn !== null,
    "and the job it moved to has one now",
  );

  log("audit fixes: Copy this week only copies what the filter is showing");
  // A week with an install and a non-install in it, filtered to installs.
  await sql(
    `INSERT INTO "CalendarEvent" (id,"organizationId",title,type,"startOn","updatedAt")
     VALUES ('evt_cal_hidden','${org}','Hidden site walk','Site walk','${day(4)}',now())`,
  );
  const countBy = async (type) =>
    (
      await sql(`SELECT count(*)::int AS n FROM "CalendarEvent" WHERE "organizationId"=$1 AND type=$2`, [
        org,
        type,
      ])
    ).rows[0].n;
  const walksBefore = await countBy("Site walk");
  const installsBefore = await countBy("Install");
  await page.goto(`${BASE}/dashboard/calendar?view=week&on=${day(4)}&type=Install`);
  await page.locator("[data-testid=cal-copy-week]").click();
  await page.getByText(/copied into the week of/).waitFor();
  assert.equal(
    await countBy("Site walk"),
    walksBefore,
    "the site walk the filter was hiding got no copy",
  );
  assert.ok(await countBy("Install") > installsBefore, "and the installs on screen did");

  log("audit fixes: a day that does not exist in the URL still renders the calendar");
  for (const bad of ["2026-13-01", "2026-00-15", "2026-02-30", "not-a-date"]) {
    const response = await page.goto(`${BASE}/dashboard/calendar?on=${bad}`);
    assert.equal(response.status(), 200, `?on=${bad} should fall back to today, not 500`);
    await page.getByRole("heading", { name: "Calendar" }).waitFor();
  }

  log("audit fixes: booking a second install on a scope confirms and closes the form");
  await page.goto(`${BASE}/dashboard/projects/${projectId}/schedule`);
  const anyScope = page.locator("[data-testid=scope-schedule]").first();
  for (const on of [day(24), day(25)]) {
    await anyScope.locator("[data-testid=schedule-install]").click();
    await anyScope.locator("[data-testid=install-start]").fill(on);
    await anyScope.locator("[data-testid=install-save]").click();
    // Closing is the signal the booking took; it used to stay open on the
    // second one, with the date reset and no confirmation.
    await anyScope.locator("[data-testid=schedule-install]").waitFor();
  }
  assert.match(
    await anyScope.textContent(),
    /Install booked/,
    "and it says so where the button is",
  );

  log("cross-tenant: another workspace's event is not on this calendar");
  await sql(
    `INSERT INTO "Organization" (id,name,slug,status,"updatedAt")
     VALUES ('org_cal_other','Other Cal Co','test-calendar-co-other','ACTIVE',now())`,
  );
  await sql(
    `INSERT INTO "CalendarEvent" (id,"organizationId",title,type,"startOn","updatedAt")
     VALUES ('evt_cal_other','org_cal_other','Somebody elses install','Install','${day(3)}',now())`,
  );
  await page.goto(`${BASE}/dashboard/calendar?on=${day(1)}`);
  assert.equal(
    await page.getByText("Somebody elses install").count(),
    0,
    "another workspace's day never shows",
  );

  log("the calendar and a job's schedule fit a phone screen");
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const small = await phone.newPage();
  await small.goto(`${BASE}/login`);
  await small.fill("#email", EMAIL);
  await small.fill("#password", PASSWORD);
  await small.click("button[type=submit]");
  await small.waitForURL(/\/dashboard$/);
  for (const [url, name] of [
    [`${BASE}/dashboard/calendar?on=${day(1)}`, "05-phone-month"],
    [`${BASE}/dashboard/calendar?view=week&on=${day(3)}`, "06-phone-week"],
    [`${BASE}/dashboard/projects/${projectId}/schedule`, "07-phone-schedule"],
  ]) {
    await small.goto(url);
    await small.locator("h1").first().waitFor();
    const overflow = await small.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    assert.ok(overflow <= 1, `${name} overflows by ${overflow}px`);
    await shot(small, name);
  }
  await phone.close();

  await sql(`DELETE FROM "Organization" WHERE id='org_cal_other'`);
  await browser.close();
  console.log(`\nALL ${step} STEPS PASSED · screenshots in ${OUT}`);
  process.exit(0);
})().catch(async (error) => {
  console.error(`\nFAILED at step ${step} \n`, error);
  process.exit(1);
});
