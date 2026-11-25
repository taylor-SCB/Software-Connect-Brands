/* Browser regression for Pipeline AI, Release 1: Activity AI (Nov 25, 2026).
 *
 * Covers: the bar on an empty Pipeline; a typed call read into a card
 * (Found person, outcome and interest pre-picked, the words fenced in the
 * prompt) and saved through the log form's own save (the history line, the
 * calendar entry, the status), then Undo; whatever the AI says that isn't
 * in the words (a name, an email, a number in the notes) dropped and
 * counted; a held meeting with someone who only looks like a contact and a
 * business that only looks like one (the "Is this the same person?" box,
 * Save waiting on it), a new person made at the business picked, with
 * Added by and the rep (decision 4), the tile at Meeting Completed, and
 * Undo taking the new person and the tile back; the server checking a new
 * person again at Save; one sentence as three cards (a front-desk try on
 * the business, a Family note, a meeting booked ahead) each saved on its
 * own; a call scheduled ahead (a calendar entry, no history); a call with
 * a price given making a deal at Quote Sent with a new person and business,
 * and Undo taking all of it back; a tile with its meeting still ahead left
 * alone; Build Quote from a held meeting opening the new quote with its
 * lines drafted from the words at the catalog's price; "Already a deal";
 * a refusal, an API failure that gives its allowance back (bug 6) and the
 * day's allowance as sentences; the company page's "Add New Contact" asking
 * about a look-alike (bug 1); the ✦ on a phone; and, on a server without
 * the key, no bar and no ✦.
 *
 * Claude is never called: fake-claude.cjs answers on :3995 by kind. Start
 * the server with ANTHROPIC_API_KEY=test-key and
 * ANTHROPIC_ENDPOINT=http://localhost:3995 (run-suites.sh's "ai" group
 * does). For "AI off" the suite starts its own keyless server on NOAI_PORT
 * (default 3131) from the same build, or uses NOAI_BASE when given.
 *
 *   BASE=http://localhost:3400 \
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/scb_test \
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules \
 *   node scripts/browser-tests/pipeline-ai-activity.cjs
 */
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS on purpose, like every suite */
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");
const { Client } = require("pg");
const { startFakeClaude } = require("./fake-claude.cjs");

const BASE = process.env.BASE || "http://localhost:3400";
const DB = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5433/scb_test";
const NOAI_PORT = Number(process.env.NOAI_PORT || 3131);
let NOAI_BASE = process.env.NOAI_BASE || "";
const OUT = process.env.SHOTS_DIR || path.join(os.tmpdir(), "scb-browser-shots-pipeline-ai");
fs.mkdirSync(OUT, { recursive: true });

const EMAIL = "test-pipeline-ai@example.com";
const PASSWORD = "password123";
const COMPANY = "Test Pipeline AI Co";
const SLUG_LIKE = "test-pipeline-ai-co%";
const ZONE = "America/Chicago";

