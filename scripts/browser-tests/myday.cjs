/* Browser regression for TODAY (BDR redesign, Nov 11, 2026; release 5):
 * My day, Team today, the calendar's Agenda, the phone's tab bar and the
 * team goals in Settings → General.
 *
 * Covers: a Member lands on My day (first tab, greeting, three week rings
 * "vs last week"); Up next in the plan's order (meeting to close out,
 * late, due today, talked, new, still trying) with its reason lines, a
 * lead booked ahead left off, tel: / sms: links; Log from a row opens How
 * did it go? and a No answer with its follow-up takes the row off; the
 * Meetings card's Held writes a HELD meeting with Undo; Done today; "12
 * new leads nobody owns · Take 10" with its confirm, then Undo; Jump in's
 * Log a call asking Who? first; the Member's Daily Rundown tab; an Owner
 * landing on the Daily Rundown with Team today (the owner left out),
 * opening a rep's My day read-only; goals saved by the Owner filling the
 * Member's rings "of 50", read-only for a Member; the calendar opening a
 * Member on the Agenda (Overdue, Today, tap-to-call, Done opening the log
 * sheet), Mine / Everyone remembered per person; Month hiding logged
 * touches behind "n logged" with Show logged; Week opening on today on a
 * phone; the phone: the bottom tab bar, More with every link, the look
 * switch and a confirmed Log out, the sticky "Next:" bar, no sideways
 * scroll; the sidebar's search; a Member's Settings opening My Account;
 * an Owner's bare calendar on a phone swapping to the Agenda.
 *
 * Runs against a built app and a local Postgres that has had `prisma
 * migrate deploy`. It signs up its own workspace and deletes it again on
 * the next run. Never point it at the live database.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/scb_test \
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules \
 *   BASE=http://localhost:3000 node scripts/browser-tests/myday.cjs
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
const OUT = process.env.SHOTS_DIR || path.join(os.tmpdir(), "scb-browser-shots-myday");
fs.mkdirSync(OUT, { recursive: true });

const EMAIL = "test-myday@example.com";
const MARCUS_EMAIL = "test-myday-marcus@example.com";
const PASSWORD = "password123";
const COMPANY = "Test Myday Co";
const SLUG_LIKE = "test-myday-co%";
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
async function login(page, email) {
  await page.goto(`${BASE}/login`);
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/dashboard$/);
}
async function until(fn, what) {
  for (let i = 0; i < 60; i += 1) {
    if (await fn()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`timed out waiting for ${what}`);
}
// The workspace's today, as yyyy-mm-dd, and days either side of it.
function zoneDay(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
const TODAY = zoneDay(new Date());
function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const ago = (days) => `now() - interval '${days} days'`;

(async () => {
  await sql(`DELETE FROM "Organization" WHERE slug LIKE $1`, [SLUG_LIKE]);
  await sql(`DELETE FROM "User" WHERE email = $1`, [MARCUS_EMAIL]);

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await context.newPage();
  page.on("pageerror", (err) => console.error("PAGE ERROR:", err.message));

  log("signup + activate, an Owner and a Member (Marcus) with a seeded book");
  await page.goto(`${BASE}/signup`);
  await page.fill("[name=companyName]", COMPANY);
  await page.fill("[name=name]", "Taylor Test");
  await page.fill("[name=email]", EMAIL);
  await page.fill("[name=phone]", "5550000000");
  await page.fill("[name=password]", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/signup\/submitted/);
  await sql(`UPDATE "Organization" SET status='ACTIVE', "reviewedAt"=now(), "timeZone"=$2 WHERE slug LIKE $1`, [SLUG_LIKE, ZONE]);
  const org = (await sql(`SELECT id FROM "Organization" WHERE slug LIKE $1`, [SLUG_LIKE])).rows[0].id;
  const taylor = (await sql(`SELECT id, "passwordHash" FROM "User" WHERE email = $1`, [EMAIL])).rows[0];
  const M = "usr_myday_marcus";
  await sql(
    `INSERT INTO "User" (id, name, email, "passwordHash", role, "organizationId") VALUES ($1, 'Marcus Reed', $2, $3, 'MEMBER', $4)`,
    [M, MARCUS_EMAIL, taylor.passwordHash, org],
  );
  await sql(`INSERT INTO "Company" (id,"organizationId",name,"updatedAt") VALUES ('cmp_md_redbud',$1,'Redbud Dental',now())`, [org]);
  // One per Up next group, all Marcus's, plus one booked ahead.
  await sql(
    `INSERT INTO "Contact" (id,"organizationId",name,"companyId",status,"ownerId",mobile,"createdAt","updatedAt") VALUES
       ('ctc_md_mia',$1,'Mia Meeting','cmp_md_redbud','MEETING_SET',$2,'(512) 555-0101',now() - interval '20 days',now()),
       ('ctc_md_lou',$1,'Lou Late','cmp_md_redbud','CONTACTED',$2,'(512) 555-0102',now() - interval '20 days',now()),
       ('ctc_md_tia',$1,'Tia Today','cmp_md_redbud','CONTACTED',$2,'(512) 555-0103',now() - interval '20 days',now()),
       ('ctc_md_tom',$1,'Tom Talked','cmp_md_redbud','CONNECTED',$2,'(512) 555-0104',now() - interval '20 days',now()),
       ('ctc_md_nia',$1,'Nia Newlead',NULL,'NOT_ACTIONED',$2,'(512) 555-0105',now() - interval '1 days',now()),
       ('ctc_md_ty',$1,'Ty Trying',NULL,'CONTACTED',$2,'(512) 555-0106',now() - interval '20 days',now()),
       ('ctc_md_ben',$1,'Ben Booked',NULL,'CONTACTED',$2,'(512) 555-0107',now() - interval '20 days',now())`,
    [org, M],
  );
  for (let i = 1; i <= 12; i += 1) {
    await sql(
      `INSERT INTO "Contact" (id,"organizationId",name,status,"createdAt","updatedAt") VALUES ($1,$2,$3,'NOT_ACTIONED',now() - ($4 || ' minutes')::interval,now())`,
      [`ctc_md_un${i}`, org, `Unowned Lead ${String(i).padStart(2, "0")}`, String(i)],
    );
  }
  await sql(
    `INSERT INTO "Activity" (id,"organizationId","contactId","userId",type,body,outcome,"occurredAt") VALUES
       ('act_md_lou',$1,'ctc_md_lou',$2,'PHONE_CALL','No answer','NO_ANSWER',${ago(5)}),
       ('act_md_tia',$1,'ctc_md_tia',$2,'PHONE_CALL','Voicemail','VOICEMAIL',${ago(4)}),
       ('act_md_tom',$1,'ctc_md_tom',$2,'PHONE_CALL','Good talk','TALKED',${ago(6)}),
       ('act_md_ty',$1,'ctc_md_ty',$2,'PHONE_CALL','No answer','NO_ANSWER',${ago(4)}),
       ('act_md_ben',$1,'ctc_md_ben',$2,'PHONE_CALL','No answer','NO_ANSWER',${ago(4)}),
       ('act_md_mia',$1,'ctc_md_mia',$2,'PHONE_CALL','Booked','TALKED',${ago(8)})`,
    [org, M],
  );
  await sql(
    `INSERT INTO "CalendarEvent" (id,"organizationId",title,type,"startOn","startTime","ownerId","contactId","updatedAt","createdAt") VALUES
       ('ev_md_mia',$1,'Meeting · Mia Meeting','Meeting',$3::date,'10:00',$2,'ctc_md_mia',now(),now() - interval '8 days'),
       ('ev_md_lou',$1,'Call · Lou Late','Call',$4::date,NULL,$2,'ctc_md_lou',now(),now() - interval '8 days'),
       ('ev_md_tia',$1,'Call · Tia Today','Call',$5::date,'10:00',$2,'ctc_md_tia',now(),now() - interval '8 days'),
       ('ev_md_ben',$1,'Call · Ben Booked','Call',$6::date,NULL,$2,'ctc_md_ben',now(),now() - interval '8 days')`,
    [org, M, addDays(TODAY, -1), addDays(TODAY, -3), TODAY, addDays(TODAY, 3)],
  );

  log("a Member lands on My day: the first tab, the greeting and three week rings");
  await login(page, MARCUS_EMAIL);
  await page.locator("[data-testid=my-day]").waitFor();
  const tabs = await page.locator("[data-testid=report-tab]").allTextContents();
  assert.deepEqual(tabs, ["My day", "Daily Rundown", "Pipeline", "Activity", "Closing", "Money Owed"]);
  assert.equal(await page.locator("[data-testid=report-tab][aria-current=page]").textContent(), "My day");
  assert.match(await page.locator("[data-testid=my-day-greeting]").textContent(), /^(Morning|Afternoon|Evening), Marcus · 1 follow-up late · \d+ to call/);
  assert.equal(await page.locator("[data-testid=week-rings] a[data-testid^=ring-]").count(), 3);
  for (const caption of await page.locator("[data-testid=ring-caption]").allTextContents()) {
    assert.match(caption, /last week/, "with no goals the rings read against last week");
  }
  assert.match(await page.locator("[data-testid=ring-tries]").getAttribute("href"), /report=activity.*rep=usr_myday_marcus/);
  await shot(page, "myday-desktop");

  log("Up next is in the plan's order, says why, and leaves off a lead booked ahead");
  const rows = page.locator("[data-testid=up-next-row]");
  const order = await rows.evaluateAll((els) => els.map((el) => [el.dataset.contactId, el.dataset.category]));
  assert.deepEqual(order, [
    ["ctc_md_mia", "meeting"],
    ["ctc_md_lou", "late"],
    ["ctc_md_tia", "today"],
    ["ctc_md_tom", "talked"],
    ["ctc_md_nia", "new"],
    ["ctc_md_ty", "trying"],
  ]);
  const reasons = await page.locator("[data-testid=up-next-reason]").allTextContents();
  assert.match(reasons[0], /^Met .+ — how did it go\?/);
  assert.equal(reasons[1], "Follow-up 3 days late");
  assert.equal(reasons[2], "Call due today · 10:00 AM");
  assert.equal(reasons[3], "Talked 6 days ago — ask for the meeting");
  assert.equal(reasons[4], "New lead");
  assert.equal(reasons[5], "1 try, never reached");
  assert.equal(await page.locator("[data-testid=up-next-row][data-contact-id=ctc_md_ben]").count(), 0, "Ben's next call is booked ahead");
  assert.equal(await rows.first().locator("[data-testid=up-next-call]").getAttribute("href"), "tel:5125550101");
  assert.equal(await rows.first().locator("[data-testid=up-next-text]").getAttribute("href"), "sms:5125550101");

  log("Log on a row opens How did it go?; No answer with its follow-up takes the row off");
  await page.locator("[data-testid=up-next-row][data-contact-id=ctc_md_ty] [data-testid=up-next-log]").click();
  const sheet = page.locator("[data-testid=how-did-it-go]");
  await sheet.waitFor();
  assert.match(await sheet.textContent(), /Ty/);
  await sheet.locator("[data-testid=outcome-NO_ANSWER]").click();
  await page.locator("[data-testid=follow-up-save]").waitFor();
  await until(async () => (await sql(`SELECT count(*)::int n FROM "Activity" WHERE "contactId"='ctc_md_ty' AND outcome='NO_ANSWER'`)).rows[0].n === 2, "the no answer saved");
  await page.locator("[data-testid=follow-up-save]").click();
  await sheet.waitFor({ state: "detached" });
  await until(async () => (await page.locator("[data-testid=up-next-row][data-contact-id=ctc_md_ty]").count()) === 0, "Ty off Up next");
  const ahead = await sql(`SELECT count(*)::int n FROM "CalendarEvent" WHERE "contactId"='ctc_md_ty' AND "doneAt" IS NULL AND "startOn" > $1::date`, [TODAY]);
  assert.equal(ahead.rows[0].n, 1, "the next try is on the calendar");

  log("the Meetings card: yesterday's meeting offers Held / No-show; Held saves a HELD meeting with Undo");
  const meeting = page.locator("[data-testid=meeting-row][data-event-id=ev_md_mia]");
  await meeting.locator("[data-testid=meeting-held]").waitFor();
  assert.equal(await meeting.locator("[data-testid=meeting-noshow]").count(), 1);
  await meeting.locator("[data-testid=meeting-held]").click();
  await page.locator("[data-testid=log-toast-words]", { hasText: /^Held · Mia Meeting/ }).waitFor();
  await until(async () => (await sql(`SELECT count(*)::int n FROM "Activity" WHERE "contactId"='ctc_md_mia' AND type='MEETING' AND outcome='HELD'`)).rows[0].n === 1, "the held meeting");
  // A past meeting that is done leaves the card; it is in the history now.
  await meeting.waitFor({ state: "detached" });
  await until(async () => (await page.locator("[data-testid=up-next-row][data-contact-id=ctc_md_mia]").count()) === 0, "Mia off Up next once held");

  log("Done today folds what was logged today, one line a save (yesterday's held meeting is dated yesterday)");
  const done = page.locator("[data-testid=done-today]");
  assert.match(await done.locator("summary").textContent(), /Done today \(1\)/);
  assert.equal(await done.getAttribute("open"), null, "collapsed");
  await done.locator("summary").click();
  assert.equal(await done.locator("[data-testid=done-row]").count(), 1);
  assert.match(await done.textContent(), /Ty Trying · Phone Call · No answer/);

  log("12 new leads nobody owns · Take 10, with a confirm, then Undo gives them back");
  const unowned = page.locator("[data-testid=unowned]");
  assert.equal(await unowned.locator("[data-testid=unowned-count]").textContent(), "12 new leads nobody owns");
  await unowned.locator("[data-testid=unowned-take]").click();
  await unowned.locator("[data-testid=unowned-confirm]").click();
  await unowned.locator("[data-testid=unowned-toast]").waitFor();
  const owned = async () => (await sql(`SELECT count(*)::int n FROM "Contact" WHERE "organizationId"=$1 AND id LIKE 'ctc_md_un%' AND "ownerId"=$2`, [org, M])).rows[0].n;
  assert.equal(await owned(), 10);
  await until(async () => /^2 new leads/.test((await unowned.locator("[data-testid=unowned-count]").textContent().catch(() => "")) ?? ""), "2 left");
  await until(async () => (await page.locator("[data-testid=up-next-row][data-category=new]").count()) >= 5, "the taken leads on Up next");
  assert.match(await page.locator("[data-testid=up-next-all]").textContent(), /^Show all 1\d$/);
  await unowned.locator("[data-testid=unowned-undo]").click();
  await until(async () => (await owned()) === 0, "given back");
  await until(async () => /^12 new leads/.test((await unowned.locator("[data-testid=unowned-count]").textContent().catch(() => "")) ?? ""), "12 again");

  log("Jump in for a Member: Log a call asks Who? first, then opens the log sheet");
  await page.locator("[data-testid=jump-log-call]").click();
  await page.locator("[data-testid=jump-who]").waitFor();
  await page.fill("[data-testid=jump-who-search]", "Nia");
  await page.locator("[data-testid=jump-who-pick]").first().click();
  await page.locator("[data-testid=how-did-it-go]").waitFor();
  assert.match(await page.locator("[data-testid=how-did-it-go]").textContent(), /Nia/);
  await page.keyboard.press("Escape");
  await page.locator("[data-testid=how-did-it-go]").waitFor({ state: "detached" });
  assert.equal(await page.locator("[data-testid=jump-add-contact]").getAttribute("href"), "/dashboard/contacts/new");

  log("the Member's Daily Rundown tab names itself and keeps BDR shortcuts in Jump in");
  assert.match(await page.locator("[data-testid=report-tab][data-report=daily]").getAttribute("href"), /report=daily/);
  await page.locator("[data-testid=report-tab][data-report=daily]").click();
  await page.locator("[data-testid=report][data-report=daily]").waitFor();
  await page.locator("[data-testid=jump-in-member]").waitFor();
  assert.equal(await page.getByText("Change branding").count(), 0);
  assert.equal(await page.locator("[data-testid=team-today]").count(), 0, "Team today is for Owners and Admins");

  log("a Member's Settings opens My Account, and the sidebar's search finds a person");
  assert.equal(await page.locator("aside [data-testid=nav-link][data-href='/dashboard/settings']").getAttribute("href"), "/dashboard/settings/account");
  await page.locator("[data-testid=sidebar-search]").click();
  await page.fill("[data-testid=global-search-input]", "Tom Tal");
  await page.locator("[data-testid=global-search-person]").first().waitFor();
  await page.locator("[data-testid=global-search-person]").first().click();
  await page.waitForURL(/\/dashboard\/contacts\/ctc_md_tom$/);

  log("the Member's calendar opens on the Agenda: Overdue, Today, tap-to-call, Done opening the log sheet");
  await page.goto(`${BASE}/dashboard/calendar`);
  await page.locator("[data-testid=agenda]").waitFor();
  assert.equal(await page.locator("[data-testid=cal-view-agenda]").getAttribute("aria-selected"), "true");
  assert.equal(await page.locator("[data-testid=cal-just-me]").getAttribute("aria-pressed"), "true", "a Member opens on Mine");
  const overdue = page.locator("[data-testid=agenda-overdue]");
  assert.match(await overdue.textContent(), /Call · Lou Late/);
  const todayRows = page.locator("[data-testid=agenda-today]");
  assert.match(await todayRows.textContent(), /Call · Tia Today/);
  const tia = todayRows.locator("[data-testid=agenda-row][data-event-id=ev_md_tia]");
  assert.equal(await tia.locator("[data-testid=agenda-call]").getAttribute("href"), "tel:5125550103");
  assert.ok(await page.locator("[data-testid=agenda-day]").count() >= 1, "the next 7 days follow");
  await tia.locator("[data-testid=agenda-done]").click();
  await page.locator("[data-testid=done-box]").waitFor();
  await page.keyboard.press("Escape");
  await page.locator("[data-testid=done-box]").waitFor({ state: "detached" });
  await shot(page, "agenda-desktop");

  log("Mine / Everyone is remembered per person");
  await page.locator("[data-testid=cal-everyone]").click();
  await until(async () => (await sql(`SELECT "uiPrefs" FROM "User" WHERE id=$1`, [M])).rows[0].uiPrefs?.calendar?.scope === "team", "team remembered");
  await page.goto(`${BASE}/dashboard/calendar`);
  await page.locator("[data-testid=cal-everyone][aria-pressed=true]").waitFor();
  await page.locator("[data-testid=cal-just-me]").click();
  await page.waitForURL(/users=usr_myday_marcus/);
  await until(async () => (await sql(`SELECT "uiPrefs" FROM "User" WHERE id=$1`, [M])).rows[0].uiPrefs?.calendar?.scope === "mine", "mine remembered");
  // A broken stored value reads as not set, and saving merges into it.
  await sql(`UPDATE "User" SET "uiPrefs"='{"calendar":"junk","lists":{"x":1}}'::jsonb WHERE id=$1`, [M]);
  await page.goto(`${BASE}/dashboard/calendar`);
  await page.locator("[data-testid=cal-just-me][aria-pressed=true]").waitFor();
  await page.locator("[data-testid=cal-everyone]").click();
  await until(async () => {
    const prefs = (await sql(`SELECT "uiPrefs" FROM "User" WHERE id=$1`, [M])).rows[0].uiPrefs;
    return prefs?.calendar?.scope === "team" && prefs?.lists?.x === 1;
  }, "merged into a broken namespace, other namespaces kept");

  log("Month hides logged touches behind 'n logged', with Show logged");
  await page.goto(`${BASE}/dashboard/calendar?on=${TODAY}&users=${M}`);
  const cell = page.locator(`[data-testid=month-day][data-day="${TODAY}"]`);
  await cell.waitFor();
  const logged = Number(await cell.getAttribute("data-logged"));
  assert.ok(logged >= 1, `today's logged touches are counted (${logged})`);
  assert.match(await cell.locator("[data-testid=month-logged]").textContent(), new RegExp(`${logged} logged`));
  await page.locator("[data-testid=cal-show-logged]").click();
  await until(async () => (await cell.locator("[data-testid=month-logged]").count()) === 0, "logged shown");
  await until(async () => (await sql(`SELECT "uiPrefs" FROM "User" WHERE id=$1`, [M])).rows[0].uiPrefs?.calendar?.showLogged === true, "show logged remembered");
  await page.reload();
  await cell.waitFor();
  assert.equal(await cell.locator("[data-testid=month-logged]").count(), 0, "still shown after a reload");

  log("an Owner lands on the Daily Rundown with Team today; the owner with no book is left out");
  const owner = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const op = await owner.newPage();
  op.on("pageerror", (err) => console.error("PAGE ERROR (owner):", err.message));
  await login(op, EMAIL);
  await op.locator("[data-testid=report][data-report=daily]").waitFor();
  assert.deepEqual(await op.locator("[data-testid=report-tab]").allTextContents(), ["Daily Rundown", "Pipeline", "Activity", "Closing", "Money Owed"]);
  const team = op.locator("[data-testid=team-row]");
  assert.deepEqual(await team.evaluateAll((els) => els.map((el) => el.dataset.rep)), [M]);
  assert.match(await team.first().locator("[data-testid=team-today-numbers]").textContent(), /Today 1 try · 0 talks \(0%\) · 0 booked/);
  assert.equal(await team.first().locator("[data-testid=team-dot]").getAttribute("data-fresh"), "", "logged in the last two hours");
  assert.match(await op.locator("[data-testid=team-unowned]").textContent(), /12 new leads nobody owns/);
  await op.locator("[data-testid=jump-in-member]").count().then((n) => assert.equal(n, 0, "an Owner keeps the owner's Jump in"));

  log("clicking a rep opens their My day, read-only");
  await team.first().click();
  await op.locator("[data-testid=my-day][data-readonly]").waitFor();
  assert.match(await op.locator("[data-testid=my-day]").textContent(), /Marcus Reed's day · read-only/);
  assert.equal(await op.locator("[data-testid=up-next-log]").count(), 0);
  assert.equal(await op.locator("[data-testid=unowned]").count(), 0);
  assert.equal(await op.locator("[data-testid=meeting-held]").count(), 0);
  await op.locator("[data-testid=my-day-back]").waitFor();

  log("Settings → General: the Owner saves goals and the try limit; the Member's rings fill toward them");
  await op.goto(`${BASE}/dashboard/settings/general`);
  await op.fill("[data-testid=goal-weeklyTryGoal]", "50");
  await op.fill("[data-testid=goal-weeklyTalkGoal]", "10");
  await op.fill("[data-testid=goal-weeklyMeetingGoal]", "0");
  await op.fill("[data-testid=goal-parkAfterTries]", "4");
  await op.click("[data-testid=team-goals-save]");
  await op.getByText("A goal is at least 1").waitFor();
  assert.equal(await op.inputValue("[data-testid=goal-weeklyTryGoal]"), "50", "a refused save keeps what was typed");
  await op.fill("[data-testid=goal-weeklyMeetingGoal]", "");
  await op.click("[data-testid=team-goals-save]");
  await op.getByText(/Saved: 2 weekly goals, try limit 4/).waitFor();
  const goals = (await sql(`SELECT "weeklyTryGoal" t, "weeklyTalkGoal" k, "weeklyMeetingGoal" m, "parkAfterTries" p FROM "Organization" WHERE id=$1`, [org])).rows[0];
  assert.deepEqual(goals, { t: 50, k: 10, m: null, p: 4 });
  await page.goto(`${BASE}/dashboard`);
  assert.equal(await page.locator("[data-testid=ring-tries] [data-testid=ring-caption]").textContent(), "of 50");
  assert.equal(await page.locator("[data-testid=ring-talks] [data-testid=ring-caption]").textContent(), "of 10");
  assert.match(await page.locator("[data-testid=ring-booked] [data-testid=ring-caption]").textContent(), /last week/);
  await page.goto(`${BASE}/dashboard/settings/general`);
  assert.ok(await page.locator("[data-testid=goal-weeklyTryGoal]").isDisabled(), "a Member reads the goals");
  assert.equal(await page.locator("[data-testid=team-goals-save]").count(), 0);

  log("the Owner's bare calendar is the Month with Everyone");
  await op.goto(`${BASE}/dashboard/calendar`);
  await op.locator("[data-testid=month-day]").first().waitFor();
  assert.equal(await op.locator("[data-testid=cal-everyone]").getAttribute("aria-pressed"), "true");
  await owner.close();

  log("the phone: tab bar, the sticky Next bar, no sideways scroll, More with every link, the look and a confirmed Log out");
  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: await context.storageState() });
  const phone = await phoneContext.newPage();
  phone.on("pageerror", (err) => console.error("PAGE ERROR (phone):", err.message));
  await phone.goto(`${BASE}/dashboard`);
  await phone.locator("[data-testid=my-day]").waitFor();
  const bar = await phone.locator("[data-testid=phone-tabs]").boundingBox();
  assert.ok(Math.abs(bar.y + bar.height - 844) <= 1 && bar.height >= 56, `the tab bar sits on the bottom (${JSON.stringify(bar)})`);
  assert.deepEqual(await phone.locator("[data-testid=phone-tab]").allTextContents(), ["Today", "Contacts", "Companies", "Pipeline"]);
  assert.equal(await phone.locator("[data-testid=phone-tab][aria-current=page]").textContent(), "Today");
  assert.match(await phone.locator("[data-testid=next-bar-name]").textContent(), /Lou Late/);
  const next = await phone.locator("[data-testid=next-bar]").boundingBox();
  assert.ok(next.y + next.height <= bar.y + 1, "the Next bar sits above the tabs");
  const width = await phone.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(width <= 391, `My day on a phone scrolls sideways (${width}px)`);
  const upNextTop = (await phone.locator("[data-testid=up-next]").boundingBox()).y;
  assert.ok(upNextTop < 700, `Up next starts on the first screen (${upNextTop}px)`);
  for (const button of await phone.locator("[data-testid=up-next-row]").first().locator("[data-testid=up-next-call], [data-testid=up-next-text], [data-testid=up-next-log]").all()) {
    const box = await button.boundingBox();
    if (box) assert.ok(box.height >= 44, `an Up next button is ${box.height}px tall`);
  }
  await shot(phone, "myday-phone");
  await phone.locator("[data-testid=phone-more]").tap();
  const more = phone.locator("[data-testid=phone-more-sheet]");
  await more.waitFor();
  const hrefs = await more.locator("nav a").evaluateAll((els) => els.map((el) => el.getAttribute("href")));
  for (const want of ["/dashboard", "/dashboard/calendar", "/dashboard/contacts", "/dashboard/contacts/favorites", "/dashboard/companies", "/dashboard/labels", "/dashboard/deals", "/dashboard/quotes", "/dashboard/contracts/tracker", "/dashboard/products/ratesheets", "/dashboard/projects/crews", "/dashboard/stats", "/dashboard/settings/account"]) {
    assert.ok(hrefs.includes(want), `More lists ${want}`);
  }
  assert.equal(await more.locator("[data-testid=look-switch]").count(), 1, "Dark / Light is under More");
  await more.locator("[data-testid=phone-logout]").tap();
  await more.locator("[data-testid=logout-confirm]").waitFor();
  assert.match(phone.url(), /\/dashboard$/, "nothing happens before Yes");
  await more.locator("[data-testid=sheet-close]").tap();

  log("the phone's Week opens on today; the calendar's tab is under More");
  await phone.goto(`${BASE}/dashboard/calendar?view=week&on=${TODAY}`);
  await phone.locator(`[data-week-card="${TODAY}"]`).waitFor();
  await until(async () => {
    const top = await phone.locator(`[data-week-card="${TODAY}"]`).evaluate((el) => el.getBoundingClientRect().top);
    return top < 300;
  }, "today's card scrolled up");
  assert.equal(await phone.locator("[data-testid=phone-more][aria-current=page]").count(), 1, "Calendar lives under More");
  await phoneContext.close();

  log("an Owner's bare calendar on a phone swaps to the Agenda");
  const ownerPhone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p2 = await ownerPhone.newPage();
  await login(p2, EMAIL);
  await p2.goto(`${BASE}/dashboard/calendar`);
  await p2.waitForURL(/view=agenda/);
  await p2.locator("[data-testid=agenda]").waitFor();
  const w2 = await p2.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(w2 <= 391, `the Agenda on a phone scrolls sideways (${w2}px)`);
  await shot(p2, "agenda-phone");
  await ownerPhone.close();

  await browser.close();
  console.log(`\n${step} steps passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
