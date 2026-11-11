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
 * "audit fixes (UX review)" steps (Nov 10, 2026), at the end where their
 * data is: the panel's People roles fit a 390px phone with Do Not List on
 * screen and the greyed-out boxes visible in Light; a meeting booked ahead
 * reads "Next meeting" on the tile, never "last"; a rep saved in the panel
 * shows on the tile's rep picker without a reload; the panel's Stage menu
 * saves the panel's edits first (a refused save keeps it open and moves
 * nothing, and the convert prompt offers the saved name); every Lead Label
 * chip and the suggested chip read at 4.5:1 in Dark and Light, unfaded.
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

async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity),
  );
}

/* An element's words against what is really behind them (its own fill,
 * else its ancestors' blended down to the page, as looks.cjs reads them),
 * and the lowest opacity on it or any ancestor. Colours go through a 1x1
 * canvas so color-mix() comes back as plain RGBA. */
async function textContrast(locator) {
  return locator.evaluate((el) => {
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
    const over = (top, under) => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1);
    const lum = ([r, g, b]) => {
      const ch = (v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
    };
    let opacity = 1;
    for (let node = el; node; node = node.parentElement) opacity = Math.min(opacity, parseFloat(getComputedStyle(node).opacity));
    const layers = [];
    for (let node = el; node && node !== document.documentElement; node = node.parentElement) {
      const s = getComputedStyle(node);
      let c = rgba(s.backgroundColor);
      if (c[3] === 0 && s.backgroundImage.startsWith("linear-gradient")) {
        const first = s.backgroundImage.match(/(rgba?\([^)]*\)|color\([^)]*\)|#[0-9a-f]{3,8})/i);
        if (first) c = rgba(first[1]);
      }
      if (c[3] > 0) layers.push(c);
      if (c[3] >= 0.999) break;
    }
    const bg = layers.reverse().reduce((acc, layer) => over(layer, acc), rgba(getComputedStyle(document.documentElement).backgroundColor));
    const fg = over(rgba(getComputedStyle(el).color), bg);
    const [x, y] = [lum(fg), lum(bg)].sort((p, q) => q - p);
    return { ratio: +((x + 0.05) / (y + 0.05)).toFixed(2), opacity, text: el.textContent.trim() };
  });
}

/* The strongest contrast any pixel of a small picture has against its
 * top-left pixel — how visible a drawn control is on what it sits on. */