let step = 0;
function log(msg) {
  step += 1;
  console.log(`[${String(step).padStart(2, "0")}] ${msg}`);
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
async function until(check, what, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) {
    if (await check()) return;
    if (Date.now() > end) {
      const toast = lastPage ? await lastPage.getByTestId("log-toast-words").innerText({ timeout: 500 }).catch(() => "(no toast)") : "";
      const errors = lastPage ? await lastPage.getByTestId("pai-card-error").allInnerTexts().catch(() => []) : [];
      throw new Error(`timed out waiting for ${what} (toast: ${toast}; card errors: ${errors.join(" | ") || "none"})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}
const isoIn = (date) => new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
const TODAY = isoIn(new Date());
const plusDays = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true }).catch(() => {});

async function login(page, base = BASE) {
  await page.goto(`${base}/login`);
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/dashboard/);
}

// The answer Claude would give, with every field the schema asks for.
const company = (name, extra = {}) => ({ name, phone: null, website: null, city: null, state: null, ...extra });
const person = (name, companyIndex = null, extra = {}) => ({ name, title: null, email: null, phone: null, company: companyIndex, ...extra });
const entry = (fields) => ({
  kind: "LOG",
  type: "PHONE_CALL",
  outcome: null,
  day: null,
  time: null,
  notes: "",
  noteLabel: null,
  people: [],
  company: null,
  interest: null,
  reason: null,
  deal: "NONE",
  valueDollars: null,
  where: null,
  ...fields,
});

let noaiServer = null;
let lastPage = null;
(async () => {
  const claude = await startFakeClaude();
  await sql(`DELETE FROM "Organization" WHERE slug LIKE $1`, [SLUG_LIKE]);
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await context.newPage();
  lastPage = page;
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
  await sql(`UPDATE "Organization" SET status='ACTIVE', "reviewedAt"=now(), "timeZone"=$2 WHERE slug LIKE $1`, [SLUG_LIKE, ZONE]);
  await login(page);
  const org = (await one(`SELECT id FROM "Organization" WHERE slug LIKE $1`, [SLUG_LIKE])).id;
  const me = await one(`SELECT id, "passwordHash" FROM "User" WHERE email=$1`, [EMAIL]);
  const userId = me.id;

  log("seed: Acme Roofing with Bob Smith, Lee Property Group with Sue Lee, a teammate, a catalog camera");
  await sql(
    `INSERT INTO "User" (id,"organizationId",name,email,"passwordHash",role) VALUES ('pai_rae',$1,'Rae Rep','test-pipeline-ai-rae@example.com',$2,'MEMBER')`,
    [org, me.passwordHash],
  );
  await sql(
    `INSERT INTO "Company" (id,"organizationId",name,"companyTypes","updatedAt") VALUES
       ('pai_co_acme',$1,'Acme Roofing','{}',now()),
       ('pai_co_lee',$1,'Lee Property Group','{}',now())`,
    [org],
  );
  await sql(
    `INSERT INTO "Contact" (id,"organizationId","companyId",name,email,phone,"updatedAt") VALUES
       ('pai_bob',$1,'pai_co_acme','Bob Smith','bob@acmeroofing.com','(512) 555-0101',now()),
       ('pai_sue',$1,'pai_co_lee','Sue Lee','sue@leeprop.com',NULL,now())`,
    [org],
  );
  await sql(
    `INSERT INTO "Product" (id,"organizationId",name,sku,"unitPriceCents","defaultTag",active,"updatedAt") VALUES
       ('pai_cam',$1,'4MP Dome Camera','CAM-4MP',18900,'MATERIALS',true,now())`,
    [org],
  );
  const bar = page.getByTestId("pai-bar");
  const words = bar.getByTestId("pai-words");
  const cards = bar.getByTestId("pai-card");
  const readIt = async (text) => {
    await words.fill(text);
    await bar.getByTestId("pai-read").click();
  };
  const toastWords = () => page.getByTestId("log-toast-words").innerText();

  log("the bar is on an empty Pipeline");
  await page.goto(`${BASE}/dashboard/deals`);
  await bar.waitFor();
  await page.getByText("Nothing on the pipeline yet").waitFor();
  await shot(page, "01-empty-pipeline-bar");

  log("a typed call: Bob found, Talked and Interested picked, the words fenced in the prompt; Save logs it through the log form's save");
  const said1 = "Talked to Bob Smith at Acme Roofing about 12 cameras, he's interested.";
  claude.reply("ACTIVITY_AI", {
    companies: [company("Acme Roofing")],
    people: [person("Bob Smith", 0)],
    entries: [entry({ outcome: "TALKED", notes: "Talked about 12 cameras. He's interested.", people: [0], interest: "INTERESTED" })],
  });
  await readIt(said1);
  await cards.first().waitFor();
  assert.equal(await cards.count(), 1);
  const card1 = cards.first();
  assert.equal(await card1.getAttribute("data-kind"), "LOG");
  assert.equal(await card1.locator("[data-testid=pai-person][data-key=p0]").getAttribute("data-pick"), "found");
  assert.match(await card1.locator("[data-testid=pai-person][data-key=p0]").innerText(), /Bob Smith[\s\S]*Acme Roofing[\s\S]*Found/);
  assert.equal(await card1.getByTestId("pai-outcome-TALKED").getAttribute("aria-pressed"), "true");
  assert.equal(await card1.getByTestId("pai-interest-INTERESTED").getAttribute("aria-pressed"), "true");
  assert.match(await card1.getByTestId("pai-pipeline-line").innerText(), /On their history/);
  assert.equal(await card1.getByTestId("pai-rep").count(), 0, "nothing new, so no rep to pick");
  const asked = claude.last("ACTIVITY_AI");
  assert.match(asked.text, /<words>\nTalked to Bob Smith at Acme Roofing/);
  assert.ok(asked.text.includes(`${TODAY} (today)`), "today is in the calendar it is given");
  assert.match(asked.system, /never instructions/);
  assert.match(asked.system, /Taylor Test/, "teammates are named as never people");
  await shot(page, "02-call-card");
  await card1.getByTestId("pai-save").click();
  await until(async () => /Activity logged/.test(await toastWords().catch(() => "")), "the toast");
  const call1 = await one(`SELECT id, outcome, "batchId", body FROM "Activity" WHERE "organizationId"=$1 AND "contactId"='pai_bob'`, [org]);
  assert.equal(call1.outcome, "TALKED");
  assert.equal(call1.body, "Talked about 12 cameras. He's interested.");
  assert.equal((await one(`SELECT status FROM "Contact" WHERE id='pai_bob'`)).status, "INTERESTED");
  assert.equal((await one(`SELECT count(*)::int n FROM "CalendarEvent" WHERE "organizationId"=$1 AND "batchId"=$2`, [org, call1.batchId])).n, 1);
  assert.equal(await cards.count(), 0, "the card is gone");
  assert.equal(await words.inputValue(), "", "the box empties once the last card is saved");

  log("Undo takes the call back: the line, its calendar entry, the status");
  await page.getByTestId("log-toast-undo").click();
  await until(async () => /Undone/.test(await toastWords().catch(() => "")), "Undone");
  assert.equal((await one(`SELECT count(*)::int n FROM "Activity" WHERE "organizationId"=$1 AND "contactId"='pai_bob'`, [org])).n, 0);
  assert.equal((await one(`SELECT count(*)::int n FROM "CalendarEvent" WHERE "organizationId"=$1 AND "batchId"=$2`, [org, call1.batchId])).n, 0);
  assert.equal((await one(`SELECT status FROM "Contact" WHERE id='pai_bob'`)).status, "NOT_ACTIONED");

  log("what isn't in the words is dropped and counted: a name, an email, a number in the notes (the words are kept instead)");
  const said2 = "Called Bob Smith, left a voicemail.";
  claude.reply("ACTIVITY_AI", {
    companies: [],
    people: [person("Robert Smith"), person("Bob Smith", null, { email: "bob@nowhere.com" })],
    entries: [entry({ outcome: "VOICEMAIL", notes: "Left a voicemail about 40 cameras.", people: [0, 1] })],
  });
  await readIt(said2);
  await cards.first().waitFor();
  assert.equal(await cards.first().locator("[data-testid=pai-person]").count(), 1, "Robert was never said");
  assert.equal(await cards.first().locator("[data-testid=pai-person][data-key=p0]").getAttribute("data-pick"), "found", "Bob, by the same name with no company said");
  assert.equal(await cards.first().getByTestId("pai-notes").inputValue(), said2);
  assert.match(await bar.getByTestId("pai-dropped").innerText(), /things I heard didn't match your words/);
  await cards.first().getByTestId("pai-cancel").click();
  assert.equal(await cards.count(), 0);
  assert.equal(await words.inputValue(), said2, "dismissing keeps the words to read again");

  log("a held meeting: Sue and Lee Property only look like ones here, so the box asks and Save waits; Mark is made at the business picked, with the rep");
  const said3 = "Met Sue Lee from Lee Property and her colleague Mark Hill yesterday, went well.";
  const reply3 = {
    companies: [company("Lee Property")],
    people: [person("Sue Lee", 0), person("Mark Hill", 0)],
    entries: [entry({ type: "MEETING", outcome: "HELD", day: plusDays(TODAY, -1), notes: "Met Sue and Mark. It went well.", people: [0, 1] })],
  };
  claude.reply("ACTIVITY_AI", reply3);
  await readIt(said3);
  await cards.first().waitFor();
  const card3 = cards.first();
  assert.equal(await card3.locator("[data-testid=pai-person][data-key=p0]").getAttribute("data-pick"), "ask");
  assert.equal(await card3.locator("[data-testid=pai-person][data-key=p1]").getAttribute("data-pick"), "new");
  assert.equal(await card3.locator("[data-testid=pai-company][data-key=c0]").getAttribute("data-pick"), "ask");
  assert.equal(await card3.getByTestId("pai-same").count(), 2);
  assert.ok(await card3.getByTestId("pai-save").isDisabled(), "Save waits on the box");
  assert.match(await card3.getByTestId("pai-blocker").innerText(), /Answer the box above first/);
  assert.match(await card3.getByTestId("pai-pipeline-line").innerText(), /A new tile in Meeting Completed/);
  await shot(page, "03-same-person-box");
  await card3.locator("[data-testid=pai-same-use][data-id=pai_sue]").click();
  await card3.locator("[data-testid=pai-same-use][data-id=pai_co_lee]").click();
  assert.equal(await card3.locator("[data-testid=pai-person][data-key=p0]").getAttribute("data-pick"), "found");
  assert.equal(await card3.getByTestId("pai-rep").inputValue(), userId, "the person logging is the rep on anything new (decision 4)");
  assert.ok(!(await card3.getByTestId("pai-save").isDisabled()));
  await card3.getByTestId("pai-save").click();
  await until(async () => /Logged on 2 contacts[\s\S]*1 new record/.test(await toastWords().catch(() => "")), "the meeting's toast");
  const mark = await one(`SELECT id, "companyId", "createdById", "ownerId" FROM "Contact" WHERE "organizationId"=$1 AND name='Mark Hill'`, [org]);
  assert.deepEqual({ ...mark, id: undefined }, { id: undefined, companyId: "pai_co_lee", createdById: userId, ownerId: userId });
  const meeting = await sql(`SELECT "contactId", outcome FROM "Activity" WHERE "organizationId"=$1 AND type='MEETING' ORDER BY "contactId"`, [org]);
  assert.deepEqual(meeting.rows.map((row) => row.outcome), ["HELD", "HELD"]);
  const tile = await one(
    `SELECT o.id, o.stage, count(oc.id)::int AS people FROM "Opportunity" o JOIN "OpportunityContact" oc ON oc."opportunityId"=o.id WHERE o."organizationId"=$1 GROUP BY o.id`,
    [org],
  );
  assert.deepEqual({ stage: tile.stage, people: tile.people }, { stage: "MEETING_COMPLETED", people: 2 });
  assert.equal((await one(`SELECT status FROM "Contact" WHERE id='pai_sue'`)).status, "MEETING_COMPLETED");

  log("Undo takes the meeting, the tile and Mark back; Sue goes back where she was");
  await page.getByTestId("log-toast-undo").click();
  await until(async () => /Undone/.test(await toastWords().catch(() => "")), "Undone");
  assert.equal((await one(`SELECT count(*)::int n FROM "Contact" WHERE "organizationId"=$1 AND name='Mark Hill'`, [org])).n, 0);
  assert.equal((await one(`SELECT count(*)::int n FROM "Opportunity" WHERE "organizationId"=$1`, [org])).n, 0);
  assert.equal((await one(`SELECT count(*)::int n FROM "Activity" WHERE "organizationId"=$1 AND type='MEETING'`, [org])).n, 0);
  assert.equal((await one(`SELECT status FROM "Contact" WHERE id='pai_sue'`)).status, "NOT_ACTIONED");
  assert.equal((await one(`SELECT count(*)::int n FROM "Company" WHERE id='pai_co_lee'`)).n, 1, "a business that was already here stays");

  log("Save checks a new person again: someone added meanwhile is asked about, and 'No, make a new contact' goes through");
  claude.reply("ACTIVITY_AI", {
    companies: [company("Acme Roofing")],
    people: [person("Nina Park", 0)],
    entries: [entry({ outcome: "TALKED", notes: "Talked with Nina.", people: [0] })],
  });
  await readIt("Talked to Nina Park at Acme Roofing.");
  await cards.first().waitFor();
  assert.equal(await cards.first().locator("[data-testid=pai-person][data-key=p0]").getAttribute("data-pick"), "new");
  await sql(`INSERT INTO "Contact" (id,"organizationId","companyId",name,"updatedAt") VALUES ('pai_nina',$1,'pai_co_acme','Nina Park',now())`, [org]);
  await cards.first().getByTestId("pai-save").click();
  await cards.first().getByTestId("pai-card-error").waitFor();
  assert.match(await cards.first().getByTestId("pai-card-error").innerText(), /may already be here/);
  assert.equal(await cards.first().locator("[data-testid=pai-person][data-key=p0]").getAttribute("data-pick"), "ask");
  await cards.first().locator("[data-testid=pai-same-use][data-id=pai_nina]").waitFor();
  await cards.first().getByTestId("pai-same-new").click();
  await cards.first().getByTestId("pai-save").click();
  await until(async () => (await one(`SELECT count(*)::int n FROM "Contact" WHERE "organizationId"=$1 AND name='Nina Park'`, [org])).n === 2, "the second Nina, asked for");
  await until(async () => (await cards.count()) === 0, "the card saved");

  log("a first name alone, and two people with the same name at one business, are asked about rather than guessed");
  claude.reply("ACTIVITY_AI", {
    companies: [company("Acme Roofing")],
    people: [person("Bob"), person("Nina Park", 0)],
    entries: [entry({ outcome: "NO_ANSWER", notes: "No answer.", people: [0] }), entry({ outcome: "TALKED", notes: "Talked with Nina.", people: [1] })],
  });
  await readIt("Called Bob, no answer. Talked to Nina Park at Acme Roofing.");
  await until(async () => (await cards.count()) === 2, "two cards");
  assert.equal(await cards.nth(0).locator("[data-testid=pai-person][data-key=p0]").getAttribute("data-pick"), "ask");
  await cards.nth(0).locator("[data-testid=pai-same-use][data-id=pai_bob]").waitFor();
  assert.match(await cards.nth(0).getByTestId("pai-same").innerText(), /First name, at Acme Roofing/);
  assert.equal(await cards.nth(1).locator("[data-testid=pai-person][data-key=p1]").getAttribute("data-pick"), "ask");
  assert.equal(await cards.nth(1).getByTestId("pai-same-use").count(), 2, "both Ninas offered");
  await bar.getByTestId("pai-clear").click();
  assert.equal(await cards.count(), 0);

  log("one sentence, three cards: a front-desk try on the business, a Family note on Bob, a meeting booked ahead; each saved on its own");
  const tuesday = plusDays(TODAY, 6);
  claude.reply("ACTIVITY_AI", {
    companies: [company("Acme Roofing")],
    people: [person("Bob Smith", 0)],
    entries: [
      entry({ outcome: "GATEKEEPER", notes: "Called the main line, nobody picked up.", company: 0 }),
      entry({ kind: "NOTE", type: null, notes: "Bob's daughter is getting married in June.", noteLabel: "FAMILY", people: [0] }),
      entry({ kind: "BOOK", type: "MEETING", day: tuesday, time: "14:00", notes: "Meeting at their office.", people: [0], where: "their office" }),
    ],
  });
  await readIt("Called Acme Roofing's main line, nobody picked up. Bob's daughter is getting married in June. Meeting with Bob Smith next Tuesday at 2pm at their office.");
  await until(async () => (await cards.count()) === 3, "three cards");
  assert.deepEqual(await cards.evaluateAll((list) => list.map((el) => el.getAttribute("data-kind"))), ["LOG", "NOTE", "BOOK"]);
  const desk = cards.nth(0);
  await desk.getByTestId("pai-company-only").waitFor();
  assert.equal(await desk.getByTestId("pai-outcome-TALKED").count(), 0, "with nobody named it's a try, never a talk");
  assert.equal(await desk.getByTestId("pai-type-MEETING").count(), 0);
  assert.equal(await cards.nth(1).getByTestId("pai-note-label").inputValue(), "FAMILY");
  assert.equal(await cards.nth(2).getByTestId("pai-day").inputValue(), tuesday);
  assert.equal(await cards.nth(2).getByTestId("pai-time").inputValue(), "14:00");
  assert.equal(await cards.nth(2).getByTestId("pai-where").inputValue(), "their office");
  await shot(page, "04-three-cards");
  // The note, then its Undo.
  await cards.nth(1).getByTestId("pai-save").click();
  await until(async () => /Note added/.test(await toastWords().catch(() => "")), "the note's toast");
  const note = await one(`SELECT id, label, body FROM "Note" WHERE "organizationId"=$1 AND "contactId"='pai_bob'`, [org]);
  assert.deepEqual({ label: note.label, body: note.body }, { label: "FAMILY", body: "Bob's daughter is getting married in June." });
  await page.getByTestId("log-toast-undo").click();
  await until(async () => /Undone/.test(await toastWords().catch(() => "")), "the note undone");
  assert.equal((await one(`SELECT count(*)::int n FROM "Note" WHERE id=$1`, [note.id])).n, 0);
  // The front desk.
  await cards.nth(0).getByTestId("pai-save").click();
  await until(async () => (await cards.count()) === 1, "the front-desk card saved");
  const deskRow = await one(`SELECT "contactId", "companyId", outcome FROM "Activity" WHERE "organizationId"=$1 AND "companyId"='pai_co_acme'`, [org]);
  assert.deepEqual(deskRow, { contactId: null, companyId: "pai_co_acme", outcome: "GATEKEEPER" });
  // The booking.
  await cards.first().getByTestId("pai-save").click();
  await until(async () => (await cards.count()) === 0, "the booking saved");
  const booked = await one(
    `SELECT e."startOn"::text AS on, e."startTime" AS time, e."doneAt" FROM "CalendarEvent" e WHERE e."organizationId"=$1 AND e.type ILIKE 'meeting' AND e."contactId"='pai_bob'`,
    [org],
  );
  assert.equal(booked.on, tuesday);
  assert.equal(booked.doneAt, null);
  const bookedTile = await one(
    `SELECT o.stage, m."bookedById" FROM "Opportunity" o JOIN "OpportunityMeeting" m ON m."opportunityId"=o.id JOIN "OpportunityContact" oc ON oc."opportunityId"=o.id AND oc."contactId"='pai_bob' WHERE o."organizationId"=$1`,
    [org],
  );
  assert.deepEqual(bookedTile, { stage: "MEETING_SET", bookedById: userId });

  log("a call to make Friday goes on the calendar, not into the history");
  const friday = plusDays(TODAY, 2);
  claude.reply("ACTIVITY_AI", { companies: [], people: [person("Sue Lee")], entries: [entry({ kind: "SCHEDULE", day: friday, notes: "Call about the walkthrough.", people: [0] })] });
  await readIt("Call Sue Lee on Friday about the walkthrough.");
  await cards.first().waitFor();
  assert.equal(await cards.first().getAttribute("data-kind"), "SCHEDULE");
  assert.match(await cards.first().getByTestId("pai-pipeline-line").innerText(), /On your calendar for that day/);
  await cards.first().getByTestId("pai-save").click();
  await until(async () => (await cards.count()) === 0, "scheduled");
  assert.equal((await one(`SELECT count(*)::int n FROM "Activity" WHERE "organizationId"=$1 AND "contactId"='pai_sue'`, [org])).n, 0);
  const scheduled = await one(`SELECT "startOn"::text AS on, "doneAt" FROM "CalendarEvent" WHERE "organizationId"=$1 AND "contactId"='pai_sue' AND title ILIKE '%sue%'`, [org]);
  assert.deepEqual(scheduled, { on: friday, doneAt: null });

  log("a price given on a call: a deal at Quote Sent with a new person and business; Undo takes all of it back");
  claude.reply("ACTIVITY_AI", {
    companies: [company("Ward Builders")],
    people: [person("Tom Ward", 0)],
    entries: [entry({ outcome: "TALKED", notes: "Gave him a price of $8,500 for the cameras.", people: [0], deal: "PRICED", valueDollars: 8500 })],
  });
  await readIt("Talked to Tom Ward at Ward Builders, gave him a price of $8,500 for the cameras.");
  await cards.first().waitFor();
  const priced = cards.first();
  assert.equal(await priced.getByTestId("pai-deal-PRICED").getAttribute("aria-pressed"), "true");
  assert.equal(await priced.getByTestId("pai-deal-value").inputValue(), "8500");
  assert.equal(await priced.getByTestId("pai-deal-title").inputValue(), "Ward Builders");
  assert.match(await priced.getByTestId("pai-pipeline-line").innerText(), /Then a deal at Quote Sent\./);
  await priced.getByTestId("pai-save").click();
  await until(async () => /Deal at Quote Sent for \$8,500\.00[\s\S]*2 new records/.test(await toastWords().catch(() => "")), "the deal's toast");
  const tom = await one(`SELECT id, status, "companyId" FROM "Contact" WHERE "organizationId"=$1 AND name='Tom Ward'`, [org]);
  assert.equal(tom.status, "QUOTE_SENT");
  const ward = await one(`SELECT "ownerId", "createdById" FROM "Company" WHERE id=$1`, [tom.companyId]);
  assert.deepEqual(ward, { ownerId: userId, createdById: userId });
  const deal = await one(`SELECT d.stage, d."valueCents", d.title, o.id AS opp FROM "Deal" d JOIN "Opportunity" o ON o."dealId"=d.id WHERE d."contactId"=$1`, [tom.id]);
  assert.deepEqual({ stage: deal.stage, valueCents: deal.valueCents, title: deal.title }, { stage: "QUOTE_SENT", valueCents: 850000, title: "Ward Builders" });
  await page.getByTestId("log-toast-undo").click();
  await until(async () => /Undone/.test(await toastWords().catch(() => "")), "Undone");
  assert.equal((await one(`SELECT count(*)::int n FROM "Contact" WHERE id=$1`, [tom.id])).n, 0);
  assert.equal((await one(`SELECT count(*)::int n FROM "Company" WHERE id=$1`, [tom.companyId])).n, 0);
  assert.equal((await one(`SELECT count(*)::int n FROM "Opportunity" WHERE id=$1`, [deal.opp])).n, 0);
  assert.equal((await one(`SELECT count(*)::int n FROM "Deal" WHERE "organizationId"=$1 AND title='Ward Builders'`, [org])).n, 0);

  log("a tile with its meeting still to come is left alone: no deal off a call to Bob");
  claude.reply("ACTIVITY_AI", { companies: [], people: [person("Bob Smith")], entries: [entry({ outcome: "TALKED", notes: "He wants a quote.", people: [0], deal: "QUOTE" })] });
  await readIt("Talked to Bob Smith, he wants a quote.");
  await cards.first().waitFor();
  await cards.first().getByTestId("pai-meeting-ahead").waitFor();
  assert.equal(await cards.first().getByTestId("pai-deal").count(), 0);
  await cards.first().getByTestId("pai-cancel").click();

  log("Build Quote off a held meeting opens the new quote with lines drafted from the words at the catalog's price");
  claude.reply("ACTIVITY_AI", {
    companies: [],
    people: [person("Sue Lee")],
    entries: [entry({ type: "MEETING", outcome: "HELD", notes: "She wants a quote for 12 4MP dome cameras.", people: [0], deal: "QUOTE" })],
  });
  claude.reply("QUOTE_DRAFT", { lines: [{ productId: "pai_cam", name: "", quantity: 12, tag: "MATERIALS", note: "12 cameras" }] });
  await readIt("Met Sue Lee today, she wants a quote for 12 4MP dome cameras.");
  await cards.first().waitFor();
  assert.equal(await cards.first().getByTestId("pai-deal-QUOTE").getAttribute("aria-pressed"), "true");
  assert.equal(await cards.first().getByTestId("pai-deal-title").inputValue(), "Lee Property Group");
  await cards.first().getByTestId("pai-save").click();
  await page.waitForURL(/\/dashboard\/quotes\/[^/?]+/);
  await page.getByTestId("quote-draft-info").waitFor();
  assert.match(await page.getByTestId("quote-draft-info").innerText(), /Added 1 line/);
  assert.equal(await page.locator("input[aria-label='Line 1 quantity']").inputValue(), "12");
  assert.equal(await page.locator("input[aria-label='Line 1 unit value']").inputValue(), "189.00");
  assert.doesNotMatch(page.url(), /draft=/, "the address is cleaned so a reload doesn't draft again");
  const draftAsk = claude.last("QUOTE_DRAFT");
  assert.match(draftAsk.text, /<words>\nShe wants a quote for 12 4MP dome cameras\.\n<\/words>/);
  assert.match(draftAsk.text, /pai_cam \| 4MP Dome Camera \| SKU CAM-4MP \| \$189\.00/);
  const quoteId = page.url().split("/").pop().split("?")[0];
  assert.equal((await one(`SELECT count(*)::int n FROM "QuoteLineItem" WHERE "quoteId"=$1`, [quoteId])).n, 0, "nothing saved until Save");
  log("review fixes: after a save the quote still drafts from what was said (?from= stays, ?draft= goes)");
  await page.getByTestId("quote-save").click();
  await until(async () => (await one(`SELECT count(*)::int n FROM "QuoteLineItem" WHERE "quoteId"=$1`, [quoteId])).n === 1, "the drafted line saved");
  await page.reload();
  assert.match(page.url(), /\?from=/);
  assert.match(await page.getByTestId("quote-draft-meeting").innerText(), /Draft lines from what you said/);
  await page.getByTestId("quote-draft-meeting").click();
  await page.getByTestId("quote-draft-info").waitFor();
  assert.equal(await page.getByTestId("quote-draft-error").count(), 0);
  assert.match(claude.last("QUOTE_DRAFT").text, /Already on it: 12 × 4MP Dome Camera/);
  await page.goto(`${BASE}/dashboard/quotes/${quoteId}`);
  await sql(`DELETE FROM "QuoteLineItem" WHERE "quoteId"=$1`, [quoteId]);
  const q = await one(`SELECT q.status, d.stage, o.stage AS opp FROM "Quote" q JOIN "Deal" d ON d.id=q."dealId" JOIN "Opportunity" o ON o."dealId"=d.id WHERE q.id=$1`, [quoteId]);
  assert.deepEqual(q, { status: "DRAFT", stage: "LEAD", opp: "MEETING_COMPLETED" });

  log("Sue's tile is a deal now: a later card says so, offers none, and its Save makes no second deal (the AI's guess isn't sent)");
  await page.goto(`${BASE}/dashboard/deals`);
  claude.reply("ACTIVITY_AI", { companies: [], people: [person("Sue Lee")], entries: [entry({ outcome: "TALKED", notes: "Checked in.", people: [0], deal: "QUOTE" })] });
  await readIt("Talked to Sue Lee, checked in.");
  await cards.first().waitFor();
  await cards.first().getByTestId("pai-already-deal").waitFor();
  assert.equal(await cards.first().getByTestId("pai-deal").count(), 0);
  assert.match(await cards.first().getByTestId("pai-pipeline-line").innerText(), /^On their history\. It stays off the board\.$/);
  const dealsBefore = (await one(`SELECT count(*)::int n FROM "Deal" WHERE "organizationId"=$1`, [org])).n;
  await cards.first().getByTestId("pai-save").click();
  await until(async () => (await cards.count()) === 0, "saved");
  assert.equal((await one(`SELECT count(*)::int n FROM "Deal" WHERE "organizationId"=$1`, [org])).n, dealsBefore, "no second deal");
  assert.equal((await one(`SELECT count(*)::int n FROM "Quote" WHERE "organizationId"=$1`, [org])).n, 1);

  log("a refusal, an API failure (its allowance given back, bug 6) and the day's allowance are sentences");
  claude.refuse("ACTIVITY_AI");
  await readIt("Talked to Bob Smith.");
  await until(async () => /declined/.test(await bar.getByTestId("pai-error").innerText().catch(() => "")), "refusal");
  const usedBefore = (await one(`SELECT count(*)::int n FROM "AiRequest" WHERE "organizationId"=$1 AND kind='ACTIVITY_AI'`, [org])).n;
  claude.fail("ACTIVITY_AI", 529);
  await bar.getByTestId("pai-read").click();
  await until(async () => /didn't answer/.test(await bar.getByTestId("pai-error").innerText().catch(() => "")), "failure");
  assert.equal((await one(`SELECT count(*)::int n FROM "AiRequest" WHERE "organizationId"=$1 AND kind='ACTIVITY_AI'`, [org])).n, usedBefore, "a failed call doesn't count");
  await sql(`INSERT INTO "AiRequest" (id,"organizationId",kind) SELECT 'pai_cap_'||g,$1,'ACTIVITY_AI' FROM generate_series(1,400) g`, [org]);
  const asks = claude.count("ACTIVITY_AI");
  await bar.getByTestId("pai-read").click();
  await until(async () => /allowance/.test(await bar.getByTestId("pai-error").innerText().catch(() => "")), "allowance");
  assert.equal(claude.count("ACTIVITY_AI"), asks, "past the allowance Claude isn't asked");
  await sql(`DELETE FROM "AiRequest" WHERE id LIKE 'pai_cap_%'`);

  log("bug 1: the company page's Add New Contact asks about a look-alike before making a second Bob Smith");
  await page.goto(`${BASE}/dashboard/companies/pai_co_acme`);
  await page.locator("[data-testid=company-log-toggle]").click();
  const form = page.locator("[data-testid=log-activity-form]");
  const picker = form.locator("[data-testid=company-people-picker]");
  await picker.locator("[data-testid=company-person-add]").click();
  await picker.getByLabel("New contact name").fill("Bob Smith");
  await picker.locator("[data-testid=company-person-save]").click();
  await picker.getByTestId("pai-same").waitFor();
  await picker.locator("[data-testid=pai-same-use][data-id=pai_bob]").click();
  await picker.locator("[data-testid=company-person-chip][aria-checked=true]", { hasText: "Bob Smith" }).waitFor();
  assert.equal((await one(`SELECT count(*)::int n FROM "Contact" WHERE "organizationId"=$1 AND name='Bob Smith'`, [org])).n, 1);
  await picker.locator("[data-testid=company-person-add]").click();
  await picker.getByLabel("New contact name").fill("Zed Newman");
  await picker.locator("[data-testid=company-person-save]").click();
  await picker.locator("[data-testid=company-person-chip][aria-checked=true]", { hasText: "Zed Newman" }).waitFor();
  assert.equal(await picker.getByTestId("pai-same").count(), 0, "nobody like Zed: no box");
  await page.keyboard.press("Escape");

  log("review fixes: a new person on a meeting that joins a tile past Meeting Set goes with Undo, not 'kept'");
  await page.goto(`${BASE}/dashboard/deals`);
  claude.reply("ACTIVITY_AI", {
    companies: [],
    people: [person("Sue Lee"), person("Ray Newell")],
    entries: [entry({ type: "MEETING", outcome: "HELD", notes: "Walked the site with Sue and Ray.", people: [0, 1] })],
  });
  await readIt("Met Sue Lee and Ray Newell today, walked the site.");
  await cards.first().waitFor();
  assert.equal(await cards.first().locator("[data-testid=pai-person][data-key=p1]").getAttribute("data-pick"), "new");
  await cards.first().getByTestId("pai-save").click();
  await until(async () => /Logged on 2 contacts/.test(await toastWords().catch(() => "")), "saved");
  const ray = await one(`SELECT id FROM "Contact" WHERE "organizationId"=$1 AND name='Ray Newell'`, [org]);
  assert.ok((await one(`SELECT count(*)::int n FROM "OpportunityContact" WHERE "contactId"=$1`, [ray.id])).n >= 1, "Ray joined Sue's tile");
  await page.getByTestId("log-toast-undo").click();
  await until(async () => /^Undone$/.test((await toastWords().catch(() => "")).trim()), "Undone, nothing kept");
  assert.equal((await one(`SELECT count(*)::int n FROM "Contact" WHERE id=$1`, [ray.id])).n, 0);

  log("review fixes: the best matches are never cut by 25 older look-alikes (a business by its exact name, a person by email)");
  await sql(
    `INSERT INTO "Company" (id,"organizationId",name,"companyTypes","createdAt","updatedAt")
       SELECT 'pai_prem_'||g, $1, 'Premier Group '||g, '{}', now() - interval '30 days' + g * interval '1 minute', now() FROM generate_series(1,26) g`,
    [org],
  );
  await sql(`INSERT INTO "Company" (id,"organizationId",name,"companyTypes","updatedAt") VALUES ('pai_premier',$1,'Premier','{}',now())`, [org]);
  await sql(
    `INSERT INTO "Contact" (id,"organizationId",name,"createdAt","updatedAt")
       SELECT 'pai_js_'||g, $1, 'John Smithers '||g, now() - interval '30 days' + g * interval '1 minute', now() FROM generate_series(1,26) g`,
    [org],
  );
  await sql(`INSERT INTO "Contact" (id,"organizationId",name,email,"updatedAt") VALUES ('pai_jemail',$1,'J. Smith','john@x.com',now())`, [org]);
  claude.reply("ACTIVITY_AI", {
    companies: [company("Premier")],
    people: [person("Pat Quinn", 0), person("John Smith", null, { email: "john@x.com" })],
    entries: [entry({ outcome: "TALKED", notes: "Talked with Pat.", people: [0] }), entry({ kind: "LOG", type: "EMAIL", outcome: "SENT", notes: "Emailed John.", people: [1] })],
  });
  await readIt("Talked to Pat Quinn at Premier. Emailed John Smith at john@x.com.");
  await until(async () => (await cards.count()) === 2, "two cards");
  const premier = cards.nth(0).locator("[data-testid=pai-company][data-key=c0]");
  assert.equal(await premier.getAttribute("data-pick"), "found");
  assert.equal(await premier.getByTestId("pai-company-switch").inputValue(), "pai_premier");
  assert.equal(await cards.nth(1).locator("[data-testid=pai-person][data-key=p1]").getAttribute("data-pick"), "found");
  assert.equal(await cards.nth(1).getByTestId("pai-person-switch").inputValue(), "pai_jemail", "the email match, not an older same-named one");
  await bar.getByTestId("pai-clear").click();

  log("review fixes: a name only inside another word, and a phone made of separate numbers, are dropped");
  claude.reply("ACTIVITY_AI", {
    companies: [],
    people: [person("Ann"), person("Bob Smith", null, { phone: "450-2153" })],
    entries: [entry({ outcome: "TALKED", notes: "Talked about the annual contract.", people: [0, 1] })],
  });
  await readIt("Talked to Bob Smith about the annual contract, 12 cameras at 450, meet 2/15 at 3.");
  await cards.first().waitFor();
  assert.equal(await cards.first().locator("[data-testid=pai-person]").count(), 1, "no Ann");
  assert.equal(await cards.first().locator("[data-testid=pai-person][data-key=p0]").innerText().then((text) => /450/.test(text)), false, "no made-up phone");
  assert.match(await bar.getByTestId("pai-dropped").innerText(), /things I heard/);
  await bar.getByTestId("pai-cancel").first().click();

  log("review fixes: after an Undo, a person that save made is new again on the sentence's other card");
  claude.reply("ACTIVITY_AI", {
    companies: [],
    people: [person("Kim Diaz")],
    entries: [entry({ type: "MEETING", outcome: "HELD", notes: "Met Kim.", people: [0] }), entry({ kind: "NOTE", type: null, notes: "Kim's birthday is in May.", noteLabel: "BIRTHDAY", people: [0] })],
  });
  await readIt("Met Kim Diaz today. Kim's birthday is in May.");
  await until(async () => (await cards.count()) === 2, "two cards");
  await cards.nth(0).getByTestId("pai-save").click();
  await until(async () => (await cards.count()) === 1, "the meeting saved");
  assert.match(await cards.first().getByTestId("pai-person-state").innerText(), /Just added/);
  await page.getByTestId("log-toast-undo").click();
  await until(async () => /Undone/.test(await toastWords().catch(() => "")), "Undone");
  await until(async () => /New/.test(await cards.first().getByTestId("pai-person-state").innerText()), "Kim is new again");
  await cards.first().getByTestId("pai-save").click();
  await until(async () => (await cards.count()) === 0, "the note saved");
  assert.equal((await one(`SELECT count(*)::int n FROM "Note" n JOIN "Contact" c ON c.id=n."contactId" WHERE c.name='Kim Diaz' AND c."organizationId"=$1`, [org])).n, 1);

  log("review fixes: the company page's box only offers this company's people (Sue is at another company)");
  await page.goto(`${BASE}/dashboard/companies/pai_co_acme`);
  await page.locator("[data-testid=company-log-toggle]").click();
  const picker2 = page.locator("[data-testid=log-activity-form] [data-testid=company-people-picker]");
  await picker2.locator("[data-testid=company-person-add]").click();
  await picker2.getByLabel("New contact name").fill("Sue Lee");
  await picker2.locator("[data-testid=company-person-save]").click();
  await picker2.locator("[data-testid=company-person-chip][aria-checked=true]", { hasText: "Sue Lee" }).waitFor();
  assert.equal(await picker2.getByTestId("pai-same").count(), 0);
  assert.equal((await one(`SELECT count(*)::int n FROM "Contact" WHERE "organizationId"=$1 AND name='Sue Lee' AND "companyId"='pai_co_acme'`, [org])).n, 1);
  await page.keyboard.press("Escape");

  log("the ✦ on a phone opens the bar from any page; a call saved there");
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mobile = await phone.newPage();
  lastPage = mobile;
  await login(mobile);
  await mobile.goto(`${BASE}/dashboard/contacts`);
  await mobile.getByTestId("pai-phone-button").click();
  const sheet = mobile.getByTestId("pai-sheet");
  await sheet.waitFor();
  claude.reply("ACTIVITY_AI", { companies: [], people: [person("Bob Smith")], entries: [entry({ outcome: "VOICEMAIL", notes: "Left a voicemail.", people: [0] })] });
  await sheet.getByTestId("pai-words").fill("Called Bob Smith, left a voicemail.");
  await sheet.getByTestId("pai-read").click();
  await sheet.getByTestId("pai-card").waitFor();
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 1, `no sideways scroll on a phone (${overflow}px)`);
  await shot(mobile, "05-phone-sheet");
  await sheet.getByTestId("pai-save").click();
  await until(async () => /Activity logged/.test(await mobile.getByTestId("log-toast-words").innerText().catch(() => "")), "the phone's toast");
  assert.equal((await one(`SELECT count(*)::int n FROM "Activity" WHERE "organizationId"=$1 AND "contactId"='pai_bob' AND outcome='VOICEMAIL'`, [org])).n, 1);
  await sheet.getByTestId("pai-sheet-close").click();
  await until(async () => (await mobile.getByTestId("pai-sheet").count()) === 0, "the sheet closed");
  await phone.close();
  lastPage = page;

  /* -------------------------------- AI off -------------------------------- */
  if (!NOAI_BASE) {
    noaiServer = spawn("npx", ["next", "start", "-p", String(NOAI_PORT)], {
      cwd: path.resolve(__dirname, "../.."),
      env: { ...process.env, DATABASE_URL: DB, ANTHROPIC_API_KEY: "", ANTHROPIC_ENDPOINT: "", STORAGE_DRIVER: "local" },
      detached: true,
      stdio: "ignore",
    });
    NOAI_BASE = `http://localhost:${NOAI_PORT}`;
    for (let i = 0; ; i += 1) {
      try {
        if ((await fetch(`${NOAI_BASE}/login`)).status === 200) break;
      } catch {
        /* still starting */
      }
      if (i > 240) throw new Error("the AI-off server did not start");
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  log("AI off: no bar on the Pipeline and no ✦ on a phone");
  const asked0 = claude.requests.length;
  const off = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const offPage = await off.newPage();
  lastPage = offPage;
  await login(offPage, NOAI_BASE);
  await offPage.goto(`${NOAI_BASE}/dashboard/deals`);
  await offPage.getByTestId("phone-top-bar").waitFor();
  assert.equal(await offPage.getByTestId("pai-bar").count(), 0);
  assert.equal(await offPage.getByTestId("pai-phone-button").count(), 0);
  assert.equal(claude.requests.length, asked0, "nothing reached Claude");
  await off.close();

  await browser.close();
  await claude.close();
  console.log(`\nAll ${step} steps passed.`);
})()
  .catch(async (error) => {
    console.error(error);
    if (lastPage) await lastPage.screenshot({ path: path.join(OUT, "zz-failure.png"), fullPage: true }).catch(() => {});
    process.exitCode = 1;
  })
  .finally(() => {
    if (noaiServer) {
      try {
        process.kill(-noaiServer.pid);
      } catch {
        /* already gone */
      }
    }
    setTimeout(() => process.exit(process.exitCode ?? 0), 200);
  });
