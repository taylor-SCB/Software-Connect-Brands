/* Browser regression for Release B of the AI release (Nov 12, 2026):
 * contracts and compliance.
 *
 * Covers: the rules behind every check (scripts/contract-checks-check.ts,
 * run first); B1 the price check before Create on the Contract
 * Coordinator (under cost, under the starred supplier's minimum, a unit
 * that isn't the product's, a discount bigger than the margin; Claude's
 * plain line used, one with an invented number and an unknown id left
 * out, Go back and fix, the kept answer, Create anyway, a clean grid
 * creating with no list); B2 read before send (the wording's total and a
 * quote row changed since, by rule; Claude's wording item kept, one whose
 * words aren't in the contract and one with an invented number dropped;
 * asked once per version; a fixed contract sending straight away; a
 * refusal shown as a sentence with Send anyway); B3 the redline reader
 * (a Word file with tracked changes, Accept / Reject, a change that
 * couldn't be placed, a sent contract pulled back to draft after a
 * confirmation, nothing saved until Save, the copy kept and downloadable;
 * a PDF sent as a PDF in pieces and a cut-off answer discarding it; photos
 * made small); B4 dates in a signed contract (written dates and days after
 * signing, a wrong date and an unquoted duty dropped, No date given, one
 * already on the calendar, ticked ones onto the rep's calendar, kept so
 * the page doesn't ask again, never on the signing page); B5 the
 * compliance watchdog (a PDF read into the form, a limit not in the file
 * left blank, the 30-day flag on the tile, a name made out to someone
 * else, a subcontractor's COI from a photo on their crew card, the crew
 * badge and the job banner, a Member, the daily allowance); the phone
 * width; and, against a second server started without the key, every AI
 * control hidden while the rules still run.
 *
 * Claude is never called: fake-claude.cjs answers on :3995. Start the
 * server with ANTHROPIC_API_KEY=test-key and
 * ANTHROPIC_ENDPOINT=http://localhost:3995 (run-suites.sh's "ai" group
 * does). The "AI off" steps start their own second server from the same
 * build on NOAI_PORT (default 3117) with an empty key; pass NOAI_BASE to
 * use one already running instead.
 *
 *   BASE=http://localhost:3400 \
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/scb_b \
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules \
 *   node scripts/browser-tests/ai-release-b.cjs
 */
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS on purpose: NODE_PATH only resolves the global playwright for require() */
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { spawn, execFileSync } = require("node:child_process");
const { chromium } = require("playwright");
const { Client } = require("pg");
const { zipSync, strToU8 } = require("fflate");
const { startFakeClaude } = require("./fake-claude.cjs");

const BASE = process.env.BASE || "http://localhost:3000";
const DB = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5433/scb_b";
const NOAI_PORT = Number(process.env.NOAI_PORT || 3117);
let NOAI_BASE = process.env.NOAI_BASE || "";
const OUT = process.env.SHOTS_DIR || path.join(os.tmpdir(), "scb-browser-shots-ai-release-b");
fs.mkdirSync(OUT, { recursive: true });
const ROOT = path.resolve(__dirname, "../..");

const EMAIL = "test-ai-release-b@example.com";
const MEMBER_EMAIL = "test-ai-release-b-member@example.com";
const PASSWORD = "password123";
const COMPANY = "Test AI Release B Co";
const SLUG_LIKE = "test-ai-release-b-co%";

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
async function until(check, what, ms = 10000) {
  const end = Date.now() + ms;
  for (;;) {
    if (await check()) return;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}
async function login(page, email, base = BASE) {
  await page.goto(`${base}/login`);
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/dashboard/);
}
async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
}
async function noSideScroll(page, what) {
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(wide <= 1, `${what} scrolls sideways by ${wide}px`);
}

/* ------------------------------ files built here ------------------------------ */

// A one-page PDF with real text, offsets and all, so pdf.js reads its words.
function makePdf(lines, padBytes = 0) {
  const esc = (text) => text.replace(/[\\()]/g, (c) => `\\${c}`);
  const content = `BT /F1 11 Tf 50 760 Td ${lines.map((line, i) => `${i ? "0 -15 Td " : ""}(${esc(line)}) Tj`).join(" ")} ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((n) => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  // Padding after the end (a scanner's leftovers): read past, never parsed.
  return Buffer.concat([Buffer.from(out, "latin1"), Buffer.alloc(padBytes, 0x20)]);
}

// A Word file whose second paragraph carries a tracked deletion and insertion.
function makeDocx(paragraphs) {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const body = paragraphs
    .map((p) => (typeof p === "string" ? `<w:p><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>` : `<w:p>${p.xml}</w:p>`))
    .join("");
  return Buffer.from(
    zipSync({
      "[Content_Types].xml": strToU8(
        '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      ),
      "_rels/.rels": strToU8(
        '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      ),
      "word/document.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${body}</w:body></w:document>`),
    }),
  );
}

// The width and height of a JPEG, from its first frame header.
function jpegSize(base64) {
  const bytes = Buffer.from(base64, "base64");
  assert.equal(bytes[0], 0xff, "a JPEG");
  assert.equal(bytes[1], 0xd8, "a JPEG");
  let at = 2;
  while (at < bytes.length) {
    const marker = bytes[at + 1];
    const length = bytes.readUInt16BE(at + 2);
    if (marker >= 0xc0 && marker <= 0xc3) return { height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7) };
    at += 2 + length;
  }
  throw new Error("no frame header");
}
const imageBlocks = (request) => request.body.messages[0].content.filter((block) => block.type === "image");

// A big PNG drawn in the browser (a phone photo's size), as bytes.
async function bigPng(page, label, width = 3000, height = 2000) {
  const dataUrl = await page.evaluate(
    ({ label, width, height }) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fafafa";
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = "#111";
      ctx.font = "120px sans-serif";
      for (let y = 200; y < height; y += 260) ctx.fillText(`${label} ${y}`, 100, y);
      return canvas.toDataURL("image/png");
    },
    { label, width, height },
  );
  return Buffer.from(dataUrl.split(",")[1], "base64");
}

