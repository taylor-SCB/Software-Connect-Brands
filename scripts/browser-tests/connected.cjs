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
 * "audit fixes:" steps for the final audit's fix phase (Nov 11, 2026), at
 * the end: Not moving forward written into the Held's save so one Undo
 * takes the Lost deal, the tile it made and the ladder back (and a Quote
 * Sent deal back to its own day; a teammate can't add a move to someone
 * else's save); a forged front-desk log refused as a talk, a held meeting
 * or Not interested; Held in two tabs at once logging one meeting and one
 * next step; a calendar meeting waited for at its entry's own time; a
 * meeting with a line logged for later today moving on reschedule (M16).
 * And the fix review's: a second Done arriving mid-write refused; an entry
 * with nobody on it logged only as a try (and the Done box's chips off); a
 * Held line deleted a day later leaving Not moving forward's Lost standing,
 * and a stale save not joined; the meeting-moment repair; a no-entry
 * meeting with a loose line moved in place on reschedule.
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
// core(), without blocking this process: for a step that must hold a lock
// while the call waits on it.
function coreAsync(module, fn, args) {
  const code = `import * as lib from "./src/lib/${module}";
    const args = JSON.parse(process.env.CORE_ARGS).map((a) => (typeof a === "string" && /^\\d{4}-\\d{2}-\\d{2}T/.test(a) ? new Date(a) : a));
    lib.${fn}(...args).then(
      (answer) => { console.log("@@" + JSON.stringify(answer ?? null)); process.exit(0); },
      (err) => { console.error(err); process.exit(1); });`;
  return new Promise((resolve, reject) => {
    require("node:child_process").execFile(
      path.join(process.cwd(), "node_modules/.bin/tsx"),
      ["-e", code],
      { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, CORE_ARGS: JSON.stringify(args) } },
      (err, out) => {
        if (err) return reject(err);
        const line = out.split("\n").find((row) => row.startsWith("@@"));
        resolve(line ? JSON.parse(line.slice(2)) : null);
      },
    );
  });
}
// core(), with the arguments' ISO date-times (at any depth) handed over as
// Dates and a Map answered as an object: for waitingMeetings' `now`.
function coreDated(module, fn, args) {
  const code = `import * as lib from "./src/lib/${module}";
    const args = JSON.parse(process.env.CORE_ARGS, (key, value) =>
      typeof value === "string" && /^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?Z$/.test(value) ? new Date(value) : value);
    Promise.resolve(lib.${fn}(...args)).then(
      (answer) => { console.log("@@" + JSON.stringify(answer instanceof Map ? Object.fromEntries(answer) : (answer ?? null))); process.exit(0); },
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
const SHEET_ACTIONS = "src/components/how-did-it-go/actions.ts";
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
  // The status is written before the meeting row, inside the same save:
  // wait for the save to finish rather than reading it half-way.
  const omSql = `SELECT m."bookedById", m."eventId", o.stage, o.id AS opp FROM "OpportunityMeeting" m JOIN "Opportunity" o ON o.id=m."opportunityId" WHERE m."eventId"=$1`;
  await until(async () => Boolean(await one(omSql, [booked.id])), "Chase's meeting on the Pipeline");
  const om = await one(omSql, [booked.id]);
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

  /* ------------------------------------------------------------------ */
  /* Final audit, data area (Nov 11, 2026): each step fails on the code  */
  /* before its fix.                                                      */
  /* ------------------------------------------------------------------ */
  // AUDIT_SOFT=1 runs every audit step even when one fails, and lists the
  // failures: how each was shown to fail on the code before its fix.
  const AUDIT_SOFT = process.env.AUDIT_SOFT === "1";
  const auditFailed = [];
  const bid = (ms) => `${ms.toString(36)}.${require("node:crypto").randomUUID()}`;
  const CAL_ACTIONS = "src/app/dashboard/calendar/actions.ts";
  await sql(
    `INSERT INTO "Contact" (id,"organizationId",name,status,"companyId","updatedAt") VALUES
       ('ctc_au_m1',$1,'Audit Meeting','MEETING_SET','cmp_cn_red',now()),
       ('ctc_au_p1',$1,'Audit Pat','CONNECTED',NULL,now()),
       ('ctc_au_p2',$1,'Audit Lee','CONNECTED',NULL,now()),
       ('ctc_au_late',$1,'Audit Later',DEFAULT,NULL,now()),
       ('ctc_au_ahead',$1,'Audit Ahead',DEFAULT,NULL,now()),
       ('ctc_au_tmr',$1,'Audit Tomorrow','CONNECTED',NULL,now()),
       ('ctc_au_past',$1,'Audit Past','CONNECTED',NULL,now()),
       ('ctc_au_lost',$1,'Audit Lost','LOST',NULL,now()),
       ('ctc_au_two',$1,'Audit Two Tiles','CONNECTED',NULL,now()),
       ('ctc_au_edit',$1,'Audit Edit','MEETING_SET',NULL,now()),
       ('ctc_au_race',$1,'Audit Race','CONTACTED',NULL,now()),
       ('ctc_au_untimed',$1,'Audit Untimed','CONNECTED',NULL,now())`,
    [org],
  );

  try {
    log("audit fixes: a Member can't undo a teammate's No-show, by its batchId or a made-up one (D1)");
    await action(page, CONTACT_ACTIONS, "bookMeeting", { contactId: "ctc_au_m1", on: TODAY, time: "09:00" });
    var m1 = await one(`SELECT m.id, m."eventId" FROM "OpportunityMeeting" m JOIN "CalendarEvent" e ON e.id=m."eventId" WHERE e."contactId"='ctc_au_m1'`);
    await sql(`UPDATE "CalendarEvent" SET "startOn"=$2::date WHERE id=$1`, [m1.eventId, shift(TODAY, -2)]);
    await sql(`UPDATE "OpportunityMeeting" SET "on"=now() - interval '2 days' WHERE id=$1`, [m1.id]);
    var ns1 = await meetingAction(page, me, "markMeetingNoShow", m1.id);
    assert.match(ns1.success ?? "", /No-show/, JSON.stringify(ns1));
    assert.ok((await one(`SELECT "doneAt" FROM "CalendarEvent" WHERE id=$1`, [m1.eventId])).doneAt, "the no-show ticked its entry");
    var nicReal = await action(nic, CONTACT_ACTIONS, "undoLog", ns1.batchId);
    assert.match(nicReal.error ?? "", /Only whoever logged it, or an Owner or Admin/, JSON.stringify(nicReal));
    var nicForged = await action(nic, CONTACT_ACTIONS, "undoLog", `m:${m1.id}:made-up`);
    assert.ok(nicForged.error, JSON.stringify(nicForged));
    assert.equal((await one(`SELECT outcome FROM "OpportunityMeeting" WHERE id=$1`, [m1.id])).outcome, "NO_SHOW", "Taylor's no-show stands");
  } catch (err) {
    if (!AUDIT_SOFT) throw err;
    auditFailed.push(`[${String(step).padStart(2, "0")}] ${String(err.message).split("\n")[0]}`);
  }
  try {
    log("audit fixes: Undo of a No-show unticks the calendar entry it ticked (D11)");
    var ns1Undo = await action(page, CONTACT_ACTIONS, "undoLog", ns1.batchId);
    assert.equal(ns1Undo.success, "Undone", JSON.stringify(ns1Undo));
    assert.equal((await one(`SELECT outcome FROM "OpportunityMeeting" WHERE id=$1`, [m1.id])).outcome, null);
    assert.equal((await one(`SELECT "doneAt" FROM "CalendarEvent" WHERE id=$1`, [m1.eventId])).doneAt, null, "the entry asks again");
  } catch (err) {
    if (!AUDIT_SOFT) throw err;
    auditFailed.push(`[${String(step).padStart(2, "0")}] ${String(err.message).split("\n")[0]}`);
  }
  try {
    log("audit fixes: an older Undo never clears a later answer; Held after a No-show undoes back to No-show (D3, D11)");
    var ns2 = await meetingAction(page, me, "markMeetingNoShow", m1.id);
    var held2 = await meetingAction(page, me, "markMeetingHeld", m1.id, {});
    assert.match(held2.success ?? "", /Held/, JSON.stringify(held2));
    var stale = await action(page, CONTACT_ACTIONS, "undoLog", ns2.batchId);
    assert.ok(stale.error, `the no-show's Undo is spent once the meeting was held: ${JSON.stringify(stale)}`);
    assert.equal((await one(`SELECT outcome FROM "OpportunityMeeting" WHERE id=$1`, [m1.id])).outcome, "HELD");
    var held2Undo = await action(page, CONTACT_ACTIONS, "undoLog", held2.batchId);
    assert.equal(held2Undo.success, "Undone", JSON.stringify(held2Undo));
    assert.equal((await one(`SELECT outcome FROM "OpportunityMeeting" WHERE id=$1`, [m1.id])).outcome, "NO_SHOW", "back to what Held found");
    assert.ok((await one(`SELECT "doneAt" FROM "CalendarEvent" WHERE id=$1`, [m1.eventId])).doneAt, "still ticked by the no-show");
    assert.equal(await status("Contact", "ctc_au_m1"), "MEETING_SET");
  } catch (err) {
    if (!AUDIT_SOFT) throw err;
    auditFailed.push(`[${String(step).padStart(2, "0")}] ${String(err.message).split("\n")[0]}`);
  }
  try {
    log("audit fixes: deleting an hour-old booking leaves a teammate's later person and Held on that tile alone (D2)");
    var bA = bid(Date.now() - 3_600_000);
    var savedA = core("meetings", "bookMeetingCore", [
      { organizationId: org, userId: taylor.id, batchId: bA },
      { contactIds: ["ctc_au_p1"], companyId: null, on: TODAY, time: "07:00" },
    ]);
    var oppA = savedA.opportunityId;
    assert.ok(oppA, JSON.stringify(savedA));
    // The save is an hour old.
    await sql(`UPDATE "CalendarEvent" SET "createdAt"="createdAt" - interval '1 hour' WHERE "batchId"=$1`, [bA]);
    await sql(`UPDATE "StatusChange" SET "createdAt"="createdAt" - interval '1 hour' WHERE "batchId"=$1`, [bA]);
    await sql(`UPDATE "Opportunity" SET "createdAt"="createdAt" - interval '1 hour', "updatedAt"="updatedAt" - interval '1 hour' WHERE id=$1`, [oppA]);
    await sql(`UPDATE "OpportunityContact" SET "createdAt"="createdAt" - interval '1 hour' WHERE "opportunityId"=$1`, [oppA]);
    await sql(`UPDATE "OpportunityMeeting" SET "createdAt"="createdAt" - interval '1 hour' WHERE "opportunityId"=$1`, [oppA]);
    // Now Nic books Lee onto the same tile and it is held.
    var lee = await action(nic, CONTACT_ACTIONS, "bookMeeting", { contactId: "ctc_au_p2", on: TODAY, time: "08:00", opportunity: oppA });
    assert.match(lee.success ?? "", /Booked/, JSON.stringify(lee));
    var leeMeeting = await one(`SELECT m.id FROM "OpportunityMeeting" m JOIN "CalendarEvent" e ON e.id=m."eventId" WHERE e."contactId"='ctc_au_p2'`);
    var leeHeld = await meetingAction(nic, { organizationId: org, userId: nicId }, "markMeetingHeld", leeMeeting.id, { early: true });
    assert.match(leeHeld.success ?? "", /Held/, JSON.stringify(leeHeld));
    assert.equal((await one(`SELECT stage FROM "Opportunity" WHERE id=$1`, [oppA])).stage, "MEETING_COMPLETED");
    var undoA = await action(page, CONTACT_ACTIONS, "undoLog", bA);
    assert.equal(undoA.success, "Undone", JSON.stringify(undoA));
    assert.equal((await one(`SELECT stage FROM "Opportunity" WHERE id=$1`, [oppA])).stage, "MEETING_COMPLETED", "Nic's Held stands");
    assert.equal((await one(`SELECT count(*)::int n FROM "OpportunityContact" WHERE "opportunityId"=$1 AND "contactId"='ctc_au_p2'`, [oppA])).n, 1, "Lee stays on it");
    assert.ok((await one(`SELECT count(*)::int n FROM "OpportunityLog" WHERE "opportunityId"=$1 AND kind='OPPORTUNITY_CREATED'`, [oppA])).n > 0, "its Opportunity Created lines stay");
  } catch (err) {
    if (!AUDIT_SOFT) throw err;
    auditFailed.push(`[${String(step).padStart(2, "0")}] ${String(err.message).split("\n")[0]}`);
  }
  try {
    log("audit fixes: a talk logged for later today counts now, and they are Connected (D6)");
    await page.goto(`${BASE}/dashboard/contacts/ctc_au_late`);
    await logWith(page, { outcome: "TALKED", occurredOn: TODAY, atTime: "23:59" }, { body: "Talked about the bid" });
    await until(async () => (await status("Contact", "ctc_au_late")) === "CONNECTED", "Later is Connected");
    var lateLine = await one(`SELECT "occurredAt" FROM "Activity" WHERE "contactId"='ctc_au_late'`);
    assert.ok(+lateLine.occurredAt <= Date.now() + 5_000, "the line is dated now, not tonight");
  } catch (err) {
    if (!AUDIT_SOFT) throw err;
    auditFailed.push(`[${String(step).padStart(2, "0")}] ${String(err.message).split("\n")[0]}`);
  }
  try {
    log("audit fixes: a touch dated ahead that books a meeting is refused, not silently dropped (D7)");
    await page.goto(`${BASE}/dashboard/contacts/ctc_au_ahead`);
    await logWith(page, { occurredOn: shift(TODAY, 1), next: "meeting", nextOn: shift(TODAY, 3), nextTime: "10:00" }, { body: "Planning the call" });
    var aheadForm = page.locator("[data-testid=log-activity-form]");
    await aheadForm.getByRole("alert").waitFor();
    assert.match(await aheadForm.getByRole("alert").textContent(), /dated ahead/);
    assert.equal((await one(`SELECT count(*)::int n FROM "CalendarEvent" WHERE "contactId"='ctc_au_ahead'`)).n, 0, "nothing scheduled or booked");
    assert.equal(await status("Contact", "ctc_au_ahead"), "NOT_ACTIONED");
  } catch (err) {
    if (!AUDIT_SOFT) throw err;
    auditFailed.push(`[${String(step).padStart(2, "0")}] ${String(err.message).split("\n")[0]}`);
  }
  try {
    log("audit fixes: a meeting ticked done a day early with no chip asks first, then is Held (D4)");
    await action(page, CONTACT_ACTIONS, "bookMeeting", { contactId: "ctc_au_tmr", on: shift(TODAY, 1), time: "10:00" });
    var tmrEvent = await one(`SELECT id FROM "CalendarEvent" WHERE "contactId"='ctc_au_tmr' AND type='Meeting'`);
    var tmrAsk = await action(page, CAL_ACTIONS, "completeEventWithLog", tmrEvent.id, { activityType: "MEETING", note: "Met them early" });
    assert.equal(tmrAsk.confirmEarly, shift(TODAY, 1), JSON.stringify(tmrAsk));
    assert.equal((await one(`SELECT count(*)::int n FROM "Activity" WHERE "contactId"='ctc_au_tmr'`)).n, 0, "nothing written yet");
    var tmrDone = await action(page, CAL_ACTIONS, "completeEventWithLog", tmrEvent.id, { activityType: "MEETING", note: "Met them early", early: true });
    assert.ok(!tmrDone.error, JSON.stringify(tmrDone));
    var tmrLine = await one(`SELECT outcome, "occurredAt" FROM "Activity" WHERE "contactId"='ctc_au_tmr'`);
    assert.equal(tmrLine.outcome, "HELD");
    assert.ok(+tmrLine.occurredAt <= Date.now() + 5_000, "held now, not tomorrow");
    assert.equal(await status("Contact", "ctc_au_tmr"), "MEETING_COMPLETED");
  } catch (err) {
    if (!AUDIT_SOFT) throw err;
    auditFailed.push(`[${String(step).padStart(2, "0")}] ${String(err.message).split("\n")[0]}`);
  }
  try {
    log("audit fixes: a meeting logged as having happened, with no chip, is Held; old ones stop asking (D5)");
    await page.goto(`${BASE}/dashboard/contacts/ctc_au_past`);
    await logWith(page, { occurredOn: shift(TODAY, -1) }, { type: "Meeting", body: "Walked the site" });
    await until(async () => (await status("Contact", "ctc_au_past")) === "MEETING_COMPLETED", "Past meeting completed");
    assert.equal((await one(`SELECT outcome FROM "Activity" WHERE "contactId"='ctc_au_past'`)).outcome, "HELD");
    // The release's one-time catch-up for meetings logged before it.
    await sql(
      `INSERT INTO "Activity" (id,"organizationId","contactId","userId",type,body,"occurredAt") VALUES ('act_au_old',$1,'ctc_au_edit',$2,'MEETING','Old walk',now() - interval '3 days')`,
      [org, taylor.id],
    );
    await sql(`INSERT INTO "Opportunity" (id,"organizationId",title,stage,"ownerId","updatedAt") VALUES ('opp_au_old',$1,'Audit Old','MEETING_SET',$2,now())`, [org, taylor.id]);
    await sql(`INSERT INTO "OpportunityMeeting" (id,"opportunityId","on","activityId") VALUES ('om_au_old','opp_au_old',now() - interval '3 days','act_au_old')`);
    var auditSql = fs.readFileSync(path.join(process.cwd(), "prisma/migrations/20261111170000_audit_data/migration.sql"), "utf8");
    var catchUp = /UPDATE "OpportunityMeeting"[\s\S]*?;/.exec(auditSql)[0];
    await sql(catchUp);
    await sql(catchUp);
    assert.equal((await one(`SELECT outcome FROM "OpportunityMeeting" WHERE id='om_au_old'`)).outcome, "HELD", "answered");
    assert.equal((await one(`SELECT outcome FROM "Activity" WHERE id='act_au_old'`)).outcome, null, "its line stays not recorded");
    await sql(`DELETE FROM "Opportunity" WHERE id='opp_au_old'`);
    await sql(`DELETE FROM "Activity" WHERE id='act_au_old'`);
  } catch (err) {
    if (!AUDIT_SOFT) throw err;
    auditFailed.push(`[${String(step).padStart(2, "0")}] ${String(err.message).split("\n")[0]}`);
  }
  try {
    log("audit fixes: a talk with someone Lost leaves them Lost (D8)");
    await page.goto(`${BASE}/dashboard/contacts/ctc_au_lost`);
    await logWith(page, { outcome: "TALKED" }, { body: "Caught up" });
    await until(async () => (await one(`SELECT count(*)::int n FROM "CalendarEvent" WHERE "contactId"='ctc_au_lost'`)).n === 1, "Lost call logged");
    await page.waitForTimeout(1500);
    assert.equal(await status("Contact", "ctc_au_lost"), "LOST");
    assert.equal((await one(`SELECT count(*)::int n FROM "StatusChange" WHERE "contactId"='ctc_au_lost'`)).n, 0);
  } catch (err) {
    if (!AUDIT_SOFT) throw err;
    auditFailed.push(`[${String(step).padStart(2, "0")}] ${String(err.message).split("\n")[0]}`);
  }
  try {
    log("audit fixes: a booked meeting logged on its day is held on the tile it was booked on, not their newer one (D9)");
    await action(page, CONTACT_ACTIONS, "bookMeeting", { contactId: "ctc_au_two", on: TODAY, time: "06:00", opportunity: "new" });
    var twoA = await one(`SELECT m.id, m."opportunityId" FROM "OpportunityMeeting" m JOIN "CalendarEvent" e ON e.id=m."eventId" WHERE e."contactId"='ctc_au_two'`);
    await sql(`UPDATE "Opportunity" SET "updatedAt"=now() - interval '1 hour' WHERE id=$1`, [twoA.opportunityId]);
    await action(page, CONTACT_ACTIONS, "bookMeeting", { contactId: "ctc_au_two", on: shift(TODAY, 5), time: "10:00", opportunity: "new" });
    var twoB = await one(
      `SELECT DISTINCT m."opportunityId" FROM "OpportunityMeeting" m JOIN "CalendarEvent" e ON e.id=m."eventId" WHERE e."contactId"='ctc_au_two' AND m."opportunityId"<>$1`,
      [twoA.opportunityId],
    );
    await page.goto(`${BASE}/dashboard/contacts/ctc_au_two`);
    await logWith(page, { outcome: "HELD" }, { type: "Meeting", body: "Met at the site" });
    await until(async () => (await one(`SELECT outcome FROM "OpportunityMeeting" WHERE id=$1`, [twoA.id])).outcome === "HELD", "tile A's meeting held");
    assert.equal((await one(`SELECT count(*)::int n FROM "OpportunityMeeting" WHERE "opportunityId"=$1`, [twoB.opportunityId])).n, 1, "no meeting added to tile B");
    assert.equal((await one(`SELECT stage FROM "Opportunity" WHERE id=$1`, [twoB.opportunityId])).stage, "MEETING_SET");
  } catch (err) {
    if (!AUDIT_SOFT) throw err;
    auditFailed.push(`[${String(step).padStart(2, "0")}] ${String(err.message).split("\n")[0]}`);
  }
  try {
    log("audit fixes: editing a meeting line to Held completes its tile; clearing a time clears it on the calendar copy (D13)");
    await sql(
      `INSERT INTO "Activity" (id,"organizationId","contactId","userId",type,body,"occurredAt") VALUES ('act_au_edit',$1,'ctc_au_edit',$2,'MEETING','Site walk',now() - interval '1 day')`,
      [org, taylor.id],
    );
    await sql(`INSERT INTO "Opportunity" (id,"organizationId",title,stage,"ownerId","updatedAt") VALUES ('opp_au_edit',$1,'Audit Edit','MEETING_SET',$2,now())`, [org, taylor.id]);
    await sql(`INSERT INTO "OpportunityContact" (id,"opportunityId","contactId",role,"fromMeeting") VALUES ('oc_au_edit','opp_au_edit','ctc_au_edit','PRIMARY',true)`);
    await sql(`INSERT INTO "OpportunityMeeting" (id,"opportunityId","on","activityId") VALUES ('om_au_edit','opp_au_edit',now() - interval '1 day','act_au_edit')`);
    var editDay = dayInZone(new Date(Date.now() - 86_400_000));
    var edited = await action(page, CONTACT_ACTIONS, "updateActivity", { activityId: "act_au_edit", body: "Site walk", outcome: "HELD", on: editDay, time: "" });
    assert.ok(edited.success, JSON.stringify(edited));
    assert.equal((await one(`SELECT stage FROM "Opportunity" WHERE id='opp_au_edit'`)).stage, "MEETING_COMPLETED");
    assert.equal(await status("Contact", "ctc_au_edit"), "MEETING_COMPLETED");
    await page.goto(`${BASE}/dashboard/contacts/ctc_au_edit`);
    await logWith(page, { outcome: "TALKED", occurredOn: editDay, atTime: "09:15" }, { body: "Early call" });
    await until(async () => (await one(`SELECT count(*)::int n FROM "CalendarEvent" WHERE "contactId"='ctc_au_edit' AND auto=true AND "startTime"='09:15'`)).n === 1, "timed copy");
    var timed = await one(`SELECT id FROM "Activity" WHERE "contactId"='ctc_au_edit' AND type='PHONE_CALL'`);
    var cleared = await action(page, CONTACT_ACTIONS, "updateActivity", { activityId: timed.id, body: "Early call", outcome: "TALKED", on: editDay, time: "" });
    assert.ok(cleared.success, JSON.stringify(cleared));
    assert.equal((await one(`SELECT "startTime" FROM "CalendarEvent" WHERE "activityId"=$1`, [timed.id])).startTime, null, "no time on the copy either");
  } catch (err) {
    if (!AUDIT_SOFT) throw err;
    auditFailed.push(`[${String(step).padStart(2, "0")}] ${String(err.message).split("\n")[0]}`);
  }
  try {
    log("audit fixes: two preference saves at once both stick (D14)");
    await sql(`UPDATE "User" SET "uiPrefs"=NULL WHERE id=$1`, [taylor.id]);
    var holder = new Client({ connectionString: DB });
    await holder.connect();
    await holder.query("BEGIN");
    await holder.query(`UPDATE "User" SET "uiPrefs" = '{"audit":{"a":1}}'::jsonb WHERE id=$1`, [taylor.id]);
    var second = action(page, "src/app/dashboard/prefs-actions.ts", "saveUiPref", "audit", "b", 2);
    await new Promise((resolve) => setTimeout(resolve, 800));
    await holder.query("COMMIT");
    await holder.end();
    await second;
    assert.deepEqual((await one(`SELECT "uiPrefs" AS p FROM "User" WHERE id=$1`, [taylor.id])).p, { audit: { a: 1, b: 2 } });
    await sql(`UPDATE "User" SET "uiPrefs"=NULL WHERE id=$1`, [taylor.id]);
  } catch (err) {
    if (!AUDIT_SOFT) throw err;
    auditFailed.push(`[${String(step).padStart(2, "0")}] ${String(err.message).split("\n")[0]}`);
  }
  try {
    log("audit fixes: a status a teammate moved while a save waited is never moved back (D15)");
    var raceHolder = new Client({ connectionString: DB });
    await raceHolder.connect();
    await raceHolder.query("BEGIN");
    await raceHolder.query(`SELECT 1 FROM "Contact" WHERE id='ctc_au_race' FOR UPDATE`);
    var racing = coreAsync("status", "markConnected", [{ organizationId: org, userId: taylor.id }, { contactIds: ["ctc_au_race"] }, new Date().toISOString()]);
    await new Promise((resolve) => setTimeout(resolve, 2500));
    await raceHolder.query(`UPDATE "Contact" SET status='MEETING_SET' WHERE id='ctc_au_race'`);
    await raceHolder.query("COMMIT");
    await raceHolder.end();
    await racing;
    assert.equal(await status("Contact", "ctc_au_race"), "MEETING_SET");
    assert.equal((await one(`SELECT count(*)::int n FROM "StatusChange" WHERE "contactId"='ctc_au_race'`)).n, 0, "no ladder line for a move that didn't happen");
  } catch (err) {
    if (!AUDIT_SOFT) throw err;
    auditFailed.push(`[${String(step).padStart(2, "0")}] ${String(err.message).split("\n")[0]}`);
  }
  try {
    log("audit fixes: an untimed meeting reads with no time, not 12:00 PM (D16)");
    await action(page, CONTACT_ACTIONS, "bookMeeting", { contactId: "ctc_au_untimed", on: shift(TODAY, 2) });
    var untimed = core("health-load", "contactHealth", [org, "ctc_au_untimed"]);
    assert.match(untimed.nextText ?? "", /meeting/i, JSON.stringify(untimed.nextText));
    assert.doesNotMatch(untimed.nextText, /12:00/);
  } catch (err) {
    if (!AUDIT_SOFT) throw err;
    auditFailed.push(`[${String(step).padStart(2, "0")}] ${String(err.message).split("\n")[0]}`);
  }
  try {
    log("audit fixes: one log on 60 people writes 60 lines in order and moves them all (D18, D22)");
    var many = Array.from({ length: 60 }, (_, i) => `ctc_au_many${String(i).padStart(2, "0")}`);
    await sql(
      `INSERT INTO "Contact" (id,"organizationId",name,"updatedAt") SELECT x, $1, 'Audit Many ' || x, now() FROM unnest($2::text[]) x`,
      [org, many],
    );
    await page.goto(`${BASE}/dashboard/contacts/${many[0]}`);
    await logWith(page, { outcome: "TALKED", extraContactIds: many.slice(1) }, { body: "Group call" });
    await until(async () => (await one(`SELECT count(*)::int n FROM "Contact" WHERE id = ANY($1) AND status='CONNECTED'`, [many])).n === 60, "all 60 connected");
    assert.equal((await one(`SELECT count(*)::int n FROM "Activity" WHERE "contactId" = ANY($1)`, [many])).n, 60);
    var copy = await one(`SELECT a."contactId" FROM "CalendarEvent" e JOIN "Activity" a ON a.id=e."activityId" WHERE a."contactId" = ANY($1)`, [many]);
    assert.equal(copy.contactId, many[0], "the calendar copy is the page's person's line");
    assert.deepEqual(await ladder(many[37]), ["NOT_ACTIONED>CONTACTED", "CONTACTED>CONNECTED"]);
    var manyBatch = (await one(`SELECT "batchId" FROM "Activity" WHERE "contactId"=$1`, [many[0]])).batchId;
    var manyUndo = await action(page, CONTACT_ACTIONS, "undoLog", manyBatch);
    assert.equal(manyUndo.success, "Undone", JSON.stringify(manyUndo));
    assert.equal((await one(`SELECT count(*)::int n FROM "Contact" WHERE id = ANY($1) AND status='NOT_ACTIONED'`, [many])).n, 60, "Undo puts all 60 back");
  } catch (err) {
    if (!AUDIT_SOFT) throw err;
    auditFailed.push(`[${String(step).padStart(2, "0")}] ${String(err.message).split("\n")[0]}`);
  }
  try {
    log("audit fixes: the before-rollback script leaves nobody at Connected, and nothing else changes (D17)");
    var rollbackSql = fs.readFileSync(path.join(process.cwd(), "scripts/before-rollback-to-pre-bdr.sql"), "utf8").replace(/^\s*(BEGIN|COMMIT);\s*$/gm, "");
    var tryer = new Client({ connectionString: DB });
    await tryer.connect();
    await tryer.query("BEGIN");
    var connectedBefore = (await tryer.query(`SELECT count(*)::int n FROM "Contact" WHERE "organizationId"=$1 AND status='CONNECTED'`, [org])).rows[0].n;
    assert.ok(connectedBefore > 0);
    await tryer.query(rollbackSql);
    assert.equal((await tryer.query(`SELECT count(*)::int n FROM "Contact" WHERE status='CONNECTED'`)).rows[0].n, 0);
    assert.equal((await tryer.query(`SELECT count(*)::int n FROM "Company" WHERE status='CONNECTED'`)).rows[0].n, 0);
    await tryer.query("ROLLBACK");
    await tryer.end();
  } catch (err) {
    if (!AUDIT_SOFT) throw err;
    auditFailed.push(`[${String(step).padStart(2, "0")}] ${String(err.message).split("\n")[0]}`);
  }
  try {
    log("audit fixes: the touch and connect dates read the newest index row, and match a full recount (D21)");
    // On a table this small the planner would scan it anyway; with scans
    // and sorts off it shows whether the index can answer the query.
    const planner = new Client({ connectionString: DB });
    await planner.connect();
    await planner.query("SET enable_seqscan = off");
    await planner.query("SET enable_sort = off");
    await planner.query("SET enable_bitmapscan = off");
    var plan = (await planner.query(
      `EXPLAIN SELECT a."occurredAt" FROM "Activity" a WHERE a."contactId"='ctc_au_late' AND a.marketing = false AND a."occurredAt" <= now()
         AND (a."outcome" IN ('TALKED', 'REPLIED', 'HELD') OR (a.type = 'MEETING' AND a."outcome" IS NULL)) ORDER BY a."occurredAt" DESC LIMIT 1`,
    )).rows.map((row) => row["QUERY PLAN"]).join("\n");
    await planner.end();
    assert.match(plan, /Activity_contact_connect_idx/, plan);
    await sql(`SELECT crm_touch_contacts(ARRAY(SELECT id FROM "Contact" WHERE "organizationId"=$1))`, [org]);
    var drift = await one(
      `SELECT count(*)::int n FROM "Contact" c WHERE c."organizationId"=$1 AND (
         c."lastTouchAt" IS DISTINCT FROM (SELECT max("occurredAt") FROM "Activity" a WHERE a."contactId"=c.id AND a.marketing=false AND a."occurredAt"<=now() AND (a.outcome IS NULL OR a.outcome<>'NO_SHOW'))
         OR c."lastConnectAt" IS DISTINCT FROM (SELECT max("occurredAt") FROM "Activity" a WHERE a."contactId"=c.id AND a.marketing=false AND a."occurredAt"<=now()
              AND (a.outcome IN ('TALKED','REPLIED','HELD') OR (a.type='MEETING' AND a.outcome IS NULL))))`,
      [org],
    );
    assert.equal(drift.n, 0);
  } catch (err) {
    if (!AUDIT_SOFT) throw err;
    auditFailed.push(`[${String(step).padStart(2, "0")}] ${String(err.message).split("\n")[0]}`);
  }
  /* ------------------------------------------------------------------ */
  /* Final audit, fix phase (Nov 11, 2026): what the six audits sent to  */
  /* the data and pipeline core. Each step fails on the code before its  */
  /* fix.                                                                */
  /* ------------------------------------------------------------------ */
  await sql(
    `INSERT INTO "Contact" (id,"organizationId",name,status,"companyId","updatedAt") VALUES
       ('ctc_fx_nmf',$1,'Fix Notmoving','CONNECTED',NULL,now()),
       ('ctc_fx_qs',$1,'Fix Quoted','QUOTE_SENT',NULL,now()),
       ('ctc_fx_twin',$1,'Fix Twotabs','CONNECTED',NULL,now()),
       ('ctc_fx_wait',$1,'Fix Waiting','MEETING_SET',NULL,now()),
       ('ctc_fx_m16',$1,'Fix Later','CONNECTED',NULL,now())`,
    [org],
  );
  try {
    log("audit fixes: Not moving forward after a meeting logged Held goes into that save — one Undo takes back the Lost deal, the tile it made and the ladder");
    await page.goto(`${BASE}/dashboard/contacts/ctc_fx_nmf`);
    await logWith(page, { outcome: "HELD" }, { type: "Meeting", body: "Walked the site, not a fit" });
    await until(async () => (await status("Contact", "ctc_fx_nmf")) === "MEETING_COMPLETED", "the meeting held");
    var nmfBatch = (await one(`SELECT "batchId" FROM "Activity" WHERE "contactId"='ctc_fx_nmf' AND type='MEETING'`)).batchId;
    var nmf = await action(page, SHEET_ACTIONS, "notMovingForward", { batchId: nmfBatch, reason: "PRICE" });
    assert.match(nmf.success ?? "", /moved to Lost/, JSON.stringify(nmf));
    assert.equal(nmf.batchId, nmfBatch, "the Lost move is in the Held's save, so the sheet offers its Undo");
    assert.equal((await one(`SELECT stage FROM "Deal" WHERE "contactId"='ctc_fx_nmf'`)).stage, "LOST");
    assert.equal(await status("Contact", "ctc_fx_nmf"), "LOST");
    var nmfUndo = await action(page, CONTACT_ACTIONS, "undoLog", nmfBatch);
    assert.equal(nmfUndo.success, "Undone", JSON.stringify(nmfUndo));
    assert.equal((await one(`SELECT count(*)::int n FROM "Deal" WHERE "contactId"='ctc_fx_nmf'`)).n, 0, "the deal it made is gone");
    assert.equal(
      (await one(`SELECT count(*)::int n FROM "OpportunityContact" WHERE "contactId"='ctc_fx_nmf'`)).n,
      0,
      "so is the tile the save made — no meeting left on it asking how a meeting nobody logged went",
    );
    assert.equal(await status("Contact", "ctc_fx_nmf"), "CONNECTED");
    assert.equal((await one(`SELECT count(*)::int n FROM "StatusChange" WHERE "contactId"='ctc_fx_nmf'`)).n, 0, "no ladder lines left");
  } catch (err) {
    if (!AUDIT_SOFT) throw err;
    auditFailed.push(`[${String(step).padStart(2, "0")}] ${String(err.message).split("\n")[0]}`);
  }
  try {
    log("audit fixes: Not moving forward on a Quote Sent tile — a teammate can't add a move to Taylor's save; Taylor's Undo puts the deal back at Quote Sent on its own day");
    var quotedOn = new Date(Date.now() - 5 * 86_400_000).toISOString();
    await sql(
      `INSERT INTO "Deal" (id,"organizationId","contactId",title,stage,"stageChangedAt","valueCents","ownerId","updatedAt")
       VALUES ('dl_fx_qs',$1,'ctc_fx_qs','Fix bid','QUOTE_SENT',($3::timestamptz AT TIME ZONE 'UTC'),50000,$2,now())`,
      [org, taylor.id, quotedOn],
    );
    await sql(
      `INSERT INTO "StatusChange" (id,"organizationId","dealId","userId","fromStatus","toStatus","on") VALUES ('sc_fx_qs',$1,'dl_fx_qs',$2,'LEAD','QUOTE_SENT',($3::timestamptz AT TIME ZONE 'UTC'))`,
      [org, taylor.id, quotedOn],
    );
    await sql(
      `INSERT INTO "Opportunity" (id,"organizationId",title,stage,"ownerId","dealId","completedAt","convertedAt","updatedAt")
       VALUES ('opp_fx_qs',$1,'Fix bid','MEETING_COMPLETED',$2,'dl_fx_qs',now() - interval '6 days',now() - interval '5 days',now())`,
      [org, taylor.id],
    );
    await sql(`INSERT INTO "OpportunityContact" (id,"opportunityId","contactId",role,"fromMeeting") VALUES ('oc_fx_qs','opp_fx_qs','ctc_fx_qs','PRIMARY',true)`);
    await sql(`INSERT INTO "OpportunityMeeting" (id,"opportunityId","on","bookedById") VALUES ('om_fx_qs','opp_fx_qs',now() - interval '1 day',$1)`, [taylor.id]);
    var qsBefore = await one(`SELECT "stageChangedAt" FROM "Deal" WHERE id='dl_fx_qs'`);
    var qsHeld = await meetingAction(page, me, "markMeetingHeld", "om_fx_qs", {});
    assert.match(qsHeld.success ?? "", /Held/, JSON.stringify(qsHeld));
    var forgedMove = await action(nic, OPP_ACTIONS, "moveOpportunity", "opp_fx_qs", "LOST", { batchId: qsHeld.batchId });
    assert.ok(forgedMove.error, `Nic's move can't join Taylor's save: ${JSON.stringify(forgedMove)}`);
    assert.equal((await one(`SELECT stage FROM "Deal" WHERE id='dl_fx_qs'`)).stage, "QUOTE_SENT", "and nothing moved");
    var qsLost = await action(page, SHEET_ACTIONS, "notMovingForward", { opportunityId: "opp_fx_qs", batchId: qsHeld.batchId });
    assert.equal(qsLost.batchId, qsHeld.batchId, JSON.stringify(qsLost));
    assert.equal((await one(`SELECT stage FROM "Deal" WHERE id='dl_fx_qs'`)).stage, "LOST");
    assert.equal(await status("Contact", "ctc_fx_qs"), "LOST");
    var qsUndo = await action(page, CONTACT_ACTIONS, "undoLog", qsHeld.batchId);
    assert.equal(qsUndo.success, "Undone", JSON.stringify(qsUndo));
    var qsAfter = await one(`SELECT stage, "stageChangedAt" FROM "Deal" WHERE id='dl_fx_qs'`);
    assert.equal(qsAfter.stage, "QUOTE_SENT");
    assert.equal(+qsAfter.stageChangedAt, +qsBefore.stageChangedAt, "on the day it got there, so no clock restarts");
    assert.equal(await status("Contact", "ctc_fx_qs"), "QUOTE_SENT");
    assert.equal((await one(`SELECT outcome FROM "OpportunityMeeting" WHERE id='om_fx_qs'`)).outcome, null, "the meeting is unanswered again");
    assert.equal((await one(`SELECT count(*)::int n FROM "StatusChange" WHERE "dealId"='dl_fx_qs'`)).n, 1, "only the deal's own Quote Sent line is left");
  } catch (err) {
    if (!AUDIT_SOFT) throw err;
    auditFailed.push(`[${String(step).padStart(2, "0")}] ${String(err.message).split("\n")[0]}`);
  }
  try {
    log("audit fixes: a forged front-desk log (nobody linked) can't be saved as a talk, a held meeting or Not interested");
    var deskStatus = await status("Company", "cmp_cn_red");
    var deskDates = await dates("Company", "cmp_cn_red");
    await page.goto(`${BASE}/dashboard/companies/cmp_cn_red`);
    await page.locator("[data-testid=company-log-toggle]").click();
    var deskForm = page.locator("[data-testid=log-activity-form]");
    for (const [fields, opts] of [
      [{ outcome: "TALKED", bypass: "1" }, { body: "Forged desk talk" }],
      [{ outcome: "GATEKEEPER", mark: "NOT_INTERESTED", reason: "PRICE" }, { body: "Forged desk no" }],
      [{ bypass: "1" }, { type: "Meeting", body: "Forged desk meeting" }],
    ]) {
      await logWith(page, fields, opts);
      await until(
        async () =>
          (await one(`SELECT count(*)::int n FROM "Activity" WHERE "organizationId"=$1 AND body=$2`, [org, opts.body])).n > 0 ||
          /Front desk \/ main line is a try/.test((await deskForm.getByRole("alert").textContent().catch(() => "")) ?? ""),
        `an answer for "${opts.body}"`,
      );
      await page.waitForTimeout(600);
      assert.equal((await one(`SELECT count(*)::int n FROM "Activity" WHERE "organizationId"=$1 AND body=$2`, [org, opts.body])).n, 0, `"${opts.body}" refused`);
    }
    assert.equal(await status("Company", "cmp_cn_red"), deskStatus);
    assert.equal(+(await dates("Company", "cmp_cn_red")).lastConnectAt, +deskDates.lastConnectAt, "no connect on the company");
  } catch (err) {
    if (!AUDIT_SOFT) throw err;
    auditFailed.push(`[${String(step).padStart(2, "0")}] ${String(err.message).split("\n")[0]}`);
  }
  try {
    log("audit fixes: Held tapped in two tabs at once logs one meeting and books one next step");
    await action(page, CONTACT_ACTIONS, "bookMeeting", { contactId: "ctc_fx_twin", on: TODAY, time: "06:00" });
    var twinEvent = await one(`SELECT id FROM "CalendarEvent" WHERE "contactId"='ctc_fx_twin' AND type='Meeting'`);
    var twinInput = { activityType: "MEETING", note: "Met at the site", outcome: "HELD", next: { kind: "follow", on: shift(TODAY, 2), type: "PHONE_CALL", withContactIds: [] } };
    // Both taps read the entry before either writes: the row is held while
    // they start, as two tabs a moment apart would find it.
    var twinLock = new Client({ connectionString: DB });
    await twinLock.connect();
    await twinLock.query("BEGIN");
    await twinLock.query(`SELECT 1 FROM "CalendarEvent" WHERE id=$1 FOR UPDATE`, [twinEvent.id]);
    var twinRace = Promise.all([
      action(page, CAL_ACTIONS, "completeEventWithLog", twinEvent.id, twinInput),
      action(page, CAL_ACTIONS, "completeEventWithLog", twinEvent.id, twinInput),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 2500));
    await twinLock.query("COMMIT");
    await twinLock.end();
    var twinAnswers = await twinRace;
    assert.equal(twinAnswers.filter((answer) => answer.success).length, 1, JSON.stringify(twinAnswers));
    assert.match(twinAnswers.find((answer) => answer.error)?.error ?? "", /just logged/);
    assert.equal((await one(`SELECT count(*)::int n FROM "Activity" WHERE "contactId"='ctc_fx_twin' AND type='MEETING'`)).n, 1, "one meeting line");
    assert.equal(
      (await one(`SELECT count(*)::int n FROM "CalendarEvent" WHERE "contactId"='ctc_fx_twin' AND "doneAt" IS NULL AND title LIKE 'Follow up%'`)).n,
      1,
      "one follow-up booked",
    );
    assert.equal(
      (await one(`SELECT count(*)::int n FROM "OpportunityMeeting" m JOIN "OpportunityContact" oc ON oc."opportunityId"=m."opportunityId" WHERE oc."contactId"='ctc_fx_twin'`)).n,
      1,
      "one meeting on the Pipeline",
    );
    assert.equal(await status("Contact", "ctc_fx_twin"), "MEETING_COMPLETED");
  } catch (err) {
    if (!AUDIT_SOFT) throw err;
    auditFailed.push(`[${String(step).padStart(2, "0")}] ${String(err.message).split("\n")[0]}`);
  }
  try {
    log("audit fixes: a meeting on the calendar is waited for at its entry's own time, not the midnight-UTC an older calendar save left on it");
    var waitDay = shift(TODAY, 1);
    await sql(`INSERT INTO "Opportunity" (id,"organizationId",title,stage,"ownerId","updatedAt") VALUES ('opp_fx_wait',$1,'Fix Waiting','MEETING_SET',$2,now())`, [org, taylor.id]);
    await sql(`INSERT INTO "OpportunityContact" (id,"opportunityId","contactId",role,"fromMeeting") VALUES ('oc_fx_wait','opp_fx_wait','ctc_fx_wait','PRIMARY',true)`);
    await sql(
      `INSERT INTO "CalendarEvent" (id,"organizationId",title,type,"startOn","startTime","contactId","ownerId","updatedAt")
       VALUES ('ev_fx_wait',$1,'Meeting · Fix Waiting','Meeting',$2::date,'15:00','ctc_fx_wait',$3,now())`,
      [org, waitDay, taylor.id],
    );
    await sql(`INSERT INTO "OpportunityMeeting" (id,"opportunityId","on","eventId","bookedById") VALUES ('om_fx_wait','opp_fx_wait',$1::date,'ev_fx_wait',$2)`, [waitDay, taylor.id]);
    // 1am UTC on the meeting's day is the evening before in Chicago, hours
    // before its 3pm.
    var waited = coreDated("meetings", "waitingMeetings", [org, { contactIds: ["ctc_fx_wait"] }, { now: `${waitDay}T01:00:00.000Z`, timeZone: ZONE }]);
    assert.equal(waited.ctc_fx_wait?.ahead?.id, "om_fx_wait", JSON.stringify(waited));
    assert.equal(waited.ctc_fx_wait.due, null, "nothing to answer the night before");
  } catch (err) {
    if (!AUDIT_SOFT) throw err;
    auditFailed.push(`[${String(step).padStart(2, "0")}] ${String(err.message).split("\n")[0]}`);
  }
  try {
    log("audit fixes: a meeting with a line logged for later today, then rescheduled, moves — no second booking, no line left to count as held (M16)");
    await action(page, CONTACT_ACTIONS, "bookMeeting", { contactId: "ctc_fx_m16", on: TODAY, time: "23:59" });
    var m16 = await one(
      `SELECT m.id, m."eventId", m."opportunityId" FROM "OpportunityMeeting" m JOIN "CalendarEvent" e ON e.id=m."eventId" WHERE e."contactId"='ctc_fx_m16'`,
    );
    // The line a meeting logged for later today left on it (before the D5
    // fix, or a line edited back to not recorded), ticking its entry.
    await sql(
      `INSERT INTO "Activity" (id,"organizationId","contactId","userId",type,body,"occurredAt") VALUES ('act_fx_m16',$1,'ctc_fx_m16',$2,'MEETING','Site walk later today',now() + interval '20 minutes')`,
      [org, taylor.id],
    );
    await sql(`UPDATE "CalendarEvent" SET "activityId"='act_fx_m16', "doneAt"=now() WHERE id=$1`, [m16.eventId]);
    await sql(`UPDATE "OpportunityMeeting" SET "activityId"='act_fx_m16' WHERE id=$1`, [m16.id]);
    var m16Moved = await meetingAction(page, me, "rescheduleMeeting", m16.id, { on: shift(TODAY, 1), time: "10:00" });
    assert.match(m16Moved.success ?? "", /Moved/, JSON.stringify(m16Moved));
    assert.equal((await one(`SELECT count(*)::int n FROM "OpportunityMeeting" WHERE "opportunityId"=$1`, [m16.opportunityId])).n, 1, "one meeting, one booking");
    var m16Row = await one(`SELECT "eventId", "activityId", outcome FROM "OpportunityMeeting" WHERE id=$1`, [m16.id]);
    assert.deepEqual({ ...m16Row }, { eventId: m16.eventId, activityId: null, outcome: null });
    assert.equal((await one(`SELECT count(*)::int n FROM "Activity" WHERE id='act_fx_m16'`)).n, 0, "the line dated ahead is gone, so it never counts as held");
    var m16Event = await one(`SELECT to_char("startOn",'YYYY-MM-DD') AS day, "startTime", "activityId", "doneAt" FROM "CalendarEvent" WHERE id=$1`, [m16.eventId]);
    assert.deepEqual({ ...m16Event }, { day: shift(TODAY, 1), startTime: "10:00", activityId: null, doneAt: null }, "its entry moved, open again");
  } catch (err) {
    if (!AUDIT_SOFT) throw err;
    auditFailed.push(`[${String(step).padStart(2, "0")}] ${String(err.message).split("\n")[0]}`);
  }

  /* ------------------------------------------------------------------ */
  /* Fix review (Nov 11, 2026): what the skeptics found in the fixes     */
  /* above. Each step fails on the code before its fix.                  */
  /* ------------------------------------------------------------------ */
  await sql(
    `INSERT INTO "Contact" (id,"organizationId",name,status,"companyId","updatedAt") VALUES
       ('ctc_rv_mid',$1,'Review Midway','CONNECTED',NULL,now()),
       ('ctc_rv_old',$1,'Review Oldsave','CONNECTED',NULL,now()),
       ('ctc_rv_stale',$1,'Review Stale','CONNECTED',NULL,now()),
       ('ctc_rv_moved',$1,'Review Moved','MEETING_SET',NULL,now())`,
    [org],
  );
  try {
    log("audit fixes (fix review): a second Done arriving while the first is still writing its lines is refused — one line, one next step");
    // The claim used to be a changed tick with no line yet, which reads the
    // same as "Just tick it": a second tap that read the entry between the
    // first's claim and its link got through. Review Midway's row is held,
    // so the first save waits mid-write (its line moves her last touch);
    // the second arrives while it waits.
    await sql(
      `INSERT INTO "CalendarEvent" (id,"organizationId",title,type,"startOn","contactId","ownerId","updatedAt") VALUES ('ev_rv_mid',$1,'Call · Review Midway','Call',$2::date,'ctc_rv_mid',$3,now())`,
      [org, TODAY, taylor.id],
    );
    var midInput = { activityType: "PHONE_CALL", note: "Talked it through", outcome: "TALKED", next: { kind: "follow", on: shift(TODAY, 2), type: "PHONE_CALL", withContactIds: [] } };
    var midLock = new Client({ connectionString: DB });
    await midLock.connect();
    await midLock.query("BEGIN");
    await midLock.query(`SELECT 1 FROM "Contact" WHERE id='ctc_rv_mid' FOR UPDATE`);
    var midFirst = action(page, CAL_ACTIONS, "completeEventWithLog", "ev_rv_mid", midInput);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    var midSecond = action(page, CAL_ACTIONS, "completeEventWithLog", "ev_rv_mid", midInput);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await midLock.query("COMMIT");
    await midLock.end();
    var midAnswers = await Promise.all([midFirst, midSecond]);
    assert.equal(midAnswers.filter((answer) => answer.success).length, 1, JSON.stringify(midAnswers));
    assert.match(midAnswers.find((answer) => answer.error)?.error ?? "", /just logged/);
    assert.equal((await one(`SELECT count(*)::int n FROM "Activity" WHERE "contactId"='ctc_rv_mid'`)).n, 1, "one line");
    assert.equal(
      (await one(`SELECT count(*)::int n FROM "CalendarEvent" WHERE "contactId"='ctc_rv_mid' AND "doneAt" IS NULL AND title LIKE 'Follow up%'`)).n,
      1,
      "one follow-up booked",
    );
    var midEntry = await one(`SELECT e."activityId", a."contactId" FROM "CalendarEvent" e JOIN "Activity" a ON a.id=e."activityId" WHERE e.id='ev_rv_mid'`);
    assert.equal(midEntry.contactId, "ctc_rv_mid", "the entry is linked to the line that won");
  } catch (err) {
    if (!AUDIT_SOFT) throw err;
    auditFailed.push(`[${String(step).padStart(2, "0")}] ${String(err.message).split("\n")[0]}`);
  }
  try {
    log("audit fixes (fix review): a calendar entry with nobody on it (a front-desk try's follow-up) is a try when ticked Done — a talk, Interested or a held meeting is refused, and the Done box turns them off");
    await sql(
      `INSERT INTO "CalendarEvent" (id,"organizationId",title,type,"startOn","companyId","ownerId","updatedAt") VALUES
         ('ev_rv_desk1',$1,'Try again · Redwood','Call',$2::date,'cmp_cn_red',$3,now()),
         ('ev_rv_desk2',$1,'Meeting · Redwood front desk','Meeting',$2::date,'cmp_cn_red',$3,now())`,
      [org, TODAY, taylor.id],
    );
    var deskStatus2 = await status("Company", "cmp_cn_red");
    var deskDates2 = await dates("Company", "cmp_cn_red");
    for (const [eventId, input] of [
      ["ev_rv_desk1", { activityType: "PHONE_CALL", note: "", outcome: "TALKED" }],
      ["ev_rv_desk1", { activityType: "PHONE_CALL", note: "", outcome: "NO_ANSWER", mark: "INTERESTED" }],
      ["ev_rv_desk2", { activityType: "MEETING", note: "Met them" }],
      ["ev_rv_desk2", { activityType: "MEETING", note: "", outcome: "HELD", early: true }],
    ]) {
      const answer = await action(page, CAL_ACTIONS, "completeEventWithLog", eventId, input);
      assert.match(answer.error ?? "", /Front desk \/ main line is a try/, `${eventId} ${JSON.stringify(input)}: ${JSON.stringify(answer)}`);
    }
    assert.equal((await one(`SELECT count(*)::int n FROM "CalendarEvent" WHERE id IN ('ev_rv_desk1','ev_rv_desk2') AND "activityId" IS NOT NULL`)).n, 0, "nothing logged");
    assert.equal(await status("Company", "cmp_cn_red"), deskStatus2);
    assert.equal(+(await dates("Company", "cmp_cn_red")).lastConnectAt, +deskDates2.lastConnectAt, "no connect on the company");
    // The Done box: the talk chips and "Log meeting" are off on such an entry.
    await page.goto(`${BASE}/dashboard/calendar?layout=log`);
    await page.locator(`[data-testid=log-row][data-event-id="ev_rv_desk2"] [data-testid=log-done]`).click();
    var deskBox = page.locator("[data-testid=done-box]");
    await deskBox.waitFor();
    await until(async () => await deskBox.locator("[data-testid=done-log]").isDisabled(), "Log meeting turned off");
    assert.ok(await deskBox.locator("[data-testid=outcome-HELD]").isDisabled(), "Held is off");
    await deskBox.locator("[data-testid=done-type-PHONE_CALL]").click();
    assert.ok(await deskBox.locator("[data-testid=outcome-TALKED]").isDisabled(), "Talked is off");
    assert.ok(!(await deskBox.locator("[data-testid=outcome-NO_ANSWER]").isDisabled()), "a try is still on");
    await deskBox.getByRole("button", { name: "Cancel", exact: true }).click();
    await deskBox.waitFor({ state: "detached" });
    // A try still logs.
    var deskTry = await action(page, CAL_ACTIONS, "completeEventWithLog", "ev_rv_desk1", { activityType: "PHONE_CALL", note: "", outcome: "NO_ANSWER" });
    assert.ok(deskTry.success, JSON.stringify(deskTry));
    assert.equal((await one(`SELECT a.outcome, a."companyId" FROM "CalendarEvent" e JOIN "Activity" a ON a.id=e."activityId" WHERE e.id='ev_rv_desk1'`)).outcome, "NO_ANSWER");
  } catch (err) {
    if (!AUDIT_SOFT) throw err;
    auditFailed.push(`[${String(step).padStart(2, "0")}] ${String(err.message).split("\n")[0]}`);
  }
  try {
    log("audit fixes (fix review): deleting a Held line a day after Not moving forward undoes the Held alone — the Lost deal, its reason and the person's Lost stand");
    await page.goto(`${BASE}/dashboard/contacts/ctc_rv_old`);
    await logWith(page, { outcome: "HELD" }, { type: "Meeting", body: "Walked the site, priced out" });
    await until(async () => (await status("Contact", "ctc_rv_old")) === "MEETING_COMPLETED", "the meeting held");
    var oldBatch = (await one(`SELECT "batchId" FROM "Activity" WHERE "contactId"='ctc_rv_old' AND type='MEETING'`)).batchId;
    var oldLost = await action(page, SHEET_ACTIONS, "notMovingForward", { batchId: oldBatch, reason: "PRICE" });
    assert.equal(oldLost.batchId, oldBatch, `joined while the Held is recent: ${JSON.stringify(oldLost)}`);
    var oldDeal = await one(`SELECT id, stage FROM "Deal" WHERE "contactId"='ctc_rv_old'`);
    assert.equal(oldDeal.stage, "LOST");
    // A day later: the Lost move's rows are a day old (the Held's own rows
    // too; its batchId still says when it began).
    await sql(`UPDATE "StatusChange" SET "createdAt"="createdAt" - interval '1 day' WHERE "organizationId"=$1 AND "batchId" IN ($2, $2 || '+j')`, [org, oldBatch]);
    var oldDelete = await action(page, CONTACT_ACTIONS, "undoLog", oldBatch);
    assert.equal(oldDelete.success, "Undone", JSON.stringify(oldDelete));
    assert.equal((await one(`SELECT count(*)::int n FROM "Activity" WHERE "contactId"='ctc_rv_old' AND type='MEETING'`)).n, 0, "the Held line is gone");
    assert.equal((await one(`SELECT stage FROM "Deal" WHERE id=$1`, [oldDeal.id])).stage, "LOST", "the Lost deal stands");
    assert.equal(await status("Contact", "ctc_rv_old"), "LOST", "and so does the person's Lost");
    assert.equal(
      (await one(`SELECT reason FROM "StatusChange" WHERE "dealId"=$1 AND "contactId" IS NULL AND "toStatus"='LOST'`, [oldDeal.id])).reason,
      "PRICE",
      "with its reason",
    );
    assert.equal(
      (await one(`SELECT count(*)::int n FROM "StatusChange" WHERE "organizationId"=$1 AND "batchId" LIKE $2`, [org, `${oldBatch}%`])).n,
      0,
      "the Lost move is its own move now, in no save",
    );
  } catch (err) {
    if (!AUDIT_SOFT) throw err;
    auditFailed.push(`[${String(step).padStart(2, "0")}] ${String(err.message).split("\n")[0]}`);
  }
  try {
    log("audit fixes (fix review): Not moving forward on a save begun minutes ago isn't added to it — the move stands alone and offers no Undo");
    await sql(`INSERT INTO "Opportunity" (id,"organizationId",title,stage,"ownerId","updatedAt") VALUES ('opp_rv_stale',$1,'Review Stale','MEETING_COMPLETED',$2,now())`, [org, taylor.id]);
    await sql(`INSERT INTO "OpportunityContact" (id,"opportunityId","contactId",role,"fromMeeting") VALUES ('oc_rv_stale','opp_rv_stale','ctc_rv_stale','PRIMARY',true)`);
    // The Held's save, begun five minutes ago (a sheet left open on step 2).
    var staleBatch = bid(Date.now() - 5 * 60_000);
    await sql(
      `INSERT INTO "Activity" (id,"organizationId","contactId","userId",type,outcome,body,"batchId","occurredAt","createdAt") VALUES ('act_rv_stale',$1,'ctc_rv_stale',$2,'MEETING','HELD','Walked it',$3,now() - interval '5 minutes',now() - interval '5 minutes')`,
      [org, taylor.id, staleBatch],
    );
    await sql(`INSERT INTO "OpportunityMeeting" (id,"opportunityId","on","activityId",outcome,"bookedById") VALUES ('om_rv_stale','opp_rv_stale',now() - interval '5 minutes','act_rv_stale','HELD',$1)`, [taylor.id]);
    var staleLost = await action(page, SHEET_ACTIONS, "notMovingForward", { opportunityId: "opp_rv_stale", batchId: staleBatch });
    assert.match(staleLost.success ?? "", /moved to Lost/, JSON.stringify(staleLost));
    assert.equal(staleLost.batchId, undefined, "no Undo offered for a save it wasn't added to");
    var staleDeal = await one(`SELECT d.id, d.stage FROM "Deal" d JOIN "Opportunity" o ON o."dealId"=d.id WHERE o.id='opp_rv_stale'`);
    assert.equal(staleDeal.stage, "LOST");
    assert.equal(
      (await one(`SELECT count(*)::int n FROM "StatusChange" WHERE "dealId"=$1 AND "batchId" IS NOT NULL`, [staleDeal.id])).n,
      0,
      "the move's rows are in no save",
    );
    var staleForged = await action(page, OPP_ACTIONS, "moveOpportunity", "opp_rv_stale", "WON", { batchId: staleBatch });
    assert.ok(staleForged.error, `a move can't join it either: ${JSON.stringify(staleForged)}`);
  } catch (err) {
    if (!AUDIT_SOFT) throw err;
    auditFailed.push(`[${String(step).padStart(2, "0")}] ${String(err.message).split("\n")[0]}`);
  }
  try {
    log("audit fixes (fix review): the one-off repair puts an old calendar meeting's moment on its row, so the tiles and health read the entry's time as the contact page does");
    // Om_fx_wait above holds midnight UTC on its day, as the calendar form
    // wrote it before the Nov 11 audit; its entry says 3pm.
    var repairSql = fs.readFileSync(path.join(process.cwd(), "prisma/migrations/20261111190200_meeting_moments/migration.sql"), "utf8");
    await sql(
      `INSERT INTO "OpportunityMeeting" (id,"opportunityId","on","eventId",outcome,"bookedById") VALUES ('om_rv_answered','opp_fx_wait',$1::date,'ev_fx_wait','NO_SHOW',$2)`,
      [shift(TODAY, 1), taylor.id],
    );
    await sql(repairSql);
    await sql(repairSql);
    var repairedAt = coreDated("calendar-auto", "zonedMoment", [shift(TODAY, 1), "15:00", ZONE]);
    assert.equal((await one(`SELECT "on" FROM "OpportunityMeeting" WHERE id='om_fx_wait'`)).on.toISOString(), repairedAt, "3pm in Chicago, not midnight UTC");
    assert.equal(
      (await one(`SELECT to_char("on",'YYYY-MM-DD HH24:MI') AS at FROM "OpportunityMeeting" WHERE id='om_rv_answered'`)).at,
      `${shift(TODAY, 1)} 00:00`,
      "an answered meeting keeps its own moment",
    );
    await sql(`DELETE FROM "OpportunityMeeting" WHERE id='om_rv_answered'`);
  } catch (err) {
    if (!AUDIT_SOFT) throw err;
    auditFailed.push(`[${String(step).padStart(2, "0")}] ${String(err.message).split("\n")[0]}`);
  }
  try {
    log("audit fixes (fix review): a meeting still ahead with no calendar entry and a line logged for later, rescheduled, moves in place — kept, given an entry, no Undo it can't honor");
    await sql(`INSERT INTO "Opportunity" (id,"organizationId",title,stage,"ownerId","updatedAt") VALUES ('opp_rv_moved',$1,'Review Moved','MEETING_SET',$2,now())`, [org, taylor.id]);
    await sql(`INSERT INTO "OpportunityContact" (id,"opportunityId","contactId",role,"fromMeeting") VALUES ('oc_rv_moved','opp_rv_moved','ctc_rv_moved','PRIMARY',true)`);
    await sql(
      `INSERT INTO "Activity" (id,"organizationId","contactId","userId",type,body,"occurredAt") VALUES ('act_rv_moved',$1,'ctc_rv_moved',$2,'MEETING','Site walk later',now() + interval '2 hours')`,
      [org, taylor.id],
    );
    await sql(
      `INSERT INTO "OpportunityMeeting" (id,"opportunityId","on","activityId","bookedById") VALUES ('om_rv_moved','opp_rv_moved',now() + interval '2 hours','act_rv_moved',$1)`,
      [nicId],
    );
    var movedTo = shift(TODAY, 3);
    var movedAnswer = await meetingAction(page, me, "rescheduleMeeting", "om_rv_moved", { on: movedTo, time: "10:00" });
    assert.match(movedAnswer.success ?? "", /Moved to/, JSON.stringify(movedAnswer));
    assert.equal(movedAnswer.batchId, undefined, "no Undo offered");
    assert.equal(movedAnswer.meetingId, "om_rv_moved", "the same meeting");
    var movedRows = (await sql(`SELECT id, "eventId", "activityId", outcome, "bookedById" FROM "OpportunityMeeting" WHERE "opportunityId"='opp_rv_moved'`)).rows;
    assert.equal(movedRows.length, 1, "kept, not replaced");
    assert.equal(movedRows[0].bookedById, nicId, "its booker keeps the credit");
    assert.deepEqual([movedRows[0].activityId, movedRows[0].outcome], [null, null]);
    var movedEntry = await one(`SELECT to_char("startOn",'YYYY-MM-DD') AS day, "startTime", "contactId" FROM "CalendarEvent" WHERE id=$1`, [movedRows[0].eventId]);
    assert.deepEqual({ ...movedEntry }, { day: movedTo, startTime: "10:00", contactId: "ctc_rv_moved" }, "on the calendar on its new day");
    assert.equal((await one(`SELECT count(*)::int n FROM "Activity" WHERE id='act_rv_moved'`)).n, 0, "the line dated ahead is gone, so it never counts as held");
    assert.equal(await status("Contact", "ctc_rv_moved"), "MEETING_SET");
  } catch (err) {
    if (!AUDIT_SOFT) throw err;
    auditFailed.push(`[${String(step).padStart(2, "0")}] ${String(err.message).split("\n")[0]}`);
  }

  if (AUDIT_SOFT) {
    console.log(`\nAUDIT_SOFT: ${auditFailed.length} audit step(s) failed`);
    for (const line of auditFailed) console.log(`  FAILED ${line}`);
  }

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
