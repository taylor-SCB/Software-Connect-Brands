/* Browser regression for the "How did it go?" and Book meeting sheets (BDR
 * redesign, Release 2 / 4, Nov 11, 2026).
 *
 * Covers: the "What happened with Kristen?" bar opening the sheet set to
 * Call; one tap on an outcome chip saving with the chip's words as the note
 * and "Saved · Undo"; the next step already picked (Try again on a date
 * chip) going into the same save; Undo taking the whole save back; Talked
 * → Book meeting with day / time / who-else chips naming the Pipeline;
 * "Meeting booked" on a call asking "Add to the open … opportunity with …?"
 * and joining it; Not interested with a reason and "Check back in 90 days?";
 * More → Busy; a note typed after the tap saved onto the same line; the
 * inline Undo; "Try again in 30 days" offered first after six tries; the
 * sheet opening on its own after a tel: or sms: tap; the company page's
 * Who? with the Front desk / main line chip; the calendar's Done box with
 * an outcome and the next follow-up; Held on a meeting still ahead asking
 * first; No-show on a passed meeting and Reschedule on the same tile;
 * Escape and focus; the phone's bottom sheet with 56px chips two to a row.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/scb_test \
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules \
 *   node scripts/browser-tests/how-did-it-go.cjs
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
const OUT = process.env.SHOTS_DIR || path.join(os.tmpdir(), "scb-browser-shots-how-did-it-go");
fs.mkdirSync(OUT, { recursive: true });

const EMAIL = "test-howdidit@example.com";
const PASSWORD = "password123";
const COMPANY = "Test HowDidIt Co";
const SLUG_LIKE = "test-howdidit-co%";
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
const count = async (text, params) => (await one(text, params)).n;
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
const weekend = (iso) => [0, 6].includes(new Date(`${iso}T12:00:00Z`).getUTCDay());
function nextWorkday(iso) {
  let day = shift(iso, 1);
  while (weekend(day)) day = shift(day, 1);
  return day;
}
const TODAY = dayInZone(new Date());
// The date chips: Tomorrow (or Mon) · the working day after · Next week.
const FIRST = nextWorkday(TODAY);
const SECOND = nextWorkday(FIRST);
const status = async (table, id) => (await one(`SELECT status FROM "${table}" WHERE id=$1`, [id])).status;
const ladder = async (contactId) =>
  (await sql(`SELECT "fromStatus" AS f, "toStatus" AS t FROM "StatusChange" WHERE "contactId"=$1 ORDER BY "createdAt", "on", id`, [contactId])).rows.map(
    (r) => `${r.f}>${r.t}`,
  );

(async () => {
  await sql(`DELETE FROM "Organization" WHERE slug LIKE $1`, [SLUG_LIKE]);

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await context.newPage();
  page.on("pageerror", (err) => console.error("PAGE ERROR:", err.message));
  const sheet = page.locator("[data-testid=how-did-it-go]");
  const form = page.locator("[data-testid=log-activity-form]");
  const next = page.locator("[data-testid=follow-up-prompt]");
  const toast = page.locator("[data-testid=log-toast]");
  // The contact page's "What happened with …?" bar, or the company page's
  // "Log a touch" (merged with the page redesigns, Nov 11, 2026).
  const openBar = async () => {
    await page.locator("[data-testid=log-bar], [data-testid=company-log-toggle]").first().click();
    await form.waitFor();
  };

  log("signup + activate + login, and seed two companies with their people");
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
  const taylor = await one(`SELECT id FROM "User" WHERE email = $1`, [EMAIL]);
  await sql(
    `INSERT INTO "Company" (id,"organizationId",name,"updatedAt") VALUES
       ('cmp_hd_iron',$1,'Ironwood GC',now()), ('cmp_hd_red',$1,'Redbud Dental',now())`,
    [org],
  );
  await sql(
    `INSERT INTO "Contact" (id,"organizationId",name,"companyId",phone,"updatedAt") VALUES
       ('ctc_hd_kris',$1,'Kristen Vaughn','cmp_hd_iron','5125550101',now()),
       ('ctc_hd_chase',$1,'Chase Hill','cmp_hd_iron','5125550102',now()),
       ('ctc_hd_dana',$1,'Dana Ruiz','cmp_hd_iron','5125550103',now()),
       ('ctc_hd_olivia',$1,'Olivia Wolfe','cmp_hd_red','5125550104',now()),
       ('ctc_hd_pam',$1,'Pam Parker','cmp_hd_red','5125550105',now())`,
    [org],
  );

  log("Sprint: the log is a 'What happened with Kristen?' bar; it opens How did it go? set to Call, and Left voicemail saves in one tap");
  await page.goto(`${BASE}/dashboard/contacts/ctc_hd_kris`);
  assert.match(await page.locator("[data-testid=log-bar]").textContent(), /What happened with Kristen\?/);
  assert.equal(await form.count(), 0, "the sheet is closed until asked");
  await openBar();
  assert.match(await sheet.getByRole("heading").textContent(), /How did it go with Kristen\?/);
  assert.equal(await form.locator("[data-testid=log-type-PHONE_CALL]").getAttribute("aria-pressed"), "true", "set to Call");
  const callChips = await form.locator("[data-testid=outcome-chips] button").allTextContents();
  assert.deepEqual(callChips.map((t) => t.trim()), ["No answer", "Left voicemail", "Talked", "Meeting booked", "Not interested", "More…"]);
  await shot(page, "01-call-chips");
  await form.locator("[data-testid=outcome-VOICEMAIL]").click();
  await page.locator("[data-testid=log-saved]").waitFor();
  assert.match(await page.locator("[data-testid=log-saved]").textContent(), /Saved · Left voicemail/);
  assert.ok(await page.locator("[data-testid=log-undo]").isVisible(), "Undo for ten seconds");
  const vm = await one(`SELECT outcome, body, "batchId" FROM "Activity" WHERE "contactId"='ctc_hd_kris'`);
  assert.deepEqual({ outcome: vm.outcome, body: vm.body }, { outcome: "VOICEMAIL", body: "Left voicemail" }, "the chip's words are the note");
  assert.equal(await status("Contact", "ctc_hd_kris"), "CONTACTED", "a voicemail is a try: Attempted");

  log("Sprint: the next step is already picked — Try again on the second date chip — and one more tap puts it in the same save");
  await next.waitFor();
  assert.equal(await next.locator("[data-testid=next-follow]").getAttribute("aria-checked"), "true", "Try again is picked");
  assert.equal(await next.locator("[data-testid=next-day-second]").getAttribute("aria-checked"), "true", "on the second date chip");
  assert.match(await next.locator("[data-testid=next-day-first]").textContent(), FIRST === shift(TODAY, 1) ? /Tomorrow/ : /Mon/);
  assert.match(await next.locator("[data-testid=next-day-week]").textContent(), /Next week/);
  assert.match(await page.locator("[data-testid=follow-up-save]").textContent(), /^Try again /);
  await shot(page, "02-next-step");
  await page.locator("[data-testid=follow-up-save]").click();
  await form.waitFor({ state: "detached" });
  await toast.waitFor();
  assert.match(await toast.textContent(), /Left voicemail · Phone Call follow-up on the calendar for/);
  const again = await one(`SELECT type, to_char("startOn",'YYYY-MM-DD') AS day, "batchId", "doneAt" FROM "CalendarEvent" WHERE "contactId"='ctc_hd_kris' AND "doneAt" IS NULL`);
  assert.deepEqual({ ...again }, { type: "Call", day: SECOND, batchId: vm.batchId, doneAt: null });

  log("Sprint: Undo on 'Saved · Undo' takes the voicemail and its follow-up back whole");
  await page.locator("[data-testid=log-toast-undo]").click();
  await toast.getByText("Undone").waitFor();
  assert.equal(await count(`SELECT count(*)::int n FROM "Activity" WHERE "contactId"='ctc_hd_kris'`), 0);
  assert.equal(await count(`SELECT count(*)::int n FROM "CalendarEvent" WHERE "batchId"=$1`, [vm.batchId]), 0);
  assert.equal(await status("Contact", "ctc_hd_kris"), "NOT_ACTIONED");

  log("Sprint: Talked, then Book meeting in the same sheet — day and time chips, Chase as who else — names the Pipeline");
  await page.reload();
  await openBar();
  await form.locator("[data-testid=outcome-TALKED]").click();
  await next.waitFor();
  assert.equal(await next.locator("[data-testid=next-meeting]").getAttribute("aria-checked"), "true", "Book meeting is the main choice");
  await next.locator("[data-testid=book-day-week]").click();
  await next.locator("[data-testid=book-time-10\\:00]").click();
  await next.locator("[data-testid=book-who]", { hasText: "Chase Hill" }).click();
  assert.equal(await next.locator("[data-testid=book-opportunity]").count(), 0, "nothing open to join yet");
  await shot(page, "03-book-in-sheet");
  await page.locator("[data-testid=follow-up-save]").click();
  await toast.waitFor();
  await toast.getByText(/is on your Pipeline in Meeting Set/).waitFor();
  assert.match(await toast.textContent(), /Talked · Booked \w{3}, \w{3} \d+, 10:00 AM · Kristen is on your Pipeline in Meeting Set/);
  const pipelineLink = await toast.locator("[data-testid=log-toast-link]").getAttribute("href");
  assert.equal(await status("Contact", "ctc_hd_kris"), "MEETING_SET");
  assert.deepEqual(await ladder("ctc_hd_kris"), ["NOT_ACTIONED>CONTACTED", "CONTACTED>CONNECTED", "CONNECTED>MEETING_SET"]);
  const talk = await one(`SELECT outcome, "batchId" FROM "Activity" WHERE "contactId"='ctc_hd_kris'`);
  assert.equal(talk.outcome, "TALKED");
  const krisMeeting = await one(
    `SELECT e.id, e."startTime", e."batchId", (SELECT count(*)::int FROM "_EventAttendees" a WHERE a."A"=e.id AND a."B"='ctc_hd_chase') AS chase
       FROM "CalendarEvent" e WHERE e."organizationId"=$1 AND e.title='Meeting · Kristen Vaughn'`,
    [org],
  );
  assert.deepEqual({ time: krisMeeting.startTime, batch: krisMeeting.batchId === talk.batchId, chase: krisMeeting.chase }, { time: "10:00", batch: true, chase: 1 });
  const krisOm = await one(`SELECT id, "bookedById", "opportunityId" FROM "OpportunityMeeting" WHERE "eventId"=$1`, [krisMeeting.id]);
  assert.equal(krisOm.bookedById, taylor.id, "the booker is kept");
  assert.equal(pipelineLink, `/dashboard/deals?open=${krisOm.opportunityId}`, "Pipeline → opens the tile");

  log("Sprint: 'Meeting booked' on a call with Dana asks 'Add to the open … opportunity with Kristen Vaughn?' — Yes joins it");
  await page.goto(`${BASE}/dashboard/contacts/ctc_hd_dana`);
  await openBar();
  await form.locator("[data-testid=outcome-BOOKED]").click();
  const fields = page.locator("[data-testid=book-meeting-fields]");
  await fields.locator("[data-testid=book-opportunity]").waitFor();
  assert.match(await fields.locator("[data-testid=book-opportunity] legend").textContent(), /Add to the open .* opportunity with Kristen Vaughn\?/);
  assert.equal(await fields.locator("[data-testid=book-opp-yes]").getAttribute("aria-checked"), "true", "Yes to start");
  assert.equal(await page.locator("[data-testid=book-submit]").isDisabled(), true, "no day, no booking");
  await fields.locator("[data-testid=book-day-first]").click();
  await fields.locator("[data-testid=book-time-14\\:00]").click();
  await page.locator("[data-testid=book-submit]").click();
  await toast.getByText(/Meeting booked · Booked .*, 2:00 PM · Dana is on your Pipeline/).waitFor();
  const danaCall = await one(`SELECT outcome, body FROM "Activity" WHERE "contactId"='ctc_hd_dana'`);
  assert.deepEqual({ ...danaCall }, { outcome: "TALKED", body: "Talked · Meeting booked" });
  assert.equal(await count(`SELECT count(*)::int n FROM "Opportunity" WHERE "organizationId"=$1`, [org]), 1, "one tile for Ironwood");
  assert.equal(await count(`SELECT count(*)::int n FROM "OpportunityMeeting" WHERE "opportunityId"=$1`, [krisOm.opportunityId]), 2);

  log("Sprint: Not interested in one tap, then a reason chip and 'Check back in 90 days?' go on the same save");
  await page.goto(`${BASE}/dashboard/contacts/ctc_hd_olivia`);
  await openBar();
  await form.locator("[data-testid=outcome-NOT_INTERESTED]").click();
  await next.locator("[data-testid=reason-HAS_VENDOR]").waitFor();
  assert.equal(await status("Contact", "ctc_hd_olivia"), "NOT_INTERESTED", "saved on the tap");
  const ni = await one(`SELECT body, outcome, "batchId" FROM "Activity" WHERE "contactId"='ctc_hd_olivia'`);
  assert.deepEqual({ body: ni.body, outcome: ni.outcome }, { body: "Talked · Not interested", outcome: "TALKED" });
  await next.locator("[data-testid=reason-HAS_VENDOR]").click();
  await next.locator("[data-testid=next-checkback]").click();
  await page.locator("[data-testid=follow-up-save]").click();
  await form.waitFor({ state: "detached" });
  await until(async () => (await one(`SELECT reason FROM "StatusChange" WHERE "contactId"='ctc_hd_olivia' AND "toStatus"='NOT_INTERESTED'`)).reason === "HAS_VENDOR", "reason");
  const checkBack = await one(`SELECT to_char("startOn",'YYYY-MM-DD') AS day, "batchId" FROM "CalendarEvent" WHERE "contactId"='ctc_hd_olivia' AND "doneAt" IS NULL`);
  assert.deepEqual({ ...checkBack }, { day: shift(TODAY, 90), batchId: ni.batchId });

  log("Sprint: More holds Busy · Front desk · Wrong number; Busy is a no answer whose note reads Busy, and the inline Undo takes it back");
  await page.goto(`${BASE}/dashboard/contacts/ctc_hd_pam`);
  await openBar();
  await form.locator("[data-testid=outcome-more]").click();
  assert.deepEqual(
    (await form.locator("[data-testid=outcome-chips] button").allTextContents()).slice(5).map((t) => t.trim()),
    ["Busy", "Front desk", "Wrong number"],
  );
  await form.locator("[data-testid=outcome-BUSY]").click();
  await page.locator("[data-testid=log-saved]").waitFor();
  assert.deepEqual({ ...(await one(`SELECT outcome, body FROM "Activity" WHERE "contactId"='ctc_hd_pam'`)) }, { outcome: "NO_ANSWER", body: "Busy" });
  await page.locator("[data-testid=log-undo]").click();
  await form.locator("[data-testid=outcome-chips]").waitFor();
  assert.equal(await count(`SELECT count(*)::int n FROM "Activity" WHERE "contactId"='ctc_hd_pam'`), 0, "undone, and back on the outcome");

  log("Sprint: after six tries with no connect, 'Try again in 30 days' is offered first and books only that");
  await sql(
    `INSERT INTO "Activity" (id,"organizationId","contactId","userId",type,body,outcome,"occurredAt")
     SELECT 'act_hd_pam_' || g, $1, 'ctc_hd_pam', $2, 'PHONE_CALL', 'Left voicemail', 'VOICEMAIL', now() - (g || ' days')::interval
       FROM generate_series(2, 7) g`,
    [org, taylor.id],
  );
  await page.reload();
  await openBar();
  await form.locator("[data-testid=outcome-NO_ANSWER]").click();
  await next.locator("[data-testid=next-park]").waitFor();
  assert.equal(await next.locator("[data-testid=next-park]").getAttribute("aria-checked"), "true", "parking is picked");
  assert.match(await page.locator("[data-testid=follow-up-save]").textContent(), /Try again in 30 days/);
  await page.locator("[data-testid=follow-up-save]").click();
  await toast.getByText(/Parked/).waitFor();
  const park = await one(`SELECT to_char("startOn",'YYYY-MM-DD') AS day, title FROM "CalendarEvent" WHERE "contactId"='ctc_hd_pam' AND "doneAt" IS NULL`);
  assert.deepEqual({ ...park }, { day: shift(TODAY, 30), title: "Try again · Pam Parker" });
  assert.equal(await status("Contact", "ctc_hd_pam"), "CONTACTED", "parking moves no status");

  log("Sprint: a note typed after the tap is saved onto the same line, with Call back on the first chip");
  await page.goto(`${BASE}/dashboard/contacts/ctc_hd_chase`);
  await openBar();
  await form.locator("[data-testid=outcome-TALKED]").click();
  await next.waitFor();
  await form.locator("textarea[name=body]").fill("Wants pricing by Friday");
  await next.locator("[data-testid=next-follow]").click();
  await next.locator("[data-testid=next-day-first]").click();
  await page.locator("[data-testid=follow-up-save]").click();
  await form.waitFor({ state: "detached" });
  await until(async () => (await one(`SELECT body FROM "Activity" WHERE "contactId"='ctc_hd_chase' AND outcome='TALKED'`)).body === "Wants pricing by Friday", "note saved");
  const chaseCopy = await one(`SELECT e.notes FROM "CalendarEvent" e JOIN "Activity" a ON a.id=e."activityId" WHERE a."contactId"='ctc_hd_chase' AND a.outcome='TALKED'`);
  assert.equal(chaseCopy.notes, "Wants pricing by Friday", "the calendar copy follows");
  assert.equal(
    await count(`SELECT count(*)::int n FROM "CalendarEvent" WHERE "contactId"='ctc_hd_chase' AND title='Follow up · Chase Hill' AND "startOn"=$1::date`, [FIRST]),
    1,
  );

  log("Sprint: coming back from a tel: tap opens How did it go? on its own set to Call, and an sms: tap sets it to Text");
  await page.goto(`${BASE}/dashboard/contacts/ctc_hd_dana`);
  await page.locator("[data-testid=log-bar]").waitFor();
  const away = async (href) => {
    await page.evaluate((link) => {
      document.addEventListener("click", (event) => event.preventDefault(), { once: true });
      const a = document.createElement("a");
      a.href = link;
      a.textContent = "dial";
      a.id = "sprint-dial";
      document.body.appendChild(a);
      a.click();
      a.remove();
      const set = (state) => {
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
        document.dispatchEvent(new Event("visibilitychange"));
      };
      set("hidden");
      set("visible");
    }, href);
  };
  await away("tel:5125550103");
  await form.waitFor();
  assert.equal(await form.locator("[data-testid=log-type-PHONE_CALL]").getAttribute("aria-pressed"), "true");
  await page.keyboard.press("Escape");
  await form.waitFor({ state: "detached" });
  await away("sms:5125550103");
  await form.waitFor();
  assert.equal(await form.locator("[data-testid=log-type-TEXT]").getAttribute("aria-pressed"), "true");
  assert.deepEqual(
    (await form.locator("[data-testid=outcome-chips] button").allTextContents()).map((t) => t.trim()),
    ["Sent", "They replied", "Meeting booked", "Not interested"],
  );

  log("Sprint: Escape closes the sheet and focus goes back to the bar");
  await page.keyboard.press("Escape");
  await form.waitFor({ state: "detached" });
  await page.locator("[data-testid=log-bar]").focus();
  await page.keyboard.press("Enter");
  await form.waitFor();
  await page.keyboard.press("Escape");
  await form.waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-testid")), "log-bar");

  log("Sprint: the company page asks Who? first, with a Front desk / main line chip; Front desk + No answer is a try on the company");
  await page.goto(`${BASE}/dashboard/companies/cmp_hd_red`);
  await openBar();
  const order = await form.evaluate((el) => {
    const who = el.querySelector("[data-testid=company-people-picker]");
    const chips = el.querySelector("[data-testid=outcome-chips]");
    return Boolean(who && chips && who.compareDocumentPosition(chips) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  assert.ok(order, "Who? comes before the outcome");
  assert.ok(await form.locator("[data-testid=outcome-BOOKED]").isDisabled(), "a meeting needs a person");
  await form.locator("[data-testid=company-bypass-tick]").check();
  await form.locator("[data-testid=outcome-NO_ANSWER]").click();
  await next.waitFor();
  const desk = await one(`SELECT "contactId", "companyId", outcome FROM "Activity" WHERE "companyId"='cmp_hd_red'`);
  assert.deepEqual({ ...desk }, { contactId: null, companyId: "cmp_hd_red", outcome: "NO_ANSWER" });
  await page.locator("[data-testid=follow-up-skip]").click();
  await toast.getByText(/Saved · No answer/).waitFor();

  log("Sprint: the calendar's Done box is the same sheet: a call ticked No answer offers the next follow-up, in the same save");
  await sql(
    `INSERT INTO "CalendarEvent" (id,"organizationId","ownerId",type,title,"startOn","contactId","companyId",notes,"updatedAt")
     VALUES ('evt_hd_call',$1,$2,'Call','Call · Dana Ruiz',$3::date,'ctc_hd_dana','cmp_hd_iron','',now())`,
    [org, taylor.id, TODAY],
  );
  await page.goto(`${BASE}/dashboard/calendar?layout=log`);
  await page.locator(`[data-testid=log-row][data-event-id="evt_hd_call"] [data-testid=log-done]`).click();
  const box = page.locator("[data-testid=done-box]");
  await box.waitFor();
  assert.equal(await box.locator("[data-testid=done-type-PHONE_CALL]").getAttribute("aria-pressed"), "true");
  await box.locator("[data-testid=outcome-NO_ANSWER]").click();
  await box.locator("[data-testid=follow-up-prompt]").waitFor();
  assert.equal(await box.locator("[data-testid=next-follow]").getAttribute("aria-checked"), "true");
  await shot(page, "04-done-box-next");
  await box.locator("[data-testid=follow-up-save]").click();
  await box.waitFor({ state: "detached" });
  const ticked = await one(`SELECT e."doneAt", a.outcome, a."batchId" FROM "CalendarEvent" e JOIN "Activity" a ON a.id=e."activityId" WHERE e.id='evt_hd_call'`);
  assert.ok(ticked.doneAt, "ticked done");
  assert.equal(ticked.outcome, "NO_ANSWER");
  assert.equal(await count(`SELECT count(*)::int n FROM "CalendarEvent" WHERE "batchId"=$1 AND "doneAt" IS NULL AND "startOn"=$2::date`, [ticked.batchId, SECOND]), 1, "the chain goes on");

  log("Sprint: a meeting ticked Held in the Done box while still ahead asks first, then holds it, and offers Start a quote");
  const chaseMeet = await one(`SELECT e.id FROM "CalendarEvent" e WHERE e."organizationId"=$1 AND e.title='Meeting · Dana Ruiz'`, [org]);
  await page.goto(`${BASE}/dashboard/calendar?layout=log`);
  await page.locator(`[data-testid=log-row][data-event-id="${chaseMeet.id}"] [data-testid=log-done]`).click();
  await box.waitFor();
  assert.equal(await box.locator("[data-testid=done-type-MEETING]").getAttribute("aria-pressed"), "true");
  assert.deepEqual((await box.locator("[data-testid=outcome-chips] button").allTextContents()).map((t) => t.trim()), ["Held", "No-show", "Rescheduled"]);
  await box.locator("[data-testid=outcome-HELD]").click();
  await box.locator("[data-testid=log-early]").waitFor();
  assert.match(await box.locator("[data-testid=log-early]").textContent(), /Did it happen early\?/);
  assert.equal(await status("Contact", "ctc_hd_dana"), "MEETING_SET", "nothing written before the answer");
  await box.locator("[data-testid=log-early-yes]").click();
  await box.locator("[data-testid=follow-up-prompt]").waitFor();
  assert.equal(await status("Contact", "ctc_hd_dana"), "MEETING_COMPLETED");
  assert.equal(await box.locator("[data-testid=next-quote]").getAttribute("aria-checked"), "true");
  assert.equal(await box.locator("[data-testid=follow-up-save]").getAttribute("href"), "/dashboard/quotes/new?contactId=ctc_hd_dana");
  await box.locator("[data-testid=follow-up-skip]").click();
  await box.waitFor({ state: "detached" });

  log("Sprint: on the contact page, Meeting · No-show answers the meeting that has passed; Reschedule books it again on the same tile");
  await sql(`UPDATE "CalendarEvent" SET "startOn"=$2::date WHERE id=$1`, [krisMeeting.id, shift(TODAY, -1)]);
  await sql(`UPDATE "OpportunityMeeting" SET "on"=now() - interval '1 day' WHERE id=$1`, [krisOm.id]);
  await page.goto(`${BASE}/dashboard/contacts/ctc_hd_kris`);
  await openBar();
  await form.locator("[data-testid=log-type-MEETING]").click();
  await form.locator("[data-testid=log-meeting-line]").waitFor();
  const krisBefore = await status("Contact", "ctc_hd_kris");
  await form.locator("[data-testid=outcome-NO_SHOW]").click();
  await next.waitFor();
  assert.equal((await one(`SELECT outcome FROM "OpportunityMeeting" WHERE id=$1`, [krisOm.id])).outcome, "NO_SHOW");
  assert.equal(await status("Contact", "ctc_hd_kris"), krisBefore, "a no-show moves nobody");
  assert.equal(await next.locator("[data-testid=next-reschedule]").getAttribute("aria-checked"), "true");
  await next.locator("[data-testid=book-day-week]").click();
  await next.locator("[data-testid=book-time-09\\:00]").click();
  await page.locator("[data-testid=follow-up-save]").click();
  await toast.getByText(/Rescheduled to/).waitFor();
  assert.equal(await count(`SELECT count(*)::int n FROM "OpportunityMeeting" WHERE "opportunityId"=$1 AND outcome IS NULL`, [krisOm.opportunityId]), 1, "a new meeting on the same tile");

  log("Sprint: on a phone the sheet is a bottom sheet — 56px chips two to a row, Save pinned, nothing sideways");
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mobile = await phone.newPage();
  await login(mobile, EMAIL);
  await mobile.goto(`${BASE}/dashboard/contacts/ctc_hd_olivia`);
  await mobile.locator("[data-testid=log-bar]").click();
  const mSheet = mobile.locator("[data-testid=how-did-it-go]");
  await mSheet.waitFor();
  const box1 = await mSheet.boundingBox();
  assert.ok(Math.abs(box1.y + box1.height - 844) <= 2, `pinned to the bottom (${box1.y + box1.height})`);
  const chips = mobile.locator("[data-testid=outcome-chips] button");
  const a = await chips.nth(0).boundingBox();
  const b = await chips.nth(1).boundingBox();
  assert.ok(a.height >= 56 && b.height >= 56, `56px chips (${a.height})`);
  assert.ok(Math.abs(a.y - b.y) < 1 && b.x > a.x, "two to a row");
  const submit = await mobile.locator("[data-testid=activity-submit]").boundingBox();
  assert.ok(submit.y + submit.height <= 844, "the save row is on screen");
  assert.ok(submit.height >= 44, "44px to tap");
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= 390), "nothing sideways");
  await shot(mobile, "05-phone-sheet");
  await phone.close();

  await sql(`DELETE FROM "Organization" WHERE id=$1`, [org]);
  await browser.close();
  console.log(`\nAll ${step} steps passed. Screenshots in ${OUT}`);
  process.exit(0);
})().catch((err) => {
  console.error("\nFAILED at step", step, "\n", err);
  process.exit(1);
});
