/* Browser regression for Planner AI (Nov 12, 2026; Taylor's plan v2).
 *
 *  - The three ways in: the Calendar's Planner button, the dashboard's box
 *    (words turned into filter chips by AI, invented values dropped), and the
 *    Contacts list's Plan outreach carrying its filters.
 *  - Who can be planned: yours, unowned, or a teammate's only when nothing
 *    is booked ahead and nothing was logged in 45 days (44 days out, 46 in);
 *    never Won / Lost / Not interested / Archived; nobody with an open entry
 *    ahead; reachable by every row's type (an Email row needs an email).
 *  - Warm (touched, warmest first), Cold (never, newest first), Mix; at most
 *    3 from one company; a pick is required.
 *  - Create: one entry per person per row on your own calendar, one batch a
 *    minute, one Undo.
 *  - Planned tab: Done (the How did it go? sheet: pick, notes, Save / Cancel,
 *    then up to 6 follow-up rows), Reschedule, Delete with a confirm.
 *  - My day's Up next: the same buttons on a row with an entry; a delegated
 *    entry offers Hand back, never Delete; the calendar's log row too.
 *  - A teammate's view of the same leads, and the phone.
 *
 * Answers as Claude through fake-claude.cjs on :3995, so run it in the "ai"
 * group: run-suites.sh "ai:planner" (the server needs
 * ANTHROPIC_API_KEY=test-key and ANTHROPIC_ENDPOINT=http://localhost:3995).
 *
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/scb_test \
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules \
 *   BASE=http://localhost:3000 node scripts/browser-tests/planner.cjs
 */
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS on purpose: NODE_PATH only resolves the global playwright for require() */
const os = require("node:os");
const { chromium, devices } = require("playwright");
const { Client } = require("pg");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { startFakeClaude } = require("./fake-claude.cjs");

const BASE = process.env.BASE || "http://localhost:3000";
const DB = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5433/scb_test";
const OUT = process.env.SHOTS_DIR || path.join(os.tmpdir(), "scb-browser-shots-planner");
fs.mkdirSync(OUT, { recursive: true });

const EMAIL = "test-planner@example.com";
const ROB_EMAIL = "test-planner-rob@example.com";
const PASSWORD = "password123";
const COMPANY = "Test Planner Co";
const SLUG_LIKE = "test-planner-co%";
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
  for (let i = 0; i < 100; i += 1) {
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
async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming?.().iterations !== Infinity)
        .map((a) => a.finished.catch(() => {})),
    ),
  );
}
const ids = async (page) => page.locator("[data-testid=planner-person]").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-contact-id")));
async function pickKind(page, kind) {
  await page.getByTestId(`planner-kind-${kind}`).click();
}
async function generate(page) {
  await page.getByTestId("planner-generate").click();
  await page.getByTestId("planner-count").waitFor();
  await until(async () => !(await page.getByTestId("planner-generate").textContent()).includes("Finding"), "the preview");
}

