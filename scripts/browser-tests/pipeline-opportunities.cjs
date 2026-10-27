/* Browser regression for the Pipeline as opportunities (Oct 27, 2026).
 *
 * Taylor's rules: a meeting with several people is one tile with all of
 * them on it; a later meeting with any of them joins it while it is open;
 * Won or Lost closes it and the next meeting starts a new one. Click a
 * tile to edit it: Primary POC / Associated POC / Do Not List, one box
 * each (the other two grey out), one Primary, + Add contact — none of it
 * touching the meeting's own log. "Opportunity Created" (Meeting
 * Completed) and "Deal Created" (Quote Sent or further) land once on each
 * Primary and Associated person's log, tagged with their role and the
 * deal's stage as they are now. Meeting Set ↔ Meeting Completed moves with
 * no prompt; into Quote Sent or further asks "convert this to a deal?"
 * (Quote / Contract / Signed / Won / Lost, then Build Quote or Manual
 * Input, then Save and Accept); a deal never goes back to a meeting. Lead
 * Labels (N/A gray with red letters, five built-ins, custom in neon
 * yellow), search and the Lead Label filter, the menus staying on screen,
 * the scrollbar on top, and nobody disappearing when a status is moved by
 * hand.
 *
 * Runs against a built app (`npm run build:app && npx next start`) and a
 * local Postgres that has had `prisma migrate deploy` run against it. It
 * signs up its own workspace and deletes it on the next run. Never point
 * it at the live database.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/scb_test \
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules \
 *   node scripts/browser-tests/pipeline-opportunities.cjs
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
const OUT = process.env.SHOTS_DIR || path.join(os.tmpdir(), "scb-browser-shots-opportunities");
fs.mkdirSync(OUT, { recursive: true });

const EMAIL = "test-opps@example.com";
const PASSWORD = "password123";
const COMPANY = "Test Opportunities Co";
const SLUG = "test-opportunities-co";

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
async function until(check, what, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`timed out waiting for ${what}`);
}
const one = async (text, params) => (await sql(text, params)).rows[0];

(async () => {
  await sql(`DELETE FROM "Organization" WHERE slug LIKE '${SLUG}%'`);

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (err) => console.error("PAGE ERROR:", err.message));

  log("signup + activate + login; Pat and Nic at Murphy Business, Zoe and Abby elsewhere");
  await page.goto(`${BASE}/signup`);
  await page.fill("[name=companyName]", COMPANY);
  await page.fill("[name=name]", "Taylor Test");
  await page.fill("[name=email]", EMAIL);
  await page.fill("[name=phone]", "5550000000");
  await page.fill("[name=password]", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/signup\/submitted/);
  await sql(`UPDATE "Organization" SET status='ACTIVE', "reviewedAt"=now() WHERE slug LIKE '${SLUG}%'`);
  await page.goto(`${BASE}/login`);
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/dashboard$/);
  const org = (await one(`SELECT id FROM "Organization" WHERE slug LIKE '${SLUG}%'`)).id;
  await sql(
    `INSERT INTO "Company" (id,"organizationId",name,"updatedAt") VALUES ('op_murphy',$1,'Murphy Business',now()), ('op_zco',$1,'Zoe Holdings',now())`,
    [org],
  );
  await sql(
    `INSERT INTO "Contact" (id,"organizationId","companyId",name,email,"updatedAt") VALUES
       ('op_pat',$1,'op_murphy','Pat Steffl','pat@murphy.test',now()),
       ('op_nic',$1,'op_murphy','Nic Partner','nic@murphy.test',now()),
       ('op_zoe',$1,'op_zco','Zoe Extra','zoe@zoe.test',now()),
       ('op_abby',$1,NULL,'Abby Peters','abby@home.test',now()),
       ('op_lone',$1,NULL,'Lone Ranger','lone@home.test',now())`,
    [org],
  );
  const opps = async () =>
    (await sql(`SELECT id, stage, "dealId", "leadLabel" FROM "Opportunity" WHERE "organizationId"=$1 ORDER BY "createdAt"`, [org])).rows;
  const people = async (opp) =>
    (await sql(`SELECT "contactId", role, "fromMeeting" FROM "OpportunityContact" WHERE "opportunityId"=$1 ORDER BY "contactId"`, [opp])).rows;
  const logs = async (opp) =>
    (await sql(`SELECT "contactId", kind FROM "OpportunityLog" WHERE "opportunityId"=$1 ORDER BY "contactId", kind`, [opp])).rows.map(
      (row) => `${row.contactId}:${row.kind}`,
    ).sort();

  log("a meeting logged with Pat and Nic is one opportunity: Pat Primary, Nic Associated, one meeting");
  await page.goto(`${BASE}/dashboard/contacts/op_pat`);
  const form = page.locator("[data-testid=log-activity-form]");
  await form.getByRole("button", { name: "Meeting", exact: true }).click();
  await form.locator("textarea[name=body]").fill("Kickoff at Murphy");
  await form.getByRole("button", { name: "+ Include multiple contacts" }).click();
  await page.getByRole("dialog").getByPlaceholder("Search contacts…").fill("Nic Partner");
  await page.getByRole("dialog").locator("input[type=checkbox]").first().check();
  await page.getByRole("dialog").getByRole("button", { name: "Done" }).click();
  await form.locator("[data-testid=activity-submit]").click();
  await page.locator("#activity").getByText("Kickoff at Murphy").waitFor();
  await until(async () => (await opps()).length === 1, "one opportunity");
  const patOpp = (await opps())[0].id;
  assert.deepEqual(await people(patOpp), [
    { contactId: "op_nic", role: "ASSOCIATED", fromMeeting: true },
    { contactId: "op_pat", role: "PRIMARY", fromMeeting: true },
  ]);
  assert.equal((await one(`SELECT count(*)::int n FROM "OpportunityMeeting" WHERE "opportunityId"=$1`, [patOpp])).n, 1);
  assert.deepEqual(await logs(patOpp), [], "Meeting Set writes no special lines yet");

  log("a second meeting with Pat joins it: still one tile, two meeting dates");
  await form.getByRole("button", { name: "Meeting", exact: true }).click();
  await form.locator("textarea[name=body]").fill("Second sit-down");
  await form.locator("[data-testid=activity-submit]").click();
  await page.locator("#activity").getByText("Second sit-down").waitFor();
  await until(async () => (await one(`SELECT count(*)::int n FROM "OpportunityMeeting" WHERE "opportunityId"=$1`, [patOpp])).n === 2, "two meetings");
  assert.equal((await opps()).length, 1);

  log("Abby's meeting is her own tile; the board shows both names on Pat's tile and the meeting count");
  await page.goto(`${BASE}/dashboard/contacts/op_abby`);
  await form.getByRole("button", { name: "Meeting", exact: true }).click();
  await form.locator("textarea[name=body]").fill("Kitchen walk");
  await form.locator("[data-testid=activity-submit]").click();
  await page.locator("#activity").getByText("Kitchen walk").waitFor();
  await page.goto(`${BASE}/dashboard/deals`);
  const meetingSet = page.locator("[data-testid=pipeline-column-MEETING_SET]");
  const patTile = page.locator("[data-testid=pipeline-tile]", { hasText: "Pat Steffl" });
  await meetingSet.locator("[data-testid=pipeline-tile]", { hasText: "Pat Steffl" }).waitFor();
  assert.deepEqual(await patTile.locator("[data-testid=tile-people] a").allTextContents(), ["Pat Steffl", "Nic Partner"]);
  await patTile.getByText(/2 meetings/).waitFor();
  assert.equal(await meetingSet.locator("[data-testid=pipeline-tile]").count(), 2);
  assert.equal(await patTile.locator("[data-testid=lead-label]").first().getAttribute("data-label"), "N/A");
  const naStyle = await patTile.locator("[data-testid=lead-label]").first().evaluate((el) => [getComputedStyle(el).backgroundColor, getComputedStyle(el).color]);
  assert.deepEqual(naStyle, ["rgb(212, 212, 216)", "rgb(220, 38, 38)"], "N/A is light gray with red letters");
  await shot(page, "01-board");

  log("the stage menu on a first-column tile opens fully on screen, clear of the sidebar (the cut-off bug)");
  await patTile.locator("[data-testid=tile-move]").click();
  const menu = page.locator("[data-testid=tile-move-menu]");
  await menu.waitFor();
  const box = await menu.boundingBox();
  const sidebar = await page.locator("aside, nav").first().boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 1440 && box.y + box.height <= 900, `menu off screen: ${JSON.stringify(box)}`);
  assert.ok(!sidebar || box.x >= sidebar.x + sidebar.width - 1, `menu under the sidebar: ${JSON.stringify(box)} vs ${JSON.stringify(sidebar)}`);
  const onTop = await page.evaluate(({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest("[data-testid=tile-move-menu]")), {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  });
  assert.ok(onTop, "nothing covers the menu");
  await shot(page, "02-menu");
  await page.keyboard.press("Escape");

  log("dragging Pat's tile to Meeting Completed moves it with no prompt; Opportunity Created lands on Pat and Nic");
  await patTile.dragTo(page.locator("[data-testid=pipeline-column-MEETING_COMPLETED]"));
  await page.locator("[data-testid=pipeline-column-MEETING_COMPLETED] [data-testid=pipeline-tile]", { hasText: "Pat Steffl" }).waitFor();
  assert.equal(await page.locator("[data-testid=convert-dialog]").count(), 0);
  await until(async () => (await opps())[0].stage === "MEETING_COMPLETED", "meeting completed");
  assert.deepEqual(await logs(patOpp), ["op_nic:OPPORTUNITY_CREATED", "op_pat:OPPORTUNITY_CREATED"]);
  await until(async () => (await one(`SELECT status FROM "Contact" WHERE id='op_nic'`)).status === "MEETING_COMPLETED", "Nic follows");

  log("clicking the tile opens it: three boxes per person, ticking one greys the other two");
  await page.locator("[data-testid=pipeline-tile]", { hasText: "Pat Steffl" }).locator("[data-testid=tile-open]").click();
  const panel = page.locator("[data-testid=opportunity-panel]");
  await panel.locator("[data-testid=panel-person]").first().waitFor();
  const nicRow = panel.locator("[data-testid=panel-person][data-name='Nic Partner']");
  assert.equal(await nicRow.locator("[data-testid=role-ASSOCIATED]").isChecked(), true);
  assert.equal(await nicRow.locator("[data-testid=role-PRIMARY]").isDisabled(), true);
  assert.equal(await nicRow.locator("[data-testid=role-HIDDEN]").isDisabled(), true);
  await panel.locator("[data-testid=panel-meetings] li").nth(1).waitFor();

  log("Nic → Do Not List, Zoe added from the contacts, Lead Label Vendor, Save");
  await nicRow.locator("[data-testid=role-ASSOCIATED]").uncheck();
  assert.equal(await nicRow.locator("[data-testid=role-HIDDEN]").isDisabled(), false, "unticking frees the other two");
  await nicRow.locator("[data-testid=role-HIDDEN]").check();
  await panel.locator("[data-testid=panel-add-person]").click();
  await panel.locator("[data-testid=panel-add-search]").fill("Zoe");
  await panel.locator("[data-testid=panel-add-result]", { hasText: "Zoe Extra" }).click();
  assert.equal(await panel.locator("[data-testid=panel-person][data-name='Zoe Extra'] [data-testid=role-ASSOCIATED]").isChecked(), true);
  await panel.locator("[data-testid=lead-label-picker]").click();
  await page.locator("[data-testid=lead-label-menu] [data-testid='lead-label-option-Vendor']").click();
  await shot(page, "03-panel");
  await panel.locator("[data-testid=panel-save]").click();
  await panel.waitFor({ state: "detached" });
  assert.deepEqual(await people(patOpp), [
    { contactId: "op_nic", role: "HIDDEN", fromMeeting: true },
    { contactId: "op_pat", role: "PRIMARY", fromMeeting: true },
    { contactId: "op_zoe", role: "ASSOCIATED", fromMeeting: false },
  ]);
  assert.deepEqual(await logs(patOpp), ["op_pat:OPPORTUNITY_CREATED", "op_zoe:OPPORTUNITY_CREATED"], "Nic's line off, Zoe's on");
  assert.equal((await opps())[0].leadLabel, "Vendor");
  await page.locator("[data-testid=pipeline-tile]", { hasText: "Zoe Extra" }).waitFor();
  assert.equal(await page.locator("[data-testid=pipeline-tile]", { hasText: "Pat Steffl" }).locator("[data-testid=tile-people]").getByText("Nic Partner").count(), 0);
  assert.equal(
    (await one(`SELECT count(*)::int n FROM "Activity" WHERE "contactId"='op_nic' AND type='MEETING'`)).n,
    1,
    "Nic's meeting log is untouched",
  );

  log("dragging it to Quote Sent asks to convert, Quote picked; Manual Input $2,500 → Save and Accept");
  await page.locator("[data-testid=pipeline-tile]", { hasText: "Pat Steffl" }).dragTo(page.locator("[data-testid=pipeline-column-QUOTE_SENT]"));
  const convert = page.locator("[data-testid=convert-dialog]");
  await convert.waitFor();
  assert.equal(await convert.locator("[data-testid=convert-stage-QUOTE_SENT]").isChecked(), true);
  assert.equal(await convert.locator("[data-testid=convert-save]").isDisabled(), true, "needs Build Quote or Manual Input");
  await convert.locator("[data-testid=convert-mode-manual]").check();
  await convert.locator("[data-testid=convert-value]").fill("2500");
  await shot(page, "04-convert");
  await convert.locator("[data-testid=convert-save]").click();
  await convert.waitFor({ state: "detached" });
  const quoteSent = page.locator("[data-testid=pipeline-column-QUOTE_SENT] [data-testid=pipeline-tile]", { hasText: "Pat Steffl" });
  await quoteSent.waitFor();
  await quoteSent.getByText("$2,500.00").waitFor();
  const deal = await one(`SELECT d.id, d.stage, d."valueCents", d."contactId" FROM "Deal" d JOIN "Opportunity" o ON o."dealId"=d.id WHERE o.id=$1`, [patOpp]);
  assert.deepEqual({ ...deal, id: undefined }, { id: undefined, stage: "QUOTE_SENT", valueCents: 250000, contactId: "op_pat" });
  assert.deepEqual(await logs(patOpp), ["op_pat:DEAL_CREATED", "op_pat:OPPORTUNITY_CREATED", "op_zoe:DEAL_CREATED", "op_zoe:OPPORTUNITY_CREATED"]);
  assert.equal((await one(`SELECT status FROM "Contact" WHERE id='op_zoe'`)).status, "QUOTE_SENT");

  log("Pat's activity log: Opportunity Created and Deal Created, tagged Primary and Quote Sent");
  await page.goto(`${BASE}/dashboard/contacts/op_pat`);
  const dealLine = page.locator("[data-testid=activity-special][data-kind=DEAL_CREATED]");
  await dealLine.waitFor();
  assert.equal(await dealLine.locator("[data-testid=activity-role]").textContent(), "Primary");
  assert.equal(await dealLine.locator("[data-testid=activity-stage]").textContent(), "Quote Sent");
  assert.equal(await page.locator("[data-testid=activity-special][data-kind=OPPORTUNITY_CREATED]").count(), 1);
  await shot(page, "05-pat-log");

  log("moving the deal on to Contract Sent re-tags the same line; no second Deal Created");
  await page.goto(`${BASE}/dashboard/deals`);
  await page.locator("[data-testid=pipeline-tile]", { hasText: "Pat Steffl" }).locator("[data-testid=tile-move]").click();
  await page.locator("[data-testid=tile-move-menu] [data-testid=tile-move-CONTRACT_SENT]").click();
  await page.locator("[data-testid=pipeline-column-CONTRACT_SENT] [data-testid=pipeline-tile]", { hasText: "Pat Steffl" }).waitFor();
  await until(async () => (await one(`SELECT stage FROM "Deal" WHERE id=$1`, [deal.id])).stage === "CONTRACT_SENT", "deal saved at Contract Sent");
  await page.goto(`${BASE}/dashboard/contacts/op_pat`);
  assert.equal(await page.locator("[data-testid=activity-special][data-kind=DEAL_CREATED] [data-testid=activity-stage]").textContent(), "Contract Sent");
  assert.equal((await one(`SELECT count(*)::int n FROM "OpportunityLog" WHERE "contactId"='op_pat' AND kind='DEAL_CREATED'`)).n, 1);

  log("a deal can't go back to a meeting column: the menu greys them out");
  await page.goto(`${BASE}/dashboard/deals`);
  await page.locator("[data-testid=pipeline-tile]", { hasText: "Pat Steffl" }).locator("[data-testid=tile-move]").click();
  assert.equal(await page.locator("[data-testid=tile-move-menu] [data-testid=tile-move-MEETING_SET]").isDisabled(), true);
  assert.equal(await page.locator("[data-testid=tile-move-menu] [data-testid=tile-move-MEETING_COMPLETED]").isDisabled(), true);
  await page.keyboard.press("Escape");

  log("making Zoe Primary moves Pat to Associated; the deal is filed under Zoe; Pat's tag follows");
  await page.locator("[data-testid=pipeline-tile]", { hasText: "Pat Steffl" }).locator("[data-testid=tile-open]").click();
  await panel.locator("[data-testid=panel-person]").first().waitFor();
  const zoeRow = panel.locator("[data-testid=panel-person][data-name='Zoe Extra']");
  await zoeRow.locator("[data-testid=role-ASSOCIATED]").uncheck();
  await zoeRow.locator("[data-testid=role-PRIMARY]").check();
  assert.equal(await panel.locator("[data-testid=panel-person][data-name='Pat Steffl'] [data-testid=role-ASSOCIATED]").isChecked(), true);
  await panel.locator("[data-testid=panel-save]").click();
  await panel.waitFor({ state: "detached" });
  assert.equal((await one(`SELECT "contactId" FROM "Deal" WHERE id=$1`, [deal.id])).contactId, "op_zoe");
  await page.goto(`${BASE}/dashboard/contacts/op_pat`);
  assert.equal(await page.locator("[data-testid=activity-special][data-kind=DEAL_CREATED] [data-testid=activity-role]").textContent(), "Associated");

  log("a custom lead label from the tile's chip is neon yellow and saved for next time");
  await page.goto(`${BASE}/dashboard/deals`);
  const patAgain = page.locator("[data-testid=pipeline-tile]", { hasText: "Pat Steffl" });
  await patAgain.locator("[data-testid=lead-label-picker]").click();
  await page.locator("[data-testid=lead-label-add-custom]").click();
  await page.locator("[data-testid=lead-label-custom-input]").fill("Golf Buddy");
  await page.locator("[data-testid=lead-label-custom-add]").click();
  await until(async () => (await opps())[0].leadLabel === "Golf Buddy", "custom label saved");
  await page.reload();
  const chip = page.locator("[data-testid=pipeline-tile]", { hasText: "Pat Steffl" }).locator("[data-testid=lead-label]").first();
  assert.equal(await chip.getAttribute("data-label"), "Golf Buddy");
  assert.equal(await chip.evaluate((el) => getComputedStyle(el).color), "rgb(232, 255, 58)");
  assert.equal((await one(`SELECT count(*)::int n FROM "LeadLabelOption" WHERE "organizationId"=$1 AND name='Golf Buddy'`, [org])).n, 1);
  const vendorStyle = await page.locator("[data-testid=pipeline-tile]", { hasText: "Abby Peters" }).locator("[data-testid=lead-label]").first().getAttribute("data-label");
  assert.equal(vendorStyle, "N/A");

  log("search finds a tile by company or person; the Lead Label filter narrows to Golf Buddy, or to N/A");
  await page.locator("[data-testid=pipeline-search]").fill("Murphy");
  await until(async () => (await page.locator("[data-testid=pipeline-tile]").count()) === 1, "search narrows to Murphy");
  assert.ok(await page.locator("[data-testid=pipeline-tile]", { hasText: "Pat Steffl" }).isVisible());
  await page.locator("[data-testid=pipeline-search]").fill("abby");
  await until(async () => (await page.locator("[data-testid=pipeline-tile]").allTextContents()).join(" ").includes("Abby Peters") && (await page.locator("[data-testid=pipeline-tile]").count()) === 1, "search narrows to Abby");
  await page.locator("[data-testid=pipeline-search]").fill("");
  await until(async () => (await page.locator("[data-testid=pipeline-tile]").count()) === 2, "search cleared");
  await page.locator("[data-testid=filter-lead-label]").click();
  await page.getByRole("listbox", { name: "Lead Label" }).getByText("Golf Buddy").click();
  await until(async () => (await page.locator("[data-testid=pipeline-tile]").count()) === 1, "label filter");
  assert.ok(await page.locator("[data-testid=pipeline-tile]", { hasText: "Pat Steffl" }).isVisible());
  await page.goto(`${BASE}/dashboard/deals?label=N%2FA`);
  assert.deepEqual(await page.locator("[data-testid=pipeline-tile]").evaluateAll((els) => els.map((el) => el.dataset.title)), ["Abby Peters"]);

  log("Build Quote: Abby converted to Contract opens a new quote on her new deal");
  await page.goto(`${BASE}/dashboard/deals`);
  await page.locator("[data-testid=pipeline-tile]", { hasText: "Abby Peters" }).locator("[data-testid=tile-move]").click();
  await page.locator("[data-testid=tile-move-menu] [data-testid=tile-move-CONTRACT_SENT]").click();
  await convert.waitFor();
  assert.equal(await convert.locator("[data-testid=convert-stage-CONTRACT_SENT]").isChecked(), true);
  await convert.locator("[data-testid=convert-mode-quote]").check();
  await convert.locator("[data-testid=convert-save]").click();
  await page.waitForURL(/\/dashboard\/quotes\/new\?contactId=op_abby&dealId=/);
  const abbyDeal = await one(`SELECT d.stage FROM "Deal" d WHERE d."contactId"='op_abby'`);
  assert.equal(abbyDeal.stage, "CONTRACT_SENT");

  log("a deal added on a contact's page with no opportunity gets one (no deal without an opportunity)");
  await page.goto(`${BASE}/dashboard/contacts/op_lone`);
  await page.fill("#deal-title", "Fence repair");
  await page.locator("form", { has: page.locator("#deal-title") }).getByRole("button", { name: "Add" }).click();
  await until(
    async () => (await one(`SELECT count(*)::int n FROM "Opportunity" o JOIN "Deal" d ON d.id=o."dealId" WHERE d."contactId"='op_lone'`)).n === 1,
    "lone deal on its opportunity",
  );
  const lone = await one(
    `SELECT o.stage, oc.role FROM "Opportunity" o JOIN "Deal" d ON d.id=o."dealId" JOIN "OpportunityContact" oc ON oc."opportunityId"=o.id WHERE d."contactId"='op_lone'`,
  );
  assert.deepEqual({ ...lone }, { stage: "MEETING_COMPLETED", role: "PRIMARY" });
  assert.equal((await one(`SELECT count(*)::int n FROM "Deal" d LEFT JOIN "Opportunity" o ON o."dealId"=d.id WHERE d."organizationId"=$1 AND o.id IS NULL`, [org])).n, 0);

  log("Won closes it: Pat's next meeting starts a new opportunity");
  await page.goto(`${BASE}/dashboard/deals`);
  await page.locator("[data-testid=pipeline-tile]", { hasText: "Pat Steffl" }).dragTo(page.locator("[data-testid=pipeline-column-WON]"));
  await page.locator("[data-testid=pipeline-column-WON] [data-testid=pipeline-tile]", { hasText: "Pat Steffl" }).waitFor();
  await until(async () => (await one(`SELECT stage FROM "Deal" WHERE id=$1`, [deal.id])).stage === "WON", "deal saved as Won");
  await page.goto(`${BASE}/dashboard/contacts/op_pat`);
  await form.getByRole("button", { name: "Meeting", exact: true }).click();
  await form.locator("textarea[name=body]").fill("Phase two chat");
  await form.locator("[data-testid=activity-submit]").click();
  await page.locator("#activity").getByText("Phase two chat").waitFor();
  await until(
    async () => (await one(`SELECT count(*)::int n FROM "OpportunityContact" WHERE "contactId"='op_pat'`)).n === 2,
    "Pat on a second opportunity",
  );

  log("a status moved by hand to Quote Sent with no deal stays on the board at Meeting Completed (Pat's old bug); only converting makes it a deal");
  await sql(`INSERT INTO "Contact" (id,"organizationId",name,status,"updatedAt") VALUES ('op_hand',$1,'Hand Moved','MEETING_SET',now())`, [org]);
  await page.goto(`${BASE}/dashboard/contacts/op_hand`);
  await page.locator("[data-testid=status-picker]").click();
  const statusMenu = page.locator("[data-testid=status-menu]");
  await statusMenu.waitFor();
  const statusBox = await statusMenu.boundingBox();
  assert.ok(statusBox.x >= 0 && statusBox.x + statusBox.width <= 1440, "the contact page's status menu is on screen");
  await statusMenu.locator("[data-testid=status-option-QUOTE_SENT]").click();
  await statusMenu.locator("[data-testid=status-save]").click();
  await until(async () => (await one(`SELECT status FROM "Contact" WHERE id='op_hand'`)).status === "QUOTE_SENT", "hand moved");
  await page.goto(`${BASE}/dashboard/deals`);
  const handTile = page.locator("[data-testid=pipeline-column-MEETING_COMPLETED] [data-testid=pipeline-tile]", { hasText: "Hand Moved" });
  await handTile.waitFor();
  assert.equal(await page.locator("[data-testid=pipeline-column-QUOTE_SENT] [data-testid=pipeline-tile]", { hasText: "Hand Moved" }).count(), 0);
  assert.equal(await page.locator("[data-testid=tile-needs-deal]").count(), 0);
  // Cancel is the way out: nothing changes.
  await handTile.dragTo(page.locator("[data-testid=pipeline-column-QUOTE_SENT]"));
  await convert.waitFor();
  await convert.locator("[data-testid=convert-cancel]").click();
  await convert.waitFor({ state: "detached" });
  assert.equal(await page.locator("[data-testid=pipeline-column-MEETING_COMPLETED] [data-testid=pipeline-tile]", { hasText: "Hand Moved" }).count(), 1);
  assert.equal((await one(`SELECT count(*)::int n FROM "Deal" WHERE "contactId"='op_hand'`)).n, 0);

  log("people already in Meeting Set from before opportunities, who shared a meeting, become one tile on first open");
  await sql(
    `INSERT INTO "Contact" (id,"organizationId",name,status,"updatedAt") VALUES
       ('op_old1',$1,'Old Mia','MEETING_SET',now()), ('op_old2',$1,'Old Ray','MEETING_SET',now()), ('op_old3',$1,'Old Solo','MEETING_COMPLETED',now())`,
    [org],
  );
  const taylorId = (await one(`SELECT id FROM "User" WHERE email=$1`, [EMAIL])).id;
  await sql(
    `INSERT INTO "Activity" (id,"organizationId","contactId","userId",type,body,"batchId","occurredAt") VALUES
       ('op_old_a1',$1,'op_old1',$2,'MEETING','Old shared meeting','old-batch',now() - interval '20 days'),
       ('op_old_a2',$1,'op_old2',$2,'MEETING','Old shared meeting','old-batch',now() - interval '20 days')`,
    [org, taylorId],
  );
  await sql(
    `INSERT INTO "StatusChange" (id,"organizationId","contactId","userId","fromStatus","toStatus","on",auto) VALUES
       ('op_old_s1',$1,'op_old1',$2,'CONTACTED','MEETING_SET',now() - interval '20 days',true),
       ('op_old_s2',$1,'op_old2',$2,'CONTACTED','MEETING_SET',now() - interval '20 days',true),
       ('op_old_s3',$1,'op_old3',$2,'MEETING_SET','MEETING_COMPLETED',now() - interval '9 days',false)`,
    [org, taylorId],
  );
  await page.goto(`${BASE}/dashboard/deals`);
  const shared = page.locator("[data-testid=pipeline-column-MEETING_SET] [data-testid=pipeline-tile]", { hasText: "Old Mia" });
  await shared.waitFor();
  assert.deepEqual((await shared.locator("[data-testid=tile-people] a").allTextContents()).sort(), ["Old Mia", "Old Ray"]);
  await page.locator("[data-testid=pipeline-column-MEETING_COMPLETED] [data-testid=pipeline-tile]", { hasText: "Old Solo" }).waitFor();
  assert.equal((await one(`SELECT count(*)::int n FROM "OpportunityLog" ol JOIN "OpportunityContact" oc ON oc."opportunityId"=ol."opportunityId" WHERE oc."contactId" IN ('op_old1','op_old2','op_old3')`)).n, 0, "nothing back-written");
  await page.reload();
  assert.equal(await page.locator("[data-testid=pipeline-tile]", { hasText: "Old Mia" }).count(), 1, "a second open makes nothing new");

  log("the scrollbar on top scrolls the board");
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.reload();
  const top = page.locator("[data-testid=pipeline-top-scroll]");
  await top.evaluate((el) => {
    el.scrollLeft = 300;
    el.dispatchEvent(new Event("scroll"));
  });
  await until(async () => (await page.locator("[data-testid=pipeline-scroll]").evaluate((el) => el.scrollLeft)) > 250, "board follows the top bar");

  log("phone width: the page itself never scrolls sideways; the board does inside its box");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.locator("[data-testid=pipeline-tile]").first().waitFor();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, `page scrolls sideways by ${overflow}px`);
  await shot(page, "06-phone");

  await browser.close();
  console.log(`\nALL ${step} STEPS PASSED. Screenshots in ${OUT}`);
})().catch((err) => {
  console.error("\nFAILED at step", step, "\n", err);
  process.exit(1);
});
