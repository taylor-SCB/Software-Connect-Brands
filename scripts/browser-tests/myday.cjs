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
 * an Owner's bare calendar on a phone swapping to the Agenda. The final
 * audit's cross-area steps (Nov 11, 2026): a rep's own quiet account in the
 * greeting past the workspace's 300 quietest, and the Agenda's Overdue read
 * on its own answering exactly as the Log's, and keeping the Type filter;
 * a number with an extension dialled right on Up next, the Rundown and the
 * Agenda (lists audit L30).
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
  await sheet.locator("[data-testid=outcome-save]").click();
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
  assert.equal(await rundownOverdue.locator("[data-testid=rundown-overdue-all]").getAttribute("href"), `/dashboard/calendar?view=agenda&users=${M}`, "the Agenda on the same person (audit)");
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
  for (const h of await reportBar.locator("a").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height))) assert.ok(Math.round(h) >= 44, `a report tab is ${h}px`);
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

  /* ------------------------------ audit fixes ------------------------------ */
  // The final audit of the BDR sprint (Nov 11, 2026), area "today". Each
  // step fails on the code before its fix.
  const atZone = (iso, hhmm) => `(('${iso}'::date + time '${hhmm}') AT TIME ZONE '${ZONE}')`;
  const setScope = (value) =>
    sql(
      `UPDATE "User" SET "uiPrefs" = jsonb_set(COALESCE("uiPrefs"::jsonb,'{}'::jsonb), '{calendar}', COALESCE("uiPrefs"::jsonb->'calendar','{}'::jsonb) || jsonb_build_object('scope', $2::text)) WHERE id=$1`,
      [M, value],
    );
  const prefScope = async () => (await sql(`SELECT "uiPrefs" FROM "User" WHERE id=$1`, [M])).rows[0].uiPrefs?.calendar?.scope;
  const auditM = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const am = await auditM.newPage();
  am.on("pageerror", (err) => console.error("PAGE ERROR:", err.message));
  await login(am, MARCUS_EMAIL);

  log("audit fixes: Take 10 keeps its Undo when it empties the pool, and skips a lead touched since the page loaded");
  const ownerOf = async (id) => (await sql(`SELECT "ownerId" FROM "Contact" WHERE id=$1`, [id])).rows[0].ownerId;
  const resetPool = () => sql(`UPDATE "Contact" SET "ownerId"=NULL, status='NOT_ACTIONED', "lastTouchAt"=NULL WHERE "organizationId"=$1 AND id LIKE 'ctc_md_un%'`, [org]);
  await resetPool();
  await sql(`UPDATE "Contact" SET "ownerId"=$2 WHERE "organizationId"=$1 AND id LIKE 'ctc_md_un%' AND id NOT IN ('ctc_md_un1','ctc_md_un2','ctc_md_un3')`, [org, taylor.id]);
  await am.goto(`${BASE}/dashboard`);
  const pool = am.locator("[data-testid=unowned]");
  assert.equal(await pool.locator("[data-testid=unowned-count]").textContent(), "3 new leads nobody owns");
  // A teammate calls one after the page loaded; nobody owns it yet.
  await sql(`UPDATE "Contact" SET "lastTouchAt"=now() WHERE id='ctc_md_un3'`);
  await pool.locator("[data-testid=unowned-take]").click();
  await pool.locator("[data-testid=unowned-confirm]").click();
  await until(async () => (await ownerOf("ctc_md_un1")) === M, "taken");
  assert.equal(await ownerOf("ctc_md_un3"), null, "a lead touched since the page loaded isn't taken");
  // The refresh finds nobody left; the toast and its Undo stay.
  await until(async () => (await am.locator("[data-testid=unowned-count]").count()) === 0, "the pool empty");
  await am.waitForTimeout(500);
  assert.equal(await am.locator("[data-testid=unowned-toast] [data-testid=unowned-undo]").count(), 1, "Undo is still there after the pool emptied");

  log("audit fixes: Take 10's Undo keeps the leads she has worked, and a second take has its own Undo");
  await resetPool();
  await am.goto(`${BASE}/dashboard`);
  await pool.locator("[data-testid=unowned-take]").click();
  await pool.locator("[data-testid=unowned-confirm]").click();
  const toast = am.locator("[data-testid=unowned-toast]");
  await toast.locator("[data-testid=unowned-undo]").waitFor();
  const taken = (await sql(`SELECT id FROM "Contact" WHERE "organizationId"=$1 AND "ownerId"=$2 AND id LIKE 'ctc_md_un%' ORDER BY id`, [org, M])).rows.map((row) => row.id);
  assert.equal(taken.length, 10);
  // She works one before thinking better of it.
  await sql(`UPDATE "Contact" SET status='CONTACTED', "lastTouchAt"=now() WHERE id=$1`, [taken[0]]);
  await toast.locator("[data-testid=unowned-undo]").click();
  await until(async () => (await ownerOf(taken[1])) === null, "the untouched ones given back");
  assert.equal(await ownerOf(taken[0]), M, "a lead she has worked keeps its rep");
  await until(async () => /^\d+ new leads/.test((await pool.locator("[data-testid=unowned-count]").textContent().catch(() => "")) ?? ""), "the pool back");
  await pool.locator("[data-testid=unowned-take]").click();
  await pool.locator("[data-testid=unowned-confirm]").click();
  await until(async () => (await sql(`SELECT count(*)::int n FROM "Contact" WHERE "organizationId"=$1 AND "ownerId"=$2 AND id LIKE 'ctc_md_un%'`, [org, M])).rows[0].n >= 10, "the second take");
  await am.waitForTimeout(500);
  assert.equal(await toast.locator("[data-testid=unowned-undo]").count(), 1, "the second take has its own Undo");
  await resetPool();

  log("audit fixes: Team & money isn't built while it is shut (no write-up asked for), and opening it builds it");
  await am.goto(`${BASE}/dashboard`);
  const money = am.locator("[data-testid=team-money]");
  assert.equal(await money.getAttribute("open"), null);
  assert.equal(await money.locator("[data-testid=report-narrative]").count(), 0, "nothing inside a shut Team & money");
  assert.equal(await money.locator("[data-testid=stat-tile]").count(), 0);
  await money.locator("> summary").click();
  await money.locator("[data-testid=report-narrative]").waitFor();
  await money.locator("> summary").click();
  await until(async () => (await sql(`SELECT "uiPrefs" FROM "User" WHERE id=$1`, [M])).rows[0].uiPrefs?.myday?.teamMoney === false, "shut again");

  log("audit fixes: the Meetings card still lists this week's meeting after a month of answered ones, on its own day when a teammate holds the entry");
  await sql(`INSERT INTO "Opportunity" (id,"organizationId",title,stage,"ownerId","createdAt","updatedAt") VALUES ('opp_md_busy',$1,'Busy Book','MEETING_COMPLETED',$2,now() - interval '40 days',now())`, [org, M]);
  for (let i = 1; i <= 65; i += 1) {
    const d = addDays(TODAY, -1 - (i % 29));
    await sql(`INSERT INTO "OpportunityMeeting" (id,"opportunityId","on",outcome,"bookedById","createdAt") VALUES ($1,'opp_md_busy',${atZone(d, "12:00")},'HELD',$2,now() - interval '30 days')`, [`om_md_busy${i}`, M]);
  }
  await sql(`INSERT INTO "Opportunity" (id,"organizationId",title,stage,"ownerId","createdAt","updatedAt") VALUES ('opp_md_up',$1,'Upcoming Tile','MEETING_SET',$2,now(),now())`, [org, M]);
  await sql(
    `INSERT INTO "CalendarEvent" (id,"organizationId",title,type,"startOn","startTime","ownerId","contactId","updatedAt") VALUES ('ev_md_up',$1,'Meeting · Busy upcoming','Meeting',$3::date,'15:00',$2,'ctc_md_tom',now())`,
    [org, taylor.id, addDays(TODAY, 2)],
  );
  // Stamped the way the calendar form stamped it before the audit: the
  // bare day, midnight UTC, which is the evening before in Chicago.
  await sql(`INSERT INTO "OpportunityMeeting" (id,"opportunityId","on","eventId","bookedById") VALUES ('om_md_up','opp_md_up',($1::date)::timestamp,'ev_md_up',$2)`, [addDays(TODAY, 2), taylor.id]);
  await am.goto(`${BASE}/dashboard`);
  const upRow = am.locator("[data-testid=meeting-row][data-event-id=ev_md_up]");
  await upRow.waitFor();
  assert.equal(await upRow.getAttribute("data-day"), addDays(TODAY, 2), "on the entry's own day");
  await sql(`DELETE FROM "Opportunity" WHERE id IN ('opp_md_busy','opp_md_up')`);
  await sql(`DELETE FROM "CalendarEvent" WHERE id='ev_md_up'`);

  log("audit fixes: a meeting saved on the calendar is its time in the workspace's clock, and moving it moves the meeting");
  await sql(`INSERT INTO "Opportunity" (id,"organizationId",title,stage,"ownerId","createdAt","updatedAt") VALUES ('opp_md_c1',$1,'Ty Trying','MEETING_SET',$2,now(),now())`, [org, M]);
  await sql(`INSERT INTO "OpportunityContact" (id,"opportunityId","contactId",role) VALUES ('oc_md_c1','opp_md_c1','ctc_md_ty','PRIMARY')`);
  await sql(
    `INSERT INTO "CalendarEvent" (id,"organizationId",title,type,"startOn","startTime","ownerId","contactId","updatedAt") VALUES ('ev_md_c1',$1,'Meeting · Ty Trying','Meeting',$3::date,'09:00',$2,'ctc_md_ty',now())`,
    [org, M, addDays(TODAY, 1)],
  );
  await sql(`INSERT INTO "OpportunityMeeting" (id,"opportunityId","on","eventId","bookedById") VALUES ('om_md_c1','opp_md_c1',${atZone(addDays(TODAY, 1), "09:00")},'ev_md_c1',$1)`, [M]);
  const meetingsAt = async (iso, hhmm) =>
    (await sql(`SELECT bool_and("on" = ${atZone(iso, hhmm)}) AS ok, count(*)::int AS n FROM "OpportunityMeeting" WHERE "eventId"='ev_md_c1'`)).rows[0];
  await am.goto(`${BASE}/dashboard/calendar?view=week&on=${addDays(TODAY, 1)}`);
  const c1Card = am.locator("[data-testid=event-card]").filter({ hasText: "Meeting · Ty Trying" }).first();
  await c1Card.locator("[data-testid=event-edit]").click();
  await am.locator("[data-testid=event-form] [data-testid=event-start-time]").fill("16:00");
  await am.locator("[data-testid=event-form] [data-testid=event-save]").click();
  await until(async () => (await sql(`SELECT "startTime" FROM "CalendarEvent" WHERE id='ev_md_c1'`)).rows[0].startTime === "16:00", "the edit saved");
  const afterEdit = await meetingsAt(addDays(TODAY, 1), "16:00");
  assert.ok(afterEdit.n >= 1 && afterEdit.ok, "the meeting is 4pm in Chicago, not midnight UTC");
  await am.goto(`${BASE}/dashboard/calendar?view=week&on=${addDays(TODAY, 1)}`);
  const c1Moved = am.locator("[data-testid=event-card]").filter({ hasText: "Meeting · Ty Trying" }).first();
  await c1Moved.locator("[data-testid=event-move]").click();
  await c1Moved.locator("[data-testid=event-move-date]").fill(addDays(TODAY, 3));
  await until(async () => (await sql(`SELECT "startOn" FROM "CalendarEvent" WHERE id='ev_md_c1'`)).rows[0].startOn.toISOString().slice(0, 10) === addDays(TODAY, 3), "moved");
  await until(async () => (await meetingsAt(addDays(TODAY, 3), "16:00")).ok === true, "the meeting moved with its entry");
  await sql(`DELETE FROM "Opportunity" WHERE id='opp_md_c1'`);
  await sql(`DELETE FROM "CalendarEvent" WHERE id='ev_md_c1'`);

  log("audit fixes: Copy this week into next copies only what Mine shows");
  const far = addDays(TODAY, 70);
  await sql(
    `INSERT INTO "CalendarEvent" (id,"organizationId",title,type,"startOn","ownerId","updatedAt") VALUES
       ('ev_md_cpm',$1,'Copy me (Marcus)','Site walk',$4::date,$2,now()),
       ('ev_md_cpt',$1,'Not mine (Taylor)','Site walk',$4::date,$3,now())`,
    [org, M, taylor.id, far],
  );
  await setScope("mine");
  await am.goto(`${BASE}/dashboard/calendar?view=week&on=${far}`);
  await am.locator("[data-testid=event-card]").filter({ hasText: "Copy me (Marcus)" }).waitFor();
  assert.equal(await am.locator("[data-testid=event-card]").filter({ hasText: "Not mine (Taylor)" }).count(), 0, "Mine shows only Marcus's");
  await am.locator("[data-testid=cal-view-menu]").click();
  await am.locator("[data-testid=cal-copy-week]").click();
  await am.getByText(/copied into the week of/).waitFor();
  const copies = (await sql(`SELECT title FROM "CalendarEvent" WHERE "organizationId"=$1 AND "startOn"=$2::date ORDER BY title`, [org, addDays(far, 7)])).rows.map((row) => row.title);
  assert.deepEqual(copies, ["Copy me (Marcus)"], `only what was on screen was copied: ${copies.join(", ")}`);
  await sql(`DELETE FROM "CalendarEvent" WHERE "organizationId"=$1 AND "startOn" IN ($2::date, $3::date)`, [org, far, addDays(far, 7)]);

  log("audit fixes: Clear after a company filter keeps a Member's remembered Mine");
  await setScope("mine");
  await am.goto(`${BASE}/dashboard/calendar?view=agenda&companies=cmp_md_redbud`);
  await am.locator("[data-testid=cal-active-filters]").getByRole("button", { name: "Clear", exact: true }).click();
  await am.waitForURL((url) => !url.search.includes("companies"));
  await am.locator("[data-testid=agenda]").waitFor();
  assert.equal(await prefScope(), "mine", "dropping a company filter isn't choosing Team");

  log("audit fixes: the Rundown's Overdue 'See all' opens the Agenda on the same people; a full Overdue says so; Log works on the Agenda; Done today names the rest");
  const ov = Array.from({ length: 60 }, (_, i) => `('ev_md_ov${i}','${org}','Call · overdue ${i}','Call','${addDays(TODAY, -2)}'::date,'${M}',now())`).join(",");
  await sql(`INSERT INTO "CalendarEvent" (id,"organizationId",title,type,"startOn","ownerId","updatedAt") VALUES ${ov}`);
  const dn = Array.from({ length: 9 }, (_, i) => `('ev_md_dn${i}','${org}','Call · done ${i}','Call','${TODAY}'::date,'${M}',now(),now())`).join(",");
  await sql(`INSERT INTO "CalendarEvent" (id,"organizationId",title,type,"startOn","ownerId","doneAt","updatedAt") VALUES ${dn}`);
  const auditO = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const ao = await auditO.newPage();
  await login(ao, EMAIL);
  await ao.goto(`${BASE}/dashboard?report=daily&rep=${M}`);
  const seeAll = ao.locator("[data-testid=rundown-overdue] a[href*='view=agenda']");
  assert.match(await seeAll.getAttribute("href"), new RegExp(`users=${M}`), "narrowed to Marcus, it opens on Marcus");
  await ao.locator("[data-testid=rundown-done] > summary").click();
  assert.equal(await ao.locator("[data-testid=rundown-done-more]").count(), 1, "Done today says how many more there are");
  await ao.goto(`${BASE}/dashboard?report=daily&rep=all`);
  const teamSeeAll = await ao.locator("[data-testid=rundown-overdue] a[href*='view=agenda']").getAttribute("href");
  assert.match(teamSeeAll, /scope=team/, "the whole team opens on the whole team");
  await ao.goto(`${BASE}${teamSeeAll}`);
  await ao.locator("[data-testid=agenda-overdue]").waitFor();
  assert.equal(await ao.locator("[data-testid=agenda-overdue-more]").count(), 1, "a full Overdue says more are waiting");
  await ao.locator("[data-testid=cal-view-menu]").click();
  assert.equal(await ao.locator("[data-testid=cal-layout-log]").count(), 1, "Log is offered on the Agenda");
  await ao.locator("[data-testid=cal-layout-log]").click();
  await ao.locator("[data-testid=log-columns]").waitFor();
  assert.equal(await ao.locator("[data-testid=agenda]").count(), 0, "the Agenda's Log shows the history");
  await sql(`DELETE FROM "CalendarEvent" WHERE id LIKE 'ev_md_ov%' OR id LIKE 'ev_md_dn%'`);

  log("audit fixes: Team today's 'See them' lists the same people its count is");
  await ao.goto(`${BASE}/dashboard`);
  const seeThem = await ao.locator("[data-testid=team-unowned] a").getAttribute("href");
  assert.match(seeThem, /rep=none/);
  assert.match(seeThem, /status=NOT_ACTIONED/);
  assert.match(seeThem, /act=never/);
  await auditO.close();

  log("audit fixes: the phone — the tab bar shows above a contact's own bar, the top bar never covers the Pipeline's stage tabs or the week's day, the active tab's words are readable, the calendar's small targets are 44px and long names shorten");
  const contrast = (a, b) => {
    const lum = (rgb) => {
      const [r, g, bl] = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map((v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    };
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  await sql(`INSERT INTO "Company" (id,"organizationId",name,"updatedAt") VALUES ('cmp_md_long',$1,'Northwest Regional Property Management and Facilities Services Group LLC',now())`, [org]);
  await sql(`INSERT INTO "Contact" (id,"organizationId",name,"companyId",email,"ownerId","createdAt","updatedAt") VALUES ('ctc_md_long',$1,'Bartholomew Montgomery-Fairweather','cmp_md_long','bartholomew.montgomery-fairweather@northwest-regional.example.com',$2,now(),now())`, [org, M]);
  for (let i = 0; i < 25; i += 1) {
    await sql(`INSERT INTO "Contact" (id,"organizationId",name,status,"ownerId","createdAt","updatedAt") VALUES ($1,$2,$3,'MEETING_SET',$4,now(),now())`, [`ctc_md_ms${i}`, org, `Board Filler ${i}`, M]);
  }
  await sql(
    `INSERT INTO "CalendarEvent" (id,"organizationId",title,type,"startOn","startTime","ownerId","contactId","updatedAt") VALUES ('ev_md_tap',$1,'Call · Tom Talked','Call',$3::date,'11:00',$2,'ctc_md_tom',now())`,
    [org, M, TODAY],
  );
  const phoneM = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const pm = await phoneM.newPage();
  await login(pm, MARCUS_EMAIL);
  // A contact's Call / Text / Log bar sits above the tabs, not over them.
  await pm.goto(`${BASE}/dashboard/contacts/ctc_md_tom`);
  await pm.locator("[data-testid=phone-tabs]").waitFor();
  const covered = await pm.locator("[data-testid=phone-tab], [data-testid=phone-more]").evaluateAll((els) =>
    els.filter((el) => {
      const box = el.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return !hit || !el.contains(hit);
    }).length,
  );
  assert.equal(covered, 0, `${covered} tabs are covered on a contact's page`);
  // The active tab: words in the text colour, readable on the bar.
  await pm.goto(`${BASE}/dashboard/contacts`);
  const active = await pm.locator("[data-testid=phone-tab][aria-current=page]").evaluate((el) => [
    getComputedStyle(el).color,
    getComputedStyle(el.closest("nav")).backgroundColor,
  ]);
  assert.ok(contrast(active[0], active[1]) >= 4.5, `the active tab's words read ${contrast(active[0], active[1]).toFixed(2)}:1`);
  // The Pipeline's stage tabs stay in sight when the board scrolls.
  await pm.goto(`${BASE}/dashboard/deals?scope=all`);
  await pm.locator("[data-testid=pipeline-tabs]").waitFor();
  await until(async () => (await pm.evaluate(() => document.documentElement.scrollHeight)) > 2000, "a long board");
  await pm.evaluate(() => window.scrollTo(0, 900));
  await pm.waitForTimeout(400);
  const tabsSeen = await pm.locator("[data-testid=pipeline-tabs]").evaluate((el) => {
    const box = el.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return Boolean(hit && el.contains(hit));
  });
  assert.ok(tabsSeen, "the stage tabs aren't under the top bar");
  // The week opens on today's card with its heading in sight.
  await pm.goto(`${BASE}/dashboard/calendar?view=week`);
  const todayCard = pm.locator(`[data-week-card="${TODAY}"]`);
  await todayCard.waitFor();
  await pm.waitForTimeout(700);
  const headingSeen = await todayCard.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + 20, Math.max(box.top, 0) + 8);
    return Boolean(hit && el.contains(hit));
  });
  assert.ok(headingSeen, "today's heading isn't under the top bar");
  for (const id of ["cal-prev", "cal-next"]) {
    const box = await pm.locator(`[data-testid=${id}]`).boundingBox();
    assert.ok(Math.round(box.width) >= 44, `${id} is ${box.width}px wide`);
  }
  const tap = await pm.locator(`[data-week-card="${TODAY}"] [data-testid=event-call]`).first().boundingBox();
  assert.ok(Math.round(tap.height) >= 44, `the tap-to-call badge is ${tap.height}px tall`);
  // A long company filter shortens instead of widening the page.
  await pm.goto(`${BASE}/dashboard/calendar?view=agenda&companies=cmp_md_long`);
  await pm.locator("[data-testid=cal-active-filters] .badge").first().waitFor();
  const wide = await pm.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(wide <= 391, `a long company chip widens the page to ${wide}px`);
  const x = await pm.locator("[data-testid=cal-active-filters] .badge button").first().boundingBox();
  assert.ok(Math.round(x.height) >= 44 && Math.round(x.width) >= 44, "the chip's × is a 44px target");
  // Jump in's Who? list shortens long lines instead of scrolling sideways.
  await pm.goto(`${BASE}/dashboard`);
  await pm.locator("[data-testid=jump-log-call]").tap();
  await pm.locator("[data-testid=jump-who]").waitFor();
  await pm.fill("[data-testid=jump-who-search]", "Bartholomew");
  await pm.locator("[data-testid=jump-who-pick]").first().waitFor();
  const list = await pm.locator("[data-testid=jump-who-pick]").first().evaluate((el) => {
    const ul = el.closest("ul");
    return [ul.scrollWidth, ul.clientWidth];
  });
  assert.ok(list[0] <= list[1], `the Who? list scrolls sideways (${list[0]} > ${list[1]})`);
  await phoneM.close();
  // An Owner's Team today on a phone: name, today's numbers, the health bar.
  const phoneO = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const po = await phoneO.newPage();
  await login(po, EMAIL);
  const teamRow = po.locator("[data-testid=team-row]").first();
  await teamRow.waitFor();
  assert.equal(await teamRow.locator("[data-testid=team-week-numbers]").isVisible(), false, "the week's rings are on the rep's My day");
  assert.equal(await teamRow.locator("[data-testid=team-today-numbers]").isVisible(), true);
  await phoneO.close();
  await sql(`DELETE FROM "Contact" WHERE id LIKE 'ctc_md_ms%' OR id='ctc_md_long'`);
  await sql(`DELETE FROM "Company" WHERE id='cmp_md_long'`);
  await sql(`DELETE FROM "CalendarEvent" WHERE id='ev_md_tap'`);

  // Final audit, cross-area fixes (Nov 11, 2026).
  log("audit fixes: My day's greeting names the rep's own quiet account even with more than 300 quieter ones in the workspace");
  // goneQuietOpportunities took the workspace's 300 quietest and My day
  // kept Marcus's afterwards, so 320 of Taylor's, quiet longer, pushed his
  // own out of his greeting. The rep is now part of the statement.
  await sql(
    `INSERT INTO "Opportunity" (id,"organizationId",title,stage,"ownerId","createdAt","updatedAt")
     SELECT 'opp_md_hush' || g, $1, 'Hushed account ' || g, 'MEETING_COMPLETED', $2, now() - interval '60 days', now() FROM generate_series(1, 320) g`,
    [org, taylor.id],
  );
  await sql(
    `INSERT INTO "Opportunity" (id,"organizationId",title,stage,"ownerId","createdAt","updatedAt") VALUES ('opp_md_bluebird',$1,'Bluebird Spa','MEETING_COMPLETED',$2,now() - interval '20 days',now())`,
    [org, M],
  );
  await am.goto(`${BASE}/dashboard`);
  await am.locator("[data-testid=my-day]").waitFor();
  assert.match((await am.locator("[data-testid=my-day-greeting]").textContent()).trim(), /· Bluebird Spa quiet 20 days$/, "Marcus's own quiet account, past the workspace's 300");
  await sql(`DELETE FROM "Opportunity" WHERE "organizationId"=$1 AND (id LIKE 'opp_md_hush%' OR id='opp_md_bluebird')`, [org]);

  log("audit fixes: the Agenda's Overdue, now its own read, lists exactly the Log's Overdue: oldest first, never done, ahead, still running or a day of work, and the filter applied");
  // The Agenda ran the whole Log (three 60-row reads) for its Overdue; it
  // reads only that now. Its speed is timed by load-test.cjs; this checks it
  // still answers the same as the Log's own column, for Mine and filtered.
  await sql(
    `INSERT INTO "CalendarEvent" (id,"organizationId",title,type,"startOn","endOn","startTime","ownerId","contactId","doneAt","updatedAt") VALUES
       ('ev_md_ag1',$1,'Call · oldest','Call',$3::date,NULL,NULL,$2,NULL,NULL,now()),
       ('ev_md_ag2',$1,'Email · Tom at nine','Email',$4::date,NULL,'09:00',$2,'ctc_md_tom',NULL,now()),
       ('ev_md_ag3',$1,'Text · at eight','Text',$4::date,NULL,'08:00',$2,NULL,NULL,now()),
       ('ev_md_ag4',$1,'Call · ticked','Call',$5::date,NULL,NULL,$2,'ctc_md_tom',now(),now()),
       ('ev_md_ag5',$1,'Install · a day of work','Install',$5::date,NULL,NULL,$2,'ctc_md_tom',NULL,now()),
       ('ev_md_ag6',$1,'Call · still running','Call',$6::date,$7::date,NULL,$2,'ctc_md_tom',NULL,now()),
       ('ev_md_ag7',$1,'Call · ahead','Call',$7::date,NULL,NULL,$2,'ctc_md_tom',NULL,now())`,
    [org, M, addDays(TODAY, -6), addDays(TODAY, -2), addDays(TODAY, -3), addDays(TODAY, -1), addDays(TODAY, 1)],
  );
  const agendaOverdue = async (query) => {
    await am.goto(`${BASE}/dashboard/calendar?view=agenda&${query}`);
    await am.locator("[data-testid=agenda]").waitFor();
    return am.locator("[data-testid=agenda-overdue] [data-testid=agenda-row]").evaluateAll((rows) => rows.map((row) => row.dataset.eventId));
  };
  const logOverdue = async (query) => {
    await am.goto(`${BASE}/dashboard/calendar?view=agenda&layout=log&${query}`);
    await am.locator("[data-testid=log-columns]").waitFor();
    return am.locator("[data-testid=log-overdue] [data-testid=log-row]").evaluateAll((rows) => rows.map((row) => row.dataset.eventId));
  };
  const mine = await agendaOverdue(`users=${M}`);
  assert.deepEqual(mine.filter((id) => id.startsWith("ev_md_ag")), ["ev_md_ag1", "ev_md_ag3", "ev_md_ag2"], "oldest first, then by time; ticked, ahead, still running and Install left out");
  assert.deepEqual(mine, await logOverdue(`users=${M}`), "the same list as the Log's Overdue");
  const tom = await agendaOverdue("scope=team&contacts=ctc_md_tom");
  assert.deepEqual(tom, ["ev_md_ag2"], "a contact filter narrows it");
  assert.deepEqual(tom, await logOverdue("scope=team&contacts=ctc_md_tom"));

  log("audit fixes: the Agenda's and the Log's Overdue keep the toolbar's Type: a Call filter lists the overdue call alone, an Install filter no Overdue at all");
  // loadOverdue spread its own list of overdue types after the filter, so
  // the type list replaced the Type picked: ?type=Call still listed the
  // overdue email and text, and ?type=Install every overdue entry.
  const calls = await agendaOverdue(`users=${M}&type=Call`);
  assert.deepEqual(calls.filter((id) => id.startsWith("ev_md_ag")), ["ev_md_ag1"], "the overdue Email and Text are not Calls");
  assert.deepEqual(calls, await logOverdue(`users=${M}&type=Call`), "the Log's Overdue column the same");
  await am.goto(`${BASE}/dashboard/calendar?view=agenda&users=${M}&type=Install`);
  await am.locator("[data-testid=agenda]").waitFor();
  assert.equal(await am.locator("[data-testid=agenda-overdue]").count(), 0, "an Install is a day of work, never overdue");
  await sql(`DELETE FROM "CalendarEvent" WHERE id LIKE 'ev_md_ag%'`);

  log("audit fixes (lists L30): a number with an extension dials the number, then the extension, on Up next, the Rundown and the Agenda; a text never carries it");
  // Up next, the Rundown's Call and the Agenda's Call / Text stripped
  // everything but digits, so "(512) 555-0177 x31" dialled 512555017731.
  await sql(
    `INSERT INTO "Contact" (id,"organizationId",name,status,"ownerId",mobile,"createdAt","updatedAt") VALUES ('ctc_md_ext',$1,'Ezra Extension','CONTACTED',$2,'(512) 555-0177 x31',now() - interval '20 days',now())`,
    [org, M],
  );
  await sql(
    `INSERT INTO "CalendarEvent" (id,"organizationId",title,type,"startOn","ownerId","contactId","updatedAt") VALUES ('ev_md_ext',$1,'Call · Ezra Extension','Call',$3::date,$2,'ctc_md_ext',now())`,
    [org, M, addDays(TODAY, -2)],
  );
  await am.goto(`${BASE}/dashboard/calendar?view=agenda&users=${M}`);
  await am.locator("[data-testid=agenda]").waitFor();
  const extRow = am.locator('[data-testid=agenda-row][data-event-id="ev_md_ext"]');
  assert.equal(await extRow.locator("[data-testid=agenda-call]").getAttribute("href"), "tel:5125550177,31");
  assert.equal(await extRow.locator("[data-testid=agenda-text]").getAttribute("href"), "sms:5125550177");
  await am.goto(`${BASE}/dashboard`);
  await am.locator("[data-testid=my-day]").waitFor();
  const extNext = am.locator("[data-testid=up-next-row][data-contact-id=ctc_md_ext]");
  assert.equal(await extNext.locator("[data-testid=up-next-call]").getAttribute("href"), "tel:5125550177,31");
  assert.equal(await extNext.locator("[data-testid=up-next-text]").getAttribute("href"), "sms:5125550177");
  await am.goto(`${BASE}/dashboard?report=daily`);
  await am.locator("[data-testid=rundown-overdue]").waitFor();
  assert.equal(
    await am.locator('[data-testid=rundown-overdue] [data-testid=rundown-call][aria-label="Call Ezra Extension"]').getAttribute("href"),
    "tel:5125550177,31",
  );
  await sql(`DELETE FROM "CalendarEvent" WHERE id='ev_md_ext'`);
  await sql(`DELETE FROM "Contact" WHERE id='ctc_md_ext'`);
  await auditM.close();



  /* ------------------- audit fixes (session audit, Nov 12, 2026) ------------------- */
  log("audit fixes (session audit): one call on 100 people is one line with its true count, and earlier saves stay on Done today and Recent activity");
  {
    await sql(
      `INSERT INTO "Contact" (id,"organizationId",name,status,"ownerId","createdAt","updatedAt")
       SELECT 'ctc_md_bulk' || g, $1, 'Bulk Person ' || lpad(g::text, 3, '0'), 'CONTACTED', NULL, now() - interval '40 days', now() FROM generate_series(1, 100) g`,
      [org],
    );
    await sql(
      `INSERT INTO "Activity" (id,"organizationId","contactId","userId",type,body,"occurredAt","batchId")
       SELECT 'act_md_bulk' || g, $1, 'ctc_md_bulk' || g, $2, 'PHONE_CALL', 'Announcement call', now(), 'b_md_bulk' FROM generate_series(1, 100) g`,
      [org, M],
    );
    await page.goto(`${BASE}/dashboard`);
    const doneCard = page.locator("[data-testid=done-today]");
    await doneCard.locator("> summary").click();
    const lines = await doneCard.locator("[data-testid=done-row]").allTextContents();
    assert.ok(lines.length >= 2, `earlier saves are still listed: ${lines.join(" | ")}`);
    const bulk = lines.filter((line) => /Bulk Person/.test(line));
    assert.equal(bulk.length, 1, `the 100-person save is one line: ${lines.join(" | ")}`);
    assert.match(bulk[0], /Bulk Person \d+ \+ 99 · Phone Call/, `it reads "+ 99": ${bulk[0]}`);
    assert.ok(lines.some((line) => /Ty Trying · Phone Call · No answer/.test(line)), "the morning's No answer is still there");
    const teamMoney2 = page.locator("[data-testid=team-money]");
    if ((await teamMoney2.getAttribute("open")) === null) await teamMoney2.locator("> summary").click();
    const firstRecent = teamMoney2.locator("[data-testid=recent-row]").first();
    await firstRecent.waitFor();
    assert.equal((await firstRecent.locator("[data-testid=recent-more]").textContent()).trim(), "+97", "three named, +97 more");
    assert.ok((await teamMoney2.locator("[data-testid=recent-row]").count()) >= 2, "the big save doesn't push every other line off");
  }

  log("audit fixes (session audit): a follow-up on several people is due for each of them, today and late");
  {
    await sql(
      `INSERT INTO "Contact" (id,"organizationId",name,status,"ownerId","createdAt","updatedAt") VALUES
         ('ctc_md_ann',$1,'Ann Attendee','CONTACTED',$2,now() - interval '20 days',now()),
         ('ctc_md_bea',$1,'Bea Attendee','CONTACTED',$2,now() - interval '20 days',now()),
         ('ctc_md_cal',$1,'Cal Attendee','CONTACTED',$2,now() - interval '20 days',now()),
         ('ctc_md_dot',$1,'Dot Attendee','CONTACTED',$2,now() - interval '20 days',now())`,
      [org, M],
    );
    await sql(
      `INSERT INTO "CalendarEvent" (id,"organizationId",title,type,"startOn","ownerId","contactId","updatedAt") VALUES
         ('ev_md_grp_today',$1,'Call · Ann Attendee','Call',$3::date,$2,'ctc_md_ann',now()),
         ('ev_md_grp_late',$1,'Call · Cal Attendee','Call',$4::date,$2,'ctc_md_cal',now())`,
      [org, M, TODAY, addDays(TODAY, -2)],
    );
    await sql(`INSERT INTO "_EventAttendees" ("A","B") VALUES ('ev_md_grp_today','ctc_md_bea'), ('ev_md_grp_late','ctc_md_dot')`);
    await page.goto(`${BASE}/dashboard`);
    await page.locator("[data-testid=up-next-all]").click().catch(() => {});
    const cat = (id) => page.locator(`[data-testid=up-next-row][data-contact-id=${id}]`).getAttribute("data-category");
    assert.equal(await cat("ctc_md_ann"), "today");
    assert.equal(await cat("ctc_md_bea"), "today", "the second person on today's call is due too");
    assert.equal(await cat("ctc_md_cal"), "late");
    assert.equal(await cat("ctc_md_dot"), "late", "and on a late one, late too");
  }

  log("audit fixes (session audit): a Member's links that name a rep or the whole team open the Daily Rundown, not My day");
  {
    await page.goto(`${BASE}/dashboard?rep=${M}`);
    await page.locator("[data-testid=report][data-report=daily]").waitFor();
    assert.equal(await page.locator("[data-testid=my-day]").count(), 0);
    await page.goto(`${BASE}/dashboard?report=daily&rep=all`);
    await page.locator("[data-testid=report-scope]", { hasText: /Whole team$/ }).waitFor();
    assert.match(await page.locator("[data-testid=report-tab][data-report=daily]").getAttribute("href"), /report=daily.*rep=all/, "Whole team stays whole team");
    await sql(`INSERT INTO "ReportSubscription" (id,"organizationId","recipientId",report,cadence,"repId") VALUES ('rs_md_daily',$1,$2,'DAILY','DAILY',NULL)`, [org, M]);
    await page.goto(`${BASE}/dashboard/settings/account`);
    const emailLink = page.locator("[data-testid=my-report-email] a").first();
    const href = await emailLink.getAttribute("href");
    assert.match(href, /report=daily/);
    assert.match(href, /rep=all/);
    await emailLink.click();
    await page.locator("[data-testid=report-scope]", { hasText: /Whole team$/ }).waitFor();
    await sql(`DELETE FROM "ReportSubscription" WHERE id='rs_md_daily'`);
  }

  log("audit fixes (session audit): a calendar filter keeps a Member's Mine, Clear keeps it, the Team week shows everyone, Escape in a list keeps Filters open");
  {
    await sql(`UPDATE "User" SET "uiPrefs" = jsonb_set(COALESCE("uiPrefs",'{}'::jsonb), '{calendar}', '{"scope":"mine","view":"agenda"}'::jsonb) WHERE id=$1`, [M]);
    await page.goto(`${BASE}/dashboard/calendar?view=week&on=${TODAY}&type=Call`);
    await page.locator("[data-testid=cal-just-me][aria-pressed=true]").waitFor();
    assert.equal(await page.locator("[data-testid=cal-everyone]").getAttribute("aria-pressed"), "false");
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await page.waitForURL((url) => !url.searchParams.has("type"));
    await page.locator("[data-testid=cal-just-me][aria-pressed=true]").waitFor();
    assert.equal((await sql(`SELECT "uiPrefs" FROM "User" WHERE id=$1`, [M])).rows[0].uiPrefs.calendar.scope, "mine", "Clear didn't overwrite Mine");
    await sql(
      `INSERT INTO "CalendarEvent" (id,"organizationId",title,type,"startOn","ownerId","updatedAt") VALUES ('ev_md_owner_walk',$1,'Owner site walk','Site walk',$2::date,$3,now())`,
      [org, TODAY, taylor.id],
    );
    await page.goto(`${BASE}/dashboard/calendar?view=team&on=${TODAY}`);
    await page.locator("[data-testid=team-grid]").waitFor();
    assert.match(await page.locator(`[data-testid=team-row][data-row="u-${taylor.id}"]`).getAttribute("data-things"), /^[1-9]/, "a teammate's row shows their day under Mine");
    await page.goto(`${BASE}/dashboard/calendar?view=agenda`);
    await page.locator("[data-testid=cal-filters-open]").click();
    await page.locator("[data-testid=cal-users]").click();
    await page.getByRole("listbox", { name: "Users" }).waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("listbox", { name: "Users" }).waitFor({ state: "detached" });
    assert.equal(await page.locator("[data-testid=cal-filters-sheet]").count(), 1, "the Filters sheet stays open");
    await page.keyboard.press("Escape");
    await page.locator("[data-testid=cal-filters-sheet]").waitFor({ state: "detached" });
  }

  log("audit fixes (session audit): Awaiting signature counts a quote once; the write-up's headline isn't cut at \"Dr.\"");
  {
    await sql(
      `INSERT INTO "Deal" (id,"organizationId","contactId",title,stage,"ownerId","updatedAt") VALUES
         ('deal_md_aw',$1,'ctc_md_quinn','Quinn upgrade','CONTRACT_SENT',$2,now()),
         ('deal_md_draft',$1,'ctc_md_quinn','Quinn lobby','QUOTE_SENT',$2,now())`,
      [org, taylor.id],
    );
    await sql(
      `INSERT INTO "Quote" (id,"organizationId","contactId","dealId",number,title,status,"publicToken","updatedAt") VALUES
         ('q_md_aw',$1,'ctc_md_quinn','deal_md_aw',9800,'Quinn upgrade quote','SENT','tok_md_aw_0123456789',now()),
         ('q_md_draft',$1,'ctc_md_quinn','deal_md_draft',9801,'Quinn lobby quote','DRAFT','tok_md_draft_012345678',now())`,
      [org],
    );
    await sql(
      `INSERT INTO "QuoteLineItem" (id,"quoteId",name,quantity,"unitPriceCents",tag,position) VALUES
         ('ql_md_aw','q_md_aw','Camera package',1,2000000,'MATERIALS',0),
         ('ql_md_draft','q_md_draft','Lobby reader',1,50000,'MATERIALS',0)`,
    );
    await sql(
      `INSERT INTO "Contract" (id,"organizationId","contactId","dealId","quoteId",number,title,body,status,payable,"publicToken","updatedAt") VALUES
         ('con_md_svc',$1,'ctc_md_quinn','deal_md_aw','q_md_aw',9800,'Service Agreement','Body','SENT',false,'tok_md_con_svc_0123456',now()),
         ('con_md_cmp',$1,'ctc_md_quinn','deal_md_aw','q_md_aw',9801,'Compliance Agreement','Body','SENT',false,'tok_md_con_cmp_0123456',now())`,
      [org],
    );
    await sql(
      `INSERT INTO "CalendarEvent" (id,"organizationId",title,type,"startOn","startTime","ownerId","updatedAt") VALUES ('ev_md_dr',$1,'Follow up · Dr. Smith','Call',$2::date,'06:00',$3,now())`,
      [org, TODAY, taylor.id],
    );
    const own = await browser.newContext({ viewport: { width: 1440, height: 950 } });
    const o2 = await own.newPage();
    await login(o2, EMAIL);
    await o2.locator("[data-testid=report][data-report=daily]").waitFor();
    assert.equal(await o2.locator('[data-testid=money-tiles] [data-testid=stat-tile][data-label="Awaiting signature"] p.num').textContent(), "$20,000", "the $20,000 quote once, not twice");
    const head = await o2.locator("[data-testid=report-narrative-headline]").textContent();
    assert.doesNotMatch(head, /Dr\.$/, `headline cut at an abbreviation: ${head}`);
    assert.match(head, /Dr\. Smith/);

    log("audit fixes (session audit): on a phone the quote's pinned Next sits above the tab bar; on a tablet so does the Save bar");
    const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: await own.storageState() });
    const ph = await phoneCtx.newPage();
    await ph.goto(`${BASE}/dashboard/quotes/q_md_draft`);
    const pinned = ph.locator(".dj-next[data-sticky]");
    await pinned.waitFor();
    // The page fades in; until it settles its transform holds fixed bars.
    await until(async () => (await ph.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length)) === 0, "the page settled");
    const tabs = await ph.locator("[data-testid=phone-tabs]").boundingBox();
    const next = await pinned.boundingBox();
    assert.ok(next.y + next.height <= tabs.y + 1, `the Next button (${next.y}+${next.height}) sits above the tabs (${tabs.y})`);
    await phoneCtx.close();
    const tabletCtx = await browser.newContext({ viewport: { width: 820, height: 1180 }, storageState: await own.storageState() });
    const tb = await tabletCtx.newPage();
    await tb.goto(`${BASE}/dashboard/quotes/q_md_draft`);
    const saveBar = tb.locator("[data-testid=quote-save-bar]");
    await saveBar.waitFor();
    await until(async () => (await tb.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length)) === 0, "the page settled");
    const tabBox = await tb.locator("[data-testid=phone-tabs]").boundingBox();
    const stuck = parseFloat(await saveBar.evaluate((el) => getComputedStyle(el).bottom));
    assert.ok(stuck >= tabBox.height - 1, `the Save bar sticks ${stuck}px up, above the ${tabBox.height}px tab bar (its 1px top line may meet it)`);
    await tabletCtx.close();
    await own.close();
  }

  await browser.close();
  console.log(`\n${step} steps passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