(async () => {
  await sql(`DELETE FROM "Organization" WHERE slug LIKE $1`, [SLUG_LIKE]);
  await sql(`DELETE FROM "User" WHERE email=$1`, [ROB_EMAIL]);
  const claude = await startFakeClaude();

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await context.newPage();
  page.on("pageerror", (err) => console.error("PAGE ERROR:", err.message));

  try {
    log("Planner: signup + activate + login; seed companies, leads, a teammate, touches and entries");
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
    const ROB = "usr_pl_rob";
    await sql(`INSERT INTO "User" (id,name,email,"passwordHash",role,"organizationId") VALUES ($4,'Rob Rep',$1,$2,'MEMBER',$3)`, [ROB_EMAIL, owner.passwordHash, org, ROB]);
    await sql(
      `INSERT INTO "Company" (id,"organizationId",name,city,state,industries,"companyTypes","updatedAt") VALUES
         ('cmp_pl_acme',$1,'Acme Property','Austin','TX','{Property Management}','{Owner}',now()),
         ('cmp_pl_blue',$1,'Bluebonnet HOA','Dallas','TX','{Property Management}','{HOA}',now()),
         ('cmp_pl_cal', $1,'Golden Gate Mgmt','Fresno','CA','{Property Management}','{Owner}',now()),
         ('cmp_pl_rob', $1,'Rob Realty','Houston','TX','{Property Management}','{Owner}',now())`,
      [org],
    );
    const PM = "Property Manager";
    await sql(
      `INSERT INTO "Contact" (id,"organizationId","companyId",name,title,mobile,email,status,"ownerId","createdAt","updatedAt") VALUES
         ('ctc_pl_a1',$1,'cmp_pl_acme','Ava One',  $3,'512-555-0101','a1@acme.test','NOT_ACTIONED',$2,  now() - interval '9 days',now()),
         ('ctc_pl_a2',$1,'cmp_pl_acme','Ben Two',  $3,'512-555-0102','a2@acme.test','NOT_ACTIONED',$2,  now() - interval '8 days',now()),
         ('ctc_pl_a3',$1,'cmp_pl_acme','Cy Three', $3,'512-555-0103','a3@acme.test','NOT_ACTIONED',NULL,now() - interval '3 days',now()),
         ('ctc_pl_a4',$1,'cmp_pl_acme','Di Four',  $3,'512-555-0104','a4@acme.test','NOT_ACTIONED',NULL,now() - interval '2 days',now()),
         ('ctc_pl_a5',$1,'cmp_pl_acme','Ed Five',  $3,'512-555-0105','a5@acme.test','NOT_ACTIONED',NULL,now() - interval '1 days',now()),
         ('ctc_pl_b1',$1,'cmp_pl_blue','Bea Warm', $3,'214-555-0201','b1@blue.test','NOT_ACTIONED',$2,  now() - interval '30 days',now()),
         ('ctc_pl_b2',$1,'cmp_pl_blue','Bo Warmish',$3,'214-555-0202','b2@blue.test','NOT_ACTIONED',NULL,now() - interval '30 days',now()),
         ('ctc_pl_ne',$1,'cmp_pl_blue','Nell NoEmail',$3,'214-555-0203',NULL,'NOT_ACTIONED',$2,      now() - interval '20 days',now()),
         ('ctc_pl_lo',$1,'cmp_pl_blue','Lou Lost', $3,'214-555-0204','lo@blue.test','LOST',$2,        now() - interval '1 days',now()),
         ('ctc_pl_bz',$1,'cmp_pl_blue','Bix Busy', $3,'214-555-0205','bz@blue.test','NOT_ACTIONED',$2,now() - interval '1 days',now()),
         ('ctc_pl_es',$1,'cmp_pl_blue','Esa Estimator','Estimator','214-555-0206','es@blue.test','NOT_ACTIONED',$2,now() - interval '1 days',now()),
         ('ctc_pl_c1',$1,'cmp_pl_cal','Cal West',  $3,'559-555-0301','c1@cal.test','NOT_ACTIONED',$2,  now() - interval '1 days',now()),
         ('ctc_pl_r44',$1,'cmp_pl_rob','Rita FortyFour',$3,'713-555-0401','r44@rob.test','CONTACTED',$4,now() - interval '90 days',now()),
         ('ctc_pl_r46',$1,'cmp_pl_rob','Reed FortySix',$3,'713-555-0402','r46@rob.test','CONTACTED',$4,now() - interval '90 days',now()),
         ('ctc_pl_rb',$1,'cmp_pl_rob','Ray Booked',$3,'713-555-0403','rb@rob.test','NOT_ACTIONED',$4,   now() - interval '1 days',now())`,
      [org, me, PM, ROB],
    );
    await sql(
      `INSERT INTO "Activity" (id,"organizationId","contactId","userId",type,body,outcome,"occurredAt") VALUES
         ('act_pl_b1',$1,'ctc_pl_b1',$2,'PHONE_CALL','Talked','TALKED',now() - interval '2 days'),
         ('act_pl_b2',$1,'ctc_pl_b2',$2,'PHONE_CALL','Left voicemail','VOICEMAIL',now() - interval '10 days'),
         ('act_pl_r44',$1,'ctc_pl_r44',$3,'PHONE_CALL','Left voicemail','VOICEMAIL',now() - interval '44 days'),
         ('act_pl_r46',$1,'ctc_pl_r46',$3,'PHONE_CALL','Left voicemail','VOICEMAIL',now() - interval '46 days')`,
      [org, me, ROB],
    );
    await sql(
      `INSERT INTO "CalendarEvent" (id,"organizationId",title,type,"startOn","ownerId","createdById","contactId","updatedAt") VALUES
         ('ev_pl_bz',$1,'Call · Bix Busy','Call',$3::date,$2,$2,'ctc_pl_bz',now()),
         ('ev_pl_rb',$1,'Call · Ray Booked','Call',$4::date,$5,$5,'ctc_pl_rb',now())`,
      [org, me, shift(TODAY, 3), shift(TODAY, 1), ROB],
    );
    const touch = await one(`SELECT "lastTouchAt" FROM "Contact" WHERE id='ctc_pl_r46'`);
    assert.ok(touch.lastTouchAt, "the touch trigger dated the 46-day lead");

    log("Planner: the Calendar toolbar opens it; the Plan and Planned tabs; Generate waits for a kind");
    await page.goto(`${BASE}/dashboard/calendar`);
    await page.getByTestId("cal-planner").click();
    await page.waitForURL(/\/dashboard\/planner$/);
    await page.getByTestId("planner-tab-plan").waitFor();
    assert.equal(await page.getByTestId("planner-tab-plan").getAttribute("aria-current"), "page");
    assert.ok(await page.getByTestId("planner-generate").isDisabled(), "Generate needs Warm, Cold or Mix");

    log("Planner: Plan outreach on Contacts carries the list's title and state into the planner's filters");
    await page.goto(`${BASE}/dashboard/contacts?title=${encodeURIComponent(PM)}&state=TX`);
    await page.getByTestId("plan-outreach").click();
    await page.waitForURL(/\/dashboard\/planner\?/);
    assert.match(page.url(), /title=Property/);
    assert.match(page.url(), /state=TX/);
    const chips = (await page.getByTestId("planner-chip").allTextContents()).map((t) => t.trim());
    assert.deepEqual(chips.sort(), ["State: TX", `Title: ${PM}`].sort());

    log("Planner: Cold = never touched, newest first, at most 3 from Acme; Lost, busy, the CA lead and the Estimator are out");
    await pickKind(page, "cold");
    await generate(page);
    const cold = await ids(page);
    assert.deepEqual(cold, ["ctc_pl_a5", "ctc_pl_a4", "ctc_pl_a3", "ctc_pl_ne"], `cold: ${cold}`);
    const warmth = (await page.getByTestId("planner-warmth").allTextContents()).map((t) => t.trim());
    assert.ok(warmth.every((w) => w === "Cold"));
    await shot(page, "01-cold");

    log("Planner: Warm = touched, the latest talk first; a teammate's lead touched 46 days ago is in, 44 days ago out");
    await pickKind(page, "warm");
    await generate(page);
    const warm = await ids(page);
    assert.deepEqual(warm, ["ctc_pl_b1", "ctc_pl_b2", "ctc_pl_r46"], `warm: ${warm}`);
    const owners = (await page.getByTestId("planner-owner").allTextContents()).map((t) => t.trim());
    assert.equal(owners[0], "Yours");
    assert.equal(owners[1], "Unowned");
    assert.match(owners[2], /Rob Rep's/);

    log("Planner: Warm + Cold mix takes both, alternating, and still 3 a company at most");
    await pickKind(page, "mix");
    await generate(page);
    const mix = await ids(page);
    assert.equal(mix.length, 7, `mix: ${mix}`);
    assert.deepEqual(mix.slice(0, 4), ["ctc_pl_b1", "ctc_pl_a5", "ctc_pl_b2", "ctc_pl_a4"]);
    const companies = await page.locator("[data-testid=planner-person]").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-company-id")));
    for (const id of new Set(companies)) assert.ok(companies.filter((c) => c === id).length <= 3, `${id} has at most 3`);

    log("Planner: an Email row needs an email, so Nell (phone only) drops out; 6 rows at most");
    await pickKind(page, "cold");
    await page.getByTestId("planner-add-row").click();
    await page.getByTestId("planner-row-day-1").fill(shift(TODAY, 1));
    await page.getByTestId("planner-row-type-1").selectOption("EMAIL");
    await generate(page);
    assert.deepEqual(await ids(page), ["ctc_pl_a5", "ctc_pl_a4", "ctc_pl_a3"]);
    assert.match(await page.getByTestId("planner-count").textContent(), /3 people found · 3 ticked · 6 entries/);
    for (let i = 0; i < 4; i += 1) await page.getByTestId("planner-add-row").click();
    assert.equal(await page.getByTestId("planner-row").count(), 6);
    assert.equal(await page.getByTestId("planner-add-row").count(), 0, "no seventh row");
    for (let i = 5; i >= 2; i -= 1) await page.getByTestId(`planner-row-remove-${i}`).click();
    assert.equal(await page.getByTestId("planner-row").count(), 2);
    await generate(page);

    log("Planner: Create puts one entry per person per row on my own calendar (Call today, Email tomorrow), one batch");
    await page.getByTestId("planner-create").click();
    await page.getByTestId("planner-toast").waitFor();
    assert.match(await page.getByTestId("planner-toast").textContent(), /Planned 3 people · 6 entries/);
    const batch1 = await sql(
      `SELECT "contactId", type, "startOn"::text AS on, "ownerId", "createdById", "batchId", title FROM "CalendarEvent"
        WHERE "organizationId"=$1 AND "batchId" LIKE 'plan:%' ORDER BY "contactId", "startOn"`,
      [org],
    );
    assert.equal(batch1.rows.length, 6);
    assert.equal(new Set(batch1.rows.map((r) => r.batchId)).size, 1, "one batch");
    assert.ok(batch1.rows.every((r) => r.ownerId === me && r.createdById === me), "mine, made by me");
    assert.deepEqual(
      batch1.rows.filter((r) => r.contactId === "ctc_pl_a5").map((r) => [r.type, r.on, r.title]),
      [
        ["Call", TODAY, "Call · Ed Five"],
        ["Email", shift(TODAY, 1), "Email · Ed Five"],
      ],
    );
    const owners5 = await one(`SELECT "ownerId" FROM "Contact" WHERE id='ctc_pl_a5'`);
    assert.equal(owners5.ownerId, null, "the planner never changes a contact's owner");
    await shot(page, "02-created");

    log("Planner: the planned people are booked now, so Generate skips them; a second batch inside a minute is refused");
    await pickKind(page, "warm");
    await generate(page);
    assert.deepEqual(await ids(page), ["ctc_pl_b1", "ctc_pl_b2", "ctc_pl_r46"]);
    await page.getByTestId("planner-create").click();
    await page.getByTestId("planner-error").waitFor();
    assert.match(await page.getByTestId("planner-error").textContent(), /Give it a minute/);
    await sql(`UPDATE "CalendarEvent" SET "createdAt" = now() - interval '2 minutes' WHERE "organizationId"=$1 AND "batchId" LIKE 'plan:%'`, [org]);
    await page.getByTestId("planner-create").click();
    await until(async () => Number((await one(`SELECT count(*) FROM "CalendarEvent" WHERE "organizationId"=$1 AND "batchId" LIKE 'plan:%'`, [org])).count) === 12, "the second batch");
    await until(async () => /Planned 3 people/.test((await page.getByTestId("planner-toast").textContent().catch(() => "")) ?? ""), "the second toast");

    log("Planner: Undo takes the whole second batch back; the first stays");
    await page.getByTestId("planner-undo").click();
    await until(async () => /Undone · 6 entries/.test(await page.getByTestId("planner-toast").textContent()), "Undone");
    assert.equal(Number((await one(`SELECT count(*) FROM "CalendarEvent" WHERE "organizationId"=$1 AND "batchId" LIKE 'plan:%'`, [org])).count), 6);
    assert.equal(Number((await one(`SELECT count(*) FROM "CalendarEvent" WHERE "organizationId"=$1 AND "contactId"='ctc_pl_b1'`, [org])).count), 0);

    log("Planner: Planned lists them by day; Reschedule asks a day and a time with Save / Cancel");
    await page.goto(`${BASE}/dashboard/planner?tab=planned`);
    await page.getByTestId("planner-planned").waitFor();
    assert.equal(await page.getByTestId("planned-day").count(), 2);
    assert.equal(await page.getByTestId("planned-row").count(), 6);
    const a5Email = (await one(`SELECT id FROM "CalendarEvent" WHERE "contactId"='ctc_pl_a5' AND type='Email'`)).id;
    const row5 = page.locator(`[data-testid=planned-row][data-entry-id="${a5Email}"]`);
    await row5.getByTestId("entry-reschedule").click();
    await row5.getByTestId("entry-move-day").fill(shift(TODAY, 5));
    await row5.getByTestId("entry-move-time").fill("09:30");
    await row5.getByTestId("entry-move-cancel").click();
    assert.equal(await row5.getByTestId("entry-move-form").count(), 0);
    assert.equal((await one(`SELECT "startOn"::text AS on FROM "CalendarEvent" WHERE id=$1`, [a5Email])).on, shift(TODAY, 1), "Cancel changes nothing");
    await row5.getByTestId("entry-reschedule").click();
    await row5.getByTestId("entry-move-day").fill(shift(TODAY, 5));
    await row5.getByTestId("entry-move-time").fill("09:30");
    await row5.getByTestId("entry-move-save").click();
    await until(async () => (await one(`SELECT "startOn"::text AS on FROM "CalendarEvent" WHERE id=$1`, [a5Email])).on === shift(TODAY, 5), "moved");
    assert.equal((await one(`SELECT "startTime" FROM "CalendarEvent" WHERE id=$1`, [a5Email])).startTime, "09:30");

    log("Planner: the red trash asks Delete / Cancel before taking an entry off");
    const a4Email = (await one(`SELECT id FROM "CalendarEvent" WHERE "contactId"='ctc_pl_a4' AND type='Email'`)).id;
    const row4 = page.locator(`[data-testid=planned-row][data-entry-id="${a4Email}"]`);
    await row4.getByTestId("entry-delete").click();
    await row4.getByTestId("entry-delete-cancel").click();
    assert.ok(await one(`SELECT id FROM "CalendarEvent" WHERE id=$1`, [a4Email]), "Cancel keeps it");
    await row4.getByTestId("entry-delete").click();
    await row4.getByTestId("entry-delete-yes").click();
    await until(async () => !(await one(`SELECT id FROM "CalendarEvent" WHERE id=$1`, [a4Email])), "deleted");

    log("Done everywhere: ✅ opens How did it go?; a chip picks (nothing saved), Cancel unpicks, Save saves with the notes");
    const a3Call = (await one(`SELECT id FROM "CalendarEvent" WHERE "contactId"='ctc_pl_a3' AND type='Call'`)).id;
    const row3 = page.locator(`[data-testid=planned-row][data-entry-id="${a3Call}"]`);
    await row3.getByTestId("entry-done").click();
    const box = page.getByTestId("done-box");
    await box.waitFor();
    await box.locator("[data-testid=outcome-NO_ANSWER]").click();
    assert.equal(await box.locator("[data-testid=outcome-NO_ANSWER]").getAttribute("aria-pressed"), "true");
    await box.getByTestId("outcome-save").waitFor();
    assert.equal(Number((await one(`SELECT count(*) FROM "Activity" WHERE "contactId"='ctc_pl_a3'`)).count), 0, "a tap saves nothing");
    await box.getByTestId("outcome-cancel").click();
    assert.equal(await box.locator("[data-testid=outcome-NO_ANSWER]").getAttribute("aria-pressed"), "false");
    assert.equal(await box.getByTestId("outcome-save").count(), 0);
    await box.locator("[data-testid=outcome-NO_ANSWER]").click();
    await box.getByTestId("done-note").fill("Rang twice, nobody picked up");
    await box.getByTestId("outcome-save").click();
    await box.getByTestId("follow-up-prompt").waitFor();
    const act3 = await one(`SELECT outcome, body FROM "Activity" WHERE "contactId"='ctc_pl_a3'`);
    assert.equal(act3.outcome, "NO_ANSWER");
    assert.equal(act3.body, "Rang twice, nobody picked up");
    assert.ok((await one(`SELECT "doneAt" FROM "CalendarEvent" WHERE id=$1`, [a3Call])).doneAt, "the entry is ticked");

    log("Done everywhere: the follow-up step takes up to 6 rows (date, then Call / Text / Email); Save writes each");
    await box.getByTestId("next-follow").waitFor();
    assert.equal(await box.getByTestId("next-follow").getAttribute("aria-checked"), "true");
    await box.getByTestId("next-add-row").click();
    await box.getByTestId("next-add-row").click();
    await box.getByTestId("next-row-type-0").selectOption("EMAIL");
    await box.getByTestId("next-row-day-1").fill(shift(TODAY, 9));
    await box.getByTestId("next-row-type-1").selectOption("TEXT");
    for (let i = 0; i < 3; i += 1) await box.getByTestId("next-add-row").click();
    assert.equal(await box.getByTestId("next-row").count(), 5);
    assert.equal(await box.getByTestId("next-add-row").count(), 0, "six in all");
    for (let i = 4; i >= 2; i -= 1) await box.getByTestId(`next-row-remove-${i}`).click();
    assert.match(await box.getByTestId("follow-up-save").textContent(), /Save 3 follow-ups/);
    await box.getByTestId("follow-up-save").click();
    await until(async () => Number((await one(`SELECT count(*) FROM "CalendarEvent" WHERE "contactId"='ctc_pl_a3' AND "doneAt" IS NULL AND "batchId" NOT LIKE 'plan:%'`)).count) === 3, "three follow-ups");
    const follows = await sql(
      `SELECT type, "startOn"::text AS on, "ownerId", "createdById" FROM "CalendarEvent"
        WHERE "contactId"='ctc_pl_a3' AND "doneAt" IS NULL AND "batchId" NOT LIKE 'plan:%' ORDER BY "startOn"`,
    );
    assert.deepEqual(follows.rows.map((r) => r.type), ["Call", "Email", "Text"]);
    assert.equal(follows.rows[2].on, shift(TODAY, 9));
    assert.ok(follows.rows.every((r) => r.ownerId === me && r.createdById === me));
    await shot(page, "03-planned");

    log("Done everywhere: Cancel on the follow-up step keeps the touch with no follow-up");
    const a5Call = (await one(`SELECT id FROM "CalendarEvent" WHERE "contactId"='ctc_pl_a5' AND type='Call'`)).id;
    await page.goto(`${BASE}/dashboard/planner?tab=planned`);
    await page.locator(`[data-testid=planned-row][data-entry-id="${a5Call}"]`).getByTestId("entry-done").click();
    await box.waitFor();
    await box.locator("[data-testid=outcome-VOICEMAIL]").click();
    await box.getByTestId("outcome-save").click();
    await box.getByTestId("follow-up-prompt").waitFor();
    assert.equal((await box.getByTestId("follow-up-skip").textContent()).trim(), "Cancel");
    await box.getByTestId("follow-up-skip").click();
    await until(async () => (await one(`SELECT outcome FROM "Activity" WHERE "contactId"='ctc_pl_a5'`))?.outcome === "VOICEMAIL", "the voicemail");
    assert.equal(Number((await one(`SELECT count(*) FROM "CalendarEvent" WHERE "contactId"='ctc_pl_a5' AND "doneAt" IS NULL AND "batchId" NOT LIKE 'plan:%'`)).count), 0);

    log("My day: an Up next row with an entry gets Done / Reschedule / Delete; one a teammate put there gets Hand back");
    await sql(
      `INSERT INTO "CalendarEvent" (id,"organizationId",title,type,"startOn","ownerId","createdById","contactId","updatedAt") VALUES
         ('ev_pl_own',$1,'Call · Ben Two','Call',$3::date,$2,$2,'ctc_pl_a2',now()),
         ('ev_pl_del',$1,'Call · Ava One','Call',$4::date,$2,$5,'ctc_pl_a1',now())`,
      [org, me, shift(TODAY, -1), TODAY, ROB],
    );
    await page.goto(`${BASE}/dashboard?view=myday`);
    await page.getByTestId("up-next").waitFor();
    await page.getByTestId("up-next-all").click().catch(() => {});
    const own = page.locator("[data-testid=up-next-row][data-contact-id=ctc_pl_a2]");
    const del = page.locator("[data-testid=up-next-row][data-contact-id=ctc_pl_a1]");
    await own.getByTestId("entry-actions").waitFor();
    assert.equal(await own.getByTestId("entry-delete").count(), 1);
    assert.equal(await del.getByTestId("entry-delete").count(), 0, "no Delete on a delegated entry");
    assert.equal(await del.getByTestId("entry-handback").count(), 1);
    await del.getByTestId("entry-handback").click();
    assert.match(await del.getByTestId("entry-handback-confirm").textContent(), /Rob Rep put this on your calendar/);
    await del.getByTestId("entry-handback-cancel").click();
    assert.equal((await one(`SELECT "ownerId" FROM "CalendarEvent" WHERE id='ev_pl_del'`)).ownerId, me);
    await shot(page, "04-myday");

    log("Calendar: the log row shows Hand back too, and Hand back moves it to Rob's calendar");
    await page.goto(`${BASE}/dashboard/calendar?layout=log`);
    const logRow = page.locator("[data-testid=log-handback]").first();
    await logRow.waitFor();
    await logRow.click();
    await page.getByTestId("log-confirm-yes").click();
    await until(async () => (await one(`SELECT "ownerId" FROM "CalendarEvent" WHERE id='ev_pl_del'`)).ownerId === ROB, "handed back");

    log("My day: Reschedule and Delete on my own entry");
    await page.goto(`${BASE}/dashboard?view=myday`);
    await page.getByTestId("up-next-all").click().catch(() => {});
    await own.getByTestId("entry-reschedule").click();
    await own.getByTestId("entry-move-day").fill(shift(TODAY, 2));
    await own.getByTestId("entry-move-save").click();
    await until(async () => (await one(`SELECT "startOn"::text AS on FROM "CalendarEvent" WHERE id='ev_pl_own'`)).on === shift(TODAY, 2), "rescheduled");
    await sql(`UPDATE "CalendarEvent" SET "startOn"=$1::date WHERE id='ev_pl_own'`, [TODAY]);
    await page.goto(`${BASE}/dashboard?view=myday`);
    await page.getByTestId("up-next-all").click().catch(() => {});
    await own.getByTestId("entry-delete").click();
    await own.getByTestId("entry-delete-yes").click();
    await until(async () => !(await one(`SELECT id FROM "CalendarEvent" WHERE id='ev_pl_own'`)), "deleted");

    log("Dashboard box: words become filter chips from the workspace's own values; an invented one is dropped");
    claude.reply("PLANNER_FILTERS", {
      titles: ["property manager", "Chief Wizard"],
      industries: [],
      companyTypes: [],
      statuses: [],
      states: ["tx"],
      cities: ["Atlantis"],
      neverContacted: true,
      kind: "cold",
    });
    await page.goto(`${BASE}/dashboard`);
    await page.getByTestId("planner-box-input").fill("property managers in Texas we've never called");
    await page.getByTestId("planner-box-go").click();
    await page.waitForURL(/\/dashboard\/planner\?q=/);
    await page.getByTestId("planner-ai-note").waitFor();
    assert.match(await page.getByTestId("planner-ai-note").textContent(), /2 not in your CRM left out/);
    const aiChips = (await page.getByTestId("planner-chip").allTextContents()).map((t) => t.trim()).sort();
    assert.deepEqual(aiChips, ["Never contacted", "State: TX", `Title: ${PM}`].sort());
    assert.equal(await page.getByTestId("planner-kind-cold").getAttribute("aria-checked"), "true");
    const sent = claude.last("PLANNER_FILTERS");
    assert.match(sent.text, /<request>[\s\S]*never called[\s\S]*<\/request>/);
    assert.match(sent.text, /Property Manager/);
    assert.equal(await page.getByTestId("planner-text").inputValue(), "property managers in Texas we've never called");

    log("Planner: Rob sees his own lead touched 44 days ago, Bo (unowned), and never Bea, whom Taylor talked to 2 days ago");
    const robContext = await browser.newContext({ viewport: { width: 1440, height: 950 } });
    const rob = await robContext.newPage();
    await login(rob, ROB_EMAIL);
    await rob.goto(`${BASE}/dashboard/planner?title=${encodeURIComponent(PM)}`);
    await pickKind(rob, "warm");
    await generate(rob);
    const robs = await ids(rob);
    assert.ok(robs.includes("ctc_pl_r44") && robs.includes("ctc_pl_r46") && robs.includes("ctc_pl_b2"), `rob: ${robs}`);
    assert.ok(!robs.includes("ctc_pl_b1"), "Taylor's lead touched 2 days ago is not Rob's to plan");
    await robContext.close();

    log("Planner: on a phone the page fits, the rows stack, and the Planned buttons are big enough to tap");
    const phone = await browser.newContext({ ...devices["iPhone 13"] });
    const mobile = await phone.newPage();
    await login(mobile, EMAIL);
    await mobile.goto(`${BASE}/dashboard/planner`);
    await pickKind(mobile, "warm");
    await generate(mobile);
    await settle(mobile);
    const wide = await mobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(wide <= 0, `no sideways scroll (${wide}px)`);
    await shot(mobile, "05-phone-plan");
    await mobile.goto(`${BASE}/dashboard/planner?tab=planned`);
    await mobile.getByTestId("planned-row").first().waitFor();
    await settle(mobile);
    const tap = await mobile.getByTestId("entry-done").first().boundingBox();
    assert.ok(tap.height >= 43.5, `Done is ${tap.height}px tall`);
    const wide2 = await mobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(wide2 <= 0, `Planned fits (${wide2}px)`);
    await shot(mobile, "06-phone-planned");
    await phone.close();

    console.log("\nAll planner steps passed.");
  } finally {
    await browser.close();
    await claude.close();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
