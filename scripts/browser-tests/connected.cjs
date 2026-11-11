/* Browser regression for the BDR redesign's data (Releases 2 and 3, Nov 11,
 * 2026): outcomes on touches, Connected on the ladder, the lastConnectAt
 * triggers, Held / No-show / Reschedule, reasons, next steps and Undo.
 *
 * Covers: the triggers keeping lastTouchAt and lastConnectAt in one UPDATE
 * (a past meeting connects, a voicemail is a try, a no-show is neither, a
 * connect dated ahead lands once crm_touch_due() runs after its time, a
 * company takes its own or its people's latest, moving or deleting rows
 * recomputes); outcomesSince on a new workspace; the CSV status words; the
 * contact log form with an outcome (Talked → Connected through Attempted,
 * the chip's words as the note, Voicemail stays Attempted, a mismatched
 * outcome refused in words), Not interested with a reason, Meeting booked
 * (Meeting Set through Connected, the calendar entry, bookedById, the
 * Pipeline line), "Try to book a meeting" and "Try again in 30 days"
 * moving no status; undoLog taking a booked save back whole (activity,
 * calendar copy, meeting entry, status changes, opportunity) and refusing
 * twice and for a teammate; the company page's Front desk chip; the
 * calendar Done box holding a meeting with no double count; Held on a
 * meeting already logged setting HELD on its line, a meeting still ahead
 * asking first; No-show keeping Meeting Set and not being a touch;
 * Reschedule booking a new meeting on the same tile; Not interested and
 * Lost by hand keeping the reason; Log as sent writing SENT; Connected and
 * Attempted in the Status filter and the Stats funnel.
 *
 * Calls the server actions the new screens will use straight over HTTP
 * (the action ids come from .next/server/server-reference-manifest.json),
 * so it needs a production build in the working directory.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/scb_test \
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules \
 *   node scripts/browser-tests/connected.cjs
 */
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS on purpose: NODE_PATH only resolves the global playwright for require() */
const os = require("node:os");
const { chromium } = require("playwright");
const { Client } = require("pg");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const assert = require("node:assert/strict");

const BASE = process.env.BASE || "http://localhost:3000";
const DB = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5433/scb_test";
const OUT = process.env.SHOTS_DIR || path.join(os.tmpdir(), "scb-browser-shots-connected");
fs.mkdirSync(OUT, { recursive: true });

const EMAIL = "test-connected@example.com";
const NIC_EMAIL = "test-connected-nic@example.com";
const PASSWORD = "password123";
const COMPANY = "Test Connected Co";
const SLUG_LIKE = "test-connected-co%";
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
  for (let i = 0; i < 60; i += 1) {
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
const dates = async (table, id) => one(`SELECT "lastTouchAt", "lastConnectAt" FROM "${table}" WHERE id=$1`, [id]);
const ladder = async (contactId) =>
  (await sql(`SELECT "fromStatus" AS f, "toStatus" AS t FROM "StatusChange" WHERE "contactId"=$1 ORDER BY "createdAt", "on", id`, [contactId])).rows.map(
    (r) => `${r.f}>${r.t}`,
  );

// A server action called the way the browser calls it: POST to a page that
// carries it, with its id in the Next-Action header and the arguments as
// JSON. The id is looked up by file and export in the build's manifest.
const MANIFEST = JSON.parse(fs.readFileSync(path.join(process.cwd(), ".next/server/server-reference-manifest.json"), "utf8"));
function actionRef(file, name) {
  for (const [id, entry] of Object.entries(MANIFEST.node)) {
    if (entry.filename === file && entry.exportedName === name) {
      const workers = Object.keys(entry.workers);
      const pick = workers.find((w) => !w.includes("[")) ?? workers[0];
      const url = pick.replace(/^app/, "").replace(/\/page$/, "").replace(/\[[^\]]+\]/g, "x") || "/";
      return { id, url };
    }
  }
  throw new Error(`no server action ${name} in ${file} (rebuild?)`);
}
async function action(page, file, name, ...args) {
  const ref = actionRef(file, name);
  const response = await page.request.post(`${BASE}${ref.url}`, {
    headers: { "Next-Action": ref.id, "Content-Type": "text/plain;charset=UTF-8", Accept: "text/x-component", Origin: BASE },
    data: JSON.stringify(args),
  });
  const text = await response.text();
  const rows = new Map();
  for (const line of text.split("\n")) {
    const match = /^([0-9a-f]+):(.*)$/.exec(line);
    if (match) {
      try {
        rows.set(match[1], JSON.parse(match[2]));
      } catch {
        rows.set(match[1], match[2]);
      }
    }
  }
  const head = rows.get("0");
  const pointer = head && typeof head.a === "string" ? head.a.replace(/^\$@/, "") : null;
  const result = pointer !== null ? rows.get(pointer) : head;
  if (result === undefined) throw new Error(`${name}: unreadable answer (${response.status()}): ${text.slice(0, 300)}`);
  return result;
}
const CONTACT_ACTIONS = "src/app/dashboard/contacts/actions.ts";
const OPP_ACTIONS = "src/app/dashboard/deals/opportunity-actions.ts";
const hasAction = (file, name) => Object.values(MANIFEST.node).some((entry) => entry.filename === file && entry.exportedName === name);

// The Pipeline's Held / No-show / Reschedule actions are only in the build
// once a screen imports them. Until then the same answer they give (the
// functions in src/lib/meetings.ts that the actions return, after the
// session check) is run directly with tsx, as that user in that workspace.
const MEETING_CORE = { markMeetingHeld: "meetingHeldAnswer", markMeetingNoShow: "meetingNoShowAnswer", rescheduleMeeting: "meetingRescheduleAnswer" };
function core(module, fn, args) {
  const code = `import * as lib from "./src/lib/${module}";
    const args = JSON.parse(process.env.CORE_ARGS);
    lib.${fn}(...args).then(
      (answer) => { console.log("@@" + JSON.stringify(answer)); process.exit(0); },
      (err) => { console.error(err); process.exit(1); });`;
  const out = execFileSync(path.join(process.cwd(), "node_modules/.bin/tsx"), ["-e", code], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, CORE_ARGS: JSON.stringify(args) },
  });
  const line = out.split("\n").find((row) => row.startsWith("@@"));
  if (!line) throw new Error(`${fn}: no answer: ${out.slice(0, 300)}`);
  return JSON.parse(line.slice(2));
}
async function meetingAction(page, actor, name, ...args) {
  if (hasAction(OPP_ACTIONS, name)) return action(page, OPP_ACTIONS, name, ...args);
  return core("meetings", MEETING_CORE[name], [actor, ...args]);
}

