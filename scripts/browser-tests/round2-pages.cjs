/* Browser regression for the contact and company pages, BDR sprint round 2
 * (Nov 11, 2026): the approved-plan items left on those two pages.
 *
 *  1. Edit on your own history lines (updateActivity): body, outcome and
 *     when; every copy of a batch and its calendar copy; Saved · Undo puts
 *     it back; a Member sees Edit on their own lines only; a future day is
 *     refused.
 *  2. Coming up rows each get Held / No-show / Move (a Pipeline meeting, a
 *     meeting only on the calendar, anything else Move only).
 *  3. On a phone, the header meter's seven steps and their dates open in a
 *     bottom sheet.
 *  4. Picking Meeting Set by hand offers "Book it" first (the shared Book
 *     meeting sheet), and "Just set the status" still works.
 *  5. "+ Event" from a lead's page lists the sales types first and starts
 *     on Call (not reached yet) or Meeting.
 *  6. On a phone, the company page's Add person is a bottom sheet.
 *  7. The contact page shows one toast at a time: the log sheet's, the
 *     Book sheet's and the page's share one slot.
 *  8. The company page's Book and Reschedule offer the person's own tile
 *     (the no-show's, else their open one).
 *
 * Seeds its own workspace with SQL. Runs against a built app and a local
 * Postgres that has had `prisma migrate deploy`; never the live database.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/scb_test \
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules \
 *   BASE=http://localhost:3000 node scripts/browser-tests/round2-pages.cjs
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
const OUT = process.env.SHOTS_DIR || path.join(os.tmpdir(), "scb-browser-shots-round2-pages");
fs.mkdirSync(OUT, { recursive: true });

const EMAIL = "test-round2-pages@example.com";
const MEMBER_EMAIL = "test-round2-pages-member@example.com";
const PASSWORD = "password123";
const COMPANY = "Test Round Two Pages Co";
const SLUG_LIKE = "test-round-two-pages-co%";
const ZONE = "America/Chicago";

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
const one = async (text, params) => (await sql(text, params)).rows[0];
async function login(page, email) {
  await page.goto(`${BASE}/login`);
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/dashboard$/);
}
async function until(fn, what) {
  for (let i = 0; i < 80; i += 1) {
    if (await fn()) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`timed out waiting for ${what}`);
}
function dayInZone(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
function shift(iso, days) {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
const TODAY = dayInZone(new Date());
const status = async (table, id) => (await one(`SELECT status FROM "${table}" WHERE id=$1`, [id])).status;
const daysAgo = (n, hour = 10) => `((date_trunc('day', now() AT TIME ZONE '${ZONE}') - interval '${n} days' + interval '${hour} hours') AT TIME ZONE '${ZONE}')`;
const at = (days, time) => `((($1::date + ${days}) + time '${time}') AT TIME ZONE '${ZONE}')`;

(async () => {
  await sql(`DELETE FROM "Organization" WHERE slug LIKE $1`, [SLUG_LIKE]);
  await sql(`DELETE FROM "User" WHERE email=$1`, [MEMBER_EMAIL]);

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await context.newPage();
  page.on("pageerror", (err) => console.error("PAGE ERROR:", err.message));

  log("Sprint: signup + activate + login; seed a company, leads, a teammate, meetings and history");
  await page.goto(`${BASE}/signup`);
  await page.fill("[name=companyName]", COMPANY);
  await page.fill("[name=name]", "Taylor Test");
  await page.fill("[name=email]", EMAIL);
  await page.fill("[name=phone]", "5550000000");
  await page.fill("[name=password]", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/signup\/submitted/);
  await sql(`UPDATE "Organization" SET status='ACTIVE', "reviewedAt"=now(), "timeZone"=$2 WHERE slug LIKE $1`, [SLUG_LIKE, ZONE]);
  await login(page, EMAIL);
  const org = (await one(`SELECT id FROM "Organization" WHERE slug LIKE $1`, [SLUG_LIKE])).id;
  const owner = await one(`SELECT id, "passwordHash" FROM "User" WHERE email=$1`, [EMAIL]);
  const me = owner.id;
  await sql(`INSERT INTO "User" (id,name,email,"passwordHash",role,"organizationId") VALUES ('usr_r2_mem','Mia Member',$1,$2,'MEMBER',$3)`, [
    MEMBER_EMAIL,
    owner.passwordHash,
    org,
  ]);

  await sql(
    `INSERT INTO "Company" (id,"organizationId",name,city,state,industries,phone,status,"updatedAt") VALUES
       ('cmp_r2_iron',$1,'Ironwood Builders','Austin','TX','{Construction}','512-555-0200','MEETING_SET',now())`,
    [org],
  );
  await sql(
    `INSERT INTO "Contact" (id,"organizationId","companyId",name,title,mobile,status,"updatedAt") VALUES
       ('ctc_r2_kris',$1,'cmp_r2_iron','Kris Vale','Preconstruction',  '512-555-0201','MEETING_SET',now()),
       ('ctc_r2_lee', $1,'cmp_r2_iron','Lee Fresh','Estimator',        '512-555-0202','NOT_ACTIONED',now()),
       ('ctc_r2_gus', $1,'cmp_r2_iron','Gus Noshow','Owner',           '512-555-0203','MEETING_SET',now()),
       ('ctc_r2_ann', $1,'cmp_r2_iron','Ann Open','Office Manager',     '512-555-0204','MEETING_SET',now())`,
    [org],
  );
  // Kris: a Pipeline meeting tomorrow 10:00 (with its calendar entry), a
  // meeting only on the calendar in three days, a site walk in five.
  await sql(
    `INSERT INTO "Opportunity" (id,"organizationId",title,stage,"ownerId","updatedAt") VALUES
       ('opp_r2_kris',$1,'Kris Vale','MEETING_SET',$2,now()),
       ('opp_r2_gus', $1,'Gus Noshow','MEETING_SET',$2,now() - interval '2 days'),
       ('opp_r2_ann', $1,'Ann Open','MEETING_SET',$2,now() - interval '1 day')`,
    [org, me],
  );
  await sql(
    `INSERT INTO "OpportunityContact" (id,"opportunityId","contactId",role,"fromMeeting") VALUES
       ('oc_r2_kris','opp_r2_kris','ctc_r2_kris','PRIMARY',true),
       ('oc_r2_gus','opp_r2_gus','ctc_r2_gus','PRIMARY',true),
       ('oc_r2_ann','opp_r2_ann','ctc_r2_ann','PRIMARY',true)`,
  );
  await sql(
    `INSERT INTO "CalendarEvent" (id,"organizationId","ownerId",type,title,"startOn","startTime","contactId","companyId","updatedAt") VALUES
       ('ev_r2_k1',$2,$3,'Meeting','Meeting · Kris Vale',$1::date + 1,'10:00','ctc_r2_kris','cmp_r2_iron',now()),
       ('ev_r2_k2',$2,$3,'Meeting','Second look · Kris Vale',$1::date + 3,'14:00','ctc_r2_kris','cmp_r2_iron',now()),
       ('ev_r2_k3',$2,$3,'Site walk','Site walk · Kris Vale',$1::date + 5,NULL,'ctc_r2_kris','cmp_r2_iron',now()),
       ('ev_r2_a1',$2,$3,'Meeting','Meeting · Ann Open',$1::date + 2,'09:00','ctc_r2_ann','cmp_r2_iron',now())`,
    [TODAY, org, me],
  );
  await sql(
    `INSERT INTO "OpportunityMeeting" (id,"opportunityId","on","eventId","bookedById","outcome") VALUES
       ('om_r2_k1','opp_r2_kris',${at(1, "10:00")},'ev_r2_k1',$2,NULL),
       ('om_r2_g1','opp_r2_gus', ${at(-2, "10:00")},NULL,$2,'NO_SHOW'),
       ('om_r2_a1','opp_r2_ann', ${at(2, "09:00")},'ev_r2_a1',$2,NULL)`,
    [TODAY, me],
  );
  // History on Kris: my call yesterday logged on Kris and Ann at once (one
  // batch, with its calendar copy), and the Member's text two days ago.
  await sql(
    `INSERT INTO "Activity" (id,"organizationId","contactId","userId",type,body,outcome,"occurredAt","batchId") VALUES
       ('act_r2_k1',$1,'ctc_r2_kris',$2,'PHONE_CALL','Talked about the Lakeside bid','TALKED',${daysAgo(1, 15)},'batch_r2_one'),
       ('act_r2_a1',$1,'ctc_r2_ann', $2,'PHONE_CALL','Talked about the Lakeside bid','TALKED',${daysAgo(1, 15)},'batch_r2_one'),
       ('act_r2_m1',$1,'ctc_r2_kris','usr_r2_mem','TEXT','Sent the brochure','SENT',${daysAgo(2)},'batch_r2_mem')`,
    [org, me],
  );
  await sql(
    `INSERT INTO "CalendarEvent" (id,"organizationId","ownerId",type,title,"startOn","startTime","contactId","activityId",auto,"doneAt",notes,"batchId","updatedAt")
     VALUES ('ev_r2_copy',$1,$2,'Call','Call · Kris Vale',(${daysAgo(1, 15)} AT TIME ZONE '${ZONE}')::date,'15:00','ctc_r2_kris','act_r2_k1',true,${daysAgo(1, 15)},'Talked about the Lakeside bid','batch_r2_one',now())`,
    [org, me],
  );
  const krisUrl = `${BASE}/dashboard/contacts/ctc_r2_kris`;

  log("Sprint: Edit on your own history line: body, outcome and when, on every copy of the batch and its calendar copy");
  await page.goto(krisUrl);
  const history = page.locator("[data-testid=history]");
  const myLine = history.locator("[data-testid=activity-line]", { hasText: "Lakeside bid" });
  const memberLine = history.locator("[data-testid=activity-line]", { hasText: "Sent the brochure" });
  await myLine.waitFor();
  assert.equal(await memberLine.locator("[data-testid=activity-edit]").count(), 1, "an Owner can edit a teammate's line, as Delete allows");
  await myLine.locator("[data-testid=activity-edit]").click();
  const edit = myLine.locator("[data-testid=activity-edit-form]");
  await edit.waitFor();
  assert.equal(await edit.locator("[data-testid=activity-edit-body]").inputValue(), "Talked about the Lakeside bid");
  assert.equal(await edit.locator("[data-testid=activity-edit-outcome]").inputValue(), "TALKED");
  assert.equal(await edit.locator("[data-testid=activity-edit-on]").inputValue(), shift(TODAY, -1));
  assert.equal(await edit.locator("[data-testid=activity-edit-time]").inputValue(), "15:00");
  const outcomes = await edit.locator("[data-testid=activity-edit-outcome] option").evaluateAll((els) => els.map((el) => el.value));
  assert.deepEqual(outcomes, ["", "NO_ANSWER", "VOICEMAIL", "GATEKEEPER", "BAD_NUMBER", "TALKED"], "a call's outcomes, and Not recorded");
  // A day ahead is refused in words.
  await edit.locator("[data-testid=activity-edit-on]").fill(shift(TODAY, 2));
  await edit.locator("[data-testid=activity-edit-save]").click();
  await edit.getByText(/has happened/).waitFor();
  await edit.locator("[data-testid=activity-edit-on]").fill(shift(TODAY, -3));
  await edit.locator("[data-testid=activity-edit-time]").fill("09:30");
  await edit.locator("[data-testid=activity-edit-outcome]").selectOption("VOICEMAIL");
  await edit.locator("[data-testid=activity-edit-body]").fill("Left a voicemail about the Lakeside bid");
  await edit.locator("[data-testid=activity-edit-save]").click();
  const edited = history.locator("[data-testid=activity-line]", { hasText: "Left a voicemail about the Lakeside bid" });
  await edited.waitFor();
  await edited.locator("[data-testid=activity-edit-saved]").getByText("Saved on all 2 people").waitFor();
  const rows = (
    await sql(
      `SELECT id, body, outcome, to_char(("occurredAt" AT TIME ZONE 'UTC') AT TIME ZONE '${ZONE}','YYYY-MM-DD HH24:MI') AS at FROM "Activity" WHERE "batchId"='batch_r2_one' ORDER BY id`,
    )
  ).rows.map((row) => ({ ...row }));
  const want = { body: "Left a voicemail about the Lakeside bid", outcome: "VOICEMAIL", at: `${shift(TODAY, -3)} 09:30` };
  assert.deepEqual(rows, [{ id: "act_r2_a1", ...want }, { id: "act_r2_k1", ...want }], "both copies of the batch changed");
  const copy = await one(`SELECT to_char("startOn",'YYYY-MM-DD') AS day, "startTime" AS time, notes FROM "CalendarEvent" WHERE id='ev_r2_copy'`);
  assert.deepEqual({ ...copy }, { day: shift(TODAY, -3), time: "09:30", notes: want.body }, "its calendar copy follows");
  assert.equal(await edited.getAttribute("data-connect"), "0", "a voicemail now reads as an attempt");
  await shot(page, "01-edit-saved");

  log("Sprint: Saved · Undo on an edit puts the words, outcome and time back");
  await edited.locator("[data-testid=activity-edit-undo]").click();
  await history.locator("[data-testid=activity-line]", { hasText: "Talked about the Lakeside bid" }).waitFor();
  const back = await one(
    `SELECT body, outcome, to_char(("occurredAt" AT TIME ZONE 'UTC') AT TIME ZONE '${ZONE}','YYYY-MM-DD HH24:MI') AS at FROM "Activity" WHERE id='act_r2_a1'`,
  );
  assert.deepEqual({ ...back }, { body: "Talked about the Lakeside bid", outcome: "TALKED", at: `${shift(TODAY, -1)} 15:00` });
  assert.equal(await sql(`SELECT 1 FROM "Activity" WHERE "batchId"='batch_r2_one'`).then((r) => r.rowCount), 2, "Undo of an edit never deletes the line");

  log("Sprint: a Member sees Edit on their own line only, and their edit saves");
  const memberContext = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const memberPage = await memberContext.newPage();
  await login(memberPage, MEMBER_EMAIL);
  await memberPage.goto(krisUrl);
  const memberHistory = memberPage.locator("[data-testid=history]");
  await memberHistory.locator("[data-testid=activity-line]", { hasText: "Lakeside bid" }).waitFor();
  assert.equal(
    await memberHistory.locator("[data-testid=activity-line]", { hasText: "Lakeside bid" }).locator("[data-testid=activity-edit]").count(),
    0,
    "no Edit on the Owner's line",
  );
  const ownText = memberHistory.locator("[data-testid=activity-line]", { hasText: "Sent the brochure" });
  await ownText.locator("[data-testid=activity-edit]").click();
  await ownText.locator("[data-testid=activity-edit-outcome]").selectOption("REPLIED");
  await ownText.locator("[data-testid=activity-edit-save]").click();
  await ownText.locator("[data-testid=activity-edit-saved]").waitFor();
  assert.equal((await one(`SELECT outcome FROM "Activity" WHERE id='act_r2_m1'`)).outcome, "REPLIED");
  await memberContext.close();

  log("Sprint: Coming up rows each get Held / No-show / Move: a Pipeline meeting, a calendar-only meeting, a site walk Move only");
  await page.goto(krisUrl);
  const upcoming = page.locator("[data-testid=upcoming-card]");
  const urow = (text) => upcoming.locator("[data-testid=upcoming-row]", { hasText: text });
  await urow("Meeting · Kris Vale").waitFor();
  for (const title of ["Meeting · Kris Vale", "Second look · Kris Vale"]) {
    for (const id of ["upcoming-held", "upcoming-no-show", "upcoming-move"]) {
      assert.equal(await urow(title).locator(`[data-testid=${id}]`).count(), 1, `${title}: ${id}`);
    }
  }
  assert.equal(await urow("Site walk").locator("[data-testid=upcoming-held]").count(), 0, "a site walk can't be held");
  assert.equal(await urow("Site walk").locator("[data-testid=upcoming-move]").count(), 1, "but can be moved");
  // Move the second (calendar-only) meeting a week on.
  await urow("Second look").locator("[data-testid=upcoming-move]").click();
  const moveMenu = page.locator("[data-testid=upcoming-move-menu]");
  await moveMenu.waitFor();
  await moveMenu.locator("[data-testid=upcoming-move-day]").fill(shift(TODAY, 7));
  await moveMenu.locator("[data-testid=upcoming-move-save]").click();
  await until(async () => (await one(`SELECT to_char("startOn",'YYYY-MM-DD') AS d FROM "CalendarEvent" WHERE id='ev_r2_k2'`)).d === shift(TODAY, 7), "the entry moved");
  // Held on tomorrow's Pipeline meeting asks "Did it happen early?" first.
  await urow("Meeting · Kris Vale").locator("[data-testid=upcoming-held]").click();
  const early = urow("Meeting · Kris Vale").locator("[data-testid=held-confirm-early]");
  await early.waitFor();
  await early.locator("[data-testid=held-early-yes]").click();
  await until(async () => (await one(`SELECT outcome FROM "OpportunityMeeting" WHERE id='om_r2_k1'`)).outcome === "HELD", "the Pipeline meeting held");
  await until(async () => (await status("Contact", "ctc_r2_kris")) === "MEETING_COMPLETED", "Kris at Meeting Completed");
  await page.locator("[data-testid=log-toast]").waitFor();
  assert.equal(await page.locator("[data-testid=log-toast]").count(), 1, "one toast");
  await shot(page, "02-upcoming-rows");

  log("Sprint: one toast slot on the contact page: a log saved then a booking show one toast, the newest");
  await page.goto(`${BASE}/dashboard/contacts/ctc_r2_lee`);
  const toast = page.locator("[data-testid=log-toast]");
  await page.locator("[data-testid=log-bar]").click();
  const form = page.locator("[data-testid=log-activity-form]");
  await form.locator("[data-testid=outcome-NO_ANSWER]").click();
  await form.locator("[data-testid=outcome-save]").click();
  await page.locator("[data-testid=follow-up-skip]").click();
  await toast.getByText(/Saved · No answer/).waitFor();
  assert.equal(await toast.count(), 1);
  await page.locator("[data-testid=next-book]").click();
  const book = page.locator("[data-testid=book-meeting]");
  await book.waitFor();
  await book.locator("[data-testid=book-day-pick]").click();
  await book.locator("[data-testid=book-day-input]").fill(shift(TODAY, 4));
  await book.locator("[data-testid=book-time-10\\:00]").click();
  await book.locator("[data-testid=book-submit]").click();
  await toast.getByText(/^Booked/).waitFor();
  assert.equal(await toast.count(), 1, "the booking replaced the log's toast rather than stacking a second");
  // Undo from the one toast takes the booking back.
  await toast.locator("[data-testid=log-toast-undo]").click();
  await toast.getByText("Undone").waitFor();
  await until(async () => (await status("Contact", "ctc_r2_lee")) === "CONTACTED", "Lee back at Attempted");
  assert.equal(await sql(`SELECT 1 FROM "CalendarEvent" WHERE "contactId"='ctc_r2_lee' AND type='Meeting'`).then((r) => r.rowCount), 0);

  log("Sprint: + Event from a lead's page lists the sales types first and starts on Call before they're reached, Meeting after");
  await page.goto(`${BASE}/dashboard/contacts/ctc_r2_lee`);
  await page.locator("[data-testid=upcoming-add-event]").click();
  const eventForm = page.locator("[data-testid=upcoming-card] [data-testid=event-form]");
  await eventForm.waitFor();
  assert.equal(await eventForm.locator("[data-testid=event-type]").inputValue(), "Call", "Lee hasn't been reached: Call");
  const order = await eventForm.locator("[data-testid=event-type] option").allTextContents();
  assert.deepEqual(order.slice(0, 4), ["Call", "Meeting", "Email", "Text"], "sales types first");
  assert.ok(order.includes("Install") && order.includes("+ Add new activity"), "nothing dropped");
  await page.goto(`${BASE}/dashboard/contacts/ctc_r2_ann`);
  await page.locator("[data-testid=upcoming-add-event]").click();
  await eventForm.waitFor();
  assert.equal(await eventForm.locator("[data-testid=event-type]").inputValue(), "Meeting", "Ann is past reaching: Meeting");
  await page.goto(`${BASE}/dashboard/companies/cmp_r2_iron`);
  await page.locator("[data-testid=upcoming-add-event]").click();
  await eventForm.waitFor();
  assert.deepEqual((await eventForm.locator("[data-testid=event-type] option").allTextContents()).slice(0, 2), ["Call", "Meeting"], "the company's too");

  log("Sprint: picking Meeting Set by hand offers Book it first; Book it opens the shared sheet, Just set the status still saves");
  await page.goto(`${BASE}/dashboard/contacts/ctc_r2_lee`);
  await page.locator("[data-testid=record-more]").click();
  await page.locator("[data-testid=record-more-menu] [data-testid=status-picker]").click();
  await page.locator("[data-testid=status-option-MEETING_SET]").click();
  const offer = page.locator("[data-testid=status-book-offer]");
  await offer.waitFor();
  assert.equal(await status("Contact", "ctc_r2_lee"), "CONTACTED", "nothing saved yet");
  await offer.locator("[data-testid=status-book-it]").click();
  await page.locator("[data-testid=book-meeting]").waitFor();
  await page.keyboard.press("Escape");
  await page.locator("[data-testid=book-meeting]").waitFor({ state: "detached" });
  await page.locator("[data-testid=record-more]").click();
  await page.locator("[data-testid=record-more-menu] [data-testid=status-picker]").click();
  await page.locator("[data-testid=status-option-MEETING_SET]").click();
  await offer.locator("[data-testid=status-set-anyway]").click();
  await until(async () => (await status("Contact", "ctc_r2_lee")) === "MEETING_SET", "Meeting Set by hand");
  // Other statuses never ask.
  await page.reload();
  await page.locator("[data-testid=record-more]").click();
  await page.locator("[data-testid=record-more-menu] [data-testid=status-picker]").click();
  await page.locator("[data-testid=status-option-INTERESTED]").click();
  await until(async () => (await status("Contact", "ctc_r2_lee")) === "INTERESTED", "Interested straight away");
  // The company's ⋯ More status picker offers it too.
  await page.goto(`${BASE}/dashboard/companies/cmp_r2_iron`);
  await page.locator("[data-testid=company-more]").click();
  await page.locator("[data-testid=company-more-tray] [data-testid=status-picker]").click();
  await page.locator("[data-testid=status-option-MEETING_SET]").click();
  await page.locator("[data-testid=status-book-offer] [data-testid=status-book-it]").click();
  await page.locator("[data-testid=book-meeting]").waitFor();
  await page.keyboard.press("Escape");

  log("Sprint: the company page's Book offers each person's own tile: the no-show's for Gus, Ann's open one for Ann");
  await page.goto(`${BASE}/dashboard/companies/cmp_r2_iron`);
  const people = page.locator("#people");
  const personRow = (name) => people.locator("[data-testid=person-row]", { hasText: name });
  await personRow("Gus Noshow").locator("[data-testid=person-book]").click();
  const bookSheet = page.locator("[data-testid=book-meeting]");
  await bookSheet.locator("[data-testid=book-opportunity]").waitFor();
  assert.equal(await bookSheet.locator("[data-testid=book-opportunity]").getAttribute("data-offered"), "opp_r2_gus", "Gus's Reschedule is on the no-show's tile");
  assert.equal(await bookSheet.locator("[data-testid=book-opp-yes]").getAttribute("aria-checked"), "true", "and it is picked");
  await page.keyboard.press("Escape");
  await bookSheet.waitFor({ state: "detached" });
  await personRow("Ann Open").locator("[data-testid=person-book]").click();
  await bookSheet.locator("[data-testid=book-opportunity]").waitFor();
  assert.equal(await bookSheet.locator("[data-testid=book-opportunity]").getAttribute("data-offered"), "opp_r2_ann", "Ann's own open tile, not the company's newest");
  await page.keyboard.press("Escape");

  log("Sprint: on a phone the meter's seven steps and their dates open in a bottom sheet; Add person on the company page is a sheet");
  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: await context.storageState() });
  const phone = await phoneContext.newPage();
  await phone.goto(krisUrl);
  const meter = phone.locator("[data-testid=contact-header] [data-testid=lifecycle-meter]");
  await meter.waitFor();
  assert.equal(await meter.locator(".lm-names").isVisible(), false, "the step names are hidden on a phone");
  const open = meter.locator("[data-testid=lifecycle-steps-open]");
  const openBox = await open.boundingBox();
  assert.ok(openBox.height >= 44, `All steps is a 44px target (${openBox.height})`);
  await open.tap();
  const steps = phone.locator("[data-testid=lifecycle-steps-sheet]");
  await steps.waitFor();
  assert.equal(await steps.locator("[data-testid=lifecycle-sheet-step]").count(), 7);
  const meetingCompleted = steps.locator("[data-testid=lifecycle-sheet-step][data-step='3']");
  assert.match(await meetingCompleted.innerText(), /Meeting Completed/);
  assert.match(await meetingCompleted.locator("[data-testid=lifecycle-sheet-date]").innerText(), /^Reached/);
  const sheetBox = await steps.boundingBox();
  assert.ok(sheetBox.y + sheetBox.height >= 843 && sheetBox.x >= 0 && sheetBox.width <= 390, `a bottom sheet (${JSON.stringify(sheetBox)})`);
  await phone.screenshot({ path: path.join(OUT, "03-phone-steps.png") });
  await phone.keyboard.press("Escape");
  await steps.waitFor({ state: "detached" });
  await phone.goto(`${BASE}/dashboard/companies/cmp_r2_iron`);
  await phone.locator("[data-testid=add-person-compact]").scrollIntoViewIfNeeded();
  await phone.locator("[data-testid=add-person-compact]").tap();
  const addSheet = phone.locator("[data-testid=add-person-panel]");
  await addSheet.waitFor();
  assert.equal(await addSheet.getAttribute("role"), "dialog", "Add person opens as a sheet");
  const addBox = await addSheet.boundingBox();
  assert.ok(addBox.y + addBox.height >= 843 && addBox.x >= 0 && addBox.x + addBox.width <= 390, `pinned to the foot of the screen (${JSON.stringify(addBox)})`);
  await until(async () => (await phone.evaluate(() => document.activeElement?.getAttribute("data-testid"))) === "add-person-input", "the search box to have the cursor");
  await addSheet.locator("[data-testid=add-person-input]").fill("Lee");
  await addSheet.locator("[data-testid=add-person-hit]").first().waitFor();
  const wide = await phone.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(wide <= 390, `no sideways scroll (${wide})`);
  await phone.screenshot({ path: path.join(OUT, "04-phone-add-person.png") });
  await phoneContext.close();

  console.log(`\nALL ${step} STEPS PASSED. Screenshots in ${OUT}`);
  await browser.close();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
