/* Browser regression for the AI helpers and "gone quiet" (Nov 10, 2026;
 * Taylor's CTO Think Tank, five AI items plus gone quiet).
 *
 * Covers: the "Quiet N days" badge on Pipeline tiles and in the panel, the
 * Gone quiet toggle, the day count in Settings → General; Draft a
 * follow-up (edit, Copy, Log as sent as a real touch that takes the badge
 * off); Suggest from meeting notes (a label outside the list dropped,
 * dismissed without saving, accepted then saved); a refusal shown as a
 * message; Build Quote drafting lines from the meeting with a catalog
 * item at the catalog's price, a typed "Price needed" line the save waits
 * for, and a product id that isn't a candidate left out; the contacts
 * import's duplicate flags (in the file, already on file, email updates)
 * and AI header mapping re-planning the preview with nothing saved until
 * Import; lead label rules (Vendor, Residential, Client) and the AI
 * suggestion, an unreadable answer shown as a message; the daily cap; the
 * phone width; the Nov 10 audit fixes (a saved drafted quote never drafting
 * again, the import clean-up following the importer's matching, a booked
 * meeting keeping a tile off Gone quiet, the follow-up dialog's clicks and
 * Escape staying in it, retired labels kept from the AI); and, against a
 * second server started without the key, every AI control hidden.
 *
 * Claude is never called. Start the server with
 *   ANTHROPIC_API_KEY=test-key
 *   ANTHROPIC_ENDPOINT=http://localhost:3995
 * in .env; this suite answers on :3995 as the Messages API would. For the
 * "AI off" step, start a second server WITHOUT the key, e.g.
 *   ANTHROPIC_API_KEY= npx next start -p 3105   (after next build)
 * and pass NOAI_BASE=http://localhost:3105; without it that step is
 * skipped and says so.
 *
 *   BASE=http://localhost:3104 \
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/scb_ai \
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules \
 *   node scripts/browser-tests/ai-assist.cjs
 */
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS on purpose: NODE_PATH only resolves the global playwright for require() */
const os = require("node:os");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const { Client } = require("pg");

const BASE = process.env.BASE || "http://localhost:3000";
const NOAI_BASE = process.env.NOAI_BASE || "";
const DB = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5433/scb_test";
const FAKE_PORT = Number(process.env.FAKE_CLAUDE_PORT || 3995);
const OUT = process.env.SHOTS_DIR || path.join(os.tmpdir(), "scb-browser-shots-ai-assist");
fs.mkdirSync(OUT, { recursive: true });

const EMAIL = "test-ai-assist@example.com";
const PASSWORD = "password123";
const COMPANY = "Test AI Assist Co";
const SLUG_LIKE = "test-ai-assist-co%";

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
async function until(check, what, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    if (await check()) return;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

// The stand-in Claude. Each helper's system prompt says what it is; the
// answer for each kind can be swapped by a step.
const replies = {};
const requests = [];
function kindOf(system) {
  if (/follow-up messages/.test(system)) return "FOLLOW_UP";
  if (/suggest how to file/.test(system)) return "MEETING";
  if (/draft quote lines/.test(system)) return "QUOTE";
  if (/spreadsheet columns/.test(system)) return "HEADERS";
  if (/lead label/.test(system)) return "LABEL";
  return "OTHER";
}
const json = (value) => ({ text: JSON.stringify(value), stop: "end_turn" });
const fakeClaude = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    const body = JSON.parse(raw || "{}");
    const system = typeof body.system === "string" ? body.system : JSON.stringify(body.system ?? "");
    const kind = kindOf(system);
    const prompt = body.messages?.[0]?.content ?? "";
    requests.push({ kind, prompt: typeof prompt === "string" ? prompt : JSON.stringify(prompt) });
    const reply = replies[kind] ?? { text: "{}", stop: "end_turn" };
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        id: "msg_test",
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content: [{ type: "text", text: reply.text }],
        stop_reason: reply.stop,
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
    );
  });
});
const lastRequest = (kind) => [...requests].reverse().find((row) => row.kind === kind);

