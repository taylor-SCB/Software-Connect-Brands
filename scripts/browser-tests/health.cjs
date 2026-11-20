/* Browser regression for the contact page in the BDR redesign (Nov 11,
 * 2026; Taylor approved the plan's "Contact page" section, Release 1
 * header and Release 4).
 *
 * Covers: every health state on the header (New dashed, Trying grey,
 * Trying stalled amber, Warm teal, Cold rose, Closed grey with its reason,
 * Won with money late rose), the one main button per stage (Call, Book
 * meeting, "Meeting <day> 10:00 AM" with Reschedule, Mark held with
 * No-show, Start a quote, Customer said yes, Copy signing link, Send
 * deposit invoice) and the meter's next step running it; the Book meeting
 * sheet (Meeting Set, the Pipeline, the booker kept, "Saved · Undo"),
 * Reschedule, Held on a meeting whose day has gone by; Call ▾ with every
 * number; Show counts; ⋯ More holding New quote, New contract, Edit,
 * Additional Account, Set status by hand (grouped, "auto" tags, skipped-
 * step dates, the Not Interested reason) and Delete at the foot; the Next
 * step strip (nothing booked, Set follow-up, Try again in 30 days); the
 * "What happened with …?" bar opening the log form; the history by day
 * with green talk tags, muted attempts, filter chips with counts, Quote
 * sent / Accepted by <name> / Contract sent / Signed lines (from the
 * paperwork's own columns, never Activity rows) and Delete on your own
 * line; Reach,
 * More details, Good to know, the Paperwork card appearing only once
 * there is something; both looks' words at 4.5:1; keyboard focus; reduced
 * motion; and the phone at 390 (no sideways scroll, the 56px bar, the
 * full-width main button, folded cards, five history lines). And one
 * rule for the meeting waiting (integration, Nov 11, 2026): a calendar
 * tick answers nothing, a no-show's next step is Reschedule and Held says
 * it did happen, Do Not List is not on a tile, and Mark held with no
 * meeting known opens How did it go? on Meeting — never a second meeting.
 *
 * Runs against a built app (`npm run build:app && npx next start`) and a
 * local Postgres that has had `prisma migrate deploy` run against it. It
 * signs up its own workspace and deletes it on the next run. Never point
 * it at the live database.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/scb_test \
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules \
 *   node scripts/browser-tests/health.cjs
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
const OUT = process.env.SHOTS_DIR || path.join(os.tmpdir(), "scb-browser-shots-health");
fs.mkdirSync(OUT, { recursive: true });

const EMAIL = "test-health@example.com";
const PASSWORD = "password123";
const COMPANY = "Test Health Co";
const SLUG = "test-health-co";
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
const status = async (id) => (await one(`SELECT status FROM "Contact" WHERE id=$1`, [id])).status;
async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity),
  );
}
// The Book meeting sheet is the shared one (src/components/book-meeting,
// merged Nov 11, 2026): its day chips start at the next working day, so
// tomorrow is the "Tomorrow" chip on a weekday and is picked by date on a
// Friday or Saturday.
async function bookTomorrow(sheet) {
  const chip = sheet.locator("[data-testid=book-day-first]", { hasText: "Tomorrow" });
  if (await chip.count()) await chip.click();
  else {
    await sheet.locator("[data-testid=book-day-pick]").click();
    await sheet.locator("[data-testid=book-day-input]").fill(shift(TODAY, 1));
  }
}
async function open(page, id) {
  await page.goto(`${BASE}/dashboard/contacts/${id}`);
  await page.locator("[data-testid=contact-header]").waitFor();
}
const word = (page) => page.locator("[data-testid=contact-header] [data-testid=health-word]").first();
const tone = (page) => word(page).getAttribute("data-health");
const main = (page) => page.locator("[data-testid=contact-main]");

/* Each piece of text's contrast against what is really behind it (the
 * colour maths of looks.cjs). */
async function contrastReport(page, scope) {
  return page.evaluate((scopeSel) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const rgba = (css) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "rgba(0,0,0,0)";
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return [r, g, b, a / 255];
    };
    const over = (top, under) => {
      const a = top[3];
      return [top[0] * a + under[0] * (1 - a), top[1] * a + under[1] * (1 - a), top[2] * a + under[2] * (1 - a), 1];
    };
    const lum = ([r, g, b]) => {
      const ch = (v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
    };
    const ratio = (a, b) => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
      return (x + 0.05) / (y + 0.05);
    };
    const pageBg = rgba(getComputedStyle(document.documentElement).backgroundColor);
    const layers = (el) => {
      const out = [];
      for (let node = el; node && node !== document.documentElement; node = node.parentElement) {
        const s = getComputedStyle(node);
        let c = rgba(s.backgroundColor);
        if (c[3] === 0 && s.backgroundImage.startsWith("linear-gradient")) {
          const first = s.backgroundImage.match(/(rgba?\([^)]*\)|color\([^)]*\)|#[0-9a-f]{3,8})/i);
          if (first) c = rgba(first[1]);
        }
        if (c[3] > 0) out.push(c);
        if (c[3] >= 0.999) break;
      }
      return out;
    };
    const behind = (el) => layers(el).reverse().reduce((acc, layer) => over(layer, acc), pageBg);
    const results = [];
    for (const root of document.querySelectorAll(scopeSel)) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent.trim();
        if (text.length < 2) continue;
        const el = node.parentElement;
        const box = el.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) continue;
        const s = getComputedStyle(el);
        if (s.visibility === "hidden" || s.display === "none") continue;
        if (s.color === "rgba(0, 0, 0, 0)" || s.webkitTextFillColor === "rgba(0, 0, 0, 0)") continue;
        let faded = false;
        for (let n = el; n; n = n.parentElement) if (parseFloat(getComputedStyle(n).opacity) < 0.95) faded = true;
        if (faded) continue;
        // The tenant's brand fill carries the tenant's own colours.
        if (el.closest("img, svg, .btn-primary")) continue;
        const bg = behind(el);
        const fg = over(rgba(s.color), bg);
        results.push({ text: text.slice(0, 40), cls: String(el.className).slice(0, 50), ratio: +ratio(fg, bg).toFixed(2) });
      }
    }
    return results;
  }, scope);
}