// The log form lives in the How did it go? sheet, opened from the "What
// happened with …?" bar on a contact page and "Log a touch" on a company
// page (Nov 11, 2026).
async function openLog(page) {
  const form = page.locator("[data-testid=log-activity-form]");
  if (!(await form.isVisible().catch(() => false))) await page.locator("[data-testid=log-bar], [data-testid=company-log-toggle]").first().click();
  await form.waitFor();
  return form;
}

// The contact or company log form, with the new "How did it go?" fields
// added as hidden inputs: the form posts them to logActivity as is.
async function logWith(page, fields, { body = "", type } = {}) {
  const form = await openLog(page);
  if (type) await form.getByRole("button", { name: type, exact: true }).click();
  await form.locator("textarea[name=body]").fill(body);
  await form.evaluate((el, extra) => {
    el.querySelectorAll("input[data-sprint]").forEach((input) => input.remove());
    for (const [name, value] of extra) {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = name;
      input.value = value;
      input.dataset.sprint = "1";
      el.appendChild(input);
    }
  }, Object.entries(fields).flatMap(([name, value]) => (Array.isArray(value) ? value.map((v) => [name, v]) : [[name, value]])));
  await form.locator("[data-testid=activity-submit]").click();
}

(async () => {
  await sql(`DELETE FROM "Organization" WHERE slug LIKE $1`, [SLUG_LIKE]);
  await sql(`DELETE FROM "User" WHERE email = $1`, [NIC_EMAIL]);

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await context.newPage();
  page.on("pageerror", (err) => console.error("PAGE ERROR:", err.message));

  log("signup + activate + login, plus a teammate");
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
  const org = (await one(`SELECT id, "outcomesSince" FROM "Organization" WHERE slug LIKE $1`, [SLUG_LIKE])).id;
  const taylor = await one(`SELECT id, "passwordHash" FROM "User" WHERE email = $1`, [EMAIL]);
  const nicId = "usr_conn_nic";
  await sql(
    `INSERT INTO "User" (id, name, email, "passwordHash", role, "organizationId") VALUES ($1, 'Nic Rivera', $2, $3, 'MEMBER', $4)`,
    [nicId, NIC_EMAIL, taylor.passwordHash, org],
  );
  await sql(
    `INSERT INTO "Company" (id,"organizationId",name,"updatedAt") VALUES
       ('cmp_cn_iron',$1,'Ironwood GC',now()), ('cmp_cn_red',$1,'Redbud Dental',now()), ('cmp_cn_trg',$1,'Trigger Test',now())`,
    [org],
  );
  await sql(
    `INSERT INTO "Contact" (id,"organizationId",name,"companyId",phone,"updatedAt") VALUES
       ('ctc_cn_kris',$1,'Kristen Vaughn','cmp_cn_iron','5125550101',now()),
       ('ctc_cn_chase',$1,'Chase Hill','cmp_cn_iron','5125550102',now()),
       ('ctc_cn_olivia',$1,'Olivia Wolfe','cmp_cn_red','5125550103',now()),
       ('ctc_cn_gus',$1,'Gus Ng','cmp_cn_red','5125550104',now()),
       ('ctc_cn_tara',$1,'Tara Trigger','cmp_cn_trg',NULL,now()),
       ('ctc_cn_moe',$1,'Moe Mover','cmp_cn_trg',NULL,now())`,
    [org],
  );

  log("Sprint: a new workspace has outcomesSince (\"Talks counted from\") set on its own");
  const since = await one(`SELECT "outcomesSince", "createdAt" FROM "Organization" WHERE id=$1`, [org]);
  assert.ok(since.outcomesSince, "set at signup");
  assert.ok(Math.abs(since.outcomesSince - since.createdAt) < 60_000, "the day the workspace was made");

  log("Sprint: triggers — a past meeting connects, a voicemail is a try, a no-show is neither");
  await sql(
    `INSERT INTO "Activity" (id,"organizationId","contactId","userId",type,body,"occurredAt") VALUES
       ('act_cn_m1',$1,'ctc_cn_tara',$2,'MEETING','Old site walk',now() - interval '10 days')`,
    [org, taylor.id],
  );
  let tara = await dates("Contact", "ctc_cn_tara");
  assert.ok(tara.lastConnectAt && tara.lastTouchAt, "an old meeting with no outcome counts as held");
  assert.equal(+tara.lastConnectAt, +tara.lastTouchAt);
  const tenDays = +tara.lastConnectAt;
  await sql(
    `INSERT INTO "Activity" (id,"organizationId","contactId","userId",type,body,outcome,"occurredAt") VALUES
       ('act_cn_vm',$1,'ctc_cn_tara',$2,'PHONE_CALL','Left voicemail','VOICEMAIL',now() - interval '5 days'),
       ('act_cn_ns',$1,'ctc_cn_tara',$2,'MEETING','No-show','NO_SHOW',now() - interval '2 days')`,
    [org, taylor.id],
  );
  tara = await dates("Contact", "ctc_cn_tara");
  assert.equal(+tara.lastConnectAt, tenDays, "a voicemail and a no-show are not connects");
  const fiveDays = +tara.lastTouchAt;
  assert.ok(Math.abs(fiveDays - (Date.now() - 5 * 86_400_000)) < 120_000, "the voicemail is the last touch; the no-show is not a touch");
  let trg = await dates("Company", "cmp_cn_trg");
  assert.deepEqual([+trg.lastTouchAt, +trg.lastConnectAt], [fiveDays, tenDays], "the company takes its person's dates");

  log("Sprint: triggers — a company's own talk, a person's later one, a move and a delete recompute both rows");
  await sql(
    `INSERT INTO "Activity" (id,"organizationId","companyId","userId",type,body,outcome,"occurredAt") VALUES
       ('act_cn_co',$1,'cmp_cn_trg',$2,'PHONE_CALL','Talked to the office','TALKED',now() - interval '3 days')`,
    [org, taylor.id],
  );
  trg = await dates("Company", "cmp_cn_trg");
  const threeDays = +trg.lastConnectAt;
  assert.ok(threeDays > tenDays && +trg.lastTouchAt === threeDays, "its own talk is later than its person's");
  await sql(
    `INSERT INTO "Activity" (id,"organizationId","contactId","userId",type,body,outcome,"occurredAt") VALUES
       ('act_cn_moe',$1,'ctc_cn_moe',$2,'TEXT','They replied','REPLIED',now() - interval '1 day')`,
    [org, taylor.id],
  );
  trg = await dates("Company", "cmp_cn_trg");
  const oneDay = +(await dates("Contact", "ctc_cn_moe")).lastConnectAt;
  assert.equal(+trg.lastConnectAt, oneDay, "a person's later reply is the company's");
  await sql(`UPDATE "Contact" SET "companyId"='cmp_cn_red' WHERE id='ctc_cn_moe'`);
  assert.equal(+(await dates("Company", "cmp_cn_trg")).lastConnectAt, threeDays, "Moe moving out takes his reply with him");
  assert.equal(+(await dates("Company", "cmp_cn_red")).lastConnectAt, oneDay, "and his new company has it");
  await sql(`UPDATE "Contact" SET "companyId"='cmp_cn_trg' WHERE id='ctc_cn_moe'`);
  await sql(`DELETE FROM "Activity" WHERE id IN ('act_cn_moe','act_cn_co')`);
  assert.equal((await dates("Contact", "ctc_cn_moe")).lastConnectAt, null, "deleting the reply clears Moe");
  assert.equal(+(await dates("Company", "cmp_cn_trg")).lastConnectAt, tenDays, "and the company falls back to Tara's meeting");
  assert.equal((await dates("Company", "cmp_cn_red")).lastConnectAt, null);

  log("Sprint: triggers — a talk dated ahead is left out until crm_touch_due() runs after its time");
  await sql(
    `INSERT INTO "Activity" (id,"organizationId","contactId","userId",type,body,outcome,"occurredAt","createdAt") VALUES
       ('act_cn_ahead',$1,'ctc_cn_moe',$2,'PHONE_CALL','Talk booked for later','TALKED',now() + interval '2 seconds', now())`,
    [org, taylor.id],
  );
  assert.equal((await dates("Contact", "ctc_cn_moe")).lastConnectAt, null, "not yet");
  await new Promise((resolve) => setTimeout(resolve, 2500));
  await sql(`SELECT crm_touch_due($1)`, [org]);
  const moe = await dates("Contact", "ctc_cn_moe");
  assert.ok(moe.lastConnectAt && +moe.lastConnectAt === +moe.lastTouchAt, "it lands once its time has come");
  assert.equal(+(await dates("Company", "cmp_cn_trg")).lastConnectAt, +moe.lastConnectAt, "and on the company");

  log("Sprint: CSV status words — connected / talked / spoke / reached are Connected, attempted is Attempted, not connected is checked first");
  const words = execFileSync(
    path.join(process.cwd(), "node_modules/.bin/tsx"),
    [
      "-e",
      `import { parseStatus } from "./src/lib/contacts-csv";
       const words = ["Connected","talked","Spoke to owner","Reached","Not connected","not reached","Reached out","Attempted","Attempted to contact","contacted","Disconnected","Not interested","Interested"];
       console.log(JSON.stringify(words.map((w) => parseStatus(w).status)));`,
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  ).trim();
  assert.deepEqual(JSON.parse(words.split("\n").pop()), [
    "CONNECTED",
    "CONNECTED",
    "CONNECTED",
    "CONNECTED",
    "CONTACTED",
    "CONTACTED",
    "CONTACTED",
    "CONTACTED",
    "CONTACTED",
    "CONTACTED",
    "CONTACTED",
    "NOT_INTERESTED",
    "INTERESTED",
  ]);

  log("Sprint: a call logged Talked from today's form — Attempted then Connected, the chip's words as the note, company too");
  await page.goto(`${BASE}/dashboard/contacts/ctc_cn_kris`);
  await logWith(page, { outcome: "TALKED" });
  await until(async () => (await status("Contact", "ctc_cn_kris")) === "CONNECTED", "Kristen connected");
  const talked = await one(`SELECT type, outcome, body, "batchId" FROM "Activity" WHERE "contactId"='ctc_cn_kris'`);
  assert.deepEqual({ ...talked, batchId: Boolean(talked.batchId) }, { type: "PHONE_CALL", outcome: "TALKED", body: "Talked", batchId: true });
  assert.deepEqual(await ladder("ctc_cn_kris"), ["NOT_ACTIONED>CONTACTED", "CONTACTED>CONNECTED"]);
  assert.equal(await status("Company", "cmp_cn_iron"), "CONNECTED", "the company follows");
  const kris = await dates("Contact", "ctc_cn_kris");
  assert.ok(kris.lastConnectAt && +kris.lastConnectAt === +kris.lastTouchAt);
  await page.locator("[data-testid=follow-up-prompt]").waitFor();
  await page.locator("[data-testid=follow-up-skip]").click();

  log("Sprint: Left voicemail is a try — Olivia is Attempted, never Connected");
  await page.goto(`${BASE}/dashboard/contacts/ctc_cn_olivia`);
  await logWith(page, { outcome: "VOICEMAIL" });
  await until(async () => (await status("Contact", "ctc_cn_olivia")) === "CONTACTED", "Olivia attempted");
  const olivia = await dates("Contact", "ctc_cn_olivia");
  assert.ok(olivia.lastTouchAt && olivia.lastConnectAt === null);
  assert.equal((await one(`SELECT body FROM "Activity" WHERE "contactId"='ctc_cn_olivia'`)).body, "Left voicemail");
  await page.locator("[data-testid=follow-up-skip]").click();

  log("Sprint: an outcome that doesn't fit the kind of touch is refused in words, and nothing is written");
  await logWith(page, { outcome: "TALKED" }, { type: "Text", body: "Sent the price sheet" });
  const form = page.locator("[data-testid=log-activity-form]");
  await form.getByRole("alert").waitFor();
  assert.match(await form.getByRole("alert").textContent(), /“Talked” isn't something a text can be/);
  assert.equal((await one(`SELECT count(*)::int n FROM "Activity" WHERE "contactId"='ctc_cn_olivia'`)).n, 1);
  assert.equal(await form.locator("textarea[name=body]").inputValue(), "Sent the price sheet", "what was typed comes back");

  log("Sprint: Talked + Not interested with a reason — through Connected, the reason on the change");
  await page.goto(`${BASE}/dashboard/contacts/ctc_cn_gus`);
  await logWith(page, { outcome: "TALKED", mark: "NOT_INTERESTED", reason: "PRICE" });
  await until(async () => (await status("Contact", "ctc_cn_gus")) === "NOT_INTERESTED", "Gus not interested");
  assert.deepEqual(await ladder("ctc_cn_gus"), ["NOT_ACTIONED>CONTACTED", "CONTACTED>CONNECTED", "CONNECTED>NOT_INTERESTED"]);
  const gusNi = await one(`SELECT reason, auto FROM "StatusChange" WHERE "contactId"='ctc_cn_gus' AND "toStatus"='NOT_INTERESTED'`);
  assert.deepEqual({ ...gusNi }, { reason: "PRICE", auto: false });
  assert.equal((await one(`SELECT body FROM "Activity" WHERE "contactId"='ctc_cn_gus'`)).body, "Talked · Not interested (Price)");

  log("Sprint: Meeting booked from a call — the call is Talked, the meeting is on the calendar and the Pipeline, booked by Taylor");
  await page.goto(`${BASE}/dashboard/contacts/ctc_cn_chase`);
  const meetDay = shift(TODAY, 4);
  await logWith(page, { next: "meeting", nextOn: meetDay, nextTime: "10:00", nextWhere: "Their office" }, { body: "Walked through the job" });
  await until(async () => (await status("Contact", "ctc_cn_chase")) === "MEETING_SET", "Chase meeting set");
  assert.deepEqual(await ladder("ctc_cn_chase"), ["NOT_ACTIONED>CONTACTED", "CONTACTED>CONNECTED", "CONNECTED>MEETING_SET"]);
  const call = await one(`SELECT id, outcome, "batchId" FROM "Activity" WHERE "contactId"='ctc_cn_chase'`);
  assert.equal(call.outcome, "TALKED", "booking on the call says it was a talk");
  const booked = await one(
    `SELECT e.id, e.type, e.title, e."startTime", e.location, e."batchId", to_char(e."startOn",'YYYY-MM-DD') AS day FROM "CalendarEvent" e
      WHERE e."organizationId"=$1 AND e.type='Meeting'`,
    [org],
  );
  assert.deepEqual(
    { title: booked.title, day: booked.day, time: booked.startTime, where: booked.location, batch: booked.batchId === call.batchId },
    { title: "Meeting · Chase Hill", day: meetDay, time: "10:00", where: "Their office", batch: true },
  );
  const om = await one(
    `SELECT m."bookedById", m."eventId", o.stage, o.id AS opp FROM "OpportunityMeeting" m JOIN "Opportunity" o ON o.id=m."opportunityId" WHERE m."eventId"=$1`,
    [booked.id],
  );
  assert.deepEqual({ by: om.bookedById, stage: om.stage }, { by: taylor.id, stage: "MEETING_SET" });
  assert.equal(await page.locator("[data-testid=follow-up-prompt]").count(), 0, "the next step was picked, so no follow-up box");
  await shot(page, "01-meeting-booked");

  log("Sprint: undoLog takes that save back whole — the call, its calendar copy, the meeting, the Pipeline tile and the ladder");
  const nicContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const nic = await nicContext.newPage();
  await login(nic, NIC_EMAIL);
  const refused = await action(nic, CONTACT_ACTIONS, "undoLog", call.batchId);
  assert.match(refused.error ?? "", /Only whoever logged it, or an Owner or Admin/, "a Member can't undo a teammate's log");
  const undone = await action(page, CONTACT_ACTIONS, "undoLog", call.batchId);
  assert.equal(undone.success, "Undone");
  assert.equal(await status("Contact", "ctc_cn_chase"), "NOT_ACTIONED", "Chase is back where the save found him");
  assert.deepEqual(await ladder("ctc_cn_chase"), []);
  assert.equal((await one(`SELECT count(*)::int n FROM "Activity" WHERE "contactId"='ctc_cn_chase'`)).n, 0);
  assert.equal((await one(`SELECT count(*)::int n FROM "CalendarEvent" WHERE "batchId"=$1`, [call.batchId])).n, 0, "copy and meeting gone");
  assert.equal((await one(`SELECT count(*)::int n FROM "Opportunity" WHERE id=$1`, [om.opp])).n, 0, "the tile the save made is gone");
  const chase = await dates("Contact", "ctc_cn_chase");
  assert.deepEqual([chase.lastTouchAt, chase.lastConnectAt], [null, null], "the triggers recomputed his dates");
  assert.equal(await status("Company", "cmp_cn_iron"), "CONNECTED", "Ironwood keeps Kristen's connect");
  const again = await action(page, CONTACT_ACTIONS, "undoLog", call.batchId);
  assert.match(again.error ?? "", /already been undone/);

  log("Sprint: Try to book a meeting and Try again in 30 days are reminders that move no status");
  await page.goto(`${BASE}/dashboard/contacts/ctc_cn_olivia`);
  await logWith(page, { outcome: "NO_ANSWER", next: "book" });
  await until(async () => (await one(`SELECT count(*)::int n FROM "CalendarEvent" WHERE "contactId"='ctc_cn_olivia' AND title LIKE 'Try to book%'`)).n === 1, "reminder");
  const remind = await one(`SELECT type, to_char("startOn",'YYYY-MM-DD') AS day, "doneAt", "batchId" FROM "CalendarEvent" WHERE "contactId"='ctc_cn_olivia' AND title LIKE 'Try to book%'`);
  assert.deepEqual({ type: remind.type, day: remind.day, done: remind.doneAt }, { type: "Call", day: shift(TODAY, 3), done: null });
  await logWith(page, { outcome: "VOICEMAIL", next: "park" });
  await until(async () => (await one(`SELECT count(*)::int n FROM "CalendarEvent" WHERE "contactId"='ctc_cn_olivia' AND title='Try again · Olivia Wolfe'`)).n === 1, "park");
  assert.equal((await one(`SELECT to_char("startOn",'YYYY-MM-DD') AS day FROM "CalendarEvent" WHERE title='Try again · Olivia Wolfe' AND "organizationId"=$1`, [org])).day, shift(TODAY, 30));
  assert.equal(await status("Contact", "ctc_cn_olivia"), "CONTACTED", "still Attempted: nothing was booked");
  assert.equal((await one(`SELECT count(*)::int n FROM "OpportunityMeeting" m JOIN "Opportunity" o ON o.id=m."opportunityId" WHERE o."organizationId"=$1`, [org])).n, 0);

  log("Sprint: the company page's Front desk chip logs with nobody ticked, as a try on the company");
  const redBefore = await dates("Company", "cmp_cn_red");
  await page.goto(`${BASE}/dashboard/companies/cmp_cn_red`);
  // Log a touch is folded on the company page (Nov 11, 2026).
  await page.locator("[data-testid=company-log-toggle]").click();
  await logWith(page, { outcome: "GATEKEEPER" }, { body: "Front desk took a message" });
  await until(async () => (await one(`SELECT count(*)::int n FROM "Activity" WHERE "companyId"='cmp_cn_red' AND outcome='GATEKEEPER'`)).n === 1, "front desk");
  const desk = await one(`SELECT "contactId", "companyId" FROM "Activity" WHERE outcome='GATEKEEPER' AND "organizationId"=$1`, [org]);
  assert.deepEqual({ ...desk }, { contactId: null, companyId: "cmp_cn_red" });
  const redAfter = await dates("Company", "cmp_cn_red");
  assert.equal(+redAfter.lastConnectAt, +redBefore.lastConnectAt, "the front desk is not a connect (Redbud keeps Gus's talk)");
  assert.ok(+redAfter.lastTouchAt > +redBefore.lastTouchAt, "but it is a touch");

  log("Sprint: a meeting logged Held on the day one was booked ticks that booking — one entry, one meeting, held");
  const chaseBook = await action(page, CONTACT_ACTIONS, "bookMeeting", { contactId: "ctc_cn_chase", on: TODAY, time: "07:00" });
  assert.match(chaseBook.success ?? "", /Chase Hill is on your Pipeline/, JSON.stringify(chaseBook));
  await page.goto(`${BASE}/dashboard/contacts/ctc_cn_chase`);
  await logWith(page, { outcome: "HELD" }, { type: "Meeting", body: "Met Chase on site" });
  await until(async () => (await status("Contact", "ctc_cn_chase")) === "MEETING_COMPLETED", "Chase meeting completed");
  const chaseEvents = (await sql(`SELECT id, "activityId", "doneAt" FROM "CalendarEvent" WHERE "contactId"='ctc_cn_chase'`)).rows;
  const chaseLine = await one(`SELECT id, outcome FROM "Activity" WHERE "contactId"='ctc_cn_chase' AND type='MEETING'`);
  assert.equal(chaseEvents.length, 1, "no copy beside the booking");
  assert.equal(chaseEvents[0].activityId, chaseLine.id);
  assert.ok(chaseEvents[0].doneAt);
  const chaseOms = (await sql(`SELECT outcome FROM "OpportunityMeeting" WHERE "opportunityId"=$1`, [chaseBook.opportunityId])).rows;
  assert.deepEqual(chaseOms.map((r) => r.outcome), ["HELD"], "the booked meeting is the one held");

  log("Sprint: a meeting ticked done on the calendar is Held — one MEETING line, Connected, the tile and Kristen at Meeting Completed");
  const kristenBook = await action(page, CONTACT_ACTIONS, "bookMeeting", { contactId: "ctc_cn_kris", on: TODAY, time: "08:00" });
  assert.match(kristenBook.success ?? "", /is on your Pipeline in Meeting Set/, JSON.stringify(kristenBook));
  const kEvent = await one(`SELECT id FROM "CalendarEvent" WHERE "organizationId"=$1 AND title='Meeting · Kristen Vaughn'`, [org]);
  await sql(`UPDATE "CalendarEvent" SET "startOn"=$2::date WHERE id=$1`, [kEvent.id, shift(TODAY, -1)]);
  assert.equal(await status("Contact", "ctc_cn_kris"), "MEETING_SET");
  await page.goto(`${BASE}/dashboard/calendar?layout=log`);
  const overdueRow = page.locator(`[data-testid=log-row][data-event-id="${kEvent.id}"]`);
  await overdueRow.locator("[data-testid=log-done]").click();
  const box = page.locator("[data-testid=done-box]");
  await box.waitFor();
  assert.equal(await box.locator("[data-testid=done-type-MEETING]").getAttribute("aria-pressed"), "true");
  await box.locator("[data-testid=done-note]").fill("Walked the site with Kristen");
  await box.locator("[data-testid=done-log]").click();
  await until(async () => (await status("Contact", "ctc_cn_kris")) === "MEETING_COMPLETED", "Kristen meeting completed");
  const kMeetings = (await sql(`SELECT outcome FROM "Activity" WHERE "contactId"='ctc_cn_kris' AND type='MEETING'`)).rows;
  assert.deepEqual(kMeetings.map((r) => r.outcome), ["HELD"], "one meeting line, held");
  const kOm = await one(`SELECT m.outcome, m."activityId", o.stage, o."completedAt" FROM "OpportunityMeeting" m JOIN "Opportunity" o ON o.id=m."opportunityId" WHERE m."eventId"=$1`, [kEvent.id]);
  assert.equal(kOm.outcome, "HELD");
  assert.ok(kOm.activityId, "the meeting row points at its line");
  assert.equal(kOm.stage, "MEETING_COMPLETED");
  assert.equal((await one(`SELECT count(*)::int n FROM "OpportunityLog" WHERE "contactId"='ctc_cn_kris' AND kind='OPPORTUNITY_CREATED'`)).n, 1);
  await shot(page, "02-done-held");

  log("Sprint: undo of that Done-box save unticks the entry and keeps it, and puts the meeting, the tile and Kristen back");
  const doneLine = await one(`SELECT "batchId" FROM "Activity" WHERE "contactId"='ctc_cn_kris' AND type='MEETING'`);
  const doneUndo = await action(page, CONTACT_ACTIONS, "undoLog", doneLine.batchId);
  assert.equal(doneUndo.success, "Undone", JSON.stringify(doneUndo));
  const kAfter = await one(`SELECT "doneAt", "activityId" FROM "CalendarEvent" WHERE id=$1`, [kEvent.id]);
  assert.deepEqual({ ...kAfter }, { doneAt: null, activityId: null }, "the booked entry is still there, open");
  const kOmAfter = await one(`SELECT m.outcome, m."activityId", o.stage FROM "OpportunityMeeting" m JOIN "Opportunity" o ON o.id=m."opportunityId" WHERE m."eventId"=$1`, [kEvent.id]);
  assert.deepEqual({ ...kOmAfter }, { outcome: null, activityId: null, stage: "MEETING_SET" });
  assert.equal(await status("Contact", "ctc_cn_kris"), "MEETING_SET");
  assert.equal((await one(`SELECT count(*)::int n FROM "Activity" WHERE "contactId"='ctc_cn_kris' AND type='MEETING'`)).n, 0);

  log("Sprint: the Done box takes an outcome and the next follow-up, in one save");
  await page.goto(`${BASE}/dashboard/contacts/ctc_cn_moe`);
  const moeForm = await openLog(page);
  await moeForm.locator("textarea[name=body]").fill("Call Moe about the bid");
  await moeForm.locator("[data-testid=activity-when-toggle]").click();
  await moeForm.locator("[data-testid=activity-when]").fill(shift(TODAY, 1));
  await moeForm.locator("[data-testid=activity-submit]").click();
  await until(async () => (await one(`SELECT count(*)::int n FROM "CalendarEvent" WHERE "contactId"='ctc_cn_moe' AND "doneAt" IS NULL`)).n === 1, "Moe call scheduled");
  const moeCall = await one(`SELECT id FROM "CalendarEvent" WHERE "contactId"='ctc_cn_moe' AND "doneAt" IS NULL`);
  const noAnswer = await action(page, "src/app/dashboard/calendar/actions.ts", "completeEventWithLog", moeCall.id, {
    activityType: "PHONE_CALL",
    note: "",
    outcome: "NO_ANSWER",
    next: { kind: "follow", on: shift(TODAY, 2), type: "TEXT" },
  });
  assert.match(noAnswer.success ?? "", /Done and logged · Text follow-up on the calendar for/, JSON.stringify(noAnswer));
  const moeLine = await one(`SELECT outcome, body, "occurredAt", "batchId" FROM "Activity" WHERE "contactId"='ctc_cn_moe' AND type='PHONE_CALL' AND outcome='NO_ANSWER'`);
  assert.equal(moeLine.body, "No answer", "the chip's words");
  assert.ok(moeLine.occurredAt <= new Date(), "a call for tomorrow said to have gone No answer happened now");
  const moeNext = await one(`SELECT type, "batchId", to_char("startOn",'YYYY-MM-DD') AS day FROM "CalendarEvent" WHERE "contactId"='ctc_cn_moe' AND title='Follow up · Moe Mover'`);
  assert.deepEqual({ ...moeNext }, { type: "Text", batchId: moeLine.batchId, day: shift(TODAY, 2) }, "the follow-up belongs to the same save");

  log("Sprint: a meeting ticked No-show in the Done box keeps Meeting Set and is not a touch");
  const taraBook = await action(page, CONTACT_ACTIONS, "bookMeeting", { contactId: "ctc_cn_tara", on: TODAY });
  assert.match(taraBook.success ?? "", /Tara Trigger is on your Pipeline/);
  const taraEvent = await one(`SELECT id FROM "CalendarEvent" WHERE "organizationId"=$1 AND title='Meeting · Tara Trigger'`, [org]);
  await sql(`UPDATE "CalendarEvent" SET "startOn"=$2::date WHERE id=$1`, [taraEvent.id, shift(TODAY, -1)]);
  const taraTouch = (await dates("Contact", "ctc_cn_tara")).lastTouchAt;
  const missed = await action(page, "src/app/dashboard/calendar/actions.ts", "completeEventWithLog", taraEvent.id, { activityType: "MEETING", note: "", outcome: "NO_SHOW" });
  assert.match(missed.success ?? "", /Done and logged/, JSON.stringify(missed));
  assert.equal(await status("Contact", "ctc_cn_tara"), "MEETING_SET");
  assert.equal(+(await dates("Contact", "ctc_cn_tara")).lastTouchAt, +taraTouch, "a no-show is not a touch");
  assert.equal((await one(`SELECT outcome FROM "OpportunityMeeting" WHERE "eventId"=$1`, [taraEvent.id])).outcome, "NO_SHOW");

  log("Sprint: rescheduling a meeting still ahead moves it — the same meeting, its entry on the new day");
  const aheadDay = shift(TODAY, 3);
  await action(page, CONTACT_ACTIONS, "bookMeeting", { contactId: "ctc_cn_moe", on: aheadDay, time: "09:00" });
  const moeOm = await one(
    `SELECT m.id, m."eventId" FROM "OpportunityMeeting" m JOIN "CalendarEvent" e ON e.id=m."eventId" WHERE e.title='Meeting · Moe Mover' AND e."organizationId"=$1`,
    [org],
  );
  const moveAhead = await meetingAction(page, { organizationId: org, userId: taylor.id }, "rescheduleMeeting", moeOm.id, { on: shift(TODAY, 5), time: "11:00" });
  assert.match(moveAhead.success ?? "", /Moved to/, JSON.stringify(moveAhead));
  assert.equal(moveAhead.meetingId, moeOm.id, "the same meeting");
  assert.equal(moveAhead.batchId, undefined, "a plain move has nothing to undo");
  const movedEvent = await one(`SELECT to_char("startOn",'YYYY-MM-DD') AS day, "startTime" FROM "CalendarEvent" WHERE id=$1`, [moeOm.eventId]);
  assert.deepEqual({ ...movedEvent }, { day: shift(TODAY, 5), startTime: "11:00" });

  log("Sprint: Held on a meeting already in history sets HELD on that line — no second line, no double count");
  await sql(`INSERT INTO "Contact" (id,"organizationId",name,status,"companyId","updatedAt") VALUES ('ctc_cn_jess',$1,'Jessica Moreno','MEETING_SET','cmp_cn_red',now())`, [org]);
  await sql(
    `INSERT INTO "Activity" (id,"organizationId","contactId","userId",type,body,"occurredAt") VALUES ('act_cn_jess',$1,'ctc_cn_jess',$2,'MEETING','Site walk at Lakewood',now() - interval '5 days')`,
    [org, nicId],
  );
  await sql(`INSERT INTO "Opportunity" (id,"organizationId",title,stage,"ownerId","createdAt","updatedAt") VALUES ('opp_cn_jess',$1,'Redbud Dental','MEETING_SET',$2,now(),now())`, [org, nicId]);
  await sql(`INSERT INTO "OpportunityContact" (id,"opportunityId","contactId",role,"fromMeeting") VALUES ('oc_cn_jess','opp_cn_jess','ctc_cn_jess','PRIMARY',true)`);
  await sql(
    `INSERT INTO "OpportunityMeeting" (id,"opportunityId","on","activityId","bookedById") VALUES ('om_cn_jess','opp_cn_jess',now() - interval '5 days','act_cn_jess',$1)`,
    [nicId],
  );
  const jessBefore = (await one(`SELECT count(*)::int n FROM "Activity" WHERE "organizationId"=$1 AND type='MEETING'`, [org])).n;
  const me = { organizationId: org, userId: taylor.id };
  const held = await meetingAction(page, me, "markMeetingHeld", "om_cn_jess", {});
  assert.match(held.success ?? "", /Held/, JSON.stringify(held));
  assert.equal((await one(`SELECT count(*)::int n FROM "Activity" WHERE "organizationId"=$1 AND type='MEETING'`, [org])).n, jessBefore, "no second MEETING line");
  assert.equal((await one(`SELECT outcome FROM "Activity" WHERE id='act_cn_jess'`)).outcome, "HELD");
  assert.equal((await one(`SELECT outcome FROM "OpportunityMeeting" WHERE id='om_cn_jess'`)).outcome, "HELD");
  assert.equal((await one(`SELECT stage FROM "Opportunity" WHERE id='opp_cn_jess'`)).stage, "MEETING_COMPLETED");
  assert.equal(await status("Contact", "ctc_cn_jess"), "MEETING_COMPLETED");
  assert.equal((await one(`SELECT "bookedById" FROM "OpportunityMeeting" WHERE id='om_cn_jess'`)).bookedById, nicId, "credit stays with the booker");

  log("Sprint: undo of a Pipeline Held puts the line, the meeting, the tile and Jessica back");
  const heldUndo = await action(page, CONTACT_ACTIONS, "undoLog", held.batchId);
  assert.equal(heldUndo.success, "Undone", JSON.stringify(heldUndo));
  assert.equal((await one(`SELECT outcome FROM "Activity" WHERE id='act_cn_jess'`)).outcome, null);
  assert.equal((await one(`SELECT outcome FROM "OpportunityMeeting" WHERE id='om_cn_jess'`)).outcome, null);
  assert.equal((await one(`SELECT stage FROM "Opportunity" WHERE id='opp_cn_jess'`)).stage, "MEETING_SET");
  assert.equal(await status("Contact", "ctc_cn_jess"), "MEETING_SET");
  assert.equal((await one(`SELECT count(*)::int n FROM "OpportunityLog" WHERE "opportunityId"='opp_cn_jess'`)).n, 0, "no Opportunity Created line left");

  log("Sprint: No-show keeps Meeting Set, and is not a touch");
  const touchBefore = (await dates("Contact", "ctc_cn_jess")).lastTouchAt;
  const noShow = await meetingAction(page, me, "markMeetingNoShow", "om_cn_jess");
  assert.match(noShow.success ?? "", /No-show/);
  assert.equal(await status("Contact", "ctc_cn_jess"), "MEETING_SET");
  assert.equal((await one(`SELECT outcome FROM "Activity" WHERE id='act_cn_jess'`)).outcome, "NO_SHOW");
  const jess = await dates("Contact", "ctc_cn_jess");
  assert.ok(+touchBefore > 0 && jess.lastTouchAt === null && jess.lastConnectAt === null, "the no-show line no longer counts as a touch or a connect");

  log("Sprint: Reschedule of a missed meeting books a new one on the same tile, credited to whoever booked it");
  const newDay = shift(TODAY, 6);
  const moved = await meetingAction(page, me, "rescheduleMeeting", "om_cn_jess", { on: newDay, time: "14:30" });
  assert.match(moved.success ?? "", /Rescheduled to/, JSON.stringify(moved));
  const jessMeetings = (await sql(`SELECT id, outcome, "eventId", "bookedById" FROM "OpportunityMeeting" WHERE "opportunityId"='opp_cn_jess' ORDER BY "createdAt"`)).rows;
  assert.equal(jessMeetings.length, 2);
  assert.equal(jessMeetings[0].outcome, "NO_SHOW");
  assert.equal(jessMeetings[1].bookedById, taylor.id);
  const newEvent = await one(`SELECT to_char("startOn",'YYYY-MM-DD') AS day, "startTime", title FROM "CalendarEvent" WHERE id=$1`, [jessMeetings[1].eventId]);
  assert.deepEqual({ ...newEvent }, { day: newDay, startTime: "14:30", title: "Meeting · Jessica Moreno" });
  log("Sprint: a meeting still ahead asks before Held, and is held now when it happened early");
  const ask = await meetingAction(page, me, "markMeetingHeld", jessMeetings[1].id, {});
  assert.equal(ask.confirmEarly, newDay);
  assert.match(ask.error, /Did it happen early\?/);
  assert.equal(await status("Contact", "ctc_cn_jess"), "MEETING_SET", "nothing written yet");
  const early = await meetingAction(page, me, "markMeetingHeld", jessMeetings[1].id, { early: true });
  assert.match(early.success ?? "", /Held/);
  const earlyLine = await one(`SELECT outcome, "occurredAt" FROM "Activity" WHERE "contactId"='ctc_cn_jess' AND outcome='HELD'`);
  assert.ok(Math.abs(earlyLine.occurredAt - Date.now()) < 120_000, "held now");
  assert.equal(await status("Contact", "ctc_cn_jess"), "MEETING_COMPLETED");

  log("Sprint: Not interested and Lost set by hand keep the one-tap reason");
  const ni = await action(page, "src/app/dashboard/status-actions.ts", "setRecordStatus", { kind: "contact", id: "ctc_cn_olivia", target: "NOT_INTERESTED", reason: "HAS_VENDOR" });
  assert.match(ni.success ?? "", /Not Interested/);
  assert.deepEqual(await ladder("ctc_cn_olivia"), ["NOT_ACTIONED>CONTACTED", "CONTACTED>CONNECTED", "CONNECTED>NOT_INTERESTED"], "through Connected");
  assert.equal((await one(`SELECT reason FROM "StatusChange" WHERE "contactId"='ctc_cn_olivia' AND "toStatus"='NOT_INTERESTED'`)).reason, "HAS_VENDOR");
  const lost = await action(page, "src/app/dashboard/status-actions.ts", "setRecordStatus", { kind: "contact", id: "ctc_cn_jess", target: "LOST", reason: "TIMING" });
  assert.match(lost.success ?? "", /Lost/);
  assert.equal((await one(`SELECT reason FROM "StatusChange" WHERE "contactId"='ctc_cn_jess' AND "toStatus"='LOST'`)).reason, "TIMING");

  log("Sprint: a deal moved to Lost on the Pipeline keeps its one-tap reason (saveLostReason)");
  await sql(`INSERT INTO "Deal" (id,"organizationId","contactId",title,stage,"ownerId","updatedAt") VALUES ('deal_cn_jess',$1,'ctc_cn_jess','Lakewood job','LOST',$2,now())`, [org, taylor.id]);
  await sql(`UPDATE "Opportunity" SET "dealId"='deal_cn_jess' WHERE id='opp_cn_jess'`);
  await sql(
    `INSERT INTO "StatusChange" (id,"organizationId","dealId","fromStatus","toStatus","on") VALUES ('sc_cn_deal_lost',$1,'deal_cn_jess','QUOTE_SENT','LOST',now())`,
    [org],
  );
  await sql(`UPDATE "StatusChange" SET "dealId"='deal_cn_jess' WHERE "contactId"='ctc_cn_jess' AND "toStatus"='LOST'`);
  const lostWhy = hasAction(OPP_ACTIONS, "saveLostReason")
    ? await action(page, OPP_ACTIONS, "saveLostReason", "opp_cn_jess", "NO_BUDGET")
    : core("opportunities", "stampLostReason", [org, "opp_cn_jess", "NO_BUDGET"]);
  assert.equal(lostWhy.success, "Reason saved", JSON.stringify(lostWhy));
  assert.equal((await one(`SELECT reason FROM "StatusChange" WHERE id='sc_cn_deal_lost'`)).reason, "NO_BUDGET");
  assert.equal((await one(`SELECT reason FROM "StatusChange" WHERE "contactId"='ctc_cn_jess' AND "toStatus"='LOST'`)).reason, "NO_BUDGET");

  log("Sprint: Log as sent writes SENT — a try, not a connect");
  await sql(`INSERT INTO "Contact" (id,"organizationId",name,"updatedAt") VALUES ('ctc_cn_sent',$1,'Sam Sent',now())`, [org]);
  await sql(`INSERT INTO "Opportunity" (id,"organizationId",title,stage,"createdAt","updatedAt") VALUES ('opp_cn_sent',$1,'Sam Sent','MEETING_SET',now(),now())`, [org]);
  await sql(`INSERT INTO "OpportunityContact" (id,"opportunityId","contactId",role) VALUES ('oc_cn_sent','opp_cn_sent','ctc_cn_sent','PRIMARY')`);
  const sent = await action(page, "src/app/dashboard/deals/ai-actions.ts", "logFollowUpSent", { id: "opp_cn_sent", contactId: "ctc_cn_sent", type: "EMAIL", body: "Checking in on the quote" });
  assert.match(sent.success ?? "", /Logged as a email|Logged as a/);
  assert.ok(sent.batchId);
  assert.equal((await one(`SELECT outcome FROM "Activity" WHERE "contactId"='ctc_cn_sent'`)).outcome, "SENT");
  assert.equal(await status("Contact", "ctc_cn_sent"), "CONTACTED");
  assert.equal((await dates("Contact", "ctc_cn_sent")).lastConnectAt, null);

  log("Sprint: the Status filter reads Attempted and Connected, and Connected lists everyone at Connected");
  await sql(`UPDATE "Contact" SET status='CONNECTED' WHERE id IN ('ctc_cn_tara','ctc_cn_moe')`);
  await page.goto(`${BASE}/dashboard/contacts?status=CONNECTED`);
  await page.locator("[data-testid=active-filters]").waitFor();
  assert.match(await page.locator("[data-testid=active-filters]").textContent(), /Status: Connected/);
  const connectedNames = (await page.locator("[data-testid=contact-row]").allTextContents()).join(" ");
  const connectedRows = (await sql(`SELECT name FROM "Contact" WHERE "organizationId"=$1 AND status='CONNECTED' ORDER BY name`, [org])).rows.map((r) => r.name);
  assert.equal(connectedRows.length, 2, "Tara and Moe");
  assert.equal(await page.locator("[data-testid=contact-row]").count(), 2, "and only they are listed");
  for (const name of connectedRows) assert.match(connectedNames, new RegExp(name), `${name} is on the Connected filter`);
  await openFilters(page); await page.getByTestId("filter-status").click();
  const statusList = page.locator('[role=listbox][aria-label="Status"]');
  await statusList.waitFor();
  const labels = (await statusList.locator("label span").allTextContents()).map((t) => t.trim());
  assert.deepEqual(labels.slice(0, 4), ["Not Actioned", "Attempted", "Connected", "Not Interested"]);
  await page.keyboard.press("Escape");

  // The Stats redesign (approved plan, Nov 11, 2026) runs the funnel
  // Attempted → Connected → Meeting Set → … → Won; Interested is still
  // counted but sits outside the funnel.
  log("Sprint: the Stats funnel has Connected between Attempted and Meeting Set");
  await page.goto(`${BASE}/dashboard/stats`);
  await page.locator("[data-testid=stats-page]").waitFor();
  const funnelKeys = await page.locator("[data-testid=funnel-step]").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-step")));
  assert.deepEqual(funnelKeys.slice(0, 3), ["CONTACTED", "CONNECTED", "MEETING_SET"], "Connected is the step after Attempted");
  const funnelText = await page.locator("[data-testid=stats-funnel]").first().textContent();
  assert.match(funnelText, /Attempted[\s\S]*Connected[\s\S]*Meeting Set/);
  await shot(page, "03-stats");

  await nicContext.close();
  await browser.close();
  await sql(`DELETE FROM "Organization" WHERE slug LIKE $1`, [SLUG_LIKE]);
  await sql(`DELETE FROM "User" WHERE email = $1`, [NIC_EMAIL]);
  console.log(`\nAll ${step} steps passed. Screenshots in ${OUT}`);
  process.exit(0);
})().catch((err) => {
  console.error("\nFAILED at step", step, "\n", err);
  process.exit(1);
});

// The list filters sit in the Filters panel since the BDR redesign (Nov 11,
// 2026): open it when it isn't already.
async function openFilters(p) {
  // Only the Contacts and Companies lists have the panel (the Pipeline's
  // bar keeps its filters on the bar).
  if ((await p.getByTestId("filters-toggle").count()) === 0) return;
  const panel = p.getByTestId("filters-panel");
  if (await panel.isVisible().catch(() => false)) return;
  await p.getByTestId("filters-toggle").click();
  await panel.waitFor();
}
// Import CSV, Merge and Fill in missing sit under "Clean up" (Nov 11, 2026).
async function cleanUp(p, item) {
  await p.getByTestId("cleanup").click();
  await p.getByTestId(`cleanup-${item}`).click();
}
