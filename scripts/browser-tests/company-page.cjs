/* Browser regression for the company page (BDR redesign, Nov 11, 2026).
 *
 * Covers the approved company page: the header (the logo in the warmest
 * person's health ring, "City · Industry", the Rep chip, the star, the
 * health word, a red "Owes $X · late" when money is late), the action bar
 * (one main button that follows the stage — Call <person>, Book meeting,
 * "Meeting <day>" with Reschedule, Mark held with No-show and Undo, Start
 * a quote — Call main line, Email, ⋯ More holding Add person, Edit,
 * Merge, Set status by hand and Delete at the foot), the meter of the
 * person furthest along with "n of m people reached" and Show counts;
 * Who to call (people by stage then health, the mini meter, "Last: VM ·
 * 3d · 2 tries", the Main contact tag, the mobile, Call / Text / Log /
 * Book, five rows then Show all), the amber "1 call not linked to a
 * person yet · Who was it with?" line with Claim and Undo, the Book
 * meeting sheet (chips, who else, "Add to the open … opportunity?",
 * Saved · Undo), the Next step strip, Log a touch folded, the history by
 * day with one line per batch, Notes; the Opportunity card, Balance only
 * when money is owed, Good to know, Paperwork only once it exists,
 * Details folded; the phone at 390 (no sideways scroll, 44px targets,
 * three rows, five history lines, the sticky Call main line · Log · Book ·
 * ⋯ bar), keyboard focus, reduced motion and 4.5:1 words in Dark and
 * Light. Every step is titled "Sprint: …".
 *
 * Seeds its own workspace with SQL. Runs against a built app (`npm run
 * build && npx next start`) and a local Postgres that has had `prisma
 * migrate deploy`; never point it at the live database.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/scb_test \
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules \
 *   BASE=http://localhost:3000 node scripts/browser-tests/company-page.cjs
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
const OUT = process.env.SHOTS_DIR || path.join(os.tmpdir(), "scb-browser-shots-company-page");
fs.mkdirSync(OUT, { recursive: true });

const EMAIL = "test-company-page@example.com";
const PASSWORD = "password123";
const COMPANY = "Test Company Page Co";
const SLUG_LIKE = "test-company-page-co%";
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
async function login(page) {
  await page.goto(`${BASE}/login`);
  await page.fill("#email", EMAIL);
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
// A moment N days back at 10:00 on the workspace's clock.
const daysAgo = (n, hour = 10) => `((date_trunc('day', now() AT TIME ZONE '${ZONE}') - interval '${n} days' + interval '${hour} hours') AT TIME ZONE '${ZONE}')`;

// Text contrast of an element's words against the first opaque background
// behind it.
async function contrastOf(locator) {
  return locator.evaluate((el) => {
    const parse = (value) => {
      const m = value.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const parts = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
    };
    const canvas = document.createElement("canvas").getContext("2d");
    const resolve = (value) => {
      canvas.fillStyle = "#000";
      canvas.fillStyle = value;
      return parse(getComputedStyle(Object.assign(document.createElement("i"), { style: `color:${canvas.fillStyle}` })).color) ?? parse(canvas.fillStyle);
    };
    const toRgb = (value) => {
      const direct = parse(value);
      if (direct) return direct;
      canvas.fillStyle = "#000";
      canvas.fillStyle = value;
      const hex = canvas.fillStyle;
      if (hex.startsWith("#")) return { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16), a: 1 };
      return parse(hex) ?? resolve(value);
    };
    const layers = [];
    let node = el;
    while (node && node.nodeType === 1) {
      const bg = toRgb(getComputedStyle(node).backgroundColor);
      if (bg && bg.a > 0) {
        layers.push(bg);
        if (bg.a >= 0.999) break;
      }
      node = node.parentElement;
    }
    let base = { r: 255, g: 255, b: 255 };
    const bodyBg = toRgb(getComputedStyle(document.body).backgroundColor);
    if (bodyBg && bodyBg.a > 0.99) base = bodyBg;
    for (const layer of layers.reverse()) {
      base = { r: layer.r * layer.a + base.r * (1 - layer.a), g: layer.g * layer.a + base.g * (1 - layer.a), b: layer.b * layer.a + base.b * (1 - layer.a) };
    }
    const fg0 = toRgb(getComputedStyle(el).color);
    const fg = { r: fg0.r * fg0.a + base.r * (1 - fg0.a), g: fg0.g * fg0.a + base.g * (1 - fg0.a), b: fg0.b * fg0.a + base.b * (1 - fg0.a) };
    const lum = ({ r, g, b }) => {
      const f = (c) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const [l1, l2] = [lum(fg), lum(base)].sort((a, b) => b - a);
    return (l1 + 0.05) / (l2 + 0.05);
  });
}

(async () => {
  await sql(`DELETE FROM "Organization" WHERE slug LIKE $1`, [SLUG_LIKE]);

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await context.newPage();
  page.on("pageerror", (err) => console.error("PAGE ERROR:", err.message));

  log("Sprint: signup + activate + login; seed Ironwood with seven people, a Pipeline tile, a bypassed call and history");
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
  const me = (await one(`SELECT id FROM "User" WHERE email=$1`, [EMAIL])).id;

  await sql(
    `INSERT INTO "Company" (id,"organizationId",name,city,state,industries,phone,email,status,"updatedAt") VALUES
       ('cmp_cp_iron',$1,'Ironwood General Contractors','Austin','TX','{Construction}','512-555-0100','office@ironwood.test','MEETING_SET',now()),
       ('cmp_cp_new',$1,'Fresh Lead Co','Dallas','TX','{}',NULL,NULL,'NOT_ACTIONED',now()),
       ('cmp_cp_empty',$1,'Empty Shell Co',NULL,NULL,'{}',NULL,NULL,'NOT_ACTIONED',now())`,
    [org],
  );
  await sql(
    `INSERT INTO "Contact" (id,"organizationId","companyId",name,title,phone,mobile,status,"updatedAt") VALUES
       ('ctc_cp_kristen',$1,'cmp_cp_iron','Kristen Vaughn','Preconstruction Manager',NULL,'512-555-0101','MEETING_SET',now()),
       ('ctc_cp_chase',$1,'cmp_cp_iron','Chase Hill','Project Manager','512-555-0102',NULL,'CONNECTED',now()),
       ('ctc_cp_olivia',$1,'cmp_cp_iron','Olivia Wolfe','Estimator',NULL,'512-555-0103','CONTACTED',now()),
       ('ctc_cp_pat',$1,'cmp_cp_iron','Pat Moss','Office Manager',NULL,'512-555-0104','CONTACTED',now()),
       ('ctc_cp_dana',$1,'cmp_cp_iron','Dana Ruiz','Superintendent','512-555-0105',NULL,'NOT_ACTIONED',now()),
       ('ctc_cp_eli',$1,'cmp_cp_iron','Eli Park','Foreman',NULL,NULL,'NOT_ACTIONED',now()),
       ('ctc_cp_gus',$1,'cmp_cp_iron','Gus Lane','Owner',NULL,'512-555-0107','NOT_INTERESTED',now()),
       ('ctc_cp_fresh',$1,'cmp_cp_new','Freda Fresh','Owner',NULL,'214-555-0108','NOT_ACTIONED',now())`,
    [org],
  );
  // History: Olivia two tries (a voicemail 3 days ago is the last), Pat a
  // text, Chase a talk two days ago, Gus a talk long ago, one call on
  // Kristen and Chase together today (one batch), a bypassed front-desk
  // call on the company, and a birthday note on Kristen.
  await sql(
    `INSERT INTO "Activity" (id,"organizationId","contactId","companyId","userId",type,body,outcome,"occurredAt","batchId") VALUES
       ('act_cp_o1',$1,'ctc_cp_olivia',NULL,$2,'PHONE_CALL','No answer','NO_ANSWER',${daysAgo(6)},NULL),
       ('act_cp_o2',$1,'ctc_cp_olivia',NULL,$2,'PHONE_CALL','Left voicemail','VOICEMAIL',${daysAgo(3)},NULL),
       ('act_cp_p1',$1,'ctc_cp_pat',NULL,$2,'TEXT','Sent the brochure','SENT',${daysAgo(1)},NULL),
       ('act_cp_c1',$1,'ctc_cp_chase',NULL,$2,'PHONE_CALL','Talked about the Lakewood job','TALKED',${daysAgo(2)},NULL),
       ('act_cp_g1',$1,'ctc_cp_gus',NULL,$2,'PHONE_CALL','Has a vendor already','TALKED',${daysAgo(40)},NULL),
       ('act_cp_k1',$1,'ctc_cp_kristen',NULL,$2,'PHONE_CALL','Conference call with Kristen and Chase','TALKED',now() - interval '1 hour','batch_cp_conf'),
       ('act_cp_k2',$1,'ctc_cp_chase',NULL,$2,'PHONE_CALL','Conference call with Kristen and Chase','TALKED',now() - interval '1 hour','batch_cp_conf'),
       ('act_cp_desk',$1,NULL,'cmp_cp_iron',$2,'PHONE_CALL','Front desk said call back Tuesday','GATEKEEPER',now() - interval '2 hours',NULL)`,
    [org, me],
  );
  await sql(
    `INSERT INTO "Note" (id,"organizationId","contactId","authorId",body,label) VALUES
       ('note_cp_bday',$1,'ctc_cp_kristen',$2,'Birthday is March 9 — likes the Longhorns','BIRTHDAY')`,
    [org, me],
  );
  // Kristen is the Primary on an open tile with a meeting tomorrow.
  await sql(
    `INSERT INTO "Opportunity" (id,"organizationId",title,stage,"ownerId","leadLabel","updatedAt") VALUES ('opp_cp_iron',$1,'Ironwood General Contractors','MEETING_SET',$2,'Client',now())`,
    [org, me],
  );
  await sql(
    `INSERT INTO "OpportunityContact" (id,"opportunityId","contactId",role,"fromMeeting") VALUES ('oc_cp_kristen','opp_cp_iron','ctc_cp_kristen','PRIMARY',true)`,
  );
  await sql(
    `INSERT INTO "OpportunityMeeting" (id,"opportunityId","on","bookedById") VALUES ('om_cp_k',  'opp_cp_iron', ((($1::date + 1) + time '10:00') AT TIME ZONE '${ZONE}'), $2)`,
    [TODAY, me],
  );
  await sql(
    `INSERT INTO "StatusChange" (id,"organizationId","contactId","fromStatus","toStatus","on","auto","userId") VALUES
       ('sc_cp_k1',$1,'ctc_cp_kristen','NOT_ACTIONED','CONTACTED',now() - interval '5 days',true,$2),
       ('sc_cp_k2',$1,'ctc_cp_kristen','CONTACTED','CONNECTED',now() - interval '4 days',true,$2),
       ('sc_cp_k3',$1,'ctc_cp_kristen','CONNECTED','MEETING_SET',now() - interval '1 day',true,$2)`,
    [org, me],
  );
  const ironUrl = `${BASE}/dashboard/companies/cmp_cp_iron`;

  log("Sprint: the header reads like a contact's: logo in a health ring, name, City · Industry, Rep chip, star, health word");
  await page.goto(ironUrl);
  const header = page.locator("[data-testid=company-header]");
  await header.getByRole("heading", { name: "Ironwood General Contractors" }).waitFor();
  assert.equal(await header.locator("[data-testid=health-ring]").count(), 1, "the logo sits in a health ring");
  assert.equal((await header.locator("[data-testid=company-where]").innerText()).trim(), "Austin · Construction");
  assert.equal(await header.locator("[data-testid=rep-picker]").count(), 1, "the Rep chip moved up into the header");
  assert.equal(await page.locator("[data-testid=rep-picker]").count(), 1, "and only there");
  assert.equal(await header.getByRole("button", { name: /favorite/i }).count() + (await header.locator("button[aria-pressed]").count()) > 0, true, "the star");
  await header.locator("[data-testid=health-word]").first().waitFor();
  assert.equal(await header.locator("[data-testid=company-owes]").count(), 0, "nothing owed, no Owes pill");
  await shot(page, "01-header");

  log("Sprint: the action bar: the main button follows the stage (Meeting tomorrow with Reschedule), Call main line, Email, ⋯ More");
  const main = page.locator("[data-testid=company-main]");
  assert.equal(await main.getAttribute("data-action"), "meeting");
  assert.match(await main.innerText(), /^Meeting tomorrow 10:00 AM$/);
  assert.match(await main.getAttribute("href"), new RegExp(`/dashboard/calendar\\?on=${shift(TODAY, 1)}$`));
  await page.locator("[data-testid=company-reschedule]").waitFor();
  assert.equal(await page.locator("[data-testid=company-call-main]").getAttribute("href"), "tel:512-555-0100");
  assert.equal(await page.locator("[data-testid=company-email]").getAttribute("href"), "mailto:office@ironwood.test");
  const tray = page.locator("[data-testid=company-more-tray]");
  assert.equal(await tray.isVisible(), false, "More starts closed");
  assert.equal(await page.locator("[data-testid=add-person]").isVisible(), false, "Add person is one tap deeper");
  await page.locator("[data-testid=company-more]").click();
  await tray.waitFor();
  for (const id of ["add-person", "company-edit", "duplicate-merge", "status-picker", "header-delete"]) {
    assert.ok(await tray.locator(`[data-testid=${id}]`).isVisible(), `${id} in More`);
  }
  const order = await tray.locator("[data-testid=add-person], [data-testid=company-edit], [data-testid=duplicate-merge], [data-testid=status-picker], [data-testid=header-delete]").evaluateAll((els) => els.map((el) => el.getAttribute("data-testid")));
  assert.equal(order[order.length - 1], "header-delete", "Delete sits at the foot of More");
  // Merge opens with this company already picked, over the whole screen.
  await tray.locator("[data-testid=duplicate-merge]").click();
  const merge = page.locator("[data-testid=merge-dialog]");
  await merge.waitFor();
  assert.match(await merge.innerText(), /Ironwood General Contractors/);
  const mergeBox = await merge.boundingBox();
  assert.ok(mergeBox.y >= 0 && mergeBox.y + mergeBox.height <= 950 && mergeBox.x > 200, `the merge dialog is on screen (${JSON.stringify(mergeBox)})`);
  await page.keyboard.press("Escape");
  await merge.waitFor({ state: "detached" });
  await tray.locator("[data-testid=header-delete]").click();
  await tray.locator("[data-testid=header-delete-confirm]").waitFor();
  await tray.getByRole("button", { name: "Cancel" }).click();
  await shot(page, "02-more-open");
  await page.locator("[data-testid=company-more]").click();
  assert.equal(await tray.isVisible(), false, "More closes again");

  log("Sprint: the meter is the person furthest along, coloured by the warmest; 3 of 7 people reached; Show counts holds the six tiles");
  const meter = page.locator("[data-testid=company-meter]");
  assert.equal(await meter.getAttribute("data-step"), "2", "Meeting Set is the furthest step (Kristen)");
  assert.match(await meter.locator("[data-testid=lifecycle-reason]").innerText(), /meeting tomorrow 10:00 AM/);
  assert.equal((await page.locator("[data-testid=company-reached]").innerText()).trim(), "3 of 7 people reached");
  const counts = page.locator("[data-testid=company-counts]");
  assert.equal(await counts.isVisible(), false, "the count tiles are one tap deeper");
  await page.locator("[data-testid=company-show-counts]").click();
  await counts.getByText("Activity overview").waitFor();
  // The conference call on Kristen and Chase is one touch.
  const touches = (
    await one(
      `SELECT count(DISTINCT COALESCE(a."batchId", a.id))::int AS n FROM "Activity" a LEFT JOIN "Contact" c ON c.id=a."contactId"
        WHERE a."organizationId"=$1 AND NOT a.marketing AND (a."companyId"='cmp_cp_iron' OR c."companyId"='cmp_cp_iron')`,
      [org],
    )
  ).n;
  assert.match(await counts.innerText(), new RegExp(`${touches} touch(es)? logged`));
  await page.locator("[data-testid=company-show-counts]").click();

  log("Sprint: Who to call: by stage then health, mini meter, Last line, Main contact tag, mobile, Call / Text / Log / Book; five rows then Show all");
  const people = page.locator("#people");
  const rowsShown = async () =>
    people.locator("[data-testid=person-row]").evaluateAll((rows) => rows.filter((row) => row.offsetParent !== null).map((row) => row.querySelector("[data-testid=person-name]").textContent.trim()));
  assert.deepEqual(await rowsShown(), ["Kristen Vaughn", "Chase Hill", "Pat Moss", "Olivia Wolfe", "Dana Ruiz"], "stage, then warmest");
  const row = (name) => people.locator("[data-testid=person-row]", { hasText: name });
  assert.equal(await row("Kristen Vaughn").locator("[data-testid=main-contact]").count(), 1, "Kristen is the Primary POC");
  assert.equal(await people.locator("[data-testid=main-contact]").count(), 1, "nobody else is");
  assert.equal((await row("Olivia Wolfe").locator("[data-testid=person-last]").innerText()).trim(), "Last: VM · 3d · 2 tries");
  assert.equal((await row("Pat Moss").locator("[data-testid=person-last]").innerText()).trim(), "Last: Text sent · 1d · 1 try");
  assert.equal((await row("Dana Ruiz").locator("[data-testid=person-last]").innerText()).trim(), "Not tried yet");
  assert.equal(await row("Kristen Vaughn").locator("[data-testid=person-meter]").getAttribute("data-step"), "2");
  assert.equal(await row("Kristen Vaughn").locator("[data-testid=person-call-button]").getAttribute("href"), "tel:512-555-0101", "Call dials the mobile");
  assert.equal(await row("Kristen Vaughn").locator("[data-testid=person-text]").getAttribute("href"), "sms:512-555-0101");
  assert.equal(await row("Chase Hill").locator("[data-testid=person-text]").count(), 0, "no mobile, no Text");
  assert.deepEqual(
    await row("Kristen Vaughn").locator("[data-testid=person-call]").evaluateAll((links) => links.map((a) => `${a.getAttribute("href")} ${a.textContent}`)),
    ["tel:512-555-0101 Mobile 512-555-0101"],
    "the mobile is shown",
  );
  await people.locator("[data-testid=who-show-all]").click();
  assert.deepEqual((await rowsShown()).slice(5), ["Eli Park", "Gus Lane"], "never tried, then the closed one last");
  // A tap on the mini meter opens its steps, not the person's page.
  await row("Kristen Vaughn").locator("[data-testid=person-meter]").hover();
  await page.locator("[data-testid=lifecycle-popover]").waitFor();
  await page.mouse.move(5, 5);
  await shot(page, "03-who-to-call");

  log("Sprint: Log on a row opens How did it go? for that person under the row, and it logs on them");
  await row("Olivia Wolfe").locator("[data-testid=person-log-button]").click();
  const rowLog = row("Olivia Wolfe").locator("[data-testid=person-log]");
  await rowLog.waitFor();
  const rowForm = rowLog.locator("[data-testid=log-activity-form]");
  await rowForm.locator("textarea[name=body]").fill("Olivia picked up, call back Friday");
  await rowForm.locator("[data-testid=activity-submit]").click();
  await until(async () => (await one(`SELECT count(*)::int n FROM "Activity" WHERE "contactId"='ctc_cp_olivia' AND body LIKE 'Olivia picked up%'`)).n === 1, "logged on Olivia");
  await page.locator("#activity").getByText("Olivia picked up, call back Friday").waitFor();
  await row("Olivia Wolfe").locator("[data-testid=person-log-button]").click();
  await rowLog.waitFor({ state: "detached" });

  log("Sprint: the amber line names the call nobody is linked to; Claim moves it onto a person, Undo puts it back");
  const nudge = page.locator("[data-testid=other-contacts]");
  assert.equal((await nudge.locator("[data-testid=not-linked-count]").innerText()).trim(), "1 call not linked to a person yet");
  const nudgeBox = await nudge.locator("[data-testid=not-linked-toggle]").boundingBox();
  const firstRowBox = await people.locator("[data-testid=person-row]").first().boundingBox();
  assert.ok(nudgeBox.y < firstRowBox.y, "at the top of Who to call");
  assert.equal(await nudge.locator("[data-testid=unclaimed-row]").count(), 0, "folded to one line");
  await nudge.locator("[data-testid=not-linked-toggle]").click();
  await nudge.locator("[data-testid=unclaimed-row]").waitFor();
  await nudge.locator("[data-testid=claim-one]").click();
  await nudge.locator("[data-testid=claim-person]", { hasText: "Dana Ruiz" }).click();
  await until(async () => (await one(`SELECT "contactId" FROM "Activity" WHERE id='act_cp_desk'`)).contactId === "ctc_cp_dana", "claimed for Dana");
  await nudge.locator("[data-testid=claim-done]").waitFor();
  assert.match(await nudge.locator("[data-testid=claim-done]").innerText(), /Moved onto Dana Ruiz/);
  assert.equal(await status("Contact", "ctc_cp_dana"), "CONTACTED", "a front-desk call is a try: Attempted");
  await nudge.locator("[data-testid=not-linked-toggle]").waitFor({ state: "detached" });
  await shot(page, "04-claimed");
  await nudge.locator("[data-testid=claim-undo]").click();
  await until(async () => (await one(`SELECT "contactId" FROM "Activity" WHERE id='act_cp_desk'`)).contactId === null, "back on the company");
  const desk = await one(`SELECT "contactId", "companyId" FROM "Activity" WHERE id='act_cp_desk'`);
  assert.deepEqual({ ...desk }, { contactId: null, companyId: "cmp_cp_iron" });
  assert.equal(await status("Contact", "ctc_cp_dana"), "NOT_ACTIONED", "Dana's status goes back");
  assert.equal((await one(`SELECT count(*)::int n FROM "StatusChange" WHERE "contactId"='ctc_cp_dana'`)).n, 0, "and the claim's status rows go");
  assert.equal((await one(`SELECT "lastTouchAt" FROM "Contact" WHERE id='ctc_cp_dana'`)).lastTouchAt, null, "the touch date is recomputed");
  await nudge.locator("[data-testid=not-linked-toggle]").waitFor();

  log("Sprint: Book on a row opens the Book meeting sheet: day and time chips, who else, joining Kristen's open tile; Saved · Undo");
  await row("Chase Hill").locator("[data-testid=person-book]").click();
  const sheet = page.locator("[data-testid=book-sheet]");
  await sheet.waitFor();
  assert.equal(await sheet.evaluate((el) => el.closest(".modal-backdrop").parentElement === document.body), true, "drawn on the body");
  assert.match(await sheet.locator("h2").innerText(), /Book a meeting with Chase Hill/);
  await sheet.locator("[data-testid=book-day]", { hasText: "Tomorrow" }).click();
  await sheet.locator("[data-testid=book-time][data-time='14:00']").click();
  await sheet.locator("[data-testid=book-with]", { hasText: "Olivia Wolfe" }).click();
  const join = sheet.locator("[data-testid=book-join]");
  await join.waitFor();
  assert.match(await join.innerText(), /Add to the open Ironwood General Contractors opportunity with Kristen Vaughn\?/);
  assert.equal(await sheet.locator("[data-testid=book-join-yes]").getAttribute("aria-pressed"), "true", "Yes is the default");
  await shot(page, "05-book-sheet");
  await sheet.locator("[data-testid=book-save]").click();
  await sheet.waitFor({ state: "detached" });
  const toast = page.locator("[data-testid=company-saved]");
  await toast.waitFor();
  assert.match(await toast.innerText(), /Chase Hill/);
  await until(async () => (await status("Contact", "ctc_cp_chase")) === "MEETING_SET", "Chase Meeting Set");
  const onTile = (await sql(`SELECT "contactId", role FROM "OpportunityContact" WHERE "opportunityId"='opp_cp_iron' ORDER BY "contactId"`)).rows.map((r) => `${r.contactId}:${r.role}`);
  assert.deepEqual(onTile, ["ctc_cp_chase:ASSOCIATED", "ctc_cp_kristen:PRIMARY", "ctc_cp_olivia:ASSOCIATED"], "both joined Kristen's tile");
  const booked = await one(`SELECT m."bookedById", to_char((m."on" AT TIME ZONE 'UTC') AT TIME ZONE '${ZONE}', 'YYYY-MM-DD HH24:MI') AS at FROM "OpportunityMeeting" m WHERE m."opportunityId"='opp_cp_iron' AND m.id <> 'om_cp_k'`);
  assert.equal(booked.bookedById, me, "the booker is kept");
  assert.equal(booked.at, `${shift(TODAY, 1)} 14:00`);
  await toast.locator("[data-testid=company-saved-undo]").click();
  await toast.waitFor({ state: "detached" });
  await until(async () => (await status("Contact", "ctc_cp_chase")) === "CONNECTED", "Chase back to Connected");
  assert.equal(await status("Contact", "ctc_cp_olivia"), "CONTACTED", "Olivia back too");
  assert.equal((await one(`SELECT count(*)::int n FROM "OpportunityMeeting" WHERE "opportunityId"='opp_cp_iron'`)).n, 1, "the booked meeting is gone");

  log("Sprint: a meeting gone by: Mark held asks nothing, moves Kristen to Meeting Completed, and Undo takes it back; No-show sits beside it");
  await sql(`UPDATE "OpportunityMeeting" SET "on" = now() - interval '1 day' WHERE id='om_cp_k'`);
  await page.reload();
  assert.equal(await main.getAttribute("data-action"), "mark-held");
  assert.equal((await main.innerText()).trim(), "Mark held");
  await page.locator("[data-testid=company-no-show]").waitFor();
  await main.click();
  await toast.waitFor();
  await until(async () => (await status("Contact", "ctc_cp_kristen")) === "MEETING_COMPLETED", "Kristen held");
  assert.equal((await one(`SELECT outcome FROM "OpportunityMeeting" WHERE id='om_cp_k'`)).outcome, "HELD");
  await until(async () => (await main.getAttribute("data-action")) === "link", "the next step moves on");
  assert.equal((await main.innerText()).trim(), "Start a quote");
  assert.match(await main.getAttribute("href"), /\/dashboard\/quotes\/new\?contactId=ctc_cp_kristen$/);
  await toast.locator("[data-testid=company-saved-undo]").click();
  await until(async () => (await status("Contact", "ctc_cp_kristen")) === "MEETING_SET", "Kristen back to Meeting Set");
  assert.equal((await one(`SELECT outcome FROM "OpportunityMeeting" WHERE id='om_cp_k'`)).outcome, null);

  log("Sprint: a meeting still ahead shows its day, not Mark held; Reschedule moves it on the Pipeline");
  await sql(`UPDATE "OpportunityMeeting" SET "on" = now() + interval '3 days' WHERE id='om_cp_k'`);
  await page.reload();
  assert.equal(await main.getAttribute("data-action"), "meeting", "a meeting ahead shows its day, not Mark held");
  await page.locator("[data-testid=company-reschedule]").click();
  const moving = page.locator("[data-testid=company-reschedule-panel]");
  await moving.waitFor();
  await moving.locator("input[type=date]").fill(shift(TODAY, 6));
  await moving.locator("input[type=time]").fill("09:30");
  await moving.getByRole("button", { name: "Move it" }).click();
  await toast.waitFor();
  await until(
    async () =>
      (await one(`SELECT count(*)::int n FROM "OpportunityMeeting" WHERE "opportunityId"='opp_cp_iron' AND outcome IS NULL AND to_char(("on" AT TIME ZONE 'UTC') AT TIME ZONE '${ZONE}', 'YYYY-MM-DD HH24:MI') = $1`, [`${shift(TODAY, 6)} 09:30`])).n === 1,
    "the meeting moved",
  );
  await until(async () => /9:30 AM/.test(await main.innerText()), "the button follows");

  log("Sprint: Next step shows what is booked; with nothing booked it offers Book meeting and Log a touch");
  const nextStep = page.locator("[data-testid=company-next-step]");
  assert.match(await nextStep.innerText(), /Next: Meeting/i);
  await page.goto(`${BASE}/dashboard/companies/cmp_cp_new`);
  await page.locator("[data-testid=company-next-step]").getByText("Nothing booked").waitFor();
  await page.locator("[data-testid=next-log]").click();
  await page.locator("#log [data-testid=log-activity-form]").waitFor();

  log("Sprint: a new company's main button is Call <first name>, dialling their mobile and opening their log");
  await page.goto(`${BASE}/dashboard/companies/cmp_cp_new`);
  assert.equal(await main.getAttribute("data-action"), "call");
  assert.equal((await main.innerText()).trim(), "Call Freda");
  assert.equal(await main.getAttribute("href"), "tel:214-555-0108");
  assert.equal(await page.locator("[data-testid=company-call-main]").count(), 0, "no main line on file");
  await main.evaluate((a) => a.addEventListener("click", (event) => event.preventDefault(), { once: true }));
  await main.click();
  await page.locator("[data-testid=person-row]", { hasText: "Freda Fresh" }).locator("[data-testid=person-log]").waitFor();
  assert.equal(await page.locator("[data-testid=company-reached]").innerText(), "0 of 1 person reached");
  assert.equal(await page.locator("[data-testid=company-opportunity]").count(), 0, "no open tile, no Opportunity card");
  assert.equal(await page.locator("[data-testid=company-paperwork]").count(), 0, "no paperwork yet, no Paperwork card");
  assert.equal(await page.locator("[data-testid=balance-card]").count(), 0, "nothing owed, no Balance card");
  await page.goto(`${BASE}/dashboard/companies/cmp_cp_empty`);
  await page.getByText("Nobody here yet").waitFor();
  assert.equal(await page.locator("[data-testid=company-reached]").count(), 0);

  log("Sprint: Log a touch is folded and opens the company's own log form");
  await page.goto(ironUrl);
  const logToggle = page.locator("[data-testid=company-log-toggle]");
  assert.equal(await logToggle.getAttribute("aria-expanded"), "false");
  assert.equal(await page.locator("#log [data-testid=log-activity-form]").count(), 0, "nothing drawn until opened");
  await logToggle.click();
  await page.locator("#log [data-testid=log-activity-form]").waitFor();
  await page.locator("#log [data-testid=company-people-picker]").waitFor();

  log("Sprint: the history is grouped by day, one line per batch naming everyone on it");
  const history = page.locator("#activity");
  const days = await history.locator("[data-testid=history-day]").allInnerTexts();
  assert.equal(days[0], "Today");
  assert.ok(days.includes("Yesterday"), `days: ${days}`);
  assert.equal(new Set(days).size, days.length, "each day once");
  const conf = history.locator("[data-testid=activity-line]", { hasText: "Conference call with Kristen and Chase" });
  assert.equal(await conf.count(), 1, "one line for the batch");
  assert.equal(await conf.getByRole("link").count(), 2, "naming both");

  log("Sprint: the Opportunity card replaces empty Deals / Quotes / Contracts: stage, Primary POC, label, Open on Pipeline");
  const opp = page.locator("[data-testid=company-opportunity]");
  assert.equal((await opp.locator("[data-testid=opportunity-stage]").innerText()).trim(), "Meeting Set");
  assert.equal((await opp.locator("[data-testid=opportunity-primary]").innerText()).trim(), "Kristen Vaughn");
  assert.match(await opp.innerText(), /Client/);
  assert.equal(await opp.locator("[data-testid=opportunity-open]").getAttribute("href"), "/dashboard/deals?q=Kristen%20Vaughn");
  for (const title of ["Deals", "Quotes", "Contracts", "Balance"]) {
    assert.equal(await page.locator(".card h2", { hasText: new RegExp(`^${title}$`) }).count(), 0, `no empty ${title} card`);
  }
  assert.equal(await page.locator("[data-testid=company-paperwork]").count(), 0);

  log("Sprint: Good to know shows the personal notes; Details is folded with Added by and the industry inside");
  const good = page.locator("[data-testid=good-to-know]");
  assert.match(await good.innerText(), /Birthday is March 9/);
  assert.match(await good.innerText(), /Kristen Vaughn/);
  const details = page.locator("[data-testid=company-details]");
  assert.equal(await details.locator("dl").isVisible(), false, "folded");
  assert.match(await details.locator("[data-testid=added-by]").textContent(), /^Added/);
  await details.locator("[data-testid=company-details-toggle]").click();
  assert.ok(await details.locator("dl").isVisible());
  assert.match(await details.locator("dl").innerText(), /Construction/);

  log("Sprint: money owed late shows a red Owes pill in the header and the Balance card; paperwork returns as one card");
  await sql(`UPDATE "Organization" SET "nextContractNumber" = GREATEST("nextContractNumber", 9101) WHERE id=$1`, [org]);
  await sql(
    `INSERT INTO "Contract" (id,"organizationId","contactId","companyId",number,title,type,payable,status,body,"publicToken","signedAt","updatedAt")
     VALUES ('con_cp_iron',$1,'ctc_cp_kristen','cmp_cp_iron',9100,'Lakewood install','Sales Order',false,'SIGNED','','tok_con_cp_iron_0123',now(),now())`,
    [org],
  );
  await sql(
    `INSERT INTO "ContractPayment" (id,"organizationId","contractId",label,kind,"amountCents","dueOn",position)
     VALUES ('cpm_cp_iron',$1,'con_cp_iron','Deposit','FIXED',337700,current_date - 12,0)`,
    [org],
  );
  await page.reload();
  const owes = page.locator("[data-testid=company-owes]");
  assert.equal((await owes.innerText()).trim(), "Owes $3,377 · late");
  assert.equal(await owes.getAttribute("data-late"), "1");
  const owesColor = await owes.evaluate((el) => getComputedStyle(el).color);
  const danger = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--danger)";
    document.body.appendChild(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  assert.equal(owesColor, danger, "red");
  await page.locator("[data-testid=balance-card]").waitFor();
  assert.equal(await page.locator("[data-testid=balance-owed]").getAttribute("data-cents"), "337700");
  const paperwork = page.locator("[data-testid=company-paperwork]");
  await paperwork.getByText("Lakewood install").waitFor();
  assert.match(await paperwork.innerText(), /CON-9100/);
  assert.match(await paperwork.innerText(), /1 contract across everyone here/);
  await shot(page, "06-owes");


  log("Sprint: keyboard focus is visible on the action bar, More and the rows; Escape closes the Book sheet");
  await page.goto(ironUrl);
  await page.locator("[data-testid=company-more]").focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  const ring = async () =>
    page.evaluate(() => {
      const el = document.activeElement;
      const style = getComputedStyle(el);
      return { id: el.getAttribute("data-testid"), visible: el.matches(":focus-visible"), outline: style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0, shadow: style.boxShadow !== "none" };
    });
  const focused = await ring();
  assert.equal(focused.id, "company-more");
  assert.ok(focused.visible && (focused.outline || focused.shadow), `a visible focus mark (${JSON.stringify(focused)})`);
  await page.keyboard.press("Enter");
  await page.locator("[data-testid=company-more-tray]").waitFor();
  await page.locator("[data-testid=person-row]", { hasText: "Chase Hill" }).locator("[data-testid=person-book]").focus();
  await page.keyboard.press("Enter");
  await page.locator("[data-testid=book-sheet]").waitFor();
  await until(async () => page.evaluate(() => Boolean(document.activeElement?.closest("[data-testid=book-sheet]"))), "focus in the sheet");
  await page.keyboard.press("Escape");
  await page.locator("[data-testid=book-sheet]").waitFor({ state: "detached" });

  log("Sprint: words on the new parts read at 4.5:1 or better in Dark and Light");
  for (const look of ["dark", "light"]) {
    await sql(`UPDATE "User" SET theme=$2 WHERE id=$1`, [me, look]);
    await page.goto(ironUrl);
    await page.locator("[data-testid=company-header]").waitFor();
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity));
    const checks = {
      "City · Industry": page.locator("[data-testid=company-where]"),
      "people reached": page.locator("[data-testid=company-reached]"),
      "the amber line": page.locator("[data-testid=not-linked-count]"),
      "Main contact": page.locator("[data-testid=main-contact]"),
      "Last line": page.locator("[data-testid=person-last]").first(),
      "Owes pill": page.locator("[data-testid=company-owes]"),
      "Next step": page.locator("[data-testid=company-next-step] p").first(),
      "Opportunity stage": page.locator("[data-testid=opportunity-stage]"),
    };
    for (const [what, locator] of Object.entries(checks)) {
      const ratio = await contrastOf(locator);
      assert.ok(ratio >= 4.5, `${look}: ${what} reads at ${ratio.toFixed(2)}:1`);
    }
    await shot(page, `07-${look}`);
  }
  await sql(`UPDATE "User" SET theme='dark' WHERE id=$1`, [me]);

  log("Sprint: with reduced motion nothing on the page animates or slides");
  const still = await browser.newContext({ viewport: { width: 1440, height: 950 }, reducedMotion: "reduce", storageState: await context.storageState() });
  const stillPage = await still.newPage();
  await stillPage.goto(ironUrl);
  await stillPage.locator("[data-testid=company-header]").waitFor();
  await stillPage.locator("[data-testid=not-linked-toggle]").click();
  const running = await stillPage.evaluate(() =>
    document.getAnimations().filter((a) => a.playState === "running" && (a.effect?.getTiming().iterations === Infinity || Number(a.effect?.getTiming().duration) > 1)).map((a) => a.animationName ?? a.transitionProperty ?? "?"),
  );
  assert.deepEqual(running, [], "no running animation");
  const chevron = await stillPage.locator("[data-testid=not-linked-toggle] svg").evaluate((el) => {
    const style = getComputedStyle(el);
    return style.transitionProperty === "none" || /^0s(, 0s)*$/.test(style.transitionDuration);
  });
  assert.ok(chevron, "the chevron turns without a slide");
  await still.close();

  log("Sprint: on a 390px phone: no sideways scroll, three people then Show all, five history lines, Notes folded, 44px targets, the sticky bar");
  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: await context.storageState() });
  const phone = await phoneContext.newPage();
  phone.on("pageerror", (err) => console.error("PAGE ERROR (phone):", err.message));
  await phone.goto(ironUrl);
  await phone.locator("[data-testid=company-header]").waitFor();
  const fit = await phone.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  assert.ok(fit.scroll <= fit.client, `the page is ${fit.scroll}px on a ${fit.client}px phone`);
  const shownRows = await phone.locator("[data-testid=person-row]").evaluateAll((rows) => rows.filter((row) => row.offsetParent !== null).length);
  assert.equal(shownRows, 3, "three people");
  await phone.locator("[data-testid=who-show-all]").waitFor();
  const lines = await phone.locator("#activity [data-testid=activity-line]").evaluateAll((rows) => rows.filter((row) => row.offsetParent !== null).length);
  assert.equal(lines, 5, "five history lines");
  await phone.locator("[data-testid=history-show-all]").tap();
  assert.ok((await phone.locator("#activity [data-testid=activity-line]").evaluateAll((rows) => rows.filter((row) => row.offsetParent !== null).length)) > 5);
  assert.equal(await phone.locator("#notes textarea[name=body]").isVisible(), false, "Notes folded");
  await phone.locator("[data-testid=company-notes-toggle]").tap();
  assert.ok(await phone.locator("#notes textarea[name=body]").isVisible(), "and open on a tap");
  // The order the plan gives: header, meter, Who to call, Next step, History.
  const tops = await phone.evaluate(() =>
    ["[data-testid=company-header]", "[data-testid=company-meter]", "#people", "[data-testid=company-next-step]", "#activity"].map((sel) => document.querySelector(sel).getBoundingClientRect().top),
  );
  assert.deepEqual([...tops].sort((a, b) => a - b), tops, `in plan order (${tops.map(Math.round)})`);
  const bar = phone.locator("[data-testid=company-phone-bar]");
  await bar.waitFor();
  const barBox = await bar.boundingBox();
  assert.ok(Math.abs(barBox.y + barBox.height - 844) < 2, "the bar sits on the bottom edge");
  assert.deepEqual(
    (await bar.locator("a, button").allInnerTexts()).map((text) => text.replace(/\s+/g, " ").trim()),
    ["Call main line", "Log", "Book", "⋯ More"],
  );
  const small = await phone.evaluate(() =>
    [...document.querySelectorAll("main a.btn, main button.btn, [data-testid=company-phone-bar] a, [data-testid=company-phone-bar] button, [data-testid=person-actions] a, [data-testid=person-actions] button")]
      .filter((el) => el.offsetParent !== null)
      .map((el) => ({ el: (el.getAttribute("data-testid") ?? el.textContent).trim().slice(0, 24), h: el.getBoundingClientRect().height }))
      .filter((row) => row.h < 43.5),
  );
  assert.deepEqual(small, [], "every button is at least 44px tall on a touch screen");
  const mainBox = await phone.locator("[data-testid=company-main]").boundingBox();
  assert.ok(mainBox.width > 300 && mainBox.height >= 47, `the main button is full width at 48px (${Math.round(mainBox.width)}×${Math.round(mainBox.height)})`);
  await phone.screenshot({ path: path.join(OUT, "08-phone.png"), fullPage: true });
  await bar.locator("[data-testid=phone-bar-log]").tap();
  await phone.locator("#log [data-testid=log-activity-form]").waitFor();
  await bar.locator("[data-testid=phone-bar-more]").tap();
  await phone.locator("[data-testid=company-more-tray]").waitFor();
  await phone.locator("[data-testid=company-more-tray] [data-testid=add-person]").tap();
  const panel = phone.locator("[data-testid=add-person-panel]");
  await panel.waitFor();
  const panelBox = await panel.boundingBox();
  assert.ok(panelBox.x >= 0 && panelBox.x + panelBox.width <= 390, "Add person stays on screen");
  await phone.keyboard.press("Escape");
  await bar.locator("[data-testid=phone-bar-book]").tap();
  const phoneSheet = phone.locator("[data-testid=book-sheet]");
  await phoneSheet.waitFor();
  const sheetBox = await phoneSheet.boundingBox();
  assert.ok(sheetBox.x >= 0 && sheetBox.x + sheetBox.width <= 390 && sheetBox.y + sheetBox.height <= 844, "the Book sheet fits the phone");
  await phone.screenshot({ path: path.join(OUT, "09-phone-book.png") });
  await phoneContext.close();

  console.log(`\nALL ${step} STEPS PASSED. Screenshots in ${OUT}`);
  await browser.close();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