let noAiServer = null;
async function startNoAiServer() {
  if (NOAI_BASE) return;
  noAiServer = spawn("npx", ["next", "start", "-p", String(NOAI_PORT)], {
    cwd: ROOT,
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
function stopNoAiServer() {
  if (!noAiServer) return;
  try {
    process.kill(-noAiServer.pid, "SIGTERM");
  } catch {
    /* already gone */
  }
}

(async () => {
  log("the rules behind every check (scripts/contract-checks-check.ts)");
  const rules = execFileSync("npx", ["tsx", "scripts/contract-checks-check.ts"], { cwd: ROOT, encoding: "utf8" });
  assert.match(rules, /contract-checks: \d+ cases passed/);

  const claude = await startFakeClaude();
  const browser = await chromium.launch();
  try {
    await sql(`DELETE FROM "Organization" WHERE slug LIKE $1`, [SLUG_LIKE]);
    await sql(`DELETE FROM "User" WHERE email = ANY($1)`, [[EMAIL, MEMBER_EMAIL]]);
    const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
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
    await login(page, EMAIL);
    const org = (await one(`SELECT id FROM "Organization" WHERE slug LIKE $1`, [SLUG_LIKE])).id;
    const owner = await one(`SELECT id, "passwordHash" FROM "User" WHERE email=$1`, [EMAIL]);

    log("seed: a customer, a catalog with a starred supplier, two deals with quotes");
    await sql(
      `INSERT INTO "Company" (id,"organizationId",name,"updatedAt") VALUES
         ('rb_co',$1,'Harbor Dental',now()), ('rb_sup',$1,'Wire Supply',now()), ('rb_sparky',$1,'Sparky Electric LLC',now())`,
      [org],
    );
    await sql(
      `INSERT INTO "Contact" (id,"organizationId","companyId",name,email,status,"updatedAt") VALUES
         ('rb_pat',$1,'rb_co','Pat Harbor','pat@harbordental.com','MEETING_COMPLETED',now())`,
      [org],
    );
    await sql(`INSERT INTO "Distributor" (id,"organizationId",name,"updatedAt") VALUES ('rb_dist',$1,'Wire Supply',now())`, [org]);
    await sql(
      `INSERT INTO "Product" (id,"organizationId",name,"costCents","unitPriceCents","unitOfMeasure","distributorId","updatedAt") VALUES
         ('rb_thermo',$1,'Smart thermostat',10000,15000,'EACH','rb_dist',now()),
         ('rb_cable',$1,'Cable run',200,300,'PER_LINEAR_FT',NULL,now()),
         ('rb_labor',$1,'Install labor',40000,50000,NULL,NULL,now())`,
      [org],
    );
    // Starred supplier with a 30% minimum margin: $100 / 0.7 = $142.86.
    await sql(
      `INSERT INTO "ProductSupplier" (id,"organizationId","productId","distributorId","costCents","minMarginBp","preferredFor","updatedAt")
       VALUES ('rb_ps',$1,'rb_thermo','rb_dist',10000,3000,'rb_thermo',now())`,
      [org],
    );
    await sql(
      `INSERT INTO "Deal" (id,"organizationId","contactId",title,stage,"ownerId","updatedAt") VALUES
         ('rb_deal1',$1,'rb_pat','Office upgrade','QUOTE_SENT',$2,now()),
         ('rb_deal2',$1,'rb_pat','Lobby thermostat','QUOTE_SENT',$2,now())`,
      [org, owner.id],
    );
    // A $200 discount on the whole first quote, more than its $105 margin.
    await sql(
      `INSERT INTO "Quote" (id,"organizationId","contactId","dealId",number,title,status,"publicToken","discountCents","updatedAt") VALUES
         ('rb_q1',$1,'rb_pat','rb_deal1',1000,'Office upgrade quote','SENT','tok_rb_q1_0123456789',20000,now()),
         ('rb_q2',$1,'rb_pat','rb_deal2',1001,'Lobby quote','SENT','tok_rb_q2_0123456789',0,now())`,
      [org],
    );
    await sql(
      `INSERT INTO "QuoteLineItem" (id,"quoteId","productId",name,quantity,"unitPriceCents",tag,"unitOfMeasure",position) VALUES
         ('rb_l1','rb_q1','rb_thermo','Smart thermostat',2,9000,'MATERIALS','EACH',0),
         ('rb_l2','rb_q1','rb_thermo','Smart thermostat (lobby)',1,12000,'MATERIALS','EACH',1),
         ('rb_l3','rb_q1','rb_cable','Cable run',10,250,'MATERIALS','EACH',2),
         ('rb_l4','rb_q1','rb_labor','Install labor',1,50000,'LABOR',NULL,3),
         ('rb_l5','rb_q2','rb_thermo','Smart thermostat',1,20000,'MATERIALS','EACH',0)`,
    );

    /* ------------------------------ B1: price check ------------------------------ */

    log("B1: Create on the Coordinator shows what the rules found, before anything is made");
    let explainCalls = 0;
    claude.reply("PRICE_CHECK", (request) => {
      explainCalls += 1;
      const findings = JSON.parse(request.text.split("Findings (JSON):\n")[1].split("\n\nWrite one line")[0]);
      return {
        lines: findings.flatMap((finding) => {
          if (finding.id.endsWith(":cost")) return [{ id: finding.id, line: `Two thermostats at ${finding.facts.rowTotal} sell under their ${finding.facts.cost} cost, so you lose money on them.` }];
          if (finding.id.endsWith(":min")) return [{ id: finding.id, line: "This one is $999 under the minimum." }];
          if (finding.id.endsWith(":unit")) return [{ id: finding.id, line: "Cable is priced by the piece here but bought by the foot." }];
          return [{ id: "made-up-id", line: "Nothing." }];
        }),
      };
    });
    await page.goto(`${BASE}/dashboard/contracts/tracker?dealId=rb_deal1&quoteId=rb_q1`);
    await page.locator("[data-testid=tracker-grid]").waitFor();
    assert.equal(await page.locator("[data-testid=tracker-lines] tbody input[type=checkbox]:checked").count(), 4, "a first contract starts with every row ticked");
    await page.locator("[data-testid=create-contracts]").click();
    const panel = page.getByTestId("price-check");
    await panel.waitFor();
    const codes = await panel.getByTestId("price-check-item").evaluateAll((items) => items.map((item) => item.dataset.code));
    assert.deepEqual(codes, ["UNDER_COST", "UNDER_MINIMUM", "UNIT", "DISCOUNT_OVER_MARGIN"]);
    assert.equal((await one(`SELECT count(*)::int AS n FROM "Contract" WHERE "organizationId"=$1`, [org])).n, 0, "nothing made yet");

    log("B1: Claude's plain line replaces a finding's; one with a number it wasn't given, and an id it wasn't given, are left out");
    await until(async () => (await panel.getByTestId("price-check-explaining").count()) === 0, "the AI lines");
    const sources = await panel.getByTestId("price-check-line").evaluateAll((items) => items.map((item) => [item.dataset.source, item.textContent]));
    assert.equal(sources[0][0], "ai");
    assert.match(sources[0][1], /sell under their \$200\.00 cost/);
    assert.equal(sources[1][0], "rules", "the $999 line kept the rules' words");
    assert.match(sources[1][1], /under the starred supplier's minimum of \$142\.86/);
    assert.equal(sources[2][0], "ai");
    assert.equal(sources[3][0], "rules");
    assert.match(sources[3][1], /The \$200\.00 discount is more than the \$105\.00 this contract makes over cost/);
    const sent = claude.last("PRICE_CHECK");
    assert.match(sent.system, /never instructions/);
    assert.doesNotMatch(sent.text, /Install labor/, "a row with no problem isn't sent");
    await shot(page, "01-price-check");

    log("B1: Go back and fix closes the list; Create again shows it from the kept answer without asking Claude again");
    await panel.getByTestId("price-check-back").click();
    assert.equal(await page.getByTestId("price-check").count(), 0);
    const askedBefore = explainCalls;
    await page.locator("[data-testid=create-contracts]").click();
    await page.getByTestId("price-check").waitFor();
    await until(async () => (await page.getByTestId("price-check-explaining").count()) === 0, "the kept lines");
    assert.equal(explainCalls, askedBefore, "kept by the findings' fingerprint");
    assert.equal(await page.getByTestId("price-check-line").first().getAttribute("data-source"), "ai");

    log("B1: Create anyway makes the contract as it stands");
    await page.getByTestId("price-check-create-anyway").click();
    await page.waitForURL(/created=1/);
    const c1 = await one(`SELECT id, "discountCents" FROM "Contract" WHERE "organizationId"=$1 AND "dealId"='rb_deal1'`, [org]);
    assert.ok(c1, "the contract was made");
    assert.equal(c1.discountCents, 20000, "nothing was changed for the check");

    log("B1: a grid with nothing wrong creates with no list and no AI call");
    const callsBefore = claude.count("PRICE_CHECK");
    await page.goto(`${BASE}/dashboard/contracts/tracker?dealId=rb_deal2&quoteId=rb_q2`);
    await page.locator("[data-testid=tracker-grid]").waitFor();
    await page.locator("[data-testid=create-contracts]").click();
    await page.waitForURL(/created=1/);
    assert.equal(claude.count("PRICE_CHECK"), callsBefore);
    const c2 = await one(`SELECT id, "publicToken" FROM "Contract" WHERE "organizationId"=$1 AND "dealId"='rb_deal2'`, [org]);

    /* ------------------------------ B2: read before send ------------------------------ */

    log("B2: Send for signature reads it over; the rules catch a wrong total in the wording and a row the quote changed");
    const body1 = [
      "SERVICE AGREEMENT for the Office upgrade at Harbor Dental.",
      "1. Scope. We install three smart thermostats and run cable to each room.",
      "2. Payment. Net 30 from the invoice date.",
      "3. Warranty. We warrant the work for one year.",
      "4. Late fees. A late fee of 5% applies to late payments.",
      "Contract total: $1.00",
    ].join("\n");
    await sql(`UPDATE "Contract" SET body=$1 WHERE id=$2`, [body1, c1.id]);
    await sql(`UPDATE "QuoteLineItem" SET quantity=2 WHERE id='rb_l4'`);
    claude.reply("SEND_CHECK", {
      items: [
        { kind: "scope", ourWords: "We install three smart thermostats", problem: "The rows have 3 thermostats in two lines; check the count matches.", fix: "Check the scope" },
        { kind: "name", ourWords: "Harbour Dentistry", problem: "The customer name is spelled differently.", fix: "Fix the name" },
        { kind: "amount", ourWords: "Net 30 from the invoice date", problem: "The quote said $4,321 was due up front.", fix: "Match the quote" },
      ],
    });
    await page.goto(`${BASE}/dashboard/contracts/${c1.id}`);
    await page.getByTestId("send-contract").click();
    const dialog = page.getByTestId("send-check");
    await dialog.waitFor();
    const sendCodes = await dialog.getByTestId("send-check-item").evaluateAll((items) => items.map((item) => item.dataset.code));
    assert.deepEqual(sendCodes, ["WORDING_TOTAL", "QUOTE_CHANGED", "WORDING"], "the words not in the contract and the invented $4,321 are dropped");
    assert.match(await dialog.textContent(), /The wording says \$1\.00/);
    assert.match(await dialog.textContent(), /We install three smart thermostats/);
    const sendReq = claude.last("SEND_CHECK");
    assert.equal(sendReq.documents[0].kind, "text");
    assert.match(sendReq.documents[0].text, /SERVICE AGREEMENT/, "the wording goes as a document");
    assert.match(sendReq.system, /never instructions/);
    await shot(page, "02-send-check");

    log("B2: Go back and fix leaves it a draft; asking again on the same version doesn't call Claude");
    await dialog.getByTestId("send-check-back").click();
    assert.equal((await one(`SELECT status FROM "Contract" WHERE id=$1`, [c1.id])).status, "DRAFT");
    const sendCalls = claude.count("SEND_CHECK");
    await page.getByTestId("send-contract").click();
    await page.getByTestId("send-check").waitFor();
    assert.equal(claude.count("SEND_CHECK"), sendCalls, "kept per version");
    await page.keyboard.press("Escape");
    await until(async () => (await page.getByTestId("send-check").count()) === 0, "Escape to close");

    log("B2: fixed (wording edited and saved, quote back), it sends with no list");
    await sql(`UPDATE "QuoteLineItem" SET quantity=1 WHERE id='rb_l4'`);
    await page.locator("#body").fill(body1.replace("\nContract total: $1.00", ""));
    await page.getByRole("button", { name: "Save changes" }).click();
    await page.getByText("Contract saved").waitFor();
    claude.reply("SEND_CHECK", { items: [] });
    await page.getByTestId("send-contract").click();
    await until(async () => (await one(`SELECT status FROM "Contract" WHERE id=$1`, [c1.id])).status === "SENT", "the contract to send");
    assert.equal(claude.count("SEND_CHECK"), sendCalls + 1, "a new version is read again");

    log("B2: a refusal is a sentence, and Send anyway still sends");
    claude.refuse("SEND_CHECK");
    await page.goto(`${BASE}/dashboard/contracts/${c2.id}`);
    await page.getByTestId("send-contract").click();
    await page.getByTestId("send-check").waitFor();
    assert.match(await page.getByTestId("send-check-note").textContent(), /The AI declined this one\..*still send it/);
    await page.getByTestId("send-check-send").click();
    await until(async () => (await one(`SELECT status FROM "Contract" WHERE id=$1`, [c2.id])).status === "SENT", "Send anyway");

    /* ------------------------------ B3: redline reader ------------------------------ */

    log("B3: their Word file with tracked changes is read against our wording");
    claude.reply("REDLINE", {
      changes: [
        { ourWords: "Net 30 from the invoice date.", theirWords: "Net 45 from the invoice date.", deleted: false, explanation: "They want 45 days to pay instead of 30." },
        { ourWords: "A late fee of 5% applies to late payments.", theirWords: "", deleted: true, explanation: "They struck out the late fee." },
        { ourWords: "We paint every wall", theirWords: "Painting included.", deleted: false, explanation: "They added painting." },
        { ourWords: "the", theirWords: "a", deleted: false, explanation: "A word changed." },
      ],
    });
    const docx = makeDocx([
      "SERVICE AGREEMENT for the Office upgrade at Harbor Dental.",
      {
        xml:
          '<w:r><w:t xml:space="preserve">2. Payment. </w:t></w:r><w:del w:id="1" w:author="Pat"><w:r><w:delText>Net 30</w:delText></w:r></w:del><w:ins w:id="2" w:author="Pat"><w:r><w:t>Net 45</w:t></w:r></w:ins><w:r><w:t xml:space="preserve"> from the invoice date.</w:t></w:r>',
      },
      "3. Warranty. We warrant the work for one year.",
    ]);
    await page.goto(`${BASE}/dashboard/contracts/${c1.id}`);
    await page.getByTestId("redline-file").setInputFiles({ name: "harbor-markup.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: docx });
    await page.getByTestId("redline-result").waitFor({ timeout: 20000 });
    const redReq = claude.last("REDLINE");
    assert.deepEqual(
      redReq.documents.map((doc) => doc.title),
      ["OUR wording (the contract as we sent it)", "THEIR marked-up copy (the Word file's text)", "Tracked changes in their Word file"],
    );
    assert.match(redReq.documents[2].text, /INSERTED: Net 45/);
    assert.match(redReq.documents[2].text, /DELETED: Net 30/);
    assert.equal(await page.getByTestId("redline-change").count(), 2);
    assert.equal(await page.getByTestId("redline-unplaced-item").count(), 2, "words not in ours, and words in ours more than once");
    assert.match(await page.getByTestId("redline-unplaced").textContent(), /Painting included/);
    const kept = await sql(`SELECT "fileName", "sizeBytes", complete, octet_length(data)::int AS n FROM "ContractFile" WHERE "contractId"=$1`, [c1.id]);
    assert.equal(kept.rows.length, 1);
    assert.deepEqual([kept.rows[0].fileName, kept.rows[0].complete, kept.rows[0].n], ["harbor-markup.docx", true, docx.length]);

    log("B3: Accept one, Reject one; a sent contract is pulled back to draft only after a confirmation; nothing saved until Save");
    await page.getByTestId("redline-change").nth(0).getByTestId("redline-accept").click();
    await page.getByTestId("redline-change").nth(1).getByTestId("redline-reject").click();
    await page.getByTestId("redline-put-in").click();
    await page.getByTestId("redline-pull-back").waitFor();
    assert.equal((await one(`SELECT status FROM "Contract" WHERE id=$1`, [c1.id])).status, "SENT", "not until they say so");
    await page.getByTestId("redline-pull-back-yes").click();
    await page.getByTestId("redline-draft-note").waitFor();
    assert.equal((await one(`SELECT status FROM "Contract" WHERE id=$1`, [c1.id])).status, "DRAFT");
    const draftBody = await page.locator("#body").inputValue();
    assert.match(draftBody, /Net 45 from the invoice date\./);
    assert.match(draftBody, /A late fee of 5% applies/, "the rejected change is left alone");
    assert.match((await one(`SELECT body FROM "Contract" WHERE id=$1`, [c1.id])).body, /Net 30/, "nothing saved yet");
    await page.getByRole("button", { name: "Save changes" }).click();
    await page.getByText("Contract saved").waitFor();
    assert.match((await one(`SELECT body FROM "Contract" WHERE id=$1`, [c1.id])).body, /Net 45 from the invoice date\./);
    assert.equal(await page.getByTestId("redline-draft-note").count(), 0, "the draft note goes with the save");

    log("B3: their copy stays on the contract and downloads");
    const fileLink = page.getByTestId("redline-files").getByRole("link", { name: /harbor-markup\.docx/ });
    const download = await page.request.get(`${BASE}${await fileLink.getAttribute("href")}`);
    assert.equal(download.status(), 200);
    assert.equal((await download.body()).length, docx.length);
    const stranger = await browser.newContext();
    const anon = await stranger.request.get(`${BASE}${await fileLink.getAttribute("href")}`, { maxRedirects: 0 });
    assert.notEqual(anon.status(), 200, "not without a login");
    await stranger.close();

    log("B3: a PDF over the request limit goes in pieces and is sent as a PDF; a cut-off answer is a sentence and the upload is let go");
    claude.cutOff("REDLINE");
    const bigPdf = makePdf(["SERVICE AGREEMENT", "2. Payment. Net 60 from the invoice date."], 6 * 1024 * 1024);
    await page.getByTestId("redline-file").setInputFiles({ name: "scan.pdf", mimeType: "application/pdf", buffer: bigPdf });
    await page.getByTestId("redline-error").waitFor({ timeout: 30000 });
    assert.match(await page.getByTestId("redline-error").textContent(), /cut short/);
    assert.equal(claude.last("REDLINE").documents.find((doc) => doc.kind === "pdf")?.title, "THEIR marked-up copy");
    const pdfSent = claude.last("REDLINE").body.messages[0].content.find((block) => block.type === "document" && block.source.type === "base64");
    assert.equal(Buffer.from(pdfSent.source.data, "base64").length, bigPdf.length, "every piece arrived");
    assert.equal((await one(`SELECT count(*)::int AS n FROM "ContractFile" WHERE "contractId"=$1`, [c1.id])).n, 1, "the failed upload isn't kept");

    log("B3: photos of the pages are made small in the browser before they are sent");
    claude.reply("REDLINE", { changes: [] });
    const photos = [await bigPng(page, "page one"), await bigPng(page, "page two")];
    await page.getByTestId("redline-file").setInputFiles(photos.map((buffer, i) => ({ name: `page-${i + 1}.png`, mimeType: "image/png", buffer })));
    await page.getByText("No changes found in their copy.").waitFor({ timeout: 30000 });
    const photoReq = claude.last("REDLINE");
    assert.equal(photoReq.images, 2);
    for (const block of imageBlocks(photoReq)) {
      assert.equal(block.source.media_type, "image/jpeg");
      const size = jpegSize(block.source.data);
      assert.ok(Math.max(size.width, size.height) <= 1568, `sent at ${size.width}x${size.height}`);
    }
    assert.equal((await one(`SELECT count(*)::int AS n FROM "ContractFile" WHERE "contractId"=$1 AND "mimeType"='image/jpeg'`, [c1.id])).n, 2);

    /* ------------------------------ B4: dates ------------------------------ */

    log("B4: a signed contract offers Dates in this contract; the signing page never does");
    const body2 = [
      "SERVICE AGREEMENT for the Lobby thermostat.",
      "The deposit is due within ten (10) days after signing.",
      "Work will start by March 3, 2027.",
      "A warranty walk happens 1 year after signing.",
      "Insurance renews on December 31, 2027.",
      "Kickoff meeting on November 12, 2026.",
      "Either party may end this agreement with written notice.",
    ].join("\n");
    await sql(`UPDATE "Contract" SET body=$1 WHERE id=$2`, [body2, c2.id]);
    await page.goto(`${BASE}/c/${c2.publicToken}`);
    assert.equal(await page.getByTestId("contract-dates").count(), 0);
    await page.goto(`${BASE}/dashboard/contracts/${c2.id}`);
    await page.getByTestId("mark-signed").first().click();
    await page.getByTestId("mark-signed-date").fill("2026-11-12");
    await page.getByTestId("mark-signed-save").click();
    await page.getByTestId("contract-dates-read").waitFor();
    assert.equal(claude.count("CONTRACT_DATES"), 0, "never read on page load");

    log("B4: Find the dates: written and counted dates kept, a wrong date and an unquoted duty dropped, no date listed, one already on the calendar");
    claude.reply("CONTRACT_DATES", {
      duties: [
        { title: "Deposit due", kind: "deposit", snippet: "The deposit is due within ten (10) days after signing.", writtenDate: null, afterSigning: { count: 10, unit: "days" } },
        { title: "Start work by", kind: "start", snippet: "Work will start by March 3, 2027.", writtenDate: "2027-03-03", afterSigning: null },
        { title: "Warranty walk", kind: "warranty", snippet: "A warranty walk happens 1 year after signing.", writtenDate: null, afterSigning: { count: 1, unit: "years" } },
        { title: "Insurance renewal", kind: "insurance", snippet: "Insurance renews on December 31, 2027.", writtenDate: "2027-12-30", afterSigning: null },
        { title: "Final payment", kind: "payment", snippet: "Final payment due on completion of punch list.", writtenDate: "2027-05-01", afterSigning: null },
        { title: "Kickoff meeting", kind: "other", snippet: "Kickoff meeting on November 12, 2026.", writtenDate: "2026-11-12", afterSigning: null },
        { title: "Notice to end", kind: "notice", snippet: "Either party may end this agreement with written notice.", writtenDate: null, afterSigning: null },
      ],
    });
    await page.getByTestId("contract-dates-read").click();
    await page.getByTestId("contract-date").first().waitFor();
    const duties = await page.getByTestId("contract-date").evaluateAll((rows) => rows.map((row) => [row.dataset.state, row.textContent]));
    assert.equal(duties.length, 4, "the wrong date and the unquoted duty are dropped");
    assert.match(duties[0][1], /Deposit due · Nov 22, 2026/);
    assert.match(duties[0][1], /10 days after signing \(2026-11-12\)/);
    assert.match(duties[1][1], /Start work by · Mar 3, 2027/);
    assert.match(duties[2][1], /Warranty walk · Nov 12, 2027/);
    assert.equal(duties[3][0], "already", "the signing day already has Contract closed on it");
    assert.match(duties[3][1], /Already on the calendar/);
    assert.match(await page.getByTestId("contract-dates-undated").textContent(), /Notice to end/);
    const datesReq = claude.last("CONTRACT_DATES");
    assert.match(datesReq.text, /Signed on 2026-11-12/);

    log("B4: ticked dates go on the rep's calendar with the customer and the contract; the page then remembers without asking again");
    await page.getByTestId("contract-date").nth(0).getByTestId("contract-date-tick").check();
    await page.getByTestId("contract-date").nth(1).getByTestId("contract-date-tick").check();
    await page.getByTestId("contract-dates-add").click();
    await page.getByTestId("contract-dates-notice").waitFor();
    const events = (
      await sql(
        `SELECT title, "startOn"::text AS day, "ownerId", "contactId", "companyId", "dealId", type FROM "CalendarEvent" WHERE "contractId"=$1 AND type='Contract date' ORDER BY "startOn"`,
        [c2.id],
      )
    ).rows;
    assert.deepEqual(
      events.map((row) => [row.title, row.day]),
      [
        [`Deposit due · CON-${(await one(`SELECT number FROM "Contract" WHERE id=$1`, [c2.id])).number}`, "2026-11-22"],
        [`Start work by · CON-${(await one(`SELECT number FROM "Contract" WHERE id=$1`, [c2.id])).number}`, "2027-03-03"],
      ],
    );
    assert.ok(events.every((row) => row.ownerId === owner.id && row.contactId === "rb_pat" && row.dealId === "rb_deal2"));
    const datesCalls = claude.count("CONTRACT_DATES");
    await page.reload();
    await page.getByTestId("contract-date").first().waitFor();
    assert.deepEqual(await page.getByTestId("contract-date").evaluateAll((rows) => rows.map((row) => row.dataset.state)), ["added", "added", "open", "already"]);
    assert.equal(claude.count("CONTRACT_DATES"), datesCalls);

    /* ------------------------------ B5: compliance ------------------------------ */

    log("B5: Read it for me fills the upload form from a COI; a limit not in the file is left blank; nothing saved until Upload");
    const soon = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    const coi = makePdf([
      "CERTIFICATE OF LIABILITY INSURANCE",
      `Named insured: ${COMPANY}`,
      "Insurer: Acme Mutual",
      "Policy number GL-12345",
      "Each occurrence 1,000,000",
      `Policy expires ${soon}`,
    ]);
    claude.reply("COMPLIANCE_READ", {
      documentType: "COI",
      title: "General liability COI",
      namedInsured: COMPANY,
      insurer: "Acme Mutual",
      policyNumber: "GL-12345",
      expiresOn: soon,
      limits: [
        { label: "Each occurrence", amount: 1000000 },
        { label: "Made up", amount: 7777777 },
      ],
    });
    await page.goto(`${BASE}/dashboard/settings/compliance`);
    await page.getByTestId("document-upload-COMPLIANCE").getByTestId("document-file").setInputFiles({ name: "coi.pdf", mimeType: "application/pdf", buffer: coi });
    await page.getByTestId("compliance-read").click();
    await page.getByTestId("compliance-read-note").waitFor();
    assert.equal(await page.getByTestId("compliance-named").inputValue(), COMPANY);
    assert.equal(await page.getByTestId("compliance-policy").inputValue(), "GL-12345");
    assert.equal(await page.getByTestId("compliance-expires").inputValue(), soon);
    assert.equal(await page.getByTestId("compliance-limits").inputValue(), "Each occurrence: $1,000,000.00");
    assert.match(await page.getByTestId("compliance-read-note").textContent(), /Left blank because the file doesn't say it: Limit "Made up"/);
    assert.equal(claude.last("COMPLIANCE_READ").documents[0].kind, "pdf");
    assert.equal((await one(`SELECT count(*)::int AS n FROM "Upload" WHERE "organizationId"=$1 AND kind='COMPLIANCE'`, [org])).n, 0);
    await page.getByTestId("document-upload").click();
    await page.getByText("General liability COI uploaded").waitFor();
    const saved = await one(
      `SELECT u.category, u."expiresOn"::text AS expires, ci."namedInsured", ci.insurer, ci."policyNumber", ci.limits, ci."readByAi", ci."crewId"
         FROM "Upload" u JOIN "ComplianceInfo" ci ON ci."uploadId"=u.id WHERE u."organizationId"=$1`,
      [org],
    );
    assert.deepEqual(
      [saved.category, saved.expires, saved.namedInsured, saved.insurer, saved.policyNumber, saved.readByAi, saved.crewId],
      ["COI", soon, COMPANY, "Acme Mutual", "GL-12345", true, null],
    );
    assert.deepEqual(saved.limits, [{ label: "Each occurrence", amountCents: 100000000 }]);
    assert.equal(await page.getByTestId("compliance-named").inputValue(), "", "the form clears for the next file");

    log("B5: the Compliance tile flags one running out within 30 days; a file typed by hand made out to another name is flagged too");
    assert.match(await page.getByTestId("compliance-tile-flag").textContent(), /1 needs a look/);
    await page.getByTestId("document-upload-COMPLIANCE").getByTestId("document-file").setInputFiles({ name: "license.pdf", mimeType: "application/pdf", buffer: makePdf(["License"]) });
    await page.locator("#COMPLIANCE-category").selectOption("License");
    await page.locator("#COMPLIANCE-name").fill("Contractor license");
    await page.getByTestId("compliance-named").fill("Somebody Else LLC");
    await page.getByTestId("compliance-limits").fill("not a limit");
    await page.getByTestId("document-upload").click();
    await page.getByText(/Write each limit as/).waitFor();
    assert.equal(await page.getByTestId("compliance-named").inputValue(), "Somebody Else LLC", "a refused upload keeps what was typed");
    await page.getByTestId("compliance-limits").fill("");
    await page.getByTestId("document-upload").click();
    await page.getByText("Contractor license uploaded").waitFor();
    await page.getByTestId("compliance-name-flag").waitFor();
    assert.match(await page.getByTestId("compliance-tile-flag").textContent(), /2 need a look/);
    await shot(page, "03-compliance");

    log("B5: a subcontractor's crew card has a Compliance section; a job they're scheduled on says they have no COI");
    await sql(
      `INSERT INTO "Crew" (id,"organizationId",name,kind,"companyId","updatedAt") VALUES ('rb_crew',$1,'Sparky crew','SUBCONTRACTOR','rb_sparky',now())`,
      [org],
    );
    await sql(
      `INSERT INTO "Project" (id,"organizationId",number,name,"customerName","awardedAt","updatedAt") VALUES ('rb_job',$1,1,'Harbor rewire','Harbor Dental',now(),now())`,
      [org],
    );
    await sql(`INSERT INTO "ProjectScope" (id,"projectId",name,"crewId") VALUES ('rb_scope','rb_job','Electrical','rb_crew')`);
    await page.goto(`${BASE}/dashboard/projects/rb_job`);
    assert.match(await page.getByTestId("job-compliance").textContent(), /Sparky crew: has no COI on file/);
    await page.goto(`${BASE}/dashboard/projects/crews`);
    const crewCard = page.locator("[data-testid=crew-card][data-crew-id=rb_crew]");
    assert.match(await crewCard.getByTestId("crew-compliance").textContent(), /No COI on file/);

    log("B5: their COI from a phone photo, made small, read with a note to check it; expired, it flags the card and the job");
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    claude.reply("COMPLIANCE_READ", {
      documentType: "COI",
      title: "Sparky COI",
      namedInsured: "Sparky Electric",
      insurer: "Volt Insurance",
      policyNumber: "SP-1",
      expiresOn: yesterday,
      limits: [{ label: "Each occurrence", amount: 2000000 }],
    });
    await crewCard.getByTestId("crew-compliance-add").click();
    await crewCard.getByTestId("document-file").setInputFiles({ name: "sparky-coi.png", mimeType: "image/png", buffer: await bigPng(page, "COI") });
    await crewCard.getByTestId("compliance-read").click();
    await crewCard.getByTestId("compliance-read-note").waitFor();
    assert.match(await crewCard.getByTestId("compliance-read-note").textContent(), /Read from a picture: check every field/);
    const photoRead = claude.last("COMPLIANCE_READ");
    assert.equal(photoRead.images, 1);
    const coiSize = jpegSize(imageBlocks(photoRead)[0].source.data);
    assert.ok(Math.max(coiSize.width, coiSize.height) <= 1568);
    assert.equal(await crewCard.getByTestId("compliance-limits").inputValue(), "Each occurrence: $2,000,000.00", "a picture's fields can't be checked, so all are kept");
    await crewCard.getByTestId("document-upload").click();
    await crewCard.getByTestId("crew-compliance-doc").waitFor();
    assert.equal(await crewCard.getByTestId("crew-compliance-flag").getAttribute("data-flag"), "EXPIRED");
    assert.equal(await crewCard.getByTestId("compliance-name-flag").count(), 0, "Sparky Electric is Sparky Electric LLC");
    assert.equal((await one(`SELECT "crewId" FROM "ComplianceInfo" WHERE "crewId"='rb_crew'`)).crewId, "rb_crew");
    await page.goto(`${BASE}/dashboard/projects/rb_job`);
    assert.match(await page.getByTestId("job-compliance").textContent(), /Sparky crew: COI has expired/);
    await page.goto(`${BASE}/dashboard/settings/compliance`);
    assert.equal(await page.getByText("Sparky COI").count(), 0, "a sub's paper isn't on the workspace's own list");

    log("B5: a Member sees a sub's papers but can't add or read one");
    await sql(
      `INSERT INTO "User" (id,name,email,"passwordHash",role,"organizationId") VALUES ('rb_member','Mo Member',$1,$2,'MEMBER',$3)`,
      [MEMBER_EMAIL, owner.passwordHash, org],
    );
    const memberContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const member = await memberContext.newPage();
    await login(member, MEMBER_EMAIL);
    await member.goto(`${BASE}/dashboard/projects/crews`);
    const memberCard = member.locator("[data-testid=crew-card][data-crew-id=rb_crew]");
    await memberCard.getByTestId("crew-compliance-doc").waitFor();
    assert.equal(await memberCard.getByTestId("crew-compliance-add").count(), 0);
    await memberContext.close();

    log("B5: the day's allowance used up is a sentence where the button was");
    await sql(
      `INSERT INTO "AiRequest" (id,"organizationId",kind,"createdAt") SELECT 'rb_cap_' || g, $1, 'COMPLIANCE_READ', now() FROM generate_series(1, 30) g`,
      [org],
    );
    await page.getByTestId("document-upload-COMPLIANCE").getByTestId("document-file").setInputFiles({ name: "coi2.pdf", mimeType: "application/pdf", buffer: coi });
    const readsBefore = claude.count("COMPLIANCE_READ");
    await page.getByTestId("compliance-read").click();
    await page.getByText("Today's AI allowance for this is used up. It resets over the next 24 hours.").waitFor();
    assert.equal(claude.count("COMPLIANCE_READ"), readsBefore);
    await sql(`DELETE FROM "AiRequest" WHERE id LIKE 'rb_cap_%'`);

    /* ------------------------------ phone ------------------------------ */

    log("phone width: the contract page with their copy read, the send check and the crews page fit a 390px screen");
    const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const phone = await phoneContext.newPage();
    await login(phone, EMAIL);
    await phone.goto(`${BASE}/dashboard/contracts/${c1.id}`);
    await phone.getByTestId("redline-reader").waitFor();
    await noSideScroll(phone, "the contract page");
    claude.reply("SEND_CHECK", { items: [{ kind: "scope", ourWords: "We install three smart thermostats", problem: "Check the count against the rows.", fix: "Check the scope" }] });
    await phone.getByTestId("send-contract").click();
    await phone.getByTestId("send-check").waitFor();
    const box = await phone.getByTestId("send-check-send").boundingBox();
    assert.ok(box.height >= 43.5, `Send anyway is ${box.height}px tall`);
    await noSideScroll(phone, "the send check");
    await shot(phone, "04-phone-send-check");
    await phone.getByTestId("send-check-back").click();
    await phone.goto(`${BASE}/dashboard/projects/crews`);
    await phone.locator("[data-testid=crew-card][data-crew-id=rb_crew]").getByTestId("crew-compliance-doc").waitFor();
    await noSideScroll(phone, "the crews page");
    await phoneContext.close();

    /* ------------------------------ AI off ------------------------------ */

    log("AI off: a second server without the key hides every AI control; the rules still run");
    await startNoAiServer();
    const offContext = await browser.newContext({ viewport: { width: 1440, height: 950 } });
    const off = await offContext.newPage();
    await login(off, EMAIL, NOAI_BASE);
    const offCalls = claude.requests.length;
    // The contract page: their copies are still listed, with no reader; the
    // signed contract's stored dates still show and can be ticked.
    await off.goto(`${NOAI_BASE}/dashboard/contracts/${c1.id}`);
    await off.getByTestId("redline-files").waitFor();
    assert.equal(await off.getByTestId("redline-file").count(), 0);
    await off.goto(`${NOAI_BASE}/dashboard/contracts/${c2.id}`);
    assert.equal(await off.getByTestId("contract-date").count(), 4);
    assert.equal(await off.getByTestId("contract-dates-read").count(), 0);
    // Compliance: no Read it for me; the flags still show.
    await off.goto(`${NOAI_BASE}/dashboard/settings/compliance`);
    assert.equal(await off.getByTestId("compliance-read").count(), 0);
    await off.getByTestId("compliance-name-flag").waitFor();
    assert.match(await off.getByTestId("compliance-tile-flag").textContent(), /2 need a look/);
    // The send check: the rules alone.
    await sql(`UPDATE "Contract" SET body = body || E'\nContract total: $2.00' WHERE id=$1`, [c1.id]);
    await off.goto(`${NOAI_BASE}/dashboard/contracts/${c1.id}`);
    await off.getByTestId("send-contract").click();
    await off.getByTestId("send-check").waitFor();
    assert.deepEqual(await off.getByTestId("send-check-item").evaluateAll((items) => items.map((item) => item.dataset.code)), ["WORDING_TOTAL"]);
    await off.getByTestId("send-check-back").click();
    // A new deal's grid: the price check in the rules' words, nothing explaining.
    await sql(`INSERT INTO "Deal" (id,"organizationId","contactId",title,stage,"updatedAt") VALUES ('rb_deal3',$1,'rb_pat','Annex','QUOTE_SENT',now())`, [org]);
    await sql(
      `INSERT INTO "Quote" (id,"organizationId","contactId","dealId",number,title,status,"publicToken","updatedAt") VALUES ('rb_q3',$1,'rb_pat','rb_deal3',1002,'Annex quote','SENT','tok_rb_q3_0123456789',now())`,
      [org],
    );
    await sql(`INSERT INTO "QuoteLineItem" (id,"quoteId","productId",name,quantity,"unitPriceCents",tag,"unitOfMeasure",position) VALUES ('rb_l6','rb_q3','rb_thermo','Smart thermostat',1,5000,'MATERIALS','EACH',0)`);
    await off.goto(`${NOAI_BASE}/dashboard/contracts/tracker?dealId=rb_deal3&quoteId=rb_q3`);
    await off.locator("[data-testid=tracker-grid]").waitFor();
    await off.locator("[data-testid=create-contracts]").click();
    await off.getByTestId("price-check").waitFor();
    assert.equal(await off.getByTestId("price-check-line").getAttribute("data-source"), "rules");
    assert.equal(await off.getByTestId("price-check-explaining").count(), 0);
    // The crews page: no Read it for me on the upload form.
    await off.goto(`${NOAI_BASE}/dashboard/projects/crews`);
    const offCard = off.locator("[data-testid=crew-card][data-crew-id=rb_crew]");
    await offCard.getByTestId("crew-compliance-add").click();
    assert.equal(await offCard.getByTestId("compliance-read").count(), 0);
    assert.equal(claude.requests.length, offCalls, "nothing reached Claude");
    await offContext.close();

    await sql(`DELETE FROM "Organization" WHERE slug LIKE $1`, [SLUG_LIKE]);
    console.log(`\nai-release-b: all ${step} steps passed`);
  } finally {
    await browser.close();
    await claude.close();
    stopNoAiServer();
  }
})().catch((error) => {
  console.error(error);
  stopNoAiServer();
  process.exit(1);
});