(async () => {
  await sql(`DELETE FROM "Organization" WHERE slug LIKE '${SLUG}%'`);

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
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
  await sql(`UPDATE "Organization" SET status='ACTIVE', "reviewedAt"=now(), "timeZone"=$1 WHERE slug LIKE '${SLUG}%'`, [ZONE]);
  await page.goto(`${BASE}/login`);
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/dashboard$/);
  const org = (await one(`SELECT id FROM "Organization" WHERE slug LIKE '${SLUG}%'`)).id;
  const me = (await one(`SELECT id FROM "User" WHERE email=$1`, [EMAIL])).id;

  log("seed: a person in every state, with touches, paperwork and money");
  await sql(`INSERT INTO "Company" (id,"organizationId",name,"createdAt","updatedAt") VALUES ('hl_co',$1,'Ironwood Health GC',now(),now())`, [org]);
  const people = [
    ["hl_new", "Nora New", "NOT_ACTIONED", "512-555-0101", "512-555-0102", "512-555-0103"],
    ["hl_try", "Tom Trying", "CONTACTED", "512-555-0201", null, null],
    ["hl_stall", "Sam Stalled", "CONTACTED", null, "512-555-0301", null],
    ["hl_warm", "Kristen Warm", "CONNECTED", "512-555-0401", null, null],
    ["hl_cold", "Steven Cold", "CONNECTED", null, null, null],
    ["hl_hand", "Hank Hand", "CONTACTED", null, null, null],
    ["hl_cs", "Greg Contract", "CONTRACT_SENT", null, null, null],
    ["hl_won", "Wendy Won", "WON", null, null, null],
    ["hl_many", "Mia Many", "CONTACTED", "512-555-0901", null, null],
  ];
  for (const [id, name, st, mobile, phone, phone2] of people) {
    await sql(
      `INSERT INTO "Contact" (id,"organizationId","companyId",name,title,status,mobile,phone,phone2,"createdAt","updatedAt")
       VALUES ($1,$2,'hl_co',$3,'Preconstruction Manager',$4,$5,$6,$7,now() - interval '40 days',now())`,
      [id, org, name, st, mobile, phone, phone2],
    );
  }
  const act = (id, contact, type, outcome, ago, body = "") =>
    sql(
      `INSERT INTO "Activity" (id,"organizationId","contactId","userId",type,body,outcome,"batchId","occurredAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$1,now() - $8::interval)`,
      [id, org, contact, me, type, body || `${type} ${outcome ?? ""}`.trim(), outcome, ago],
    );
  await act("hla_try1", "hl_try", "PHONE_CALL", "NO_ANSWER", "2 days", "Rang the office line");
  await act("hla_stall1", "hl_stall", "PHONE_CALL", "VOICEMAIL", "20 days", "Left voicemail");
  await act("hla_warm1", "hl_warm", "PHONE_CALL", "VOICEMAIL", "3 days", "Left voicemail");
  await act("hla_warm2", "hl_warm", "PHONE_CALL", "TALKED", "1 hour", "Talked about the Elm St bid");
  await act("hla_cold1", "hl_cold", "PHONE_CALL", "TALKED", "20 days", "Talked, call back later");
  for (let i = 0; i < 8; i += 1) await act(`hla_many${i}`, "hl_many", i % 2 ? "TEXT" : "PHONE_CALL", i % 2 ? "SENT" : "NO_ANSWER", `${i * 2 + 1} days`);
  await sql(
    `INSERT INTO "Note" (id,"organizationId","contactId","authorId",body,label) VALUES ('hln_warm',$1,'hl_warm',$2,'Two kids, coaches soccer on Saturdays','FAMILY')`,
    [org, me],
  );
  // Contract out for a signature, and one signed with a deposit late.
  await sql(
    `INSERT INTO "Contract" (id,"organizationId","contactId",number,title,type,body,status,payable,"publicToken","sentAt","updatedAt")
     VALUES ('ctr_hl_cs',$1,'hl_cs',995001,'Elm St install','Sales Order','Body','SENT',false,'tok_ctr_hl_cs_0123456789',now() - interval '3 days',now())`,
    [org],
  );
  await sql(
    `INSERT INTO "Contract" (id,"organizationId","contactId",number,title,type,body,status,payable,"publicToken","sentAt","signedAt","updatedAt")
     VALUES ('ctr_hl_won',$1,'hl_won',995002,'Oak Ave job','Sales Order','Body','SIGNED',false,'tok_ctr_hl_won_012345678',now() - interval '30 days',now() - interval '25 days',now())`,
    [org],
  );
  await sql(
    `INSERT INTO "ContractPayment" (id,"contractId","organizationId",label,kind,"amountCents","dueOn",position)
     VALUES ('cp_hl_won','ctr_hl_won',$1,'Deposit','FIXED',337700,current_date - 12,0)`,
    [org],
  );
  await sql(`UPDATE "Organization" SET "nextContractNumber" = GREATEST("nextContractNumber", 995003) WHERE id = $1`, [org]);

  log("Sprint: a new lead reads New in a dashed ring, Call is the main button (the mobile first), the meter starts empty, no Paperwork card");
  await open(page, "hl_new");
  assert.equal((await word(page).textContent()).trim().replace(/^\W+/, ""), "New");
  assert.equal(await page.locator("[data-testid=contact-header] [data-testid=health-ring]").getAttribute("data-hollow"), "");
  assert.equal(await main(page).getAttribute("data-action"), "call");
  assert.equal(await main(page).getAttribute("href"), "tel:512-555-0101");
  assert.equal(await page.locator("[data-testid=contact-header] [data-testid=lifecycle-meter]").getAttribute("data-step"), "-1");
  assert.equal(await page.locator("[data-testid=paperwork]").count(), 0, "nothing to show, so no Paperwork card");
  assert.equal(await page.locator("[data-testid=next-step]").getAttribute("data-kind"), "none");
  await page.locator("[data-testid=next-step]").getByText("Nothing booked").waitFor();
  assert.equal(await page.locator("[data-testid=lifecycle-reason]").textContent(), "Not tried yet");
  await shot(page, "01-new");

  log("Sprint: Call ▾ offers the mobile, the phone and phone 2; Text goes to the mobile; Add deal waits under ⋯ More before a meeting");
  await page.locator("[data-testid=contact-call-more]").click();
  const callMenu = page.locator("[data-testid=contact-call-menu]");
  await callMenu.waitFor();
  assert.deepEqual(
    await callMenu.locator("a").evaluateAll((links) => links.map((a) => a.getAttribute("href"))),
    ["tel:512-555-0101", "tel:512-555-0102", "tel:512-555-0103"],
  );
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("[data-testid=contact-text]").getAttribute("href"), "sms:512-555-0101");
  // Before Meeting Completed no deal is invited on the page; Add deal stays under ⋯ More.
  await page.locator("[data-testid=record-more]").click();
  await page.locator("[data-testid=record-more-menu] [data-testid=more-add-deal]").click();
  await page.locator("[data-testid=more-add-deal-form] #deal-title").waitFor();
  await page.keyboard.press("Escape");

  log("Sprint: Trying — one no-answer two days ago is grey, no number; the attempt reads muted with its outcome");
  await open(page, "hl_try");
  assert.match(await word(page).textContent(), /Trying/);
  assert.equal(await tone(page), "none");
  assert.equal(await main(page).getAttribute("data-action"), "call");
  const tryLine = page.locator("[data-testid=activity-line]").first();
  assert.equal(await tryLine.getAttribute("data-connect"), "0");
  assert.equal((await tryLine.locator("[data-testid=activity-attempt]").textContent()).replace(/\s*·\s*$/, ""), "No answer");
  await word(page).hover();
  const tryPopover = page.locator("[data-testid=health-popover]");
  await tryPopover.waitFor();
  assert.doesNotMatch(await tryPopover.textContent(), /=\s*\d+/, "nobody reached, so no score");
  await page.mouse.move(5, 5);

  log("Sprint: Trying and stalled — the last try 20 days ago turns amber, never red");
  await open(page, "hl_stall");
  assert.match(await word(page).textContent(), /Trying/);
  assert.equal(await tone(page), "warn");
  assert.equal(await main(page).getAttribute("href"), "tel:512-555-0301", "no mobile, so the phone");
  assert.equal(await page.locator("[data-testid=contact-text]").getAttribute("href"), "sms:512-555-0301");

  log("Sprint: Warm after a talk today — Book meeting is the main button, the talk carries its green tag, the voicemail is muted");
  await open(page, "hl_warm");
  assert.match(await word(page).textContent(), /Warm/);
  assert.equal(await tone(page), "good");
  assert.equal(await main(page).getAttribute("data-action"), "book");
  assert.equal((await main(page).textContent()).trim(), "Book meeting");
  const talk = page.locator("[data-testid=activity-line][data-connect='1']");
  assert.equal(await talk.count(), 1);
  assert.equal((await talk.locator("[data-testid=activity-connect]").textContent()).replace("●", "").trim(), "Talked");
  assert.equal(await talk.locator("[data-testid=activity-connect]").getAttribute("data-health"), "good");
  const voicemail = page.locator("[data-testid=activity-line][data-connect='0']");
  assert.equal(await voicemail.count(), 1);
  assert.equal((await voicemail.locator("p").first().textContent()).match(/Left voicemail/g).length, 1, "the chip's words, said once");
  assert.equal(await voicemail.locator("[data-testid=activity-attempt]").count(), 0);
  await page.locator("[data-testid=good-to-know]").getByText("coaches soccer").waitFor();

  log("Sprint: history filter chips carry the counts — Talks 1, Calls 2 — and Talks narrows to the talk");
  assert.equal(await page.locator("[data-testid=history-count-talks]").textContent(), "1");
  assert.equal(await page.locator("[data-testid=history-count-calls]").textContent(), "2");
  assert.equal(await page.locator("[data-testid=history-count-texts]").count(), 0, "a zero draws no number");
  await page.locator("[data-testid=history-filter-talks]").click();
  assert.equal(await page.locator("[data-testid=activity-line]").count(), 1);
  await page.locator("[data-testid=history-filter-all]").click();
  // The talk an hour ago is under Today, or Yesterday in the hour after
  // midnight on the workspace's clock.
  const talkDay = dayInZone((await one(`SELECT "occurredAt" FROM "Activity" WHERE id='hla_warm2'`)).occurredAt);
  assert.equal(await page.locator("[data-testid=history-day]").first().locator("h3").textContent(), talkDay === TODAY ? "Today" : "Yesterday");

  log("Sprint: the caption replaces the six tiles; Show counts opens them");
  assert.match(await page.locator("[data-testid=lifecycle-caption]").textContent(), /2 tries · 1 talk/);
  assert.equal(await page.locator("[data-testid=activity-tile]").count(), 0);
  await page.locator("[data-testid=show-counts]").click();
  assert.equal(await page.locator("[data-testid=activity-tile][data-label=Calls]").getAttribute("data-value"), "2");
  assert.equal(await page.locator("[data-testid=activity-tile]").count(), 6);
  await shot(page, "02-warm");

  log("Sprint: Cold — a talk 20 days ago and nothing since is rose; the meter's next step opens Book meeting");
  await open(page, "hl_cold");
  assert.match(await word(page).textContent(), /Cold/);
  assert.equal(await tone(page), "risk");
  assert.equal(await main(page).getAttribute("data-action"), "book");
  // Tapping the meter's next step (Meeting Set) runs the same action.
  await page.locator("[data-testid=contact-header] [data-testid=lifecycle-meter] button.lm-name[data-state=next]").click();
  await page.locator("[data-testid=book-meeting]").waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("[data-testid=book-meeting]").count(), 0);

  log("Sprint: Book meeting sheet — Tomorrow at 10 books Kristen: Meeting Set, the Pipeline, the booker kept; Undo takes it back");
  await open(page, "hl_warm");
  await main(page).click();
  const sheet = page.locator("[data-testid=book-meeting]");
  await sheet.waitFor();
  await bookTomorrow(sheet);
  await sheet.locator("[data-testid='book-time-10:00']").click();
  await sheet.locator("[data-testid=book-submit]").click();
  const toast = page.locator("[data-testid=log-toast]");
  await toast.getByText(/Booked/).waitFor();
  await until(async () => (await status("hl_warm")) === "MEETING_SET", "Kristen Meeting Set");
  const booked = await one(
    `SELECT om."bookedById", to_char((om."on" AT TIME ZONE 'UTC') AT TIME ZONE '${ZONE}', 'YYYY-MM-DD HH24:MI') AS at FROM "OpportunityMeeting" om
       JOIN "OpportunityContact" oc ON oc."opportunityId" = om."opportunityId" WHERE oc."contactId"='hl_warm'`,
  );
  assert.equal(booked.bookedById, me);
  assert.equal(booked.at, `${shift(TODAY, 1)} 10:00`);
  await toast.locator("[data-testid=log-toast-undo]").click();
  await toast.getByText("Undone").waitFor();
  await until(async () => (await status("hl_warm")) === "CONNECTED", "Kristen back to Connected");
  assert.equal((await one(`SELECT count(*)::int n FROM "OpportunityMeeting" om JOIN "OpportunityContact" oc ON oc."opportunityId" = om."opportunityId" WHERE oc."contactId"='hl_warm'`)).n, 0);

  log("Sprint: booked again — the main button reads the meeting with Reschedule; the Next step strip names it");
  await open(page, "hl_warm");
  await main(page).click();
  await sheet.waitFor();
  await bookTomorrow(sheet);
  await sheet.locator("[data-testid='book-time-10:00']").click();
  await sheet.locator("[data-testid=book-submit]").click();
  await until(async () => (await status("hl_warm")) === "MEETING_SET", "Kristen Meeting Set again");
  await open(page, "hl_warm");
  assert.equal(await main(page).getAttribute("data-action"), "meeting");
  assert.equal((await main(page).textContent()).trim(), "Meeting tomorrow 10:00 AM");
  await page.locator("[data-testid=contact-reschedule]").waitFor();
  assert.equal(await page.locator("[data-testid=next-step]").getAttribute("data-kind"), "meeting");
  await shot(page, "03-meeting-booked");

  log("Sprint: Reschedule moves it to next week, keeping it one meeting");
  await page.locator("[data-testid=contact-reschedule]").click();
  const moveMenu = page.locator("[data-testid=contact-reschedule-menu]");
  await moveMenu.waitFor();
  const nextWeek = await moveMenu.locator("[data-testid^=contact-reschedule-day-]").last().getAttribute("data-testid");
  const nextWeekDay = nextWeek.replace("contact-reschedule-day-", "");
  await moveMenu.locator(`[data-testid=${nextWeek}]`).click();
  await moveMenu.locator("[data-testid=contact-reschedule-save]").click();
  await until(
    async () =>
      (
        await one(
          `SELECT to_char((om."on" AT TIME ZONE 'UTC') AT TIME ZONE '${ZONE}', 'YYYY-MM-DD') AS day FROM "OpportunityMeeting" om
             JOIN "OpportunityContact" oc ON oc."opportunityId" = om."opportunityId" WHERE oc."contactId"='hl_warm' ORDER BY om."createdAt" DESC LIMIT 1`,
        )
      ).day === nextWeekDay,
    "meeting moved",
  );
  assert.equal(await status("hl_warm"), "MEETING_SET");

  log("Sprint: the meeting's day goes by unmarked — Mark held is the main button, No-show beside it; Held moves Kristen to Meeting Completed");
  await sql(
    `UPDATE "OpportunityMeeting" SET "on" = now() - interval '2 days'
      WHERE "opportunityId" IN (SELECT "opportunityId" FROM "OpportunityContact" WHERE "contactId"='hl_warm')`,
  );
  await sql(
    `UPDATE "CalendarEvent" SET "startOn" = current_date - 2
      WHERE id IN (SELECT "eventId" FROM "OpportunityMeeting" WHERE "opportunityId" IN (SELECT "opportunityId" FROM "OpportunityContact" WHERE "contactId"='hl_warm'))`,
  );
  await open(page, "hl_warm");
  assert.equal(await main(page).getAttribute("data-action"), "mark-held");
  await page.locator("[data-testid=contact-no-show]").waitFor();
  assert.equal(await page.locator("[data-testid=next-step]").getAttribute("data-kind"), "due");
  assert.match(await page.locator("[data-testid=next-step-line]").textContent(), /^Met .* — how did it go\?$/);
  // The calendar entry gone by unticked also reads as late ("Follow-up 1
  // day late" wins the reason); the strip asks about the meeting itself.
  assert.match(await page.locator("[data-testid=lifecycle-reason]").textContent(), /meeting happen\?|late/);
  await main(page).click();
  await until(async () => (await status("hl_warm")) === "MEETING_COMPLETED", "Kristen Meeting Completed");
  await toast.getByText(/Held/).waitFor();
  const held = await one(
    `SELECT om.outcome FROM "OpportunityMeeting" om JOIN "OpportunityContact" oc ON oc."opportunityId" = om."opportunityId" WHERE oc."contactId"='hl_warm'`,
  );
  assert.equal(held.outcome, "HELD");

  log("Sprint: Meeting Completed — Start a quote; Quote Sent on the meter says the quote moves it; Paperwork appears with Add deal in its ⋯");
  await open(page, "hl_warm");
  assert.equal(await main(page).getAttribute("data-action"), "start-quote");
  assert.equal(await main(page).getAttribute("href"), "/dashboard/quotes/new?contactId=hl_warm");
  await page.locator("[data-testid=paperwork]").waitFor();
  await page.locator("[data-testid=paperwork-more]").click();
  await page.locator("[data-testid=paperwork-add-deal-open]").click();
  await page.locator("[data-testid=paperwork-add-deal] #deal-title").fill("Elm St bid");
  await page.locator("[data-testid=paperwork-add-deal]").getByRole("button", { name: "Add" }).click();
  await page.locator("[data-testid=paperwork-deal]").filter({ hasText: "Elm St bid" }).waitFor();
  await page.keyboard.press("Escape");
  // Quote Sent is moved by the quote going out, so its step says so.
  await page.locator("[data-testid=lifecycle-meter] button.lm-name[data-state=next]").click();
  await page.locator("[data-testid=lifecycle-step-popover]").getByText("Moves when the quote goes out").waitFor();
  await page.keyboard.press("Escape");

  log("Sprint: ⋯ More holds New quote, New contract, Edit, Additional Account, Set status by hand and Delete at the foot");
  await open(page, "hl_warm");
  await page.locator("[data-testid=record-more]").click();
  const more = page.locator("[data-testid=record-more-menu]");
  await more.waitFor();
  const items = await more.locator("a, button").evaluateAll((els) => els.map((el) => el.textContent.trim()));
  assert.deepEqual(items, ["New quote", "New contract", "Edit", "Additional Account", "Set status by handMeeting Completed", "Delete"]);
  assert.equal(await more.locator("[data-testid=more-new-quote]").getAttribute("href"), "/dashboard/quotes/new?contactId=hl_warm");

  log("Sprint: Set status by hand — grouped Working it / Pipeline / Closed with auto tags; Quote Sent makes Customer said yes the main button");
  await more.locator("[data-testid=status-picker]").click();
  const statusMenu = page.locator("[data-testid=status-menu]");
  await statusMenu.getByText("Working it").waitFor();
  await statusMenu.getByText("Pipeline").waitFor();
  await statusMenu.getByText("Closed").waitFor();
  assert.match(await statusMenu.locator("[data-testid=status-option-MEETING_SET]").textContent(), /auto/);
  assert.doesNotMatch(await statusMenu.locator("[data-testid=status-option-INTERESTED]").textContent(), /auto/);
  await statusMenu.locator("[data-testid=status-option-QUOTE_SENT]").click();
  await until(async () => (await status("hl_warm")) === "QUOTE_SENT", "Kristen Quote Sent by hand");
  await open(page, "hl_warm");
  assert.equal(await main(page).getAttribute("data-action"), "quote-yes");
  assert.equal((await main(page).textContent()).trim(), "Customer said yes");

  log("Sprint: Set status by hand keeps the skipped-step dates — Attempted to Contract Sent asks each pipeline step's day");
  await open(page, "hl_hand");
  await page.locator("[data-testid=record-more]").click();
  await page.locator("[data-testid=record-more-menu] [data-testid=status-picker]").click();
  await page.locator("[data-testid=status-menu] [data-testid=status-option-CONTRACT_SENT]").click();
  const dates = page.locator("[data-testid=status-dates]");
  await dates.waitFor();
  for (const st of ["MEETING_SET", "MEETING_COMPLETED", "QUOTE_SENT", "CONTRACT_SENT"]) await dates.locator(`[data-testid=status-date-${st}]`).waitFor();
  await dates.locator("[data-testid=status-save]").click();
  await until(async () => (await status("hl_hand")) === "CONTRACT_SENT", "Hank Contract Sent");

  log("Sprint: Not Interested by hand asks a one-tap reason; the meter greys with ×, the reason shows, no main button");
  await open(page, "hl_cold");
  await page.locator("[data-testid=record-more]").click();
  await page.locator("[data-testid=record-more-menu] [data-testid=status-picker]").click();
  await page.locator("[data-testid=status-menu] [data-testid=status-option-NOT_INTERESTED]").click();
  await page.locator("[data-testid=status-reason-HAS_VENDOR]").click();
  await page.locator("[data-testid=status-reason] [data-testid=status-save]").click();
  await until(async () => (await status("hl_cold")) === "NOT_INTERESTED", "Steven Not Interested");
  assert.equal((await one(`SELECT reason FROM "StatusChange" WHERE "contactId"='hl_cold' AND "toStatus"='NOT_INTERESTED'`)).reason, "HAS_VENDOR");
  await open(page, "hl_cold");
  assert.match(await word(page).textContent(), /Closed/);
  assert.equal(await page.locator("[data-testid=contact-header] [data-testid=lifecycle-meter]").getAttribute("data-state"), "CLOSED");
  assert.match(await page.locator("[data-testid=contact-header] [data-testid=lifecycle-meter]").textContent(), /Has a vendor/);
  assert.equal(await main(page).count(), 0);
  await shot(page, "04-closed");

  log("Sprint: Contract Sent — Copy signing link copies /c/<token>; the history has a Contract sent line that is no touch");
  await open(page, "hl_cs");
  assert.equal(await main(page).getAttribute("data-action"), "signing-link");
  await main(page).click();
  await main(page).getByText("Copied").waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), `${BASE}/c/tok_ctr_hl_cs_0123456789`);
  const paperLine = page.locator("[data-testid=activity-paper][data-kind=CONTRACT_SENT]");
  await paperLine.waitFor();
  assert.match(await paperLine.textContent(), /Contract sent · CON-995001 Elm St install/);
  assert.equal(await page.locator("[data-testid=history-count-all]").count(), 0, "paperwork lines are not touches");
  await page.locator("[data-testid=paperwork-contracts]").getByText("CON-995001").waitFor();

  log("Sprint: Won with a deposit 12 days late — rose, Owes in the reason, Send deposit invoice, the Balance in Paperwork");
  await open(page, "hl_won");
  assert.match(await word(page).textContent(), /Won/);
  assert.equal(await tone(page), "risk");
  assert.match(await page.locator("[data-testid=lifecycle-reason]").textContent(), /Owes \$3,377/);
  assert.equal(await main(page).getAttribute("data-action"), "deposit");
  assert.equal(await main(page).getAttribute("href"), "/dashboard/contracts/ctr_hl_won");
  assert.equal(await page.locator("[data-testid=paperwork-balance] [data-testid=balance-owed]").getAttribute("data-cents"), "337700");
  await page.locator("[data-testid=activity-paper][data-kind=SIGNED]").waitFor();

  log("Sprint: the customer accepts on their own copy — the history reads 'Accepted by <the name they typed>' above Quote sent, from the quote's own columns: no Activity row, no touch");
  await sql(
    `INSERT INTO "Contact" (id,"organizationId","companyId",name,title,status,"createdAt","updatedAt")
     VALUES ('hl_paper',$1,'hl_co','Paige Paper','Facilities Director','QUOTE_SENT',now() - interval '40 days',now())`,
    [org],
  );
  await sql(
    `INSERT INTO "Deal" (id,"organizationId","contactId",title,stage,"ownerId","updatedAt")
     VALUES ('deal_hl_paper',$1,'hl_paper','Lobby refresh','QUOTE_SENT',$2,now())`,
    [org, me],
  );
  // One out with her now; one she said yes to online that the office then
  // marked Declined (its respondedAt is the decline's), so no yes is shown.
  await sql(
    `INSERT INTO "Quote" (id,"organizationId","contactId","dealId",number,title,status,"publicToken","sentAt","respondedAt","acceptedByName","updatedAt")
     VALUES ('quo_hl_paper',$1,'hl_paper','deal_hl_paper',995101,'Lobby access control','SENT','tok_quo_hl_paper_0123456789',now() - interval '2 days',NULL,NULL,now()),
            ('quo_hl_back',$1,'hl_paper','deal_hl_paper',995102,'Gate cameras','DECLINED','tok_quo_hl_back_0123456789',now() - interval '6 days',now() - interval '1 day','Paige Paper',now())`,
    [org],
  );
  await sql(
    `INSERT INTO "QuoteLineItem" (id,"quoteId",name,quantity,"unitPriceCents",tag,position)
     VALUES ('qli_hl_paper','quo_hl_paper','Door reader',4,45000,'MATERIALS',0),
            ('qli_hl_back','quo_hl_back','Dome camera',2,25000,'MATERIALS',0)`,
  );
  await sql(`UPDATE "Organization" SET "nextQuoteNumber" = GREATEST("nextQuoteNumber", 995103) WHERE id = $1`, [org]);
  {
    const customer = await browser.newContext();
    const tab = await customer.newPage();
    await tab.goto(`${BASE}/q/tok_quo_hl_paper_0123456789`);
    await tab.getByTestId("accept-quote-name").fill("Paige R. Paper");
    await tab.getByTestId("accept-quote-submit").click();
    await tab.getByTestId("quote-accepted").filter({ hasText: /Accepted by Paige R\. Paper/ }).waitFor();
    await customer.close();
  }
  const acceptedDay = dayInZone(new Date());
  await open(page, "hl_paper");
  const acceptedLine = page.locator("[data-testid=activity-paper][data-kind=QUOTE_ACCEPTED]");
  await acceptedLine.first().waitFor();
  assert.equal(await acceptedLine.count(), 1, "only the quote that still reads Accepted");
  assert.match(await acceptedLine.textContent(), /^Accepted by Paige R\. Paper · QUO-995101 Lobby access control/);
  assert.equal(await acceptedLine.locator("a").getAttribute("href"), "/dashboard/quotes/quo_hl_paper");
  assert.equal(
    await page.locator(`[data-testid=history-day][data-day="${acceptedDay}"] [data-testid=activity-paper][data-kind=QUOTE_ACCEPTED]`).count(),
    1,
    "dated the moment she pressed it",
  );
  const sentLines = page.locator("[data-testid=activity-paper][data-kind=QUOTE_SENT]");
  assert.equal(await sentLines.count(), 2, "both quotes went out");
  assert.match(await sentLines.first().textContent(), /^Quote sent · QUO-995101 Lobby access control/);
  assert.equal(await page.locator("[data-testid=activity-paper]").first().getAttribute("data-kind"), "QUOTE_ACCEPTED", "newest first");
  assert.equal(await page.locator("[data-testid=history-count-all]").count(), 0, "paperwork lines are not touches");
  assert.equal((await one(`SELECT count(*)::int AS n FROM "Activity" WHERE "contactId"='hl_paper'`)).n, 0, "nothing was written to Activity");

  log("Sprint: Next step — Set follow-up books a call; the strip then names it with Move and Log it");
  await open(page, "hl_try");
  await page.locator("[data-testid=next-follow-up]").click();
  const follow = page.locator("[data-testid=next-follow-up-menu]");
  // The first chip is the next working day (Monday after a Friday or a
  // weekend; dayChips in how-did-it-go/dates.ts), so tomorrow isn't
  // offered on a Friday or Saturday (fixed Nov 13, 2026, a Friday).
  let firstDay = shift(TODAY, 1);
  while ([0, 6].includes(new Date(`${firstDay}T12:00:00Z`).getUTCDay())) firstDay = shift(firstDay, 1);
  await follow.locator(`[data-testid=follow-day-${firstDay}]`).click();
  await follow.locator("[data-testid=follow-save]").click();
  await toast.getByText(/on the calendar/).waitFor();
  await until(
    async () => (await one(`SELECT count(*)::int n FROM "CalendarEvent" WHERE "organizationId"=$1 AND "contactId"='hl_try' AND "doneAt" IS NULL AND "startOn" = $2::date`, [org, firstDay])).n === 1,
    "follow-up on the calendar",
  );
  await open(page, "hl_try");
  assert.equal(await page.locator("[data-testid=next-step]").getAttribute("data-kind"), "item");
  await page.locator("[data-testid=next-move]").waitFor();
  await page.locator("[data-testid=next-log]").waitFor();

  log("Sprint: six tries and never reached — Try again in 30 days books a call a month out");
  for (let i = 2; i <= 6; i += 1) await act(`hla_try${i}`, "hl_many", "PHONE_CALL", "NO_ANSWER", `${i * 3 + 20} days`);
  await open(page, "hl_many");
  await page.locator("[data-testid=next-park]").click();
  await until(
    async () => (await one(`SELECT count(*)::int n FROM "CalendarEvent" WHERE "organizationId"=$1 AND "contactId"='hl_many' AND "startOn" = $2::date`, [org, shift(TODAY, 30)])).n === 1,
    "a call 30 days out",
  );

  log("Sprint: the What happened bar opens the shared log form; the line lands under Today and Delete takes it back");
  await open(page, "hl_try");
  assert.equal(await page.locator("[data-testid=log-activity-form]").count(), 0, "folded until wanted");
  await page.locator("[data-testid=log-bar]").getByText("What happened with Tom?").waitFor();
  await page.locator("[data-testid=log-bar]").click();
  const form = page.locator("[data-testid=log-activity-form]");
  await form.locator("textarea[name=body]").fill("Asked about the spring schedule");
  await form.locator("[data-testid=activity-submit]").click();
  const newLine = page.locator("[data-testid=activity-line]", { hasText: "Asked about the spring schedule" });
  await newLine.waitFor();
  // The sheet moves on to the next step; closing it skips that.
  await page.keyboard.press("Escape");
  await form.waitFor({ state: "detached" });
  assert.equal(await page.locator("[data-testid=history-day]").first().locator("h3").textContent(), "Today");
  await newLine.locator("[data-testid=activity-delete]").click();
  await newLine.locator("[data-testid=activity-delete-yes]").click();
  await until(async () => (await one(`SELECT count(*)::int n FROM "Activity" WHERE "contactId"='hl_try' AND body='Asked about the spring schedule'`)).n === 0, "line deleted");

  log("Sprint: Reach — Call / Text / Copy beside each number; website, birthday, city, state and added by behind More details");
  await open(page, "hl_new");
  const reach = page.locator("[data-testid=reach]");
  assert.equal(await reach.locator("[data-testid=contact-mobile]").textContent(), "512-555-0101");
  assert.equal(await reach.locator("[data-testid=contact-phone2]").textContent(), "512-555-0103");
  assert.equal(await reach.getByText("Birthday").count(), 0);
  await reach.locator("[data-testid=more-details]").click();
  const labels = await reach.locator("[data-testid=more-details-list] dt").allTextContents();
  assert.deepEqual(labels, ["Industry · Type", "Title", "Website", "Birthday", "Added", "City", "State"]);

  log("Sprint: the Rep chip sits in the header and saves");
  await page.selectOption("[data-testid=contact-header] [data-testid=rep-picker]", me);
  await until(async () => (await one(`SELECT "ownerId" FROM "Contact" WHERE id='hl_new'`)).ownerId === me, "rep saved");

  log("Sprint: keyboard — Tab from the Rep chip reaches the main button with a visible focus ring");
  await open(page, "hl_new");
  await page.locator("[data-testid=contact-header] [data-testid=rep-picker]").focus();
  let landed = false;
  for (let i = 0; i < 6 && !landed; i += 1) {
    await page.keyboard.press("Tab");
    landed = await page.evaluate(() => document.activeElement?.getAttribute("data-testid") === "contact-main");
  }
  assert.ok(landed, "Tab reaches the main button");
  const ring = await page.evaluate(() => {
    const s = getComputedStyle(document.activeElement);
    return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) };
  });
  assert.ok(ring.style !== "none" && ring.width > 0, `a visible focus ring (${JSON.stringify(ring)})`);

  log("Sprint: both looks — every word on the header, the Next step and the history reads at 4.5:1 or better, Dark and Light");
  for (const look of ["dark", "light"]) {
    await sql(`UPDATE "User" SET theme = $2 WHERE email = $1`, [EMAIL, look]);
    for (const id of ["hl_new", "hl_stall", "hl_won", "hl_cs"]) {
      await open(page, id);
      await settle(page);
      assert.equal(await page.locator("[data-theme]").first().getAttribute("data-theme"), look);
      const report = await contrastReport(page, "[data-testid=contact-header], [data-testid=next-step], #activity, [data-testid=reach]");
      const bad = report.filter((r) => r.ratio < 4.5);
      assert.equal(bad.length, 0, `${look} ${id}: ${bad.slice(0, 5).map((r) => `"${r.text}" <${r.cls}> ${r.ratio}:1`).join("; ")}`);
      if (id === "hl_stall") await shot(page, `05-${look}`);
    }
  }
  await sql(`UPDATE "User" SET theme = NULL WHERE email = $1`, [EMAIL]);

  log("Sprint: reduced motion — the header's current step does not breathe");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, "hl_try");
  const breathing = await page.evaluate(() => {
    const seg = document.querySelector("[data-testid=contact-header] .lm-seg[data-state=current]");
    return seg ? getComputedStyle(seg).animationName : "none";
  });
  assert.equal(breathing, "none");
  await page.emulateMedia({ reducedMotion: "no-preference" });

  log("Sprint: one rule for the meeting waiting — a calendar 'Just tick it' still asks and Held answers that meeting; after a no-show the main button is Reschedule and Held in How did it go? says it did happen; Do Not List is not on a tile, so Mark held opens How did it go? on Meeting");
  for (const [id, name] of [
    ["hl_tick", "Tia Tick"],
    ["hl_nos", "Nia Noshow"],
    ["hl_hide", "Hal Hidden"],
  ]) {
    await sql(
      `INSERT INTO "Contact" (id,"organizationId",name,status,"createdAt","updatedAt") VALUES ($1,$2,$3,'MEETING_SET',now() - interval '20 days',now())`,
      [id, org, name],
    );
    await sql(`INSERT INTO "Opportunity" (id,"organizationId",title,stage,"ownerId","updatedAt") VALUES ($1,$2,$3,'MEETING_SET',$4,now())`, [`${id}_opp`, org, name, me]);
    await sql(`INSERT INTO "OpportunityContact" (id,"opportunityId","contactId",role,"fromMeeting") VALUES ($1,$2,$3,$4,true)`, [
      `${id}_oc`,
      `${id}_opp`,
      id,
      id === "hl_hide" ? "HIDDEN" : "PRIMARY",
    ]);
  }
  // Tia's meeting three days ago was ticked done on the calendar with no
  // outcome; Nia's was a no-show; Hal's tile has a meeting gone by, but he
  // is ticked Do Not List on it.
  await sql(
    `INSERT INTO "CalendarEvent" (id,"organizationId",title,type,"startOn","startTime","contactId","ownerId","doneAt","updatedAt") VALUES
       ('hl_ev_tick',$1,'Meeting · Tia Tick','Meeting',current_date - 3,'10:00','hl_tick',$2,now(),now()),
       ('hl_ev_nos',$1,'Meeting · Nia Noshow','Meeting',current_date - 3,'10:00','hl_nos',$2,now(),now())`,
    [org, me],
  );
  await sql(
    `INSERT INTO "OpportunityMeeting" (id,"opportunityId","on","eventId","bookedById",outcome) VALUES
       ('hl_m_tick','hl_tick_opp',((current_date - 3) + time '10:00') AT TIME ZONE '${ZONE}','hl_ev_tick',$1,NULL),
       ('hl_m_nos','hl_nos_opp',((current_date - 3) + time '10:00') AT TIME ZONE '${ZONE}','hl_ev_nos',$1,'NO_SHOW'),
       ('hl_m_hide','hl_hide_opp',now() - interval '2 days',NULL,$1,NULL)`,
    [me],
  );
  const meetingsOn = async (tile) => (await sql(`SELECT id, outcome FROM "OpportunityMeeting" WHERE "opportunityId"=$1`, [tile])).rows.map((row) => `${row.id}:${row.outcome}`);
  // Tia: the tick answered nothing, so the strip and the header ask, and
  // Held marks that very meeting (one meeting, never a second beside it).
  await open(page, "hl_tick");
  assert.equal(await main(page).getAttribute("data-action"), "mark-held");
  assert.equal(await page.locator("[data-testid=next-step]").getAttribute("data-kind"), "due", "the strip asks, as the Pipeline does");
  assert.match(await page.locator("[data-testid=next-step-line]").textContent(), /^Met .* — how did it go\?$/);
  await main(page).click();
  await until(async () => (await status("hl_tick")) === "MEETING_COMPLETED", "Tia held");
  assert.deepEqual(await meetingsOn("hl_tick_opp"), ["hl_m_tick:HELD"], "the ticked meeting itself, held");
  // Nia: after a no-show with nothing booked the next step is booking
  // again on that tile; How did it go?'s Held says the no-show did happen.
  await open(page, "hl_nos");
  assert.equal(await main(page).getAttribute("data-action"), "book");
  assert.equal((await main(page).textContent()).trim(), "Reschedule");
  assert.equal(await page.locator("[data-testid=next-step]").getAttribute("data-kind"), "none");
  await main(page).click();
  const nosBook = page.locator("[data-testid=book-meeting]");
  await nosBook.locator("[data-testid=book-opportunity]").waitFor();
  assert.equal(await nosBook.locator("[data-testid=book-opportunity]").getAttribute("data-offered"), "hl_nos_opp", "on the no-show's tile");
  await page.keyboard.press("Escape");
  await nosBook.waitFor({ state: "detached" });
  await page.locator("[data-testid=log-bar]").click();
  const nosLog = page.locator("[data-testid=how-did-it-go]");
  await nosLog.locator("[data-testid=log-type-MEETING]").click();
  const nosLine = nosLog.locator("[data-testid=log-meeting-line]");
  await nosLine.waitFor();
  assert.equal(await nosLine.getAttribute("data-meeting-id"), "hl_m_nos");
  assert.match(await nosLine.textContent(), /marked no-show/);
  await nosLog.locator("[data-testid=outcome-HELD]").click();
  await nosLog.locator("[data-testid=outcome-save]").click();
  await page.locator("[data-testid=log-saved]").waitFor();
  assert.deepEqual(await meetingsOn("hl_nos_opp"), ["hl_m_nos:HELD"], "the no-show turned Held, no second meeting");
  assert.equal(await status("hl_nos"), "MEETING_COMPLETED");
  await page.locator("[data-testid=follow-up-skip]").click();
  await nosLog.waitFor({ state: "detached" });
  // Hal: Do Not List is not on his tile, so nothing of it waits on him;
  // Mark held (Meeting Set with no meeting known) opens How did it go? on
  // Meeting and writes nothing until a chip is tapped.
  await open(page, "hl_hide");
  assert.equal(await main(page).getAttribute("data-action"), "mark-held");
  assert.equal(await page.locator("[data-testid=next-step]").getAttribute("data-kind"), "none");
  await main(page).click();
  const hideLog = page.locator("[data-testid=how-did-it-go]");
  await hideLog.waitFor();
  assert.equal(await hideLog.locator("[data-testid=log-type-MEETING]").getAttribute("aria-pressed"), "true", "on Meeting");
  await page.keyboard.press("Escape");
  await hideLog.waitFor({ state: "detached" });
  assert.deepEqual(await meetingsOn("hl_hide_opp"), ["hl_m_hide:null"], "his old tile's meeting untouched");
  assert.equal((await one(`SELECT count(*)::int n FROM "Activity" WHERE "contactId"='hl_hide'`)).n, 0, "nothing logged");

  log("Sprint: the phone at 390 — no sideways scroll, the 56px bar (Call · Text · Log · main · ⋯), the main button full width, folded cards, five history lines");
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const mobile = await phone.newPage();
  mobile.on("pageerror", (err) => console.error("PAGE ERROR (phone):", err.message));
  await mobile.goto(`${BASE}/login`);
  await mobile.fill("#email", EMAIL);
  await mobile.fill("#password", PASSWORD);
  await mobile.click("button[type=submit]");
  await mobile.waitForURL(/\/dashboard$/);
  for (const id of ["hl_many", "hl_warm", "hl_won"]) {
    await open(mobile, id);
    await settle(mobile);
    const width = await mobile.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(width <= 390, `${id}: the page is ${width}px wide on a 390px phone`);
  }
  await open(mobile, "hl_many");
  // Measured once the page's fade-in is over: mid-animation the boxes sit
  // on a fractional offset and a 48px button reads 47.99997.
  await settle(mobile);
  const bar = mobile.locator("[data-testid=phone-bar]");
  const barBox = await bar.boundingBox();
  assert.equal(Math.round(barBox.height), 56);
  const viewH = await mobile.evaluate(() => window.innerHeight);
  // audit fixes (pages): it was pinned to the foot of the screen, over the
  // app's tab bar (Today / Contacts / …). It sits right on top of it.
  const tabsBox = await mobile.locator("[data-testid=phone-tabs]").boundingBox();
  assert.ok(tabsBox && Math.abs(tabsBox.y + tabsBox.height - viewH) <= 1, `the tab bar is at the foot (${JSON.stringify(tabsBox)} in ${viewH})`);
  assert.ok(Math.abs(barBox.y + barBox.height - tabsBox.y) <= 1, `on top of the tab bar (${JSON.stringify(barBox)} over ${tabsBox.y})`);
  assert.ok(
    await mobile.evaluate(() => {
      const tabs = document.querySelector("[data-testid=phone-tabs]").getBoundingClientRect();
      return Boolean(document.elementFromPoint(tabs.left + tabs.width / 2, tabs.top + tabs.height / 2)?.closest("[data-testid=phone-tabs]"));
    }),
    "a tap on the tab bar reaches it",
  );
  for (const id of ["phone-bar-call", "phone-bar-text", "phone-bar-log", "phone-bar-main", "phone-bar-more"]) {
    const box = await bar.locator(`[data-testid=${id}]`).boundingBox();
    assert.ok(box && box.height >= 44, `${id} is a 44px target`);
  }
  const header = await mobile.locator("[data-testid=contact-header]").boundingBox();
  const mainBox = await mobile.locator("[data-testid=contact-main]").boundingBox();
  assert.ok(mainBox.width >= header.width - 40 && mainBox.height >= 48, `the main button is full width at 48px (${JSON.stringify(mainBox)})`);
  assert.equal(await mobile.locator("[data-testid=reach] [data-testid=contact-mobile]").isVisible(), false, "Reach starts folded");
  assert.equal(await mobile.locator("[data-testid=notes-card] textarea").isVisible(), false, "Notes start folded");
  const visibleLines = await mobile.locator("#activity [data-testid=activity-line]").evaluateAll((els) => els.filter((el) => el.getBoundingClientRect().height > 0).length);
  assert.equal(visibleLines, 5, "the five latest");
  await mobile.locator("[data-testid=history-show-all]").click();
  assert.ok((await mobile.locator("#activity [data-testid=activity-line]").evaluateAll((els) => els.filter((el) => el.getBoundingClientRect().height > 0).length)) > 5);
  await mobile.locator("[data-testid=reach-toggle]").click();
  assert.equal(await mobile.locator("[data-testid=reach] [data-testid=contact-mobile]").isVisible(), true);
  // The order down the page: header, Next step, the log bar, History, then Reach.
  const tops = await mobile.evaluate(() =>
    ["[data-testid=contact-header]", "[data-testid=next-step]", "#log", "#activity", "[data-testid=reach]"].map((sel) => Math.round(document.querySelector(sel).getBoundingClientRect().top)),
  );
  assert.deepEqual([...tops].sort((a, b) => a - b), tops, `in order (${tops})`);
  await mobile.locator("[data-testid=phone-bar-log]").click();
  await mobile.locator("[data-testid=log-activity-form]").waitFor();
  await shot(mobile, "06-phone");
  // The log is a sheet over the page: close it to reach the bar again.
  await mobile.keyboard.press("Escape");
  await mobile.locator("[data-testid=log-activity-form]").waitFor({ state: "detached" });
  await mobile.locator("[data-testid=phone-bar-more]").click();
  await mobile.locator("[data-testid=phone-bar-more-menu] [data-testid=status-picker]").waitFor();
  await phone.close();


  log("audit fixes (pages): Reschedule, Call ▾ and Set follow-up take the keyboard into their panels; on a phone the meeting's day and time wrap inside the main button");
  await sql(`INSERT INTO "Company" (id,"organizationId",name,"createdAt","updatedAt") VALUES ('hl_co_aud',$1,'Birchline Audit Co',now(),now())`, [org]);
  await sql(
    `INSERT INTO "Contact" (id,"organizationId","companyId",name,status,mobile,phone,"createdAt","updatedAt") VALUES
       ('hl_aud',$1,'hl_co_aud','Ava Audit','CONNECTED','512-555-1101','512-555-1102',now(),now()),
       ('hl_aud2',$1,'hl_co_aud','Abe Audit','CONTACTED','512-555-1201',null,now(),now())`,
    [org],
  );
  // A talk an hour ago: Book meeting is Ava's main button.
  await act("hla_aud_talk", "hl_aud", "PHONE_CALL", "TALKED", "1 hour", "Talked about the bid");
  const inside = (testId) => page.evaluate((id) => Boolean(document.activeElement?.closest(`[data-testid=${id}]`)), testId);
  await open(page, "hl_aud");
  await main(page).click();
  const audSheet = page.locator("[data-testid=book-meeting]");
  await audSheet.waitFor();
  await bookTomorrow(audSheet);
  await audSheet.locator("[data-testid='book-time-10:00']").click();
  await audSheet.locator("[data-testid=book-submit]").click();
  await until(async () => (await status("hl_aud")) === "MEETING_SET", "Ava Meeting Set");
  await open(page, "hl_aud");
  await page.locator("[data-testid=contact-reschedule]").focus();
  await page.keyboard.press("Enter");
  await page.locator("[data-testid=contact-reschedule-menu]").waitFor();
  await until(() => inside("contact-reschedule-menu"), "focus in Reschedule's panel");
  await page.keyboard.press("Escape");
  await page.locator("[data-testid=contact-call-more]").focus();
  await page.keyboard.press("Enter");
  await page.locator("[data-testid=contact-call-menu]").waitFor();
  await until(() => inside("contact-call-menu"), "focus in the Call menu");
  assert.match(await page.evaluate(() => document.activeElement.getAttribute("href")), /^tel:/, "the first number is focused");
  await page.keyboard.press("Escape");
  await open(page, "hl_aud2");
  await page.locator("[data-testid=next-follow-up]").focus();
  await page.keyboard.press("Enter");
  await page.locator("[data-testid=next-follow-up-menu]").waitFor();
  await until(() => inside("next-follow-up-menu"), "focus in Set follow-up's panel");
  await page.keyboard.press("Escape");
  {
    const phone2 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: await page.context().storageState() });
    const m = await phone2.newPage();
    await open(m, "hl_aud");
    await settle(m);
    const slot = m.locator("[data-testid=phone-bar-main]");
    assert.match((await slot.textContent()).trim(), /Tomorrow\s*10:00 AM/);
    const fit = await slot.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
    assert.ok(fit.scroll <= fit.client + 1, `the words stay inside the button (${fit.scroll} > ${fit.client})`);
    const box = await slot.boundingBox();
    assert.ok(box.height >= 44 && box.height <= 56, `still a 44px target inside the 56px bar (${box.height})`);
    await phone2.close();
  }

  log("Sprint: the Contacts list's Pulse filter and Warmest first (the SQL twin) put every person here exactly where their own meter says, and the twin agrees with leadHealth() on every fixture");
  {
    // What each pulse looks like on the row's own mini meter.
    const LOOK = {
      won: ["WON", "good"], owes: ["WON", "risk"], warm: ["REACHED", "good"], cooling: ["REACHED", "warn"], cold: ["REACHED", "risk"],
      trying: ["TRYING", "none"], stalled: ["TRYING", "warn"], new: ["NEW", "none"], closed: ["CLOSED", "none"],
    };
    const rowsAt = async (query) => {
      await page.goto(`${BASE}/dashboard/contacts?scope=all&per=100&${query}`);
      await page.locator("[data-testid=page-summary]").waitFor();
      return page.locator("[data-testid=contact-row]").evaluateAll((rows) =>
        rows.map((row) => {
          const meter = row.querySelector("[data-testid=pulse] [data-state]");
          return { id: row.getAttribute("data-contact-id"), state: meter?.getAttribute("data-state"), tone: meter?.getAttribute("data-health") };
        }),
      );
    };
    const everyone = await rowsAt("sort=name");
    assert.ok(everyone.length >= 10, `${everyone.length} people`);
    const seen = new Map();
    const usedKeys = new Set();
    for (const [key, [state, tone]] of Object.entries(LOOK)) {
      for (const row of await rowsAt(`pulse=${key}`)) {
        assert.deepEqual([row.state, row.tone], [state, tone], `${row.id} under ${key}`);
        assert.ok(!seen.has(row.id), `${row.id} is under ${seen.get(row.id)} and ${key}`);
        seen.set(row.id, key);
        usedKeys.add(key);
      }
    }
    assert.deepEqual([...seen.keys()].sort(), everyone.map((row) => row.id).sort(), "everyone is under exactly one pulse");
    assert.ok(usedKeys.size >= 5, `the seed reaches ${[...usedKeys]}`);
    const order = Object.keys(LOOK);
    const warmest = (await rowsAt("sort=pulse")).map((row) => order.indexOf(seen.get(row.id)));
    assert.deepEqual(warmest, [...warmest].sort((a, b) => a - b), "Warmest first reads in pulse order");
    const { execFileSync } = require("node:child_process");
    const out = execFileSync("npx", ["tsx", "scripts/health-check.ts"], { env: { ...process.env, DATABASE_URL: DB }, encoding: "utf8", timeout: 300000 });
    assert.match(out, /ok {3}Sprint: the SQL twin agrees with leadHealth\(\) on all \d+ fixtures/);
    assert.match(out, /ok {3}Sprint: the twin's inputs from the tables agree with the batched loader/);
    assert.match(out, /PASS — \d+ checks passed/);
  }

  console.log(`\nAll ${step} steps passed. Screenshots in ${OUT}`);
  await browser.close();
})().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