(async () => {
  await new Promise((resolve) => fakeClaude.listen(FAKE_PORT, resolve));
  await sql(`DELETE FROM "Organization" WHERE slug LIKE $1`, [SLUG_LIKE]);
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
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
  await sql(`UPDATE "Organization" SET status='ACTIVE', "reviewedAt"=now() WHERE slug LIKE $1`, [SLUG_LIKE]);
  await page.goto(`${BASE}/login`);
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/dashboard$/);
  const org = (await one(`SELECT id FROM "Organization" WHERE slug LIKE $1`, [SLUG_LIKE])).id;
  const userId = (await one(`SELECT id FROM "User" WHERE email=$1`, [EMAIL])).id;

  log("seed: a quiet opportunity with meeting notes, fresh ones for the label rules, a catalog");
  await sql(
    `INSERT INTO "Company" (id,"organizationId",name,"companyTypes","updatedAt") VALUES
       ('aa_co_quiet',$1,'Quiet Builders','{}',now()),
       ('aa_co_dist',$1,'Wire Supply Inc','{Distributor}',now()),
       ('aa_co_repeat',$1,'Repeat Co','{}',now()),
       ('aa_co_myst',$1,'Mystery LLC','{}',now()),
       ('aa_co_nora',$1,'Nora Works','{}',now())`,
    [org],
  );
  await sql(
    `INSERT INTO "Contact" (id,"organizationId","companyId",name,email,mobile,status,"updatedAt") VALUES
       ('aa_pat',$1,'aa_co_quiet','Pat Quiet','pat@quietbuilders.com','(512) 555-0101','MEETING_COMPLETED',now()),
       ('aa_sam',$1,'aa_co_quiet','Sam Helper','sam@quietbuilders.com','(512) 555-0102','MEETING_COMPLETED',now()),
       ('aa_dan',$1,'aa_co_dist','Dan Distro','dan@wiresupply.com',NULL,'MEETING_SET',now()),
       ('aa_homer',$1,NULL,'Homer Owner','homer.owner@gmail.com',NULL,'MEETING_SET',now()),
       ('aa_rita',$1,'aa_co_repeat','Rita Repeat','rita@repeatco.com',NULL,'MEETING_SET',now()),
       ('aa_myra',$1,'aa_co_myst','Myra Mystery','myra@mysteryllc.com',NULL,'MEETING_SET',now()),
       ('aa_nora',$1,'aa_co_nora','Nora Null','nora@noraworks.com',NULL,'MEETING_SET',now())`,
    [org],
  );
  const notes =
    "Walked the office with Pat and Sam. They want 3 boxes of Cat6 cable run to the new wing, and wall plates. " +
    "Sam signs off on anything over $5k. We also need to pull a permit with the city. Budget around $5,000.";
  await sql(
    `INSERT INTO "Activity" (id,"organizationId","contactId","userId",type,body,"batchId","occurredAt") VALUES
       ('aa_meet_pat',$1,'aa_pat',$2,'MEETING',$3,'aa_batch',now() - interval '12 days'),
       ('aa_meet_sam',$1,'aa_sam',$2,'MEETING',$3,'aa_batch',now() - interval '12 days'),
       ('aa_mkt',$1,'aa_pat',$2,'EMAIL','Monthly newsletter',NULL,now() - interval '1 day')`,
    [org, userId, notes],
  );
  await sql(`UPDATE "Activity" SET marketing=true WHERE id='aa_mkt'`);
  await sql(
    `INSERT INTO "Deal" (id,"organizationId","contactId",title,stage,"updatedAt") VALUES ('aa_won',$1,'aa_rita','Last year''s job','WON',now())`,
    [org],
  );
  await sql(
    `INSERT INTO "Opportunity" (id,"organizationId",title,stage,"ownerId","dealId","createdAt","updatedAt") VALUES
       ('aa_opp1',$1,'Quiet Builders','MEETING_COMPLETED',$2,NULL,now() - interval '12 days',now()),
       ('aa_opp2',$1,'Wire Supply Inc','MEETING_SET',$2,NULL,now() - interval '1 day',now()),
       ('aa_opp3',$1,'Homer Owner','MEETING_SET',$2,NULL,now() - interval '1 day',now()),
       ('aa_opp4',$1,'Repeat Co','MEETING_SET',$2,NULL,now() - interval '1 day',now()),
       ('aa_opp5',$1,'Mystery LLC','MEETING_SET',$2,NULL,now() - interval '1 day',now()),
       ('aa_opp6',$1,'Nora Works','MEETING_SET',$2,NULL,now() - interval '1 day',now()),
       ('aa_oppwon',$1,'Last year','MEETING_COMPLETED',$2,'aa_won',now() - interval '300 days',now())`,
    [org, userId],
  );
  await sql(
    `INSERT INTO "OpportunityContact" (id,"opportunityId","contactId",role,"fromMeeting") VALUES
       ('aa_oc1','aa_opp1','aa_pat','PRIMARY',true), ('aa_oc2','aa_opp1','aa_sam','ASSOCIATED',true),
       ('aa_oc3','aa_opp2','aa_dan','PRIMARY',true), ('aa_oc4','aa_opp3','aa_homer','PRIMARY',true),
       ('aa_oc5','aa_opp4','aa_rita','PRIMARY',true), ('aa_oc6','aa_opp5','aa_myra','PRIMARY',true),
       ('aa_oc7','aa_opp6','aa_nora','PRIMARY',true), ('aa_oc8','aa_oppwon','aa_rita','PRIMARY',true)`,
  );
  await sql(
    `INSERT INTO "OpportunityMeeting" (id,"opportunityId","on","activityId") VALUES
       ('aa_om1','aa_opp1',now() - interval '12 days','aa_meet_pat')`,
  );
  await sql(
    `INSERT INTO "Product" (id,"organizationId",name,sku,"unitPriceCents","defaultTag","updatedAt") VALUES
       ('aa_cat6',$1,'Cat6 Cable Box 1000ft','CAT6-1000',18900,'MATERIALS',now()),
       ('aa_plate',$1,'Wall Plate 2-port','WP-2',450,'MATERIALS',now()),
       ('aa_widget',$1,'Unrelated Widget','WID-9',99900,'MATERIALS',now())`,
    [org],
  );

  const tile = (name) => page.locator("[data-testid=pipeline-tile]", { hasText: name });
  const tileId = (id) => page.locator(`[data-testid=pipeline-tile][data-id=${id}]`);
  // Since the BDR redesign (Nov 11, 2026) a quiet tile says so on its
  // next-step line ("Quiet 12d — call") and in data-quiet, the suggested
  // label shows in the panel only, and Draft follow-up sits under the
  // tile's ⋯. Pat Quiet's tile is found by its id: once Sam is its
  // Primary it is titled by him.
  const quietOf = async (locator) => locator.getAttribute("data-quiet");
  const menuItem = async (locator, testId) => {
    await locator.getByTestId("tile-more").click();
    await page.getByTestId("tile-menu").getByTestId(testId).click();
  };
  const panelFor = async (locator) => {
    await locator.getByTestId("tile-open").click();
    await page.getByTestId("opportunity-panel").getByTestId("panel-title").waitFor();
    return page.getByTestId("opportunity-panel");
  };
  const closePanel = async () => {
    await page.getByTestId("panel-close").click();
    await page.getByTestId("opportunity-panel").waitFor({ state: "detached" });
  };

  log("Pipeline: Quiet 12 days on the quiet tile (a marketing email is no touch), none on the fresh ones");
  await page.goto(`${BASE}/dashboard/deals`);
  await tileId("aa_opp1").waitFor();
  assert.equal(await quietOf(tileId("aa_opp1")), "12");
  assert.equal(await tileId("aa_opp1").getByTestId("tile-line").innerText(), "Quiet 12d — call");
  assert.equal(await quietOf(tile("Homer Owner")), null);
  await page.screenshot({ path: path.join(OUT, "01-board.png"), fullPage: true });

  log("Gone quiet toggle: only the quiet tile, in the address bar; off again shows them all");
  await page.getByTestId("pipeline-quiet-toggle").click();
  await page.waitForURL(/quiet=1/);
  await until(async () => (await page.locator("[data-testid=pipeline-tile]").count()) === 1, "one quiet tile");
  assert.equal(await tileId("aa_opp1").count(), 1);
  await page.getByTestId("pipeline-quiet-toggle").click();
  await until(async () => !page.url().includes("quiet=1"), "toggle off");
  await until(async () => (await page.locator("[data-testid=pipeline-tile]").count()) >= 6, "all tiles back");

  log("Settings → General: the day count; 15 days takes the badge off, 8 puts it back");
  await page.goto(`${BASE}/dashboard/settings/general`);
  assert.equal(await page.getByTestId("quiet-days-input").inputValue(), "8");
  await page.getByTestId("quiet-days-input").fill("15");
  await page.getByTestId("quiet-days-save").click();
  await page.getByText("Saved: quiet after 15 days").waitFor();
  assert.equal((await one(`SELECT "quietDays" FROM "Organization" WHERE id=$1`, [org])).quietDays, 15);
  await page.goto(`${BASE}/dashboard/deals`);
  await tileId("aa_opp1").waitFor();
  assert.equal(await quietOf(tileId("aa_opp1")), null);
  await page.goto(`${BASE}/dashboard/settings/general`);
  await page.getByTestId("quiet-days-form").evaluate((form) => (form.noValidate = true));
  await page.getByTestId("quiet-days-input").fill("0");
  await page.getByTestId("quiet-days-save").click();
  await page.getByText("At least 1 day").waitFor();
  assert.equal(await page.getByTestId("quiet-days-input").inputValue(), "0", "typed value kept on a refusal");
  await page.getByTestId("quiet-days-input").fill("8");
  await page.getByTestId("quiet-days-save").click();
  await page.getByText("Saved: quiet after 8 days").waitFor();

  log("Lead label rules: Vendor (Distributor), Residential (no company, gmail), Client (a won deal); nothing saved until accepted");
  await page.goto(`${BASE}/dashboard/deals`);
  await tile("Dan Distro").waitFor();
  assert.equal(await page.locator("[data-testid=pipeline-tile] [data-testid=suggested-label]").count(), 0, "suggestions show in the panel only");
  let opened = await panelFor(tile("Homer Owner"));
  assert.equal(await opened.locator("[data-testid=suggested-label]").getAttribute("data-label"), "Residential");
  await opened.getByTestId("suggested-label-dismiss").click();
  assert.equal(await opened.locator("[data-testid=suggested-label]").count(), 0);
  await closePanel();
  assert.equal((await one(`SELECT "leadLabel" FROM "Opportunity" WHERE id='aa_opp3'`)).leadLabel, null);
  opened = await panelFor(tileId("aa_opp4"));
  assert.equal(await opened.locator("[data-testid=suggested-label]").getAttribute("data-label"), "Client");
  await closePanel();
  opened = await panelFor(tile("Myra Mystery"));
  assert.equal(await opened.locator("[data-testid=suggested-label]").count(), 0, "rules say nothing");
  await closePanel();
  opened = await panelFor(tile("Dan Distro"));
  assert.equal(await opened.locator("[data-testid=suggested-label]").getAttribute("data-label"), "Vendor");
  assert.equal((await one(`SELECT "leadLabel" FROM "Opportunity" WHERE id='aa_opp2'`)).leadLabel, null);
  await opened.getByTestId("suggested-label-accept").click();
  await opened.getByTestId("panel-save").click();
  await opened.waitFor({ state: "detached" });
  await until(async () => (await one(`SELECT "leadLabel" FROM "Opportunity" WHERE id='aa_opp2'`)).leadLabel === "Vendor", "Vendor saved");

  log("AI lead label: an unreadable answer is a message; then Reseller suggested and accepted");
  replies.LABEL = { text: "this is not json", stop: "end_turn" };
  opened = await panelFor(tile("Myra Mystery"));
  await opened.getByTestId("suggest-label").click();
  await opened.getByTestId("suggest-label-error").getByText("unreadable").waitFor();
  replies.LABEL = json({ leadLabel: "reseller", reason: "They resell systems" });
  await opened.getByTestId("suggest-label").click();
  await opened.locator("[data-testid=suggested-label][data-label=Reseller]").waitFor();
  assert.match(lastRequest("LABEL").prompt, /Allowed labels: Residential, Client, Vendor/);
  assert.equal((await one(`SELECT "leadLabel" FROM "Opportunity" WHERE id='aa_opp5'`)).leadLabel, null, "not saved yet");
  await opened.getByTestId("suggested-label-accept").click();
  await opened.getByTestId("panel-save").click();
  await opened.waitFor({ state: "detached" });
  await until(async () => (await one(`SELECT "leadLabel" FROM "Opportunity" WHERE id='aa_opp5'`)).leadLabel === "Reseller", "Reseller saved");

  log("the daily allowance: a used-up kind says so and asks Claude nothing");
  await sql(
    `INSERT INTO "AiRequest" (id,"organizationId",kind,"createdAt") SELECT 'aa_cap_' || g, $1, 'LEAD_LABEL', now() - interval '1 hour' FROM generate_series(1,200) g`,
    [org],
  );
  const before = requests.length;
  const rowsBefore = (await one(`SELECT count(*)::int n FROM "AiRequest" WHERE "organizationId"=$1 AND kind='LEAD_LABEL'`, [org])).n;
  opened = await panelFor(tile("Nora Null"));
  await opened.getByTestId("suggest-label").click();
  await opened.getByTestId("suggest-label-error").getByText("allowance for this is used up").waitFor();
  await closePanel();
  assert.equal(requests.length, before);
  assert.equal((await one(`SELECT count(*)::int n FROM "AiRequest" WHERE "organizationId"=$1 AND kind='LEAD_LABEL'`, [org])).n, rowsBefore, "the refused one is taken back");

  log("Draft a follow-up: text and email from the meeting notes, edited and copied");
  replies.FOLLOW_UP = json({
    text: "Hi Pat, checking in on the Cat6 run for the new wing. Want me to send a quote?",
    emailSubject: "Cat6 for the new wing",
    emailBody: "Hi Pat,\n\nFollowing up on our walk-through. Happy to put the quote together for the Cat6 run and the permit.\n\nThanks",
  });
  await menuItem(tileId("aa_opp1"), "follow-up-draft");
  const dialog = page.getByTestId("follow-up-dialog");
  await dialog.getByTestId("follow-up-text").waitFor();
  assert.match(await dialog.getByTestId("follow-up-text").inputValue(), /Cat6 run/);
  assert.equal(await dialog.getByTestId("follow-up-subject").inputValue(), "Cat6 for the new wing");
  assert.match(lastRequest("FOLLOW_UP").prompt, /pull a permit/, "the meeting notes went in");
  assert.match(lastRequest("FOLLOW_UP").prompt, /To: Pat Quiet/);
  await dialog.getByTestId("follow-up-text").fill("Hi Pat, it's Taylor. Still want the Cat6 run done this month?");
  await dialog.getByTestId("follow-up-copy-text").click();
  await dialog.getByTestId("follow-up-notice").getByText("Text copied").waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "Hi Pat, it's Taylor. Still want the Cat6 run done this month?");
  await dialog.getByTestId("follow-up-copy-email").click();
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /^Cat6 for the new wing\n\nHi Pat,/);
  assert.equal((await one(`SELECT count(*)::int n FROM "Activity" WHERE "contactId"='aa_pat' AND type IN ('TEXT','EMAIL') AND marketing=false`)).n, 0, "nothing logged yet");

  log("Log as sent: a one-to-one TEXT on Pat with the edited words, on the calendar; the tile stops being quiet");
  await dialog.getByTestId("follow-up-log-text").click();
  await dialog.getByTestId("follow-up-notice").getByText("Logged as a text to Pat Quiet").waitFor();
  const logged = await one(`SELECT id, body, marketing, "userId" FROM "Activity" WHERE "contactId"='aa_pat' AND type='TEXT'`);
  assert.equal(logged.body, "Hi Pat, it's Taylor. Still want the Cat6 run done this month?");
  assert.equal(logged.marketing, false);
  assert.equal((await one(`SELECT count(*)::int n FROM "CalendarEvent" WHERE "activityId"=$1`, [logged.id])).n, 1);
  // Logging refreshes the board, and a tile that stops being quiet loses its
  // Draft button and the dialog with it; close it if it is still there.
  await dialog.getByTestId("follow-up-close").click({ timeout: 3000 }).catch(() => {});
  await dialog.waitFor({ state: "detached" });
  await page.goto(`${BASE}/dashboard/deals`);
  await tileId("aa_opp1").waitFor();
  assert.equal(await quietOf(tileId("aa_opp1")), null, "a logged text is a touch");
  assert.notEqual(await tileId("aa_opp1").getByTestId("tile-line").getAttribute("data-key"), "quiet");

  log("Suggest from meeting notes: a label outside the list is dropped; dismissed and cancelled, nothing saved");
  replies.MEETING = json({
    primaryContactId: "aa_sam",
    primaryReason: "Sam signs off on anything over $5k",
    leadLabel: "Big Fish",
    leadLabelReason: "made up",
    estimatedValueDollars: 5000,
    valueReason: "Budget around $5,000",
    nextStep: "Send the quote and book the permit",
  });
  await tileId("aa_opp1").getByTestId("tile-open").click();
  const panel = page.getByTestId("opportunity-panel");
  await panel.getByTestId("panel-title").waitFor();
  await panel.getByTestId("meeting-suggest-ask").click();
  await panel.locator("[data-testid=meeting-chip][data-kind=primary]").waitFor();
  assert.equal(await panel.locator("[data-testid=meeting-chip][data-kind=label]").count(), 0, "Big Fish isn't a label here");
  assert.match(await panel.locator("[data-testid=meeting-chip][data-kind=value]").innerText(), /\$5,000\.00[\s\S]*Use it when you convert/);
  assert.equal(await panel.locator("[data-testid=meeting-chip][data-kind=value] [data-testid=meeting-chip-accept]").count(), 0);
  assert.match(await panel.getByTestId("meeting-next-step").innerText(), /book the permit/);
  assert.match(lastRequest("MEETING").prompt, /aa_sam: Sam Helper/);
  await panel.getByTestId("meeting-dismiss-all").click();
  assert.equal(await panel.locator("[data-testid=meeting-chip]").count(), 0);
  await panel.getByTestId("panel-cancel").click();
  await panel.waitFor({ state: "detached" });
  assert.equal((await one(`SELECT role FROM "OpportunityContact" WHERE id='aa_oc1'`)).role, "PRIMARY");

  log("Suggest from meeting notes accepted: Sam made Primary and the label Client, saved only on Save");
  replies.MEETING = json({
    primaryContactId: "aa_sam",
    primaryReason: "Sam signs off on anything over $5k",
    leadLabel: "client",
    leadLabelReason: "A business customer",
    estimatedValueDollars: 5000,
    valueReason: "Budget around $5,000",
    nextStep: null,
  });
  await tileId("aa_opp1").getByTestId("tile-open").click();
  await panel.getByTestId("meeting-suggest-ask").click();
  await panel.locator("[data-testid=meeting-chip][data-kind=primary] [data-testid=meeting-chip-accept]").click();
  await panel.locator("[data-testid=meeting-chip][data-kind=label] [data-testid=meeting-chip-accept]").click();
  assert.equal(await panel.locator("[data-testid=panel-person][data-name='Sam Helper'] [data-testid=role-PRIMARY]").isChecked(), true);
  assert.equal(await panel.locator("[data-testid=panel-person][data-name='Pat Quiet'] [data-testid=role-ASSOCIATED]").isChecked(), true);
  assert.equal((await one(`SELECT role FROM "OpportunityContact" WHERE id='aa_oc2'`)).role, "ASSOCIATED", "not saved yet");
  await panel.getByTestId("panel-save").click();
  await panel.waitFor({ state: "detached" });
  await until(async () => (await one(`SELECT role FROM "OpportunityContact" WHERE id='aa_oc2'`)).role === "PRIMARY", "Sam primary");
  assert.equal((await one(`SELECT role FROM "OpportunityContact" WHERE id='aa_oc1'`)).role, "ASSOCIATED");
  assert.equal((await one(`SELECT "leadLabel" FROM "Opportunity" WHERE id='aa_opp1'`)).leadLabel, "Client");

  log("a refusal is a message, not a dead panel");
  replies.MEETING = { text: "", stop: "refusal" };
  await tileId("aa_opp1").getByTestId("tile-open").click();
  await panel.getByTestId("meeting-suggest-ask").click();
  await panel.getByTestId("meeting-suggest-error").getByText("declined").waitFor();
  await panel.getByTestId("panel-close").click();

  log("Build Quote with 'Draft lines from the meeting': catalog line at the catalog price, a typed Price needed line, a non-candidate id left out");
  replies.QUOTE = json({
    lines: [
      { productId: "aa_cat6", name: "", quantity: 3, tag: "MATERIALS", note: "3 boxes of Cat6" },
      { productId: null, name: "Pull permit", quantity: 1, tag: "PROJECT_SERVICES", note: "City permit" },
      { productId: "aa_widget", name: "", quantity: 1, tag: "MATERIALS", note: "forged" },
    ],
  });
  await tileId("aa_opp1").getByTestId("tile-more").click();
  await page.locator("[data-testid=tile-move-menu] [data-testid=tile-move-QUOTE_SENT]").click();
  const convert = page.getByTestId("convert-dialog");
  await convert.getByTestId("convert-mode-quote").check();
  assert.equal(await convert.getByTestId("convert-draft-lines").isChecked(), true);
  await convert.getByTestId("convert-save").click();
  // Build Quote starts the quote itself, titled after the deal, and opens
  // it drafting (paperwork sprint: no setup form in between).
  await page.waitForURL(/\/dashboard\/quotes\/(?!new)[^/?]+/);
  await page.getByTestId("quote-draft-info").waitFor();
  assert.match(await page.getByTestId("quote-draft-info").innerText(), /Added 2 lines[\s\S]*1 needs a price[\s\S]*1 line named a product not in your catalog/);
  assert.ok(!page.url().includes("draft=meeting"), "a reload won't ask again");
  const quotePrompt = lastRequest("QUOTE").prompt;
  assert.match(quotePrompt, /aa_cat6 \| Cat6 Cable Box 1000ft \| SKU CAT6-1000 \| \$189\.00/);
  assert.match(quotePrompt, /aa_plate/, "wall plates are a candidate too");
  assert.doesNotMatch(quotePrompt, /aa_widget/, "only candidates are shown");
  const quoteId = page.url().split("/").pop().split("?")[0];
  assert.equal((await one(`SELECT count(*)::int n FROM "QuoteLineItem" WHERE "quoteId"=$1`, [quoteId])).n, 0, "nothing saved yet");
  assert.equal(await page.locator("input[aria-label='Line 1 unit value']").inputValue(), "189.00");
  assert.equal(await page.locator("input[aria-label='Line 1 quantity']").inputValue(), "3");
  assert.equal(await page.getByTestId("line-price-needed").count(), 1);
  await page.getByTestId("quote-save").click();
  await page.getByText("Line 2 needs a price").waitFor();
  await page.locator("input[aria-label='Line 2 unit value']").fill("150");
  assert.equal(await page.getByTestId("line-price-needed").count(), 0);
  await page.getByTestId("quote-save").click();
  await until(async () => (await one(`SELECT count(*)::int n FROM "QuoteLineItem" WHERE "quoteId"=$1`, [quoteId])).n === 2, "lines saved");
  const lines = (await sql(`SELECT name, "productId", quantity, "unitPriceCents", "projectNotes" FROM "QuoteLineItem" WHERE "quoteId"=$1 ORDER BY position`, [quoteId])).rows;
  assert.deepEqual(lines.map((line) => [line.name, line.productId, line.quantity, line.unitPriceCents]), [
    ["Cat6 Cable Box 1000ft", "aa_cat6", 3, 18900],
    ["Pull permit", null, 1, 15000],
  ]);
  assert.ok(lines.every((line) => line.projectNotes === ""), "the AI's reasons never reach the customer's copy");
  assert.equal((await one(`SELECT status FROM "Quote" WHERE id=$1`, [quoteId])).status, "DRAFT");

  log("Draft lines from the meeting again on the draft: a forged answer adds nothing");
  replies.QUOTE = json({ lines: [{ productId: "not-a-product", name: "", quantity: 2, tag: "MATERIALS", note: "x" }] });
  await page.getByTestId("quote-draft-meeting").click();
  await page.getByTestId("quote-draft-info").getByText("Nothing in the notes to add. 1 line named a product not in your catalog").waitFor();
  assert.match(lastRequest("QUOTE").prompt, /Already on it: 3 × Cat6 Cable Box 1000ft; 1 × Pull permit/);

  log("audit fixes: after the drafted quote is saved the address stays clean, and coming back never drafts again");
  const quoteAsks = () => requests.filter((row) => row.kind === "QUOTE").length;
  const asked = quoteAsks();
  await page.locator("input[aria-label='Line 1 quantity']").fill("4");
  await page.getByTestId("quote-save").click();
  await until(async () => (await one(`SELECT quantity FROM "QuoteLineItem" WHERE "quoteId"=$1 AND "productId"='aa_cat6'`, [quoteId])).quantity === 4, "saved again");
  await page.waitForTimeout(600);
  assert.ok(!page.url().includes("draft=meeting"), "a save doesn't put ?draft=meeting back in the address bar");
  await page.reload();
  await page.getByTestId("quote-draft-meeting").waitFor();
  await page.waitForTimeout(800);
  await page.goto(`${BASE}/dashboard/quotes/${quoteId}?draft=meeting`);
  await page.getByTestId("quote-draft-meeting").waitFor();
  await page.waitForTimeout(800);
  assert.equal(quoteAsks(), asked, "neither a reload nor the old address asks again once the quote has lines");
  assert.equal((await one(`SELECT count(*)::int n FROM "QuoteLineItem" WHERE "quoteId"=$1`, [quoteId])).n, 2);

  log("Import CSV: duplicates flagged in the file and against contacts on file; nothing saved");
  const csv = [
    "Name,Email,Mobile,Company Name,Role Held,Hometown Code",
    "Pat Quiet,pat@quietbuilders.com,,Quiet Builders,Owner,A1",
    "Dana Dup,dana@else.com,512-555-0102,Else Inc,Buyer,B2",
    "Lee Twin,lee1@twin.com,,Twin Co,Manager,C3",
    "Lee Twin,lee2@twin.com,,Twin Co,Manager,C3",
    "Kim Phone,kim@phone.com,(737) 555-0199,Phone Co,Tech,D4",
    "Kip Phone,kip@phone.com,737.555.0199,Phone Co,Tech,D4",
  ].join("\n");
  const csvPath = path.join(OUT, "ai-import.csv");
  fs.writeFileSync(csvPath, csv);
  const contactsBefore = (await one(`SELECT count(*)::int n FROM "Contact" WHERE "organizationId"=$1`, [org])).n;
  await page.goto(`${BASE}/dashboard/contacts`);
  await cleanUp(page, "import");
  await page.getByTestId("import-file").setInputFiles(csvPath);
  const cleanup = page.getByTestId("import-cleanup");
  await cleanup.waitFor();
  await until(async () => (await cleanup.getByTestId("import-dup-existing-count").count()) === 1, "existing check");
  assert.equal(await cleanup.getByTestId("import-dup-file-count").innerText(), "2");
  assert.equal(await cleanup.getByTestId("import-dup-existing-count").innerText(), "1");
  const dupList = await cleanup.getByTestId("import-dup-list").innerText();
  assert.match(dupList, /Lee Twin — same name at the same company/);
  assert.match(dupList, /Kim Phone \/ Kip Phone — same phone number/);
  assert.match(dupList, /looks like Sam Helper — same phone number/);
  assert.match(await cleanup.getByTestId("import-dup-updates").innerText(), /1 row matches a contact already on file/);
  assert.match(await page.getByTestId("import-unused").innerText(), /"Role Held", "Hometown Code"/);

  log("AI header mapping: Role Held → Title (a made-up field dropped); accepting re-plans the preview, Import saves it");
  replies.HEADERS = json({
    mappings: [
      { index: 4, field: "title", reason: "Owner, Buyer, Manager are job titles" },
      { index: 5, field: "favoriteColor", reason: "made up" },
    ],
  });
  await cleanup.getByTestId("import-suggest-headers").click();
  await cleanup.locator("[data-testid=import-header-suggestion][data-header='Role Held']").waitFor();
  assert.equal(await cleanup.getByTestId("import-header-suggestion").count(), 1);
  assert.match(lastRequest("HEADERS").prompt, /4: "Role Held" e\.g\. "Owner", "Buyer", "Manager"/);
  assert.doesNotMatch(lastRequest("HEADERS").prompt, /name: Name;/, "fields already matched aren't offered");
  await cleanup.getByTestId("import-apply-headers").click();
  await until(async () => !/Role Held/.test(await page.getByTestId("import-unused").innerText()), "re-planned");
  await page.getByText(/Title ← "Role Held"/).waitFor();
  assert.equal((await one(`SELECT count(*)::int n FROM "Contact" WHERE "organizationId"=$1`, [org])).n, contactsBefore, "nothing saved before Import");
  await page.getByTestId("import-start").click();
  await page.getByTestId("import-done").waitFor();
  assert.equal((await one(`SELECT title FROM "Contact" WHERE "organizationId"=$1 AND email='dana@else.com'`, [org])).title, "Buyer");

  // ---------------------------------------------------------------------
  // Audit fixes (Nov 10, 2026): one step per confirmed defect.
  log("audit fixes: the import clean-up says what the import will do (name at the company updates; a second email doesn't)");
  await sql(`UPDATE "Contact" SET email2='sammy@gmail.com' WHERE id='aa_sam'`);
  const csv2 = ["Name,Email,Mobile,Company Name", "Sam Helper,,,Quiet Builders", "Sammy G,sammy@gmail.com,,Other Co"].join("\n");
  const csv2Path = path.join(OUT, "ai-import-2.csv");
  fs.writeFileSync(csv2Path, csv2);
  await page.goto(`${BASE}/dashboard/contacts`);
  await cleanUp(page, "import");
  await page.getByTestId("import-file").setInputFiles(csv2Path);
  await cleanup.waitFor();
  await until(async () => (await cleanup.getByTestId("import-dup-updates").count()) === 1, "existing check");
  assert.match(await cleanup.getByTestId("import-dup-updates").innerText(), /^1 row matches a contact already on file/);
  const dupList2 = await cleanup.getByTestId("import-dup-list").innerText();
  assert.match(dupList2, /looks like Sam Helper — same email as their second email\. It would be added as a second contact\./);
  assert.doesNotMatch(dupList2, /same name at the same company/, "the importer updates that one; it isn't a second contact");

  log("audit fixes: a meeting booked ahead keeps an old opportunity off Gone quiet");
  await sql(
    `INSERT INTO "Contact" (id,"organizationId",name,email,status,"updatedAt") VALUES
       ('aa_bea',$1,'Bea Booked','bea@booked.example.com','MEETING_SET',now()),
       ('aa_quinn',$1,'Quinn Quiet','quinn@quiet.example.com','MEETING_SET',now()),
       ('aa_lou',$1,'Lou Label','lou@loulabs.example.com','MEETING_SET',now())`,
    [org],
  );
  await sql(
    `INSERT INTO "Opportunity" (id,"organizationId",title,stage,"ownerId","createdAt","updatedAt") VALUES
       ('aa_oppbook',$1,'Bea Booked','MEETING_SET',$2,now() - interval '20 days',now()),
       ('aa_oppq',$1,'Quinn Quiet','MEETING_SET',$2,now() - interval '20 days',now()),
       ('aa_opplou',$1,'Lou Label','MEETING_SET',$2,now(),now())`,
    [org, userId],
  );
  await sql(
    `INSERT INTO "OpportunityContact" (id,"opportunityId","contactId",role,"fromMeeting") VALUES
       ('aa_ocb','aa_oppbook','aa_bea','PRIMARY',true), ('aa_ocq','aa_oppq','aa_quinn','PRIMARY',true), ('aa_ocl','aa_opplou','aa_lou','PRIMARY',true)`,
  );
  await sql(`INSERT INTO "OpportunityMeeting" (id,"opportunityId","on") VALUES ('aa_ombook','aa_oppbook',now() + interval '5 days')`);
  await page.goto(`${BASE}/dashboard/deals`);
  await tile("Quinn Quiet").waitFor();
  assert.ok(Number(await quietOf(tile("Quinn Quiet"))) >= 8, "Quinn is quiet");
  assert.equal(await quietOf(tile("Bea Booked")), null, "the next meeting is already booked");
  await page.goto(`${BASE}/dashboard/deals?quiet=1`);
  await tile("Quinn Quiet").waitFor();
  assert.equal(await tile("Bea Booked").count(), 0);

  log("audit fixes: clicks inside the follow-up dialog stay in it; the tile's panel doesn't open underneath");
  replies.FOLLOW_UP = json({ text: "Hi Quinn, checking in.", emailSubject: "Checking in", emailBody: "Hi Quinn,\n\nChecking in.\n\nThanks" });
  await page.goto(`${BASE}/dashboard/deals`);
  await menuItem(tile("Quinn Quiet"), "follow-up-draft");
  await dialog.getByTestId("follow-up-text").waitFor();
  await dialog.getByTestId("follow-up-text").click();
  await dialog.locator("h2").click();
  await page.waitForTimeout(400);
  assert.equal(await page.getByTestId("opportunity-panel").count(), 0, "typing in the dialog opens nothing");
  await page.mouse.click(8, 8);
  await dialog.waitFor({ state: "detached" });
  await page.waitForTimeout(400);
  assert.equal(await page.getByTestId("opportunity-panel").count(), 0, "dismissing by the backdrop opens nothing");

  log("audit fixes: Escape closes the follow-up dialog only, not the panel it came from");
  await tile("Quinn Quiet").getByTestId("tile-open").click();
  await panel.getByTestId("panel-title").waitFor();
  await panel.getByTestId("follow-up-draft").click();
  await dialog.getByTestId("follow-up-text").waitFor();
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  await page.waitForTimeout(300);
  assert.equal(await panel.count(), 1, "the panel and its unsaved edits stay");
  await page.keyboard.press("Escape");
  await panel.waitFor({ state: "detached" });

  log("Sprint: Log as sent hands back Undo, and Undo takes the text off Quinn's history");
  await menuItem(tile("Quinn Quiet"), "follow-up-draft");
  await dialog.getByTestId("follow-up-text").waitFor();
  await dialog.getByTestId("follow-up-log-text").click();
  await dialog.getByTestId("follow-up-notice").getByText("Logged as a text to Quinn Quiet").waitFor();
  assert.equal((await one(`SELECT count(*)::int n FROM "Activity" WHERE "contactId"='aa_quinn' AND type='TEXT'`)).n, 1);
  await dialog.getByTestId("follow-up-undo").click();
  await dialog.getByTestId("follow-up-notice").getByText("Undone").waitFor();
  assert.equal((await one(`SELECT count(*)::int n FROM "Activity" WHERE "contactId"='aa_quinn' AND type='TEXT'`)).n, 0);
  await dialog.getByTestId("follow-up-close").click();
  await dialog.waitFor({ state: "detached" });

  log("audit fixes: AI lead-label suggestions never offer a retired label");
  await sql(`DELETE FROM "AiRequest" WHERE id LIKE 'aa_cap_%'`);
  await sql(`INSERT INTO "LeadLabelOption" (id,"organizationId",name,"retiredAt") VALUES ('aa_lbl_old',$1,'Old Custom',now()), ('aa_lbl_live',$1,'Live Custom',NULL)`, [org]);
  replies.LABEL = json({ leadLabel: "Old Custom", reason: "Retired, but it fits" });
  await page.goto(`${BASE}/dashboard/deals`);
  opened = await panelFor(tile("Lou Label"));
  await opened.getByTestId("suggest-label").click();
  await until(async () => requests.length > 0 && lastRequest("LABEL").prompt.includes("Live Custom"), "asked");
  assert.doesNotMatch(lastRequest("LABEL").prompt, /Old Custom/, "a retired label isn't offered to the AI");
  await page.waitForTimeout(600);
  assert.equal(await opened.locator("[data-testid=suggested-label][data-label='Old Custom']").count(), 0, "nor shown");
  await closePanel();
  assert.equal((await one(`SELECT "leadLabel" FROM "Opportunity" WHERE id='aa_opplou'`)).leadLabel, null);

  log("phone width: the board scrolls inside itself and the follow-up dialog fits");
  await sql(`UPDATE "Opportunity" SET "createdAt"=now() - interval '30 days' WHERE id='aa_opp6'`);
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const phonePage = await phone.newPage();
  await phonePage.goto(`${BASE}/login`);
  await phonePage.fill("#email", EMAIL);
  await phonePage.fill("#password", PASSWORD);
  await phonePage.click("button[type=submit]");
  await phonePage.waitForURL(/\/dashboard$/);
  replies.FOLLOW_UP = json({ text: "Hi Nora, checking in.", emailSubject: "Checking in", emailBody: "Hi Nora,\n\nChecking in.\n\nThanks" });
  await phonePage.goto(`${BASE}/dashboard/deals`);
  const noraTile = phonePage.locator("[data-testid=pipeline-tile]", { hasText: "Nora Null" });
  await noraTile.waitFor();
  assert.ok(Number(await noraTile.getAttribute("data-quiet")) > 0, "Nora is quiet");
  assert.ok((await phonePage.evaluate(() => document.documentElement.scrollWidth)) <= 390, "no page-wide sideways scroll");
  await noraTile.getByTestId("tile-more").scrollIntoViewIfNeeded();
  await noraTile.getByTestId("tile-more").click();
  await phonePage.getByTestId("tile-menu").getByTestId("follow-up-draft").click();
  await phonePage.getByTestId("follow-up-text").waitFor();
  const box = await phonePage.getByTestId("follow-up-dialog").boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 390, `dialog inside the screen (${box.x}, ${box.width})`);
  await phonePage.screenshot({ path: path.join(OUT, "02-phone-follow-up.png") });
  await phone.close();

  if (NOAI_BASE) {
    log("AI off (a server without ANTHROPIC_API_KEY): every AI control is hidden, the quiet badge stays");
    const off = await browser.newContext({ viewport: { width: 1500, height: 950 } });
    const offPage = await off.newPage();
    await offPage.goto(`${NOAI_BASE}/login`);
    await offPage.fill("#email", EMAIL);
    await offPage.fill("#password", PASSWORD);
    await offPage.click("button[type=submit]");
    await offPage.waitForURL(/\/dashboard$/);
    await offPage.goto(`${NOAI_BASE}/dashboard/deals`);
    const offNora = offPage.locator("[data-testid=pipeline-tile]", { hasText: "Nora Null" });
    await offNora.waitFor();
    assert.ok(Number(await offNora.getAttribute("data-quiet")) > 0, "the quiet line stays");
    await offNora.getByTestId("tile-more").click();
    await offPage.getByTestId("tile-menu").getByTestId("tile-menu-open").waitFor();
    assert.equal(await offPage.locator("[data-testid=follow-up-draft]").count(), 0);
    await offPage.keyboard.press("Escape");
    await offPage.locator("[data-testid=pipeline-tile]", { hasText: "Homer Owner" }).getByTestId("tile-open").click();
    await offPage.getByTestId("panel-title").waitFor();
    assert.equal(await offPage.locator("[data-testid=suggest-label]").count(), 0);
    assert.ok((await offPage.locator("[data-testid=suggested-label]").count()) >= 1, "the rules' chips need no AI");
    await offPage.getByTestId("panel-close").click();
    await offNora.getByTestId("tile-open").click();
    await offPage.getByTestId("panel-title").waitFor();
    assert.equal(await offPage.locator("[data-testid=meeting-suggest]").count(), 0);
    assert.equal(await offPage.locator("[data-testid=follow-up-draft]").count(), 0);
    await offPage.goto(`${NOAI_BASE}/dashboard/quotes/${quoteId}`);
    await offPage.locator("input[aria-label='Line 1 quantity']").waitFor();
    assert.equal(await offPage.locator("[data-testid=quote-draft-meeting]").count(), 0);
    await offPage.goto(`${NOAI_BASE}/dashboard/contacts`);
    await cleanUp(offPage, "import");
    await offPage.getByTestId("import-file").setInputFiles(csvPath);
    await offPage.getByTestId("import-cleanup").waitFor();
    await offPage.getByTestId("import-dup-file-count").waitFor();
    await offPage.waitForTimeout(800);
    assert.equal(await offPage.locator("[data-testid=import-suggest-headers]").count(), 0, "no AI header button");
    await off.close();
  } else {
    log("AI off: SKIPPED — pass NOAI_BASE (a second server with no ANTHROPIC_API_KEY) to run it");
  }

  await browser.close();
  fakeClaude.close();
  console.log(`\nAll ${step} steps passed.`);
})().catch((error) => {
  console.error(error);
  fakeClaude.close();
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
