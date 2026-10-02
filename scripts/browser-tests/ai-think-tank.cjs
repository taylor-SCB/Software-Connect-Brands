/* Browser regression for the CTO Think Tank build (Oct 2, 2026): the five
 * AI-centric pieces on the CRM, the Pipeline and Stats.
 *
 * Covers: Duplicate radar (contacts and companies, the reasons shown, the
 * count beside Merge, "Not the same person" remembered, Merge with the pair
 * already picked); One person, every company (the "Looks like the same
 * person" card and the "Before you call" facts and paragraph); the morning
 * Call List (its rules, Mine / Nobody's / anyone's for an owner, openers
 * drafted after the page draws, Log it and Mark held taking a row off, the
 * Overview card, a Member's own list); Meeting notes (read into a
 * checklist, prices from the catalog only, a bogus product code dropped,
 * Apply writing the log, Meeting Completed, the follow-up and a Draft quote;
 * and the same from the calendar's "How did it go?"); the Forecast on Stats
 * (low confidence, the buckets, a dragging contract, "Read it to me");
 * the 100-a-day AI allowance; and every list still standing when the AI
 * fails.
 *
 * Stands up a fake AI on :3998, so the SERVER must be started with
 *   ANTHROPIC_API_KEY=fake-local
 *   ANTHROPIC_BASE_URL=http://localhost:3998
 * in .env. Fake values are right — nothing leaves the machine. Without them
 * the AI steps fail, which looks like a bug in the app and is not one. A
 * shell that already exports ANTHROPIC_BASE_URL (Claude Code's cloud
 * container does) wins over .env, so start the server with both on the
 * command line there:
 *   ANTHROPIC_BASE_URL=http://localhost:3998 ANTHROPIC_API_KEY=fake-local \
 *   bash scripts/dev-serve.sh --serve
 *
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/scb_test \
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules \
 *   node scripts/browser-tests/ai-think-tank.cjs
 */
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS on purpose: NODE_PATH only resolves the global playwright for require() */
const os = require("node:os");
const http = require("node:http");
const { chromium } = require("playwright");
const { Client } = require("pg");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const BASE = process.env.BASE || "http://localhost:3000";
const DB = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5433/scb_test";
const OUT = process.env.SHOTS_DIR || path.join(os.tmpdir(), "scb-browser-shots-ai-think-tank");
fs.mkdirSync(OUT, { recursive: true });

const EMAIL = "test-aitank@example.com";
const NIC_EMAIL = "test-aitank-nic@example.com";
const PASSWORD = "password123";
const COMPANY = "Test AI Tank Co";
const AI_PORT = 3998;

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

/* ------------------------------- The fake AI ------------------------------ */

const ai = { mode: "ok", requests: [] };
function aiAnswer(body) {
  const system = typeof body.system === "string" ? body.system : JSON.stringify(body.system);
  const prompt = body.messages[0].content;
  if (system.includes("first thing a salesperson")) {
    const ids = [...prompt.matchAll(/^(\d+) \| ([^|]+)\|/gm)].map((match) => ({ id: match[1], who: match[2].trim() }));
    return { openers: ids.map((row) => ({ id: row.id, opener: `FAKE OPENER for ${row.who.split(" at ")[0]}` })) };
  }
  if (system.includes("quick notes from a meeting")) {
    const today = prompt.match(/(\d{4}-\d{2}-\d{2})/)[1];
    const follow = new Date(`${today}T12:00:00Z`);
    follow.setUTCDate(follow.getUTCDate() + 5);
    const shingle = prompt.match(/^(P\d+) \| Architectural shingle bundle/m)[1];
    const labor = prompt.match(/^(P\d+) \| Roofing labor/m)[1];
    return {
      summary: "Walked the roof; north side first, budget about $40k, decision by the 15th.",
      meetingHappened: true,
      followUpDate: follow.toISOString().slice(0, 10),
      followUpWhat: "Check on the north roof decision",
      quoteWanted: true,
      quoteTitle: "North roof",
      budgetDollars: 40000,
      lines: [
        { code: shingle, quantity: 30, note: "north side shingles" },
        { code: labor, quantity: 16, note: "two-day crew" },
        { code: "P999", quantity: 1, note: "not a real product" },
      ],
      notInCatalog: ["Skylight flashing"],
    };
  }
  if (system.includes("brief a salesperson")) {
    const who = prompt.match(/Brief me on ([^.]+)\./)[1];
    return { paragraph: `FAKE BRIEFING on ${who}: one open quote, call about it.` };
  }
  if (system.includes("read a sales forecast")) return { reading: "FAKE FORECAST READING: one contract is dragging." };
  throw new Error(`unexpected AI request: ${system.slice(0, 80)}`);
}
function startFakeAi() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        const body = JSON.parse(raw || "{}");
        ai.requests.push({ url: req.url, body, headers: req.headers });
        if (ai.mode === "fail") {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: "fake outage" } }));
          return;
        }
        let answer;
        try {
          answer = aiAnswer(body);
        } catch (error) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: String(error) } }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: `msg_fake_${ai.requests.length}`,
            type: "message",
            role: "assistant",
            model: body.model,
            content: [{ type: "text", text: JSON.stringify(answer) }],
            stop_reason: "end_turn",
            stop_sequence: null,
            usage: { input_tokens: 120, output_tokens: 40 },
          }),
        );
      });
    });
    server.listen(AI_PORT, () => resolve(server));
  });
}