async function pixelContrast(page, png) {
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const lum = (r, g, b) => {
      const ch = (v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
    };
    const bg = lum(d[0], d[1], d[2]);
    let best = 1;
    for (let i = 0; i < d.length; i += 4) {
      const l = lum(d[i], d[i + 1], d[i + 2]);
      best = Math.max(best, (Math.max(l, bg) + 0.05) / (Math.min(l, bg) + 0.05));
    }
    return +best.toFixed(2);
  }, png.toString("base64"));
}

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
  // The log is the How did it go? sheet behind the "What happened?" bar
  // (Nov 11, 2026); after a save it moves on to the next step.
  const openLog = async () => {
    if (await page.locator("[data-testid=follow-up-skip]").isVisible().catch(() => false)) {
      await page.locator("[data-testid=follow-up-skip]").click();
      await form.waitFor({ state: "detached" });
    }
    if (!(await form.isVisible().catch(() => false))) await page.locator("[data-testid=log-bar]").click();
    await form.waitFor();
  };
  await openLog();
  await form.getByRole("button", { name: "Meeting", exact: true }).click();
  await form.locator("textarea[name=body]").fill("Kickoff at Murphy");
  await form.getByRole("button", { name: "+ others" }).click();
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
  await openLog();
  await form.getByRole("button", { name: "Meeting", exact: true }).click();
  await form.locator("textarea[name=body]").fill("Second sit-down");
  await form.locator("[data-testid=activity-submit]").click();
  await page.locator("#activity").getByText("Second sit-down").waitFor();
  await until(async () => (await one(`SELECT count(*)::int n FROM "OpportunityMeeting" WHERE "opportunityId"=$1`, [patOpp])).n === 2, "two meetings");
  assert.equal((await opps()).length, 1);

  log("Abby's meeting is her own tile; the board shows both names on Pat's tile and the meeting count");
  await page.goto(`${BASE}/dashboard/contacts/op_abby`);
  await openLog();
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
  // The red is a deeper red since the UX review (5.6:1 on the gray; #dc2626 was 3.3:1).
  assert.deepEqual(naStyle, ["rgb(212, 212, 216)", "rgb(153, 27, 27)"], "N/A is light gray with red letters");
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
  await openLog();
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
  // The bar is sized once the page has hydrated; scrolling it before that
  // does nothing (Nov 10, 2026: the board's extra controls made this a race).
  await until(async () => (await top.evaluate((el) => el.scrollWidth - el.clientWidth)) > 250, "the top bar is sized");
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

  const panelOf = async (tileLocator) => {
    await tileLocator.locator("[data-testid=tile-open]").click();
    await panel.locator("[data-testid=panel-person]").first().waitFor();
    await settle(page);
  };
  const oldOpp = (
    await one(
      `SELECT o.id FROM "Opportunity" o JOIN "OpportunityContact" oc ON oc."opportunityId"=o.id WHERE oc."contactId"='op_old1' AND o."organizationId"=$1`,
      [org],
    )
  ).id;

  log("audit fixes (UX review): on a phone the panel's People roles fit — Do Not List on screen — and greyed-out boxes show in Light");
  // A long name on Old Mia's tile as well: it wraps instead of pushing the boxes off.
  await sql(`INSERT INTO "Contact" (id,"organizationId",name,"updatedAt") VALUES ('op_long',$1,'Maximiliana Featherstonehaugh',now())`, [org]);
  await sql(`INSERT INTO "OpportunityContact" (id,"opportunityId","contactId",role) VALUES ('op_oc_long',$1,'op_long','ASSOCIATED')`, [oldOpp]);
  for (const look of ["light", "dark"]) {
    await sql(`UPDATE "User" SET theme=$2 WHERE email=$1`, [EMAIL, look]);
    await page.goto(`${BASE}/dashboard/deals`);
    await panelOf(page.locator(`[data-testid=pipeline-tile][data-id='${oldOpp}']`));
    await panel.locator("[data-testid=panel-person][data-name='Maximiliana Featherstonehaugh']").waitFor();
    const fit = await panel.evaluate((aside) => {
      const table = aside.querySelector("[data-testid=panel-people]");
      const body = table.closest(".overflow-y-auto");
      const edge = body.getBoundingClientRect().right - parseFloat(getComputedStyle(body).paddingRight);
      const rights = [...aside.querySelectorAll("[data-testid=role-HIDDEN]")].map((box) => box.getBoundingClientRect().right);
      return { table: table.scrollWidth, room: table.parentElement.clientWidth, right: Math.max(...rights), edge, page: document.documentElement.scrollWidth };
    });
    // Before: the table was 453px+ in a 348px panel and Do Not List sat off-screen.
    assert.ok(fit.table <= fit.room + 1, `${look}: the People table is ${fit.table}px in ${fit.room}px`);
    assert.ok(fit.right <= fit.edge + 1 && fit.right <= 390, `${look}: Do Not List is off-screen (${fit.right} vs ${fit.edge})`);
    assert.ok(fit.page <= 391, `${look}: the page scrolls sideways (${fit.page})`);
    const grey = panel.locator("[data-testid=panel-person] input[type=checkbox]:disabled").first();
    const greyInfo = await grey.evaluate((el) => {
      let opacity = 1;
      for (let node = el; node; node = node.parentElement) opacity = Math.min(opacity, parseFloat(getComputedStyle(node).opacity));
      return opacity;
    });
    assert.equal(greyInfo, 1, `${look}: a greyed-out box is faded on top of the browser's own disabled look`);
    const box = await grey.boundingBox();
    const seen = await pixelContrast(page, await page.screenshot({ clip: { x: box.x - 3, y: box.y - 3, width: box.width + 6, height: box.height + 6 } }));
    // Light was 1.13:1 at 30% opacity on white, all but invisible.
    assert.ok(seen >= 1.4, `${look}: a greyed-out box is ${seen}:1 against the panel`);
    await shot(page, `07-phone-people-${look}`);
    await panel.locator("[data-testid=panel-close]").click();
    await panel.waitFor({ state: "detached" });
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  const zone = (await one(`SELECT "timeZone" FROM "Organization" WHERE id=$1`, [org])).timeZone || "America/Chicago";
  const day = (date) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: zone }).format(date);

  log("audit fixes (UX review): a meeting booked ahead reads as the next one on the tile, never the last");
  const patOpen = (
    await one(
      `SELECT o.id FROM "Opportunity" o JOIN "OpportunityContact" oc ON oc."opportunityId"=o.id WHERE oc."contactId"='op_pat' AND o."dealId" IS NULL AND o."organizationId"=$1`,
      [org],
    )
  ).id;
  const held = (await one(`SELECT max("on") AS on FROM "OpportunityMeeting" WHERE "opportunityId"=$1`, [patOpen])).on;
  const ahead = new Date(Date.now() + 9 * 86400000);
  await sql(`INSERT INTO "OpportunityMeeting" (id,"opportunityId","on") VALUES ('op_m_ahead',$1,$2)`, [patOpen, ahead]);
  await sql(`INSERT INTO "Contact" (id,"organizationId",name,status,"updatedAt") VALUES ('op_soon',$1,'Sunny Soon','MEETING_SET',now())`, [org]);
  await sql(`INSERT INTO "Opportunity" (id,"organizationId",title,stage,"createdAt","updatedAt") VALUES ('op_opp_soon',$1,'Sunny Soon','MEETING_SET',now(),now())`, [org]);
  await sql(`INSERT INTO "OpportunityContact" (id,"opportunityId","contactId",role,"fromMeeting") VALUES ('op_oc_soon','op_opp_soon','op_soon','PRIMARY',true)`);
  const soonOn = new Date(Date.now() + 5 * 86400000);
  await sql(`INSERT INTO "OpportunityMeeting" (id,"opportunityId","on") VALUES ('op_m_soon','op_opp_soon',$1)`, [soonOn]);
  await page.goto(`${BASE}/dashboard/deals`);
  const patNow = page.locator(`[data-testid=pipeline-tile][data-id='${patOpen}']`);
  await patNow.waitFor();
  // Before: "2 meetings · last <the booked date>".
  assert.ok(!(await patNow.innerText()).includes(`last ${day(ahead)}`), "the booked meeting is called the last one");
  assert.equal((await patNow.getByTestId("tile-meeting-last").innerText()).trim(), `2 meetings · last ${day(held)}`);
  assert.equal((await patNow.getByTestId("tile-meeting-next").innerText()).trim(), `Next meeting ${day(ahead)}`);
  const soonTile = page.locator("[data-testid=pipeline-tile][data-id='op_opp_soon']");
  assert.equal(await soonTile.getByTestId("tile-meeting-last").count(), 0, "a tile whose only meeting is ahead has no last meeting");
  assert.equal((await soonTile.getByTestId("tile-meeting-next").innerText()).trim(), `Next meeting ${day(soonOn)}`);
  assert.equal(await page.locator(`[data-testid=pipeline-tile][data-id='${oldOpp}']`).getByTestId("tile-meeting-next").count(), 0, "nothing booked ahead, no next line");

  log("audit fixes (UX review): a rep saved in the panel shows on the tile's rep picker straight away, no reload");
  const nicId = "usr_opps_nic";
  const taylor = await one(`SELECT id, "passwordHash" FROM "User" WHERE email=$1`, [EMAIL]);
  await sql(`INSERT INTO "User" (id,name,email,"passwordHash",role,"organizationId") VALUES ($1,'Nic Rep','test-opps-nic@example.com',$2,'MEMBER',$3)`, [
    nicId,
    taylor.passwordHash,
    org,
  ]);
  await page.goto(`${BASE}/dashboard/deals`);
  const abbyTile = page.locator("[data-testid=pipeline-tile]", { hasText: "Abby Peters" });
  const tileRep = abbyTile.locator("[data-testid=deal-owner] select");
  const abbyRep = (await one(`SELECT "ownerId" FROM "Deal" WHERE "contactId"='op_abby'`)).ownerId;
  assert.notEqual(abbyRep, nicId);
  assert.equal(await tileRep.inputValue(), abbyRep ?? "");
  await panelOf(abbyTile);
  await panel.locator("[data-testid=panel-rep]").selectOption(nicId);
  await panel.locator("[data-testid=panel-save]").click();
  await panel.waitFor({ state: "detached" });
  await until(async () => (await one(`SELECT "ownerId" FROM "Deal" WHERE "contactId"='op_abby'`)).ownerId === nicId, "the panel saved Nic");
  // Before: the tile kept showing Taylor until a full reload.
  await until(async () => (await tileRep.inputValue()) === nicId, "the tile's rep picker shows Nic");
  assert.equal(await tileRep.evaluate((select) => select.options[select.selectedIndex].text), "Nic Rep");

  log("audit fixes (UX review): the panel's Stage menu saves the panel's edits first; a refused save keeps the panel open and moves nothing");
  const oldTile = page.locator(`[data-testid=pipeline-tile][data-id='${oldOpp}']`);
  await panelOf(oldTile);
  await panel.locator("[data-testid=panel-title]").fill("Old shared job");
  await panel.locator("[data-testid=lead-label-picker]").click();
  await page.locator("[data-testid=lead-label-menu] [data-testid='lead-label-option-Client']").click();
  await panel.locator("[data-testid=tile-move]").click();
  await page.locator("[data-testid=tile-move-menu] [data-testid=tile-move-MEETING_COMPLETED]").click();
  await panel.waitFor({ state: "detached" });
  // Before: the panel closed, the stage moved and the name and label were thrown away.
  await until(async () => (await one(`SELECT stage FROM "Opportunity" WHERE id=$1`, [oldOpp])).stage === "MEETING_COMPLETED", "moved");
  assert.deepEqual({ ...(await one(`SELECT title, "leadLabel" FROM "Opportunity" WHERE id=$1`, [oldOpp])) }, { title: "Old shared job", leadLabel: "Client" });
  const moved = page.locator(`[data-testid=pipeline-column-MEETING_COMPLETED] [data-testid=pipeline-tile][data-id='${oldOpp}']`);
  await moved.waitFor();
  await until(async () => (await moved.getAttribute("data-title")) === "Old shared job", "the tile shows the saved name");
  assert.equal(await moved.locator("[data-testid=lead-label]").first().getAttribute("data-label"), "Client");
  // A save that can't go through: the panel stays open with its message and nothing moves.
  await panelOf(moved);
  const primaryBox = panel.locator("[data-testid=panel-person] [data-testid=role-PRIMARY]:checked");
  const primaryName = await primaryBox.locator("xpath=ancestor::tr").getAttribute("data-name");
  await primaryBox.uncheck();
  await panel.locator("[data-testid=tile-move]").click();
  await page.locator("[data-testid=tile-move-menu] [data-testid=tile-move-MEETING_SET]").click();
  await panel.locator("[data-testid=panel-error]").getByText(`Tick Primary POC, Associated POC or Do Not List for ${primaryName}`).waitFor();
  assert.equal(await panel.count(), 1, "the panel stays open");
  assert.equal((await one(`SELECT stage FROM "Opportunity" WHERE id=$1`, [oldOpp])).stage, "MEETING_COMPLETED");
  // Ticked again and renamed, then into Quote Sent: the edits save and the
  // convert prompt offers the new name; Cancel leaves it a non-deal.
  await panel.locator(`[data-testid=panel-person][data-name='${primaryName}'] [data-testid=role-PRIMARY]`).check();
  await panel.locator("[data-testid=panel-title]").fill("Old shared job two");
  await panel.locator("[data-testid=tile-move]").click();
  await page.locator("[data-testid=tile-move-menu] [data-testid=tile-move-QUOTE_SENT]").click();
  await panel.waitFor({ state: "detached" });
  await convert.waitFor();
  assert.equal((await convert.locator(".eyebrow").first().textContent()).trim(), "Old shared job two");
  await convert.locator("[data-testid=convert-cancel]").click();
  await convert.waitFor({ state: "detached" });
  assert.equal((await one(`SELECT title FROM "Opportunity" WHERE id=$1`, [oldOpp])).title, "Old shared job two");
  assert.equal((await one(`SELECT "dealId" FROM "Opportunity" WHERE id=$1`, [oldOpp])).dealId, null);

  log("audit fixes (UX review): every Lead Label chip and the suggested chip read at 4.5:1 in Dark and Light, and the suggestion isn't faded");
  // Two tiles with no label that the rules suggest one for: Residential
  // (no company, a personal email) and Vendor (a Distributor's person).
  await sql(`INSERT INTO "Company" (id,"organizationId",name,"companyTypes","updatedAt") VALUES ('op_dist',$1,'Dist Supply','{Distributor}',now())`, [org]);
  await sql(
    `INSERT INTO "Contact" (id,"organizationId","companyId",name,email,status,"updatedAt") VALUES
       ('op_hal',$1,NULL,'Hal Homeowner','hal@gmail.com','MEETING_SET',now()), ('op_dana',$1,'op_dist','Dana Distro','dana@dist.test','MEETING_SET',now())`,
    [org],
  );
  await sql(
    `INSERT INTO "Opportunity" (id,"organizationId",title,stage,"createdAt","updatedAt") VALUES
       ('op_opp_hal',$1,'Hal Homeowner','MEETING_SET',now(),now()), ('op_opp_dana',$1,'Dana Distro','MEETING_SET',now(),now())`,
    [org],
  );
  await sql(
    `INSERT INTO "OpportunityContact" (id,"opportunityId","contactId",role,"fromMeeting") VALUES
       ('op_oc_hal','op_opp_hal','op_hal','PRIMARY',true), ('op_oc_dana','op_opp_dana','op_dana','PRIMARY',true)`,
  );
  const halTile = page.locator("[data-testid=pipeline-tile][data-id='op_opp_hal']");
  const danaTile = page.locator("[data-testid=pipeline-tile][data-id='op_opp_dana']");
  const readable = (what, result) => {
    assert.ok(result.ratio >= 4.5, `${what} "${result.text}" is ${result.ratio}:1`);
    assert.equal(result.opacity, 1, `${what} "${result.text}" is faded`);
  };
  for (const look of ["dark", "light"]) {
    await sql(`UPDATE "User" SET theme=$2 WHERE email=$1`, [EMAIL, look]);
    await page.goto(`${BASE}/dashboard/deals`);
    await halTile.waitFor();
    await settle(page);
    // The picker lists every chip there is: N/A, the five built-ins and Golf Buddy.
    await halTile.locator("[data-testid=lead-label-picker]").click();
    const chips = page.locator("[data-testid=lead-label-menu] [data-testid=lead-label]");
    await chips.first().waitFor();
    assert.deepEqual(await chips.evaluateAll((els) => els.map((el) => el.dataset.label)), [
      "N/A",
      "Residential",
      "Client",
      "Vendor",
      "Software Integration",
      "Reseller",
      "Golf Buddy",
    ]);
    // Before: white on Client 2.28:1, Residential 2.8:1, N/A 3.27:1.
    for (let i = 0; i < (await chips.count()); i += 1) readable(`${look} chip`, await textContrast(chips.nth(i)));
    await page.keyboard.press("Escape");
    await page.locator("[data-testid=lead-label-menu]").waitFor({ state: "detached" });
    // Before: "Residential?" at 60% opacity, 1.88:1 on white.
    assert.equal(await halTile.locator("[data-testid=suggested-label]").getAttribute("data-label"), "Residential");
    assert.equal(await danaTile.locator("[data-testid=suggested-label]").getAttribute("data-label"), "Vendor");
    readable(`${look} suggestion on a tile`, await textContrast(halTile.getByTestId("suggested-label-accept")));
    readable(`${look} suggestion on a tile`, await textContrast(danaTile.getByTestId("suggested-label-accept")));
    await shot(page, `08-labels-${look}`);
    await panelOf(danaTile);
    readable(`${look} suggestion in the panel`, await textContrast(panel.getByTestId("suggested-label-accept")));
    readable(`${look} chip in the panel`, await textContrast(panel.locator("[data-testid=lead-label]").first()));
    await panel.locator("[data-testid=panel-close]").click();
    await panel.waitFor({ state: "detached" });
  }
  await sql(`UPDATE "User" SET theme='dark' WHERE email=$1`, [EMAIL]);

  log("audit fixes (UX review): a long label never covers a short title, and a long name stays inside its tile");
  await sql(
    `INSERT INTO "Contact" (id,"organizationId",name,status,"updatedAt") VALUES ('op_longtile',$1,'Maximiliana Featherstonehaugh-Wolfeschlegelsteinhausen','MEETING_SET',now())`,
    [org],
  );
  await sql(
    `INSERT INTO "Opportunity" (id,"organizationId",title,stage,"leadLabel","createdAt","updatedAt") VALUES ('op_opp_long',$1,'Lab Soft','MEETING_SET','Software Integration',now(),now())`,
    [org],
  );
  await sql(`INSERT INTO "OpportunityContact" (id,"opportunityId","contactId",role,"fromMeeting") VALUES ('op_oc_longtile','op_opp_long','op_longtile','PRIMARY',true)`);
  await page.goto(`${BASE}/dashboard/deals`);
  const longTile = page.locator("[data-testid=pipeline-tile][data-id='op_opp_long']");
  await longTile.waitFor();
  const fit = await longTile.evaluate((tile) => {
    const box = tile.getBoundingClientRect();
    const title = tile.querySelector("[data-testid=tile-open]");
    const t = title.getBoundingClientRect();
    const c = tile.querySelector("[data-testid=lead-label-picker]").getBoundingClientRect();
    const overlap = c.left < t.right && c.right > t.left && c.top < t.bottom && c.bottom > t.top;
    const name = tile.querySelector("[data-testid=tile-people] a").getBoundingClientRect();
    return { overlap, titleWidth: Math.round(t.width), titleText: title.textContent, nameRight: Math.round(name.right), tileRight: Math.round(box.right) };
  });
  assert.equal(fit.overlap, false, "the label chip sits clear of the title");
  assert.ok(fit.titleWidth >= 60, `the title is squeezed to ${fit.titleWidth}px`);
  assert.ok(fit.nameRight <= fit.tileRight, `the name runs to ${fit.nameRight}px, past the tile's edge at ${fit.tileRight}px`);

  await browser.close();
  console.log(`\nALL ${step} STEPS PASSED. Screenshots in ${OUT}`);
})().catch((err) => {
  console.error("\nFAILED at step", step, "\n", err);
  process.exit(1);
});
