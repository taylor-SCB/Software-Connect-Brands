/* Browser regression for "follow up after a logged activity" and the
 * Status filter on the Contacts and Companies lists (Oct 4, 2026).
 *
 * Covers: the Status dropdown on Contacts and Companies with the ladder's
 * labels in ladder order, stacking two statuses, its chips, Clear all, a
 * pasted bad value being ignored, and the Interested sub-pane hiding it;
 * then the "Want to set a follow-up?" box that opens under Log activity
 * once a call is logged — nothing ticked means nothing to add, each tick
 * gets its own day (default three days on) and optional time, two ticks
 * make two open calendar entries with the same people under whoever
 * logged it, they show on the contact's Coming up and the calendar's
 * Upcoming log, "No thanks" writes nothing, the box opens again for the
 * next call, a Meeting follow-up sets Meeting Set, a day before today is
 * refused, scheduling a call ahead opens no box, and a company-page log
 * (with and without people ticked) gets the same box.
 *
 * Runs against a built app (`bash scripts/dev-serve.sh`) and a local
 * Postgres that has had `prisma migrate deploy` run against it. It signs
 * up its own workspace and deletes it again on the next run. Never point
 * it at the live database.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/scb_test \
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules \
 *   node scripts/browser-tests/follow-ups-status-filter.cjs
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
const OUT = process.env.SHOTS_DIR || path.join(os.tmpdir(), "scb-browser-shots-follow-ups");
fs.mkdirSync(OUT, { recursive: true });

const EMAIL = "test-followups@example.com";
const PASSWORD = "password123";
const COMPANY = "Test Follow Ups Co";
const SLUG_LIKE = "test-follow-ups-co%";

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

// Days in the workspace's own zone (the default, America/Chicago), which
// is the clock the calendar keeps.
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

const LADDER = [
  "Not Actioned",
  "Contacted",
  "Not Interested",
  "Interested",
  "Meeting Set",
  "Meeting Completed",
  "Quote Sent",
  "Contract Sent",
  "Signed / Won",
  "Lost",
  "Archived",
];

// Every follow-up the box has written for this workspace, oldest day first.
async function followUps(org) {
  return (
    await sql(
      `SELECT e.id, e.type, e.title, e.notes, e."startOn", e."startTime", e."doneAt", e.auto, e."ownerId", e."contactId", e."companyId",
              (SELECT array_agg(a."B" ORDER BY a."B") FROM "_EventAttendees" a WHERE a."A"=e.id) AS attendees
       FROM "CalendarEvent" e WHERE e."organizationId"=$1 AND e.title LIKE 'Follow up ·%' ORDER BY e."startOn", e.type`,
      [org],
    )
  ).rows;
}

(async () => {
  await sql(`DELETE FROM "Organization" WHERE slug LIKE $1`, [SLUG_LIKE]);

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
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
  await sql(`UPDATE "Organization" SET status='ACTIVE', "reviewedAt"=now() WHERE slug LIKE $1`, [SLUG_LIKE]);
  await login(page, EMAIL);
  const org = (await sql(`SELECT id FROM "Organization" WHERE slug LIKE $1`, [SLUG_LIKE])).rows[0].id;
  const taylor = (await sql(`SELECT id FROM "User" WHERE email = $1`, [EMAIL])).rows[0].id;

  // Three companies and four people spread along the ladder.
  await sql(
    `INSERT INTO "Company" (id,"organizationId",name,status,"updatedAt") VALUES
       ('cmp_fu_harbor',$1,'Harbor Dental','INTERESTED',now()),
       ('cmp_fu_pine',$1,'Pine Roofing','MEETING_SET',now()),
       ('cmp_fu_oak',$1,'Oak Legal','NOT_ACTIONED',now())`,
    [org],
  );
  await sql(
    `INSERT INTO "Contact" (id,"organizationId",name,status,"companyId","updatedAt") VALUES
       ('ctc_fu_dana',$1,'Dana Ruiz','NOT_ACTIONED','cmp_fu_harbor',now()),
       ('ctc_fu_eli',$1,'Eli Park','INTERESTED','cmp_fu_harbor',now()),
       ('ctc_fu_faye',$1,'Faye Chen','MEETING_SET','cmp_fu_pine',now()),
       ('ctc_fu_gus',$1,'Gus Hale','QUOTE_SENT',NULL,now())`,
    [org],
  );

  /* ------------------------------ Status filter ------------------------------ */

  const statusList = page.locator('[role=listbox][aria-label="Status"]');
  const statusOption = (label) => statusList.locator("label").filter({ has: page.locator("span", { hasText: new RegExp(`^${label.replace("/", "\\/")}$`) }) });
  const rowNames = async (testId) =>
    (await page.locator(`[data-testid=${testId}] td:nth-child(4) a.link, [data-testid=${testId}] td.font-medium a`).allTextContents()).map((t) => t.trim());

  log("Contacts: the Status dropdown lists the ladder in its own order");
  await page.goto(`${BASE}/dashboard/contacts`);
  assert.equal(await page.locator("[data-testid=contact-row]").count(), 4);
  await page.getByTestId("filter-status").click();
  await statusList.waitFor();
  assert.deepEqual((await statusList.locator("label span").allTextContents()).map((t) => t.trim()), LADDER);
  await shot(page, "01-status-dropdown");

  log("tick Interested: one person; tick Meeting Set too: two, with a chip each");
  await statusOption("Interested").click();
  await page.waitForURL(/status=INTERESTED/);
  await until(async () => (await page.locator("[data-testid=contact-row]").count()) === 1, "one interested contact");
  assert.deepEqual(await page.locator("[data-testid=contact-row] td:nth-child(4) a").allTextContents(), ["Eli Park"]);
  await statusOption("Meeting Set").click();
  await page.waitForURL(/status=INTERESTED&status=MEETING_SET/);
  await until(async () => (await page.locator("[data-testid=contact-row]").count()) === 2, "two contacts");
  const twoNames = (await page.locator("[data-testid=contact-row] td:nth-child(4) a").allTextContents()).sort();
  assert.deepEqual(twoNames, ["Eli Park", "Faye Chen"]);
  const chips = page.locator("[data-testid=active-filters]");
  assert.match(await chips.textContent(), /Status: Interested/);
  assert.match(await chips.textContent(), /Status: Meeting Set/);
  assert.match(await page.getByTestId("filter-status").textContent(), /2/, "the button counts two");
  await shot(page, "02-status-two-ticked");

  log("it stacks with the search box, and Clear all takes it off");
  await page.keyboard.press("Escape");
  await page.fill("input[name=q]", "Faye");
  await page.press("input[name=q]", "Enter");
  await page.waitForURL(/q=Faye.*status=|status=.*q=Faye/);
  await until(async () => (await page.locator("[data-testid=contact-row]").count()) === 1, "Faye only");
  await page.getByRole("button", { name: "Clear all" }).click();
  await page.waitForURL(/\/dashboard\/contacts$/);
  await until(async () => (await page.locator("[data-testid=contact-row]").count()) === 4, "all four back");

  log("a pasted status that is not on the ladder is ignored, not a crash");
  await page.goto(`${BASE}/dashboard/contacts?status=BOGUS&status=LOST`);
  await until(async () => (await page.locator("[data-testid=contact-row], [data-testid=contact-row], .card").count()) > 0, "list drew");
  assert.equal(await page.locator("[data-testid=contact-row]").count(), 0, "Lost matches nobody; BOGUS is dropped");
  assert.doesNotMatch((await page.locator("[data-testid=active-filters]").textContent()) ?? "", /BOGUS/);
  assert.match(await page.locator("[data-testid=active-filters]").textContent(), /Status: Lost/);

  log("Companies: the same dropdown; Meeting Set is Pine Roofing alone");
  await page.goto(`${BASE}/dashboard/companies`);
  assert.equal(await page.locator("[data-testid=company-row]").count(), 3);
  await page.getByTestId("filter-status").click();
  await statusList.waitFor();
  await statusOption("Meeting Set").click();
  await page.waitForURL(/status=MEETING_SET/);
  await until(async () => (await page.locator("[data-testid=company-row]").count()) === 1, "one company");
  assert.match(await page.locator("[data-testid=company-row]").first().textContent(), /Pine Roofing/);
  await shot(page, "03-companies-status");

  log("the Interested sub-panes hold the status already and hide the dropdown");
  await page.goto(`${BASE}/dashboard/contacts/interested`);
  await page.locator("[data-testid=contact-row]").first().waitFor();
  assert.equal(await page.getByTestId("filter-status").count(), 0, "no Status dropdown on Interested Contacts");
  await page.goto(`${BASE}/dashboard/companies/interested`);
  await page.locator("[data-testid=company-row]").first().waitFor();
  assert.equal(await page.getByTestId("filter-status").count(), 0, "nor on Interested Companies");
  void rowNames;

  /* -------------------------------- Follow-ups -------------------------------- */

  const form = page.locator("[data-testid=log-activity-form]");
  const box = page.locator("[data-testid=follow-up-prompt]");

  log("logging a call opens 'Want to set a follow-up?' with nothing ticked and nothing to add yet");
  await page.goto(`${BASE}/dashboard/contacts/ctc_fu_dana`);
  await form.locator("textarea[name=body]").fill("Left a voicemail about the kitchen quote");
  await form.locator("[data-testid=activity-submit]").click();
  await box.waitFor();
  assert.match(await box.textContent(), /Want to set a follow-up with Dana Ruiz\?/);
  assert.equal(await box.locator("[data-testid=follow-up-rows]").count(), 0, "no rows until something is ticked");
  assert.ok(await box.locator("[data-testid=follow-up-save]").isDisabled(), "nothing ticked, nothing to add");
  assert.equal(await status("Contact", "ctc_fu_dana"), "CONTACTED", "the call itself still moves her to Contacted");
  await shot(page, "04-follow-up-box");

  log("tick Phone Call: a row three days on; tick Email too and give it its own day and time");
  await box.locator("[data-testid=follow-up-type-PHONE_CALL]").click();
  assert.equal(await box.locator("[data-testid=follow-up-on-PHONE_CALL]").inputValue(), daysOn(3), "defaults to three days on");
  assert.equal(await box.locator("[data-testid=follow-up-on-PHONE_CALL]").getAttribute("min"), TODAY, "cannot be dated before today");
  await box.locator("[data-testid=follow-up-type-EMAIL]").click();
  await box.locator("[data-testid=follow-up-on-EMAIL]").fill(daysOn(7));
  await box.locator("[data-testid=follow-up-time-EMAIL]").fill("09:30");
  assert.match(await box.locator("[data-testid=follow-up-save]").textContent(), /Add 2 to the calendar/);
  await shot(page, "05-two-follow-ups-picked");
  await box.locator("[data-testid=follow-up-save]").click();
  await box.waitFor({ state: "detached" });
  await page.locator("[data-testid=follow-up-notice]").waitFor();
  assert.match(await page.locator("[data-testid=follow-up-notice]").textContent(), /2 follow-ups on the calendar/);

  log("two open entries: Call and Email, on their days, with Dana and her company, under Taylor, not auto");
  const two = await followUps(org);
  assert.equal(two.length, 2);
  assert.deepEqual(
    two.map((row) => [row.type, isoOf(row.startOn), row.startTime]),
    [
      ["Call", daysOn(3), null],
      ["Email", daysOn(7), "09:30"],
    ],
  );
  for (const row of two) {
    assert.equal(row.title, "Follow up · Dana Ruiz");
    assert.equal(row.doneAt, null, "open, not ticked");
    assert.equal(row.auto, false, "typed by a person, so never swept by the app");
    assert.equal(row.ownerId, taylor);
    assert.equal(row.contactId, "ctc_fu_dana");
    assert.equal(row.companyId, "cmp_fu_harbor");
    assert.match(row.notes, /^Follow up on the phone call logged .*: Left a voicemail about the kitchen quote$/);
  }
  assert.equal((await sql(`SELECT count(*)::int n FROM "Activity" WHERE "organizationId"=$1`, [org])).rows[0].n, 1, "a follow-up is not history");

  log("they show on Dana's Coming up card and on the calendar's Upcoming log");
  await page.reload();
  const upcoming = page.locator("[data-testid=upcoming-card]");
  await upcoming.locator("[data-testid=upcoming-row]", { hasText: "Follow up · Dana Ruiz" }).first().waitFor();
  assert.equal(await upcoming.locator("[data-testid=upcoming-row]", { hasText: "Follow up · Dana Ruiz" }).count(), 2);
  await page.goto(`${BASE}/dashboard/calendar?layout=log`);
  const logUpcoming = page.locator("[data-testid=log-upcoming]");
  await logUpcoming.waitFor();
  assert.equal(await logUpcoming.locator("[data-testid=log-row]", { hasText: "Follow up · Dana Ruiz" }).count(), 2);
  await shot(page, "06-upcoming-log");

  log("the box opens again for the next touch; No thanks writes nothing");
  await page.goto(`${BASE}/dashboard/contacts/ctc_fu_dana`);
  await form.getByRole("button", { name: "Text", exact: true }).click();
  await form.locator("textarea[name=body]").fill("Texted the revised numbers");
  await form.locator("[data-testid=activity-submit]").click();
  await box.waitFor();
  await box.locator("[data-testid=follow-up-type-MEETING]").click();
  await box.locator("[data-testid=follow-up-skip]").click();
  await box.waitFor({ state: "detached" });
  assert.equal(await page.locator("[data-testid=follow-up-notice]").count(), 0, "nothing to say when nothing was added");
  assert.equal((await followUps(org)).length, 2, "still the two from before");
  assert.equal(await status("Contact", "ctc_fu_dana"), "CONTACTED", "a Meeting ticked then skipped sets nothing");

  log("a Meeting follow-up is a meeting booked: Eli goes to Meeting Set");
  await page.goto(`${BASE}/dashboard/contacts/ctc_fu_eli`);
  await form.getByRole("button", { name: "Email", exact: true }).click();
  await form.locator("textarea[name=body]").fill("Sent the brochure");
  await form.locator("[data-testid=activity-submit]").click();
  await box.waitFor();
  await box.locator("[data-testid=follow-up-type-MEETING]").click();
  await box.locator("[data-testid=follow-up-on-MEETING]").fill(daysOn(5));
  await box.locator("[data-testid=follow-up-save]").click();
  await box.waitFor({ state: "detached" });
  assert.match(await page.locator("[data-testid=follow-up-notice]").textContent(), /Meeting follow-up on the calendar for/);
  await until(async () => (await status("Contact", "ctc_fu_eli")) === "MEETING_SET", "Eli meeting set");
  const eli = (await followUps(org)).filter((row) => row.contactId === "ctc_fu_eli");
  assert.deepEqual(eli.map((row) => [row.type, isoOf(row.startOn), row.title]), [["Meeting", daysOn(5), "Follow up · Eli Park"]]);

  log("a day before today is refused, and the box stays open to fix it");
  await page.goto(`${BASE}/dashboard/contacts/ctc_fu_dana`);
  await form.locator("textarea[name=body]").fill("Quick check-in");
  await form.locator("[data-testid=activity-submit]").click();
  await box.waitFor();
  await box.locator("[data-testid=follow-up-type-PHONE_CALL]").click();
  await box.locator("[data-testid=follow-up-on-PHONE_CALL]").fill(daysAgo(2));
  await box.locator("[data-testid=follow-up-save]").click();
  await box.getByRole("alert").waitFor();
  assert.match(await box.getByRole("alert").textContent(), /today or later/);
  assert.equal((await followUps(org)).length, 3, "nothing written");
  await shot(page, "07-refused-past-day");
  await box.locator("[data-testid=follow-up-on-PHONE_CALL]").fill(TODAY);
  await box.locator("[data-testid=follow-up-save]").click();
  await box.waitFor({ state: "detached" });
  assert.equal((await followUps(org)).length, 4, "today itself is fine");

  log("scheduling a call ahead opens no box — it is already the thing to do");
  await form.locator("textarea[name=body]").fill("Call back next week");
  await form.locator("[data-testid=activity-when]").fill(daysOn(6));
  await form.locator("[data-testid=activity-submit]").click();
  await form.getByText(/Scheduled for/).waitFor();
  assert.equal(await box.count(), 0, "no follow-up box after scheduling");

  log("a company-page log gets the same box, with the company as who it is with");
  await page.goto(`${BASE}/dashboard/companies/cmp_fu_oak`);
  await form.locator("textarea[name=body]").fill("Spoke to reception");
  await form.locator("[data-testid=activity-submit]").click();
  await box.waitFor();
  assert.match(await box.textContent(), /Want to set a follow-up with Oak Legal\?/);
  await box.locator("[data-testid=follow-up-type-TEXT]").click();
  await box.locator("[data-testid=follow-up-save]").click();
  await box.waitFor({ state: "detached" });
  const oak = (await followUps(org)).filter((row) => row.companyId === "cmp_fu_oak");
  assert.deepEqual(oak.map((row) => [row.type, row.title, row.contactId]), [["Text", "Follow up · Oak Legal", null]]);
  await shot(page, "08-company-follow-up");

  log("with people ticked on the company page, the follow-up is with the first and the rest are expected");
  await page.goto(`${BASE}/dashboard/companies/cmp_fu_harbor`);
  const picker = form.locator("[data-testid=company-people-picker]");
  await picker.locator("[data-testid=company-person-chip]", { hasText: "Dana Ruiz" }).click();
  await picker.locator("[data-testid=company-person-chip]", { hasText: "Eli Park" }).click();
  await form.locator("textarea[name=body]").fill("Lunch with Dana and Eli");
  await form.getByRole("button", { name: "Meeting", exact: true }).click();
  await form.locator("[data-testid=activity-submit]").click();
  await box.waitFor();
  assert.match(await box.textContent(), /Want to set a follow-up with (Dana Ruiz|Eli Park)\?/);
  await box.locator("[data-testid=follow-up-type-EMAIL]").click();
  await box.locator("[data-testid=follow-up-save]").click();
  await box.waitFor({ state: "detached" });
  const lunch = (await followUps(org)).filter((row) => row.notes.includes("Lunch with Dana and Eli"));
  assert.equal(lunch.length, 1);
  assert.ok(["ctc_fu_dana", "ctc_fu_eli"].includes(lunch[0].contactId), "with one of the two");
  assert.deepEqual(lunch[0].attendees, [lunch[0].contactId === "ctc_fu_dana" ? "ctc_fu_eli" : "ctc_fu_dana"], "the other is expected");
  assert.equal(lunch[0].companyId, "cmp_fu_harbor");

  await browser.close();
  console.log(`\nAll ${step} steps passed. Screenshots in ${OUT}`);
  process.exit(0);
})().catch((err) => {
  console.error("\nFAILED at step", step, "\n", err);
  process.exit(1);
});