/* --------------------------------- Seeding -------------------------------- */

const DAY = 86_400_000;
const ago = (days) => new Date(Date.now() - days * DAY);
let seq = 0;
const id = (prefix) => `${prefix}_aitank_${++seq}`;

async function contact(org, fields) {
  const cid = id("ct");
  await sql(
    `INSERT INTO "Contact" (id, "organizationId", name, email, phone, email2, "companyId", status, "createdAt", "updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())`,
    [cid, org, fields.name, fields.email ?? null, fields.phone ?? null, fields.email2 ?? null, fields.companyId ?? null, fields.status ?? "NOT_ACTIONED", fields.createdAt ?? new Date()],
  );
  return cid;
}
async function company(org, name, city) {
  const cid = id("co");
  await sql(`INSERT INTO "Company" (id, "organizationId", name, city, state, "updatedAt") VALUES ($1,$2,$3,$4,'TX',now())`, [cid, org, name, city]);
  return cid;
}

(async () => {
  await sql(`DELETE FROM "Organization" WHERE slug LIKE 'test-ai-tank-co%'`);
  await sql(`DELETE FROM "User" WHERE email = $1`, [NIC_EMAIL]);
  const fakeAi = await startFakeAi();

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (err) => console.error("PAGE ERROR:", err.message));

  try {
    log("signup + activate + login");
    await page.goto(`${BASE}/signup`);
    await page.fill("[name=companyName]", COMPANY);
    await page.fill("[name=name]", "Taylor Test");
    await page.fill("[name=email]", EMAIL);
    await page.fill("[name=phone]", "5550000000");
    await page.fill("[name=password]", PASSWORD);
    await page.click("button[type=submit]");
    await page.waitForURL(/\/signup\/submitted/);
    await sql(`UPDATE "Organization" SET status='ACTIVE', "reviewedAt"=now() WHERE slug LIKE 'test-ai-tank-co%'`);
    await login(page, EMAIL);
    const org = (await sql(`SELECT id FROM "Organization" WHERE slug LIKE 'test-ai-tank-co%'`)).rows[0].id;
    const taylor = (await sql(`SELECT id, "passwordHash" FROM "User" WHERE email = $1`, [EMAIL])).rows[0];
    const nicId = "usr_aitank_nic";
    await sql(`INSERT INTO "User" (id, name, email, "passwordHash", role, "organizationId") VALUES ($1, 'Nic Rivera', $2, $3, 'MEMBER', $4)`, [
      nicId,
      NIC_EMAIL,
      taylor.passwordHash,
      org,
    ]);

    // Days in the workspace's own zone, as the app reads them.
    const today = (await sql(`SELECT to_char((now() AT TIME ZONE 'America/Chicago')::date, 'YYYY-MM-DD') AS d`)).rows[0].d;
    const yesterday = (await sql(`SELECT to_char((now() AT TIME ZONE 'America/Chicago')::date - 1, 'YYYY-MM-DD') AS d`)).rows[0].d;

    // The cast. Twins for the radar; a quote, a contract, a meeting and an
    // Interested person for the Call List; a catalog for Meeting notes.
    const acme = await company(org, "Acme Roofing", "Austin");
    const acmeLlc = await company(org, "ACME Roofing, LLC", "Austin");
    const leeHoldings = await company(org, "Lee Holdings", "Dallas");
    const matthew = await contact(org, { name: "Matthew Smith", phone: "(512) 555-0101", companyId: acme, createdAt: ago(40) });
    const matt = await contact(org, { name: "Matt Smith", phone: "512.555.0101", companyId: acme, createdAt: ago(5) });
    const danaA = await contact(org, { name: "Dana Lee", email: "dana@acmeroofing.com", email2: "dana.lee@gmail.com", companyId: acme });
    const danaB = await contact(org, { name: "Dana Lee", email: "dana.lee@gmail.com", companyId: leeHoldings });
    const ivy = await contact(org, { name: "Ivy Interested", phone: "512-555-0300", status: "INTERESTED" });
    await sql(`INSERT INTO "StatusChange" (id, "organizationId", "contactId", "fromStatus", "toStatus", "on", auto) VALUES ($1,$2,$3,'CONTACTED','INTERESTED',$4,false)`, [
      id("sc"),
      org,
      ivy,
      ago(10),
    ]);
    const quinn = await contact(org, { name: "Quinn Quote", phone: "512-555-0400", status: "QUOTE_SENT" });
    const quoteDeal = id("deal");
    await sql(`INSERT INTO "Deal" (id, "organizationId", "contactId", title, stage, "stageChangedAt", "ownerId", "updatedAt") VALUES ($1,$2,$3,'Garage roof','QUOTE_SENT',$4,$5,now())`, [
      quoteDeal,
      org,
      quinn,
      ago(5),
      taylor.id,
    ]);
    const quoteId = id("q");
    await sql(
      `INSERT INTO "Quote" (id, "organizationId", "contactId", "dealId", number, title, status, "publicToken", "sentAt", "updatedAt") VALUES ($1,$2,$3,$4,1000,'Garage roof','SENT',$5,$6,now())`,
      [quoteId, org, quinn, quoteDeal, `tok_${quoteId}`, ago(5)],
    );
    await sql(`UPDATE "Organization" SET "nextQuoteNumber" = 1001 WHERE id = $1`, [org]);
    await sql(`INSERT INTO "QuoteLineItem" (id, "quoteId", name, quantity, "unitPriceCents", tag) VALUES ($1,$2,'Garage roof labor',1,850000,'LABOR')`, [id("li"), quoteId]);
    // Quinn's quote also has a follow-up gone by unticked: one row, two reasons.
    const quinnFollow = id("ev");
    await sql(
      `INSERT INTO "CalendarEvent" (id, "organizationId", title, type, "startOn", "contactId", "ownerId", "quoteId", notes, auto, "updatedAt") VALUES ($1,$2,'Quote follow up · Quinn Quote','Quote follow up',$3,$4,$5,$6,'Follow up on QUO-1000',true,now())`,
      [quinnFollow, org, yesterday, quinn, taylor.id, quoteId],
    );
    const carla = await contact(org, { name: "Carla Contract", phone: "512-555-0500", status: "CONTRACT_SENT" });
    await sql(`INSERT INTO "Deal" (id, "organizationId", "contactId", title, stage, "stageChangedAt", "ownerId", "valueCents", "updatedAt") VALUES ($1,$2,$3,'Warehouse reroof','CONTRACT_SENT',$4,$5,1200000,now())`, [
      id("deal"),
      org,
      carla,
      ago(82),
      nicId,
    ]);
    const mia = await contact(org, { name: "Mia Meeting", phone: "512-555-0600", status: "MEETING_SET" });
    const miaEvent = id("ev");
    await sql(
      `INSERT INTO "CalendarEvent" (id, "organizationId", title, type, "startOn", "contactId", "ownerId", "updatedAt") VALUES ($1,$2,'Meeting · Mia Meeting','Meeting',$3,$4,$5,now())`,
      [miaEvent, org, yesterday, mia, taylor.id],
    );
    await sql(
      `INSERT INTO "Product" (id, "organizationId", name, "unitPriceCents", "defaultTag", "unitOfMeasure", "updatedAt") VALUES ($1,$2,'Architectural shingle bundle',4000,'MATERIALS',NULL,now()), ($3,$2,'Roofing labor',8500,'LABOR',NULL,now())`,
      [id("pr"), org, id("pr")],
    );

    /* ----------------------------- Duplicate radar ---------------------------- */

    log("Possible Duplicates sits under Contacts and Companies in the sidebar");
    await page.goto(`${BASE}/dashboard/contacts`);
    const aside = page.locator("aside");
    assert.equal(await aside.getByRole("link", { name: "Possible Duplicates" }).count(), 1);
    await page.locator("[data-testid=merge-count]").waitFor();
    assert.match(await page.locator("[data-testid=merge-count]").textContent(), /^2 possible$/);
    await shot(page, "01-contacts-merge-count");

    log("the radar shows Matt / Matthew by phone and nickname, and Dana across two companies");
    await page.goto(`${BASE}/dashboard/contacts/duplicates`);
    const pairs = page.locator("[data-testid=dup-pair]");
    assert.equal(await pairs.count(), 2);
    const mattPair = pairs.filter({ hasText: "Matt Smith" });
    const mattReasons = await mattPair.locator("[data-testid=dup-reason]").allTextContents();
    assert.deepEqual(mattReasons.sort(), ["Nickname at the same company", "Same phone number"]);
    const danaPair = pairs.filter({ hasText: "Lee Holdings" });
    assert.ok((await danaPair.locator("[data-testid=dup-reason]").allTextContents()).includes("Same email"));
    assert.equal(await danaPair.locator("[data-testid=dup-across]").count(), 1, "Dana pair explains the Additional Account");
    await shot(page, "02-contact-radar");

    log("Not the same person puts the Dana pair away for good");
    await danaPair.locator("[data-testid=dup-dismiss]").click();
    await page.waitForFunction(() => document.querySelectorAll("[data-testid=dup-pair]").length === 1);
    const dismissed = await sql(`SELECT "aId", "bId" FROM "DuplicateDismissal" WHERE "organizationId" = $1 AND kind = 'contact'`, [org]);
    assert.deepEqual([dismissed.rows[0].aId, dismissed.rows[0].bId].sort(), [danaA, danaB].sort());
    await page.reload();
    assert.equal(await page.locator("[data-testid=dup-pair]").count(), 1);

    log("Merge these opens Merge with the pair picked and the older record kept");
    await page.locator("[data-testid=merge-suggested]").click();
    const dialog = page.locator("[data-testid=merge-dialog]");
    await dialog.waitFor();
    assert.equal(await dialog.locator("[data-testid=merge-picked] li").count(), 2);
    assert.ok(await dialog.locator("[data-testid=merge-picked] li", { hasText: "Matthew Smith" }).getByText("keep").isVisible(), "older Matthew is kept");
    await dialog.locator("[data-testid=merge-go]").click();
    await dialog.locator("[data-testid=merge-yes]").click();
    await page.locator("[data-testid=dup-pair]").first().waitFor({ state: "detached" });
    assert.equal((await sql(`SELECT count(*)::int AS n FROM "Contact" WHERE id = $1`, [matt])).rows[0].n, 0, "Matt folded away");
    assert.equal((await sql(`SELECT count(*)::int AS n FROM "Contact" WHERE id = $1`, [matthew])).rows[0].n, 1);
    assert.ok(await page.getByText("Nothing to tidy up").isVisible());

    log("the company radar matches Acme Roofing and ACME Roofing, LLC");
    await page.goto(`${BASE}/dashboard/companies/duplicates`);
    const companyPair = page.locator("[data-testid=dup-pair]");
    assert.equal(await companyPair.count(), 1);
    assert.deepEqual(await companyPair.locator("[data-testid=dup-reason]").allTextContents(), ["Same name"]);
    assert.equal(await companyPair.getAttribute("data-strength"), "strong", "same city makes it strong");
    await companyPair.locator("[data-testid=dup-dismiss]").click();
    await page.getByText("Nothing to tidy up").waitFor();
    void acmeLlc;

    /* ------------------------- One person, every company ------------------------ */

    log("a contact page offers its twin: Sam and Samuel Rivers share an email");
    const sam = await contact(org, { name: "Sam Rivers", email: "sam@rivers.co", createdAt: ago(20) });
    const samuel = await contact(org, { name: "Samuel Rivers", email: "SAM@rivers.co", companyId: leeHoldings });
    await page.goto(`${BASE}/dashboard/contacts/${sam}`);
    const twins = page.locator("[data-testid=twins-card] [data-testid=dup-pair]");
    assert.equal(await twins.count(), 1);
    assert.ok((await twins.textContent()).includes("Samuel Rivers"));
    assert.deepEqual(await twins.locator("[data-testid=dup-reason]").allTextContents(), ["Same email"]);
    void samuel;

    log("Before you call lists the facts across every company, and writes a paragraph on request");
    await page.goto(`${BASE}/dashboard/contacts/${quinn}`);
    const facts = page.locator("[data-testid=briefing-facts]");
    assert.ok((await facts.textContent()).includes("Quote QUO-1000 \"Garage roof\" for $8,500.00 is out"));
    const before = ai.requests.length;
    await page.locator("[data-testid=briefing-write]").click();
    await page.locator("[data-testid=briefing-paragraph]").waitFor();
    assert.equal(await page.locator("[data-testid=briefing-paragraph]").textContent(), "FAKE BRIEFING on Quinn Quote: one open quote, call about it.");
    assert.equal(ai.requests.length, before + 1);
    assert.equal(ai.requests.at(-1).body.model, "claude-opus-5-5");
    assert.ok(ai.requests.at(-1).body.messages[0].content.includes("QUO-1000"), "the AI saw the facts");
    await page.reload();
    assert.equal(await page.locator("[data-testid=briefing-paragraph]").textContent(), "FAKE BRIEFING on Quinn Quote: one open quote, call about it.", "kept, not rewritten");
    assert.equal(ai.requests.length, before + 1, "a reload costs nothing");
    const usage = await sql(`SELECT feature, ok FROM "AiUsage" WHERE "organizationId" = $1`, [org]);
    assert.deepEqual(usage.rows, [{ feature: "briefing", ok: true }]);
    await shot(page, "03-before-you-call");

    /* -------------------------------- Call List -------------------------------- */

    log("Call List sits between Overview and Calendar, and lists today's calls most pressing first");
    const top = (await aside.locator("nav").first().locator("a.nav-item").allTextContents()).map((t) => t.trim());
    assert.deepEqual(top.slice(0, 3), ["Overview", "Call List", "Calendar"]);
    await page.goto(`${BASE}/dashboard/call-list`);
    const mine = page.locator("[data-testid=call-rows]").first().locator("[data-testid=call-row]");
    const kinds = await mine.evaluateAll((rows) => rows.map((row) => row.getAttribute("data-kind")));
    assert.deepEqual(kinds, ["held", "quote"], `my rows were ${kinds}`);
    assert.match(await mine.nth(0).locator("[data-testid=call-reason]").textContent(), /^Met on .+\? It isn't marked held yet$/);
    assert.equal(await mine.nth(1).locator("[data-testid=call-reason]").textContent(), "QUO-1000 for $8,500.00 out 5 days, no answer");
    assert.ok((await mine.nth(1).textContent()).includes("Also: Quote follow up 1 day overdue: Follow up on QUO-1000"), "the follow-up rides along");
    const nobodys = page.locator("[data-testid=call-nobodys] [data-testid=call-row]");
    assert.equal(await nobodys.count(), 1);
    assert.equal(await nobodys.locator("[data-testid=call-reason]").textContent(), "Interested for 10 days, no meeting booked");
    assert.equal(await page.getByText("Carla Contract").count(), 0, "Nic's contract is on Nic's list, not mine");

    log("openers are drafted after the page draws, in one request, and kept for the day");
    await page.locator("[data-testid=call-opener]").first().waitFor();
    assert.equal(await mine.nth(1).locator("[data-testid=call-opener]").textContent(), "“FAKE OPENER for Quinn Quote”");
    assert.equal(await nobodys.locator("[data-testid=call-opener]").textContent(), "“FAKE OPENER for Ivy Interested”");
    const openerCalls = ai.requests.filter((request) => JSON.stringify(request.body.system).includes("first thing a salesperson"));
    assert.equal(openerCalls.length, 1);
    await page.reload();
    await page.locator("[data-testid=call-opener]").first().waitFor();
    assert.equal(ai.requests.filter((request) => JSON.stringify(request.body.system).includes("first thing a salesperson")).length, 1, "no second request");
    assert.match(await page.locator("[data-testid=ai-counter]").textContent(), /AI drafts today: 2 of 100/);
    await shot(page, "04-call-list");

    log("Log it on the quote row logs the call and takes the row off");
    await mine.nth(1).locator("[data-testid=call-log]").click();
    await mine.nth(1).locator("[data-testid=call-note]").fill("Left a voicemail about the garage roof");
    await mine.nth(1).locator("[data-testid=call-log-save]").click();
    await page.waitForFunction(() => !document.body.innerText.includes("QUO-1000 for $8,500.00 out"));
    const logged = await sql(`SELECT type, body, "userId" FROM "Activity" WHERE "contactId" = $1`, [quinn]);
    assert.deepEqual(logged.rows, [{ type: "PHONE_CALL", body: "Left a voicemail about the garage roof", userId: taylor.id }]);
    const quinnEv = (await sql(`SELECT "doneAt", "activityId" FROM "CalendarEvent" WHERE id = $1`, [quinnFollow])).rows[0];
    assert.ok(quinnEv.doneAt && quinnEv.activityId, "the folded follow-up is ticked and carries the log");

    log("Mark held moves Mia to Meeting Completed and ticks the meeting");
    await page.reload();
    await page.locator("[data-testid=call-held]").click();
    await page.waitForFunction(() => !document.body.innerText.includes("It isn't marked held yet"));
    assert.equal((await sql(`SELECT status FROM "Contact" WHERE id = $1`, [mia])).rows[0].status, "MEETING_COMPLETED");
    const miaEv = (await sql(`SELECT "doneAt", "activityId" FROM "CalendarEvent" WHERE id = $1`, [miaEvent])).rows[0];
    assert.ok(miaEv.doneAt && miaEv.activityId, "meeting ticked and in her history");

    log("an owner can open Nic's list: the contract about to archive");
    await page.goto(`${BASE}/dashboard/call-list?whose=${nicId}`);
    const nicRows = page.locator("[data-testid=call-rows]").first().locator("[data-testid=call-row]");
    assert.equal(await nicRows.count(), 1);
    assert.equal(await nicRows.locator("[data-testid=call-reason]").textContent(), 'Contract on "Warehouse reroof" ($12,000.00) out 82 days — archives in 8 days');
    await page.goto(`${BASE}/dashboard/call-list?whose=everyone`);
    assert.ok((await page.locator("[data-testid=call-row]").allTextContents()).some((text) => text.includes("Nic Rivera")), "Everyone shows whose each row is");

    log("Overview shows the top of today's calls");
    await page.goto(`${BASE}/dashboard`);
    const overview = page.locator("[data-testid=overview-calls] [data-testid=call-row]");
    assert.ok((await overview.count()) >= 1);
    assert.ok((await overview.allTextContents()).some((text) => text.includes("Ivy Interested")));

    log("a Member sees only their own list, with no Whose list picker");
    const nicContext = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    const nicPage = await nicContext.newPage();
    await login(nicPage, NIC_EMAIL);
    await nicPage.goto(`${BASE}/dashboard/call-list?whose=${taylor.id}`);
    assert.equal(await nicPage.locator("[data-testid=call-whose]").count(), 0);
    const nicOwn = nicPage.locator("[data-testid=call-rows]").first().locator("[data-testid=call-row]");
    assert.equal(await nicOwn.count(), 1);
    assert.ok((await nicOwn.textContent()).includes("Carla Contract"));
    await nicContext.close();

    /* ------------------------------ Meeting notes ------------------------------ */

    log("Meeting notes reads two lines into a checklist with catalog prices, dropping a bogus product");
    const rosa = await contact(org, { name: "Rosa Roof", phone: "512-555-0700", companyId: acme, status: "MEETING_SET" });
    await page.goto(`${BASE}/dashboard/contacts/${rosa}`);
    await page.locator("[data-testid=notes-open]").click();
    await page.locator("[data-testid=notes-text]").fill("Walked the roof, they want the north side first, budget around 40k, decision by the 15th.");
    await page.locator("[data-testid=notes-read]").click();
    await page.locator("[data-testid=notes-proposal]").waitFor();
    assert.equal(await page.locator("[data-testid=notes-summary]").inputValue(), "Walked the roof; north side first, budget about $40k, decision by the 15th.");
    assert.ok(await page.locator("[data-testid=notes-held]").isChecked());
    const lines = page.locator("[data-testid=notes-lines] tbody tr");
    assert.equal(await lines.count(), 2, "P999 was dropped");
    assert.ok((await lines.nth(0).textContent()).includes("$40.00"), "price is the catalog's");
    assert.match(await page.locator("[data-testid=notes-total]").textContent(), /Total \$2,560\.00 · their budget \$40,000\.00/);
    assert.ok((await page.locator("[data-testid=notes-missing]").textContent()).includes("Skylight flashing"));
    const notesRequest = ai.requests.at(-1).body;
    assert.equal(notesRequest.output_config.effort, "medium");
    assert.ok(notesRequest.messages[0].content.includes("Roofing labor | $85.00"), "the catalog went in with its prices");
    assert.equal((await sql(`SELECT status FROM "Contact" WHERE id = $1`, [rosa])).rows[0].status, "MEETING_SET", "reading changes nothing");
    await shot(page, "05-meeting-notes");

    log("Apply logs it, marks it held, books the follow-up and opens a Draft quote");
    const followOn = await page.locator("[data-testid=notes-follow-on]").inputValue();
    await page.locator("[data-testid=notes-apply]").click();
    await page.waitForURL(/\/dashboard\/quotes\/[a-z0-9_]+$/);
    const draft = (
      await sql(
        `SELECT q.status, q.title, q."leadSalesRepId", d.stage FROM "Quote" q JOIN "Deal" d ON d.id = q."dealId" WHERE q."contactId" = $1`,
        [rosa],
      )
    ).rows;
    assert.deepEqual(draft, [{ status: "DRAFT", title: "North roof", leadSalesRepId: taylor.id, stage: "LEAD" }]);
    const draftLines = (
      await sql(`SELECT l.name, l.quantity, l."unitPriceCents", l.tag FROM "QuoteLineItem" l JOIN "Quote" q ON q.id = l."quoteId" WHERE q."contactId" = $1 ORDER BY l.position`, [rosa])
    ).rows;
    assert.deepEqual(draftLines, [
      { name: "Architectural shingle bundle", quantity: 30, unitPriceCents: 4000, tag: "MATERIALS" },
      { name: "Roofing labor", quantity: 16, unitPriceCents: 8500, tag: "LABOR" },
    ]);
    assert.equal((await sql(`SELECT status FROM "Contact" WHERE id = $1`, [rosa])).rows[0].status, "MEETING_COMPLETED");
    const rosaLog = (await sql(`SELECT type, body FROM "Activity" WHERE "contactId" = $1`, [rosa])).rows;
    assert.equal(rosaLog.length, 1);
    assert.equal(rosaLog[0].type, "MEETING");
    assert.ok(rosaLog[0].body.startsWith("Walked the roof; north side first") && rosaLog[0].body.includes("Notes as typed: Walked the roof, they want"));
    const follow = (await sql(`SELECT type, to_char("startOn", 'YYYY-MM-DD') AS on, notes, "doneAt" FROM "CalendarEvent" WHERE "contactId" = $1 AND type = 'Call'`, [rosa])).rows;
    assert.deepEqual(follow, [{ type: "Call", on: followOn, notes: "Check on the north roof decision", doneAt: null }]);

    log("from the calendar: How did it go? on a Meeting opens the same notes, and ticks the entry");
    const tess = await contact(org, { name: "Tess Today", status: "MEETING_SET" });
    const tessEvent = id("ev");
    await sql(`INSERT INTO "CalendarEvent" (id, "organizationId", title, type, "startOn", "contactId", "ownerId", "updatedAt") VALUES ($1,$2,'Meeting · Tess Today','Meeting',$3,$4,$5,now())`, [
      tessEvent,
      org,
      today,
      tess,
      taylor.id,
    ]);
    await page.goto(`${BASE}/dashboard/calendar?layout=log`);
    const entry = page.locator("[data-testid=log-upcoming] [data-testid=log-row]", { hasText: "Tess Today" }).first();
    await entry.locator("[data-testid=log-done]").click();
    await page.locator("[data-testid=done-box]").waitFor();
    await page.locator("[data-testid=done-box] [data-testid=notes-open]").click();
    await page.locator("[data-testid=notes-text]").fill("Quick meeting, walked the roof, north side first.");
    await page.locator("[data-testid=notes-read]").click();
    await page.locator("[data-testid=notes-proposal]").waitFor();
    await page.locator("[data-testid=notes-follow]").uncheck();
    await page.locator("[data-testid=notes-quote]").uncheck();
    await page.locator("[data-testid=notes-apply]").click();
    await page.locator("[data-testid=notes-done]").waitFor();
    await page.locator("[data-testid=notes-dialog]").getByRole("button", { name: "Close", exact: true }).last().click();
    await page.locator("[data-testid=done-box]").waitFor({ state: "detached" });
    const tessEv = (await sql(`SELECT "doneAt", "activityId" FROM "CalendarEvent" WHERE id = $1`, [tessEvent])).rows[0];
    assert.ok(tessEv.doneAt && tessEv.activityId, "the entry is ticked and carries the log");
    assert.equal((await sql(`SELECT count(*)::int AS n FROM "Quote" WHERE "contactId" = $1`, [tess])).rows[0].n, 0, "unticked quote not made");
    assert.equal((await sql(`SELECT count(*)::int AS n FROM "CalendarEvent" WHERE "contactId" = $1`, [tess])).rows[0].n, 1, "no follow-up booked");
    assert.equal((await sql(`SELECT status FROM "Contact" WHERE id = $1`, [tess])).rows[0].status, "MEETING_COMPLETED");

    /* -------------------------------- Forecast -------------------------------- */

    log("Stats shows the forecast: low confidence, the months, the dragging contract");
    await page.goto(`${BASE}/dashboard/stats`);
    const forecast = page.locator("[data-testid=forecast]");
    assert.ok((await forecast.locator("[data-testid=forecast-low]").textContent()).startsWith("Low confidence"));
    assert.equal(await forecast.locator("[data-testid=forecast-bucket]").count(), 3);
    const dragging = await forecast.locator("[data-testid=forecast-dragging]").textContent();
    assert.ok(dragging.includes("Warehouse reroof") && dragging.includes("82 days") && dragging.includes("halved to 30%"), dragging);
    const rates = await forecast.locator("[data-testid=forecast-rates]").textContent();
    assert.ok(rates.includes("No Quote Sent deal has closed yet, so this uses a starting guess: 30% sign"), rates);
    const bucketText = await forecast.locator("[data-testid=forecast-buckets]").textContent();
    // Garage roof: $8,500 × 30% = $2,550 this month; the dragging contract $12,000 × 30% = $3,600 this month too.
    assert.ok(bucketText.includes("$6,150.00"), bucketText);
    await forecast.locator("[data-testid=forecast-read]").click();
    await forecast.getByText("FAKE FORECAST READING: one contract is dragging.").waitFor();
    await shot(page, "06-forecast");

    log("Nic's filter narrows the forecast to his deals");
    await page.goto(`${BASE}/dashboard/stats?reps=${nicId}`);
    const nicForecast = await page.locator("[data-testid=forecast-buckets]").textContent();
    assert.ok(nicForecast.includes("$3,600.00") && !nicForecast.includes("$6,150.00"), nicForecast);

    /* ------------------------- The allowance and failure ------------------------ */

    log("the 100-a-day allowance stops the next draft with a plain message");
    await sql(
      `INSERT INTO "AiUsage" (id, "organizationId", "userId", feature, ok) SELECT 'aiu_aitank_' || g, $1, $2, 'test', true FROM generate_series(1, 100) g`,
      [org, taylor.id],
    );
    const beforeCap = ai.requests.length;
    await page.goto(`${BASE}/dashboard/contacts/${ivy}`);
    await page.locator("[data-testid=briefing-write]").click();
    await page.getByText("You've used today's 100 AI drafts. They reset at midnight.").waitFor();
    assert.equal(ai.requests.length, beforeCap, "nothing was sent to the AI");
    await sql(`DELETE FROM "AiUsage" WHERE id LIKE 'aiu_aitank_%'`);

    log("when the AI is down the lists still stand, and the error is plain");
    ai.mode = "fail";
    await page.goto(`${BASE}/dashboard/contacts/${carla}`);
    await page.locator("[data-testid=briefing-write]").click();
    await page.getByText("Couldn't reach the AI just now. Everything else still works; try again shortly.").waitFor();
    assert.ok(await page.locator("[data-testid=briefing-facts]").isVisible(), "facts still shown");
    await page.goto(`${BASE}/dashboard/call-list?whose=${nicId}`);
    const outageRows = page.locator("[data-testid=call-rows]").first().locator("[data-testid=call-row]");
    assert.equal(await outageRows.count(), 1, "the list renders without openers");
    assert.ok((await outageRows.textContent()).includes("Warehouse reroof"));
    const failed = await sql(`SELECT count(*)::int AS n FROM "AiUsage" WHERE "organizationId" = $1 AND ok = false`, [org]);
    assert.ok(failed.rows[0].n >= 1, "a failure is recorded but not counted against the allowance");
    ai.mode = "ok";

    log("the Call List fits a phone without sideways scrolling");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/dashboard/call-list`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 1, `page is ${overflow}px wider than the phone`);
    await shot(page, "07-call-list-phone");

    console.log(`\nAll ${step} steps passed. Screenshots in ${OUT}`);
  } finally {
    await browser.close();
    fakeAi.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
