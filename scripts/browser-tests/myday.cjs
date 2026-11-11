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

  // Round 2: Mia's meeting is a real booked meeting on a Meeting Set tile
  // (Quinn's last touch is 40 days back and Quinn is nobody's, so the owner
  // still sells nothing and stays out of Team today)
  // (the one meeting rule reads OpportunityMeeting, not bare calendar
  // entries); a quiet opportunity of the owner's with Quinn as Primary; and
  // one text Marcus logged on two people in one save.
  await sql(`UPDATE "Organization" SET "quietDays"=7 WHERE id=$1`, [org]);
  await sql(
    `INSERT INTO "Contact" (id,"organizationId",name,"companyId",status,"ownerId",mobile,"createdAt","updatedAt") VALUES
       ('ctc_md_quinn',$1,'Quinn Quiet','cmp_md_redbud','MEETING_COMPLETED',NULL,'(512) 555-0109',now() - interval '50 days',now())`,
    [org],
  );
  await sql(
    `INSERT INTO "Opportunity" (id,"organizationId",title,stage,"ownerId","createdAt","updatedAt") VALUES
       ('opp_md_mia',$1,'Redbud Dental','MEETING_SET',$2,now() - interval '8 days',now()),
       ('opp_md_quinn',$1,'Redbud Dental North','MEETING_COMPLETED',$3,now() - interval '45 days',now())`,
    [org, M, taylor.id],
  );
  await sql(
    `INSERT INTO "OpportunityContact" (id,"opportunityId","contactId",role) VALUES
       ('oc_md_mia','opp_md_mia','ctc_md_mia','PRIMARY'),
       ('oc_md_quinn','opp_md_quinn','ctc_md_quinn','PRIMARY')`,
  );
  await sql(
    `INSERT INTO "OpportunityMeeting" (id,"opportunityId","on","eventId","bookedById","createdAt") VALUES
       ('om_md_mia','opp_md_mia',($1::date + time '10:00') AT TIME ZONE $2,'ev_md_mia',$3,now() - interval '8 days')`,
    [addDays(TODAY, -1), ZONE, M],
  );
  await sql(
    `INSERT INTO "Activity" (id,"organizationId","contactId","userId",type,body,outcome,"occurredAt","batchId") VALUES
       ('act_md_q',$1,'ctc_md_quinn',$2,'PHONE_CALL','Last call','TALKED',${ago(40)},NULL),
       ('act_md_p1',$1,'ctc_md_mia',$3,'TEXT','See you soon','SENT',${ago(2)},'b_md_pair'),
       ('act_md_p2',$1,'ctc_md_tom',$3,'TEXT','See you soon','SENT',${ago(2)},'b_md_pair')`,
    [org, taylor.id, M],
  );
  await sql(`UPDATE "Activity" SET "createdAt"=now() - interval '40 days' WHERE id='act_md_q'`);

  log("a Member lands on My day: the first tab, the greeting and three week rings");
  await login(page, MARCUS_EMAIL);
  await page.locator("[data-testid=my-day]").waitFor();
  const tabs = await page.locator("[data-testid=report-tab]").allTextContents();
  assert.deepEqual(tabs, ["My day", "Daily Rundown", "Pipeline report", "Activity", "Closing", "Money Owed"]);
  assert.equal(await page.locator("[data-testid=report-tab][aria-current=page]").textContent(), "My day");
  assert.match(await page.locator("[data-testid=my-day-greeting]").textContent(), /^(Morning|Afternoon|Evening), Marcus · 1 follow-up late · \d+ to call/);
  assert.equal(await page.locator("[data-testid=week-rings] a[data-testid^=ring-]").count(), 3);
  assert.equal(await page.locator("[data-testid=greeting-rewrite]").count(), 0, "Rewrite shows only when AI is on");
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
  assert.equal(await meeting.locator("[data-testid=meeting-tile]").getAttribute("href"), "/dashboard/deals?open=opp_md_mia", "the row links to its tile");
  const miaRow = page.locator("[data-testid=up-next-row][data-contact-id=ctc_md_mia]");
  assert.equal(await miaRow.getAttribute("data-category"), "meeting", "the booked meeting waits, by the one rule");
  assert.equal(await meeting.locator("[data-testid=meeting-noshow]").count(), 1);
  await meeting.locator("[data-testid=meeting-held]").click();
  await page.locator("[data-testid=log-toast-words]", { hasText: /^Held · Mia Meeting/ }).waitFor();
  await until(async () => (await sql(`SELECT outcome FROM "OpportunityMeeting" WHERE id='om_md_mia'`)).rows[0].outcome === "HELD", "the booked meeting answered Held");
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

  log("Sprint R2: Up next rows have Book, which opens the shared Book meeting sheet");
  const niaRow = page.locator("[data-testid=up-next-row][data-contact-id=ctc_md_nia]");
  await niaRow.locator("[data-testid=up-next-book]").click();
  await page.locator("[data-testid=book-meeting-fields]").waitFor();
  await page.keyboard.press("Escape");
  await page.locator("[data-testid=book-meeting-fields]").waitFor({ state: "detached" });

  log("Sprint R2: Team & money holds the full write-up and Recent activity one line per save naming the people; open is remembered");
  const teamMoney = page.locator("[data-testid=team-money]");
  assert.equal(await teamMoney.getAttribute("open"), null);
  await teamMoney.locator("> summary").click();
  await teamMoney.locator("[data-testid=report-narrative]").waitFor();
  assert.equal(await teamMoney.locator("[data-testid=report-narrative-more]").count(), 0, "the full write-up, not folded");
  const recent = await teamMoney.locator("[data-testid=recent-who]").allTextContents();
  const pair = /^(Mia Meeting, Tom Talked|Tom Talked, Mia Meeting) · Redbud Dental · Marcus Reed$/;
  assert.equal(recent.filter((line) => pair.test(line)).length, 1, `one line naming both people for the two-person text: ${recent.join(" | ")}`);
  await until(async () => (await sql(`SELECT "uiPrefs" FROM "User" WHERE id=$1`, [M])).rows[0].uiPrefs?.myday?.teamMoney === true, "open remembered");
  await page.reload();
  assert.equal(await page.locator("[data-testid=team-money]").getAttribute("open"), "", "still open after a reload");
  await page.locator("[data-testid=team-money] > summary").click();
  await until(async () => (await sql(`SELECT "uiPrefs" FROM "User" WHERE id=$1`, [M])).rows[0].uiPrefs?.myday?.teamMoney === false, "shut remembered");

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

  log("Sprint (integration): Import my list opens Import CSV straight away on the Contacts list, and closing it leaves the list's own address");
  const myDayUrl = page.url();
  assert.equal(await page.locator("[data-testid=jump-import]").getAttribute("href"), "/dashboard/contacts?import=1");
  await page.locator("[data-testid=jump-import]").click();
  await page.waitForURL(/\/dashboard\/contacts\?import=1$/);
  const importDialog = page.locator("[role=dialog][aria-label='Import CSV']");
  await importDialog.waitFor();
  await importDialog.locator("[data-testid=import-file]").waitFor();
  await importDialog.locator("button[aria-label=Close]").click();
  await importDialog.waitFor({ state: "detached" });
  await until(async () => !/import=1/.test(page.url()), "?import=1 taken off");
  await page.reload();
  await page.locator("[data-testid=cleanup]").waitFor();
  assert.equal(await importDialog.count(), 0, "a refresh doesn't open it again");
  await page.locator("[data-testid=cleanup]").click();
  await page.locator("[data-testid=cleanup-import]").click();
  await importDialog.waitFor();
  await importDialog.locator("button[aria-label=Close]").click();
  await page.goto(myDayUrl);
  await page.locator("[data-testid=jump-in-member]").waitFor();

  log("the Member's Daily Rundown tab names itself and keeps BDR shortcuts in Jump in");
  assert.match(await page.locator("[data-testid=report-tab][data-report=daily]").getAttribute("href"), /report=daily/);
  await page.locator("[data-testid=report-tab][data-report=daily]").click();
  await page.locator("[data-testid=report][data-report=daily]").waitFor();
  await page.locator("[data-testid=jump-in-member]").waitFor();
  assert.equal(await page.getByText("Change branding").count(), 0);
  assert.equal(await page.locator("[data-testid=team-today]").count(), 0, "Team today is for Owners and Admins");

  log("Sprint R2: a Member's Rundown opens on Me, Whole team one tap away; rows lead to people with Call; done entries fold");
  assert.match(await page.locator("[data-testid=report-scope]").textContent(), /Marcus Reed$/);
  assert.equal(await page.locator("[data-testid=report-rep]").inputValue(), M);
  const rundownOverdue = page.locator("[data-testid=rundown-overdue]");
  assert.match(await rundownOverdue.textContent(), /Lou Late/);
  assert.equal(await rundownOverdue.locator("[data-testid=rundown-person]").first().getAttribute("href"), "/dashboard/contacts/ctc_md_lou");
  assert.equal(await rundownOverdue.locator("[data-testid=rundown-call]").first().getAttribute("href"), "tel:5125550102");
  assert.equal(await rundownOverdue.locator("[data-testid=rundown-overdue-all]").getAttribute("href"), "/dashboard/calendar?view=agenda");
  const cal = page.locator("[data-testid=rundown-calendar]");
  assert.match(await cal.locator("[data-testid=rundown-row]").first().textContent(), /Tia Today/);
  assert.equal(await cal.locator("[data-testid=rundown-row][data-done]").count(), 0, "done entries aren't in the open list");
  const doneFold = cal.locator("[data-testid=rundown-done]");
  assert.equal(await doneFold.getAttribute("open"), null, "Done today is collapsed");
  assert.match(await doneFold.locator("summary").textContent(), /Done today \(\d+\)/);
  await page.locator("[data-testid=report-rep]").selectOption("all");
  await page.waitForURL(/rep=all/);
  await page.locator("[data-testid=report-scope]", { hasText: /Whole team$/ }).waitFor();
  assert.match(await page.locator("[data-testid=rundown-quiet]").textContent(), /Quinn Quiet/, "the whole team's quiet opportunity names its Primary");

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

  log("the toolbar: [Mine | Team] [Agenda · Week · Month] [View] [Filters (n)] [+ New]; nothing removed");
  await page.locator("[data-testid=cal-view-menu]").click();
  const viewPanel = page.locator("[data-testid=cal-view-panel]");
  await viewPanel.waitFor();
  assert.equal(await viewPanel.locator("[data-testid=cal-view-team]").count(), 1, "the Team week is in View");
  await page.keyboard.press("Escape");
  await page.goto(`${BASE}/dashboard/calendar?view=week&on=${TODAY}`);
  await page.locator("[data-testid=cal-view-menu]").click();
  for (const id of ["cal-layout-calendar", "cal-layout-log", "cal-layout-both", "cal-copy-week"]) {
    assert.equal(await viewPanel.locator(`[data-testid=${id}]`).count(), 1, `${id} is in View`);
  }
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("[data-testid=cal-filters-open]").textContent(), "Filters");
  await page.locator("[data-testid=cal-filters-open]").click();
  const filterSheet = page.locator("[data-testid=cal-filters-sheet]");
  await filterSheet.waitFor();
  for (const id of ["cal-users", "cal-companies", "cal-contacts", "cal-projects", "cal-crew-filter", "cal-type-filter"]) {
    assert.equal(await filterSheet.locator(`[data-testid=${id}]`).count(), 1, `${id} is in Filters`);
  }
  await filterSheet.locator("[data-testid=cal-type-filter]").selectOption("Call");
  await page.waitForURL(/type=Call/);
  await page.locator("[data-testid=cal-filters-done]").click();
  await page.locator("[data-testid=cal-filters-open]", { hasText: /^Filters \(1\)$/ }).waitFor();
  assert.match(await page.locator("[data-testid=cal-active-filters]").textContent(), /Call/);
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await page.waitForURL((url) => !url.searchParams.has("type"));

  log("+ New opens a sheet set to Call with Title, Type, Day and Time; the rest is under More");
  await page.locator("[data-testid=cal-add-event]").click();
  const newSheet = page.locator("[data-testid=cal-new-sheet]");
  await newSheet.waitFor();
  assert.equal(await newSheet.locator("[data-testid=event-type]").inputValue(), "Call");
  for (const id of ["event-title", "event-type", "event-start-on", "event-start-time"]) {
    assert.ok(await newSheet.locator(`[data-testid=${id}]`).isVisible(), `${id} shows at once`);
  }
  assert.equal(await newSheet.locator("[data-testid=event-owner]").isVisible(), false, "Whose calendar waits under More");
  await newSheet.locator("[data-testid=event-title]").fill("Call back Nia");
  await newSheet.locator("[data-testid=event-start-time]").fill("15:00");
  await newSheet.locator("[data-testid=event-more]").click();
  assert.ok(await newSheet.locator("[data-testid=event-owner]").isVisible());
  await newSheet.locator("[data-testid=event-contact]").selectOption("ctc_md_nia");
  await newSheet.locator("[data-testid=event-save]").click();
  await newSheet.waitFor({ state: "detached" });
  const nia = (await sql(`SELECT type, "startTime", "ownerId", "contactId" FROM "CalendarEvent" WHERE "organizationId"=$1 AND title='Call back Nia'`, [org])).rows[0];
  assert.deepEqual(nia, { type: "Call", startTime: "15:00", ownerId: M, contactId: "ctc_md_nia" });

  log("Sprint R2: Agenda / Week / Month is remembered per person");
  await page.goto(`${BASE}/dashboard/calendar`);
  await page.locator("[data-testid=cal-view-week]").click();
  await until(async () => (await sql(`SELECT "uiPrefs" FROM "User" WHERE id=$1`, [M])).rows[0].uiPrefs?.calendar?.view === "week", "week remembered");
  await page.goto(`${BASE}/dashboard/calendar`);
  await page.locator("[data-testid=cal-view-week][aria-selected=true]").waitFor();
  await page.locator("[data-testid=week-grid]").waitFor();
  await page.locator("[data-testid=cal-view-agenda]").click();
  await until(async () => (await sql(`SELECT "uiPrefs" FROM "User" WHERE id=$1`, [M])).rows[0].uiPrefs?.calendar?.view === "agenda", "agenda remembered");

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
  assert.deepEqual(await op.locator("[data-testid=report-tab]").allTextContents(), ["Daily Rundown", "Pipeline report", "Activity", "Closing", "Money Owed"]);
  const team = op.locator("[data-testid=team-row]");
  assert.deepEqual(await team.evaluateAll((els) => els.map((el) => el.dataset.rep)), [M]);
  assert.match(await team.first().locator("[data-testid=team-today-numbers]").textContent(), /Today 1 try · 0 talks \(0%\) · 0 booked/);
  assert.equal(await team.first().locator("[data-testid=team-dot]").getAttribute("data-fresh"), "", "logged in the last two hours");
  assert.match(await op.locator("[data-testid=team-unowned]").textContent(), /12 new leads nobody owns/);
  await op.locator("[data-testid=jump-in-member]").count().then((n) => assert.equal(n, 0, "an Owner keeps the owner's Jump in"));

  log("Sprint R2: the Owner's four money tiles in whole dollars, the rest under More numbers; the write-up is a headline and Read more");
  assert.deepEqual(
    await op.locator("[data-testid=money-tiles] [data-testid=stat-tile]").evaluateAll((els) => els.map((el) => el.dataset.label)),
    ["Owed to you", "Quoted & sent", "Awaiting signature", "Open pipeline"],
  );
  for (const value of await op.locator("[data-testid=money-tiles] [data-testid=stat-tile] p.num").allTextContents()) assert.match(value, /^\$[\d,]+$/, `whole dollars: ${value}`);
  const moreNumbers = op.locator("[data-testid=more-numbers]");
  assert.equal(await moreNumbers.getAttribute("open"), null);
  assert.deepEqual(await moreNumbers.locator("[data-testid=stat-tile]").evaluateAll((els) => els.map((el) => el.dataset.label)), ["Active jobs", "Contacts", "Signed"]);
  const headline = await op.locator("[data-testid=report-narrative-headline]").textContent();
  assert.match(headline, /[.!?]$/, `one sentence: ${headline}`);
  assert.equal(await op.locator("[data-testid=report-scope]").textContent().then((t) => /Whole team$/.test(t)), true, "an Owner's Rundown is the whole team");
  const quiet = op.locator("[data-testid=rundown-quiet] [data-testid=rundown-row]").first();
  assert.match(await quiet.textContent(), /Quinn Quiet/);
  assert.match(await quiet.locator("[data-testid=rundown-quiet-sub]").textContent(), /^Redbud Dental · Taylor Test$/);
  assert.equal(await quiet.locator("[data-testid=rundown-call]").getAttribute("href"), "tel:5125550109");

  log("Sprint R2: the Activity report's rep rows leave out a teammate with no book and no touches");
  await sql(`INSERT INTO "User" (id, name, email, "passwordHash", role, "organizationId") VALUES ('usr_md_idle','Ida Idle',$1,$2,'MEMBER',$3)`, ["test-myday-idle@example.com", taylor.passwordHash, org]);
  await op.goto(`${BASE}/dashboard?report=activity&period=this-week`);
  const groups = op.locator("[data-testid=activity-groups]");
  await groups.waitFor();
  const groupsText = await groups.textContent();
  assert.match(groupsText, /Marcus Reed/);
  assert.doesNotMatch(groupsText, /Ida Idle/, "nobody with no book and no touches");
  assert.doesNotMatch(await op.locator("[data-testid=report-narrative-body]").textContent(), /Ida Idle/);
  await op.goto(`${BASE}/dashboard`);
  await op.locator("[data-testid=team-row]").first().waitFor();

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
  await p2.locator("[data-testid=report][data-report=daily]").waitFor();
  const overdueY = (await p2.locator("[data-testid=rundown-overdue]").boundingBox()).y;
  const todayY = (await p2.locator("[data-testid=rundown-calendar]").boundingBox()).y;
  assert.ok(overdueY < todayY, "on a phone Overdue comes above Today");
  const reportBar = p2.locator("[data-testid=report-bar]");
  assert.equal(await reportBar.evaluate((el) => getComputedStyle(el).flexWrap), "nowrap", "the report tabs are one sideways strip");
  for (const h of await reportBar.locator("a").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height))) assert.ok(h >= 44, `a report tab is ${h}px`);
  assert.ok((await p2.evaluate(() => document.documentElement.scrollWidth)) <= 391, "the Rundown doesn't scroll sideways");
  const tilesBox = await p2.locator("[data-testid=money-tiles] [data-testid=stat-tile]").evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
  assert.equal(new Set(tilesBox).size, 2, `money tiles 2×2 on a phone (${tilesBox})`);
  await p2.goto(`${BASE}/dashboard/calendar`);
  await p2.waitForURL(/view=agenda/);
  await p2.locator("[data-testid=agenda]").waitFor();
  const strip = p2.locator("[data-testid=agenda-strip-day]");
  assert.equal(await strip.count(), 7, "a one-week day strip on top");
  assert.equal(await strip.first().getAttribute("data-day"), TODAY);
  for (const box of await strip.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height))) assert.ok(box >= 44);
  assert.equal(await p2.locator("[data-testid=cal-view-month]").isVisible(), false, "Month sits behind View on a phone");
  await p2.locator("[data-testid=cal-view-menu]").tap();
  await p2.locator("[data-testid=cal-view-month-phone]").tap();
  await p2.locator("[data-testid=month-day]").first().waitFor();
  await p2.goto(`${BASE}/dashboard/calendar?view=agenda`);
  await p2.locator("[data-testid=cal-add-event]").tap();
  const phoneSheet = await p2.locator("[data-testid=cal-new-sheet]").boundingBox();
  assert.ok(Math.abs(phoneSheet.y + phoneSheet.height - 844) <= 2, "a new entry opens as a bottom sheet");
  await p2.locator("[data-testid=cal-new-sheet] [data-testid=sheet-close]").tap();
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
