/* Browser regression for uploading an agreement as a template and
 * Suggest fields (Contracts v2, Phase 2, Oct 7, 2026).
 *
 * Covers: Upload Word or PDF reads a .docx and a text PDF into the body
 * (nothing saved until Save); a scanned PDF, an old .doc and an empty
 * file are refused with a plain reason; Suggest fields sends the body to
 * Claude, drops any suggestion whose snippet isn't in the body verbatim or
 * whose field doesn't exist, lists the rest as ticked boxes, puts only the
 * ticked ones in, and Undo takes them back out.
 *
 * Oct 24, 2026 audit fixes (their own steps at the end): the file is read
 * in the browser and never posted; a Word file with a 6 MB picture reads;
 * a Word file that unpacks to more than an agreement and a 301-page PDF
 * are refused in words; ANSI and UTF-16 .txt files read as written; an
 * agreement just under 60,000 characters with hundreds of line breaks
 * saves; a cut-off answer from Claude is a message, not a dead page; a
 * suggestion that changes words besides its blank is dropped and each
 * one says what it changes; the 20-a-day allowance.
 *
 * Claude is never called: the server has to be started with
 *   ANTHROPIC_API_KEY=test-key
 *   ANTHROPIC_ENDPOINT=http://localhost:3998
 * in .env, and this suite answers on :3998 as the Messages API would.
 * Without them the Suggest fields button doesn't show and step 8 fails,
 * which is the setup, not a bug in the app.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/scb_test \
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules \
 *   node scripts/browser-tests/template-import.cjs
 */
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS on purpose: NODE_PATH only resolves the global playwright for require() */
const os = require("node:os");
const http = require("node:http");
const { chromium } = require("playwright");
const { Client } = require("pg");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { zipSync, unzipSync } = require("fflate");

const BASE = process.env.BASE || "http://localhost:3000";
const DB = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5433/scb_test";
const OUT = process.env.SHOTS_DIR || path.join(os.tmpdir(), "scb-browser-shots-template-import");
const FIXTURES = path.join(__dirname, "fixtures");
fs.mkdirSync(OUT, { recursive: true });

const EMAIL = "test-template-import@example.com";
const PASSWORD = "password123";
const COMPANY = "Test Template Import Co";
const SLUG_LIKE = "test-template-import-co%";

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

// What the stand-in Claude answers with: three good suggestions, one whose
// snippet isn't in the agreement and one naming a field that doesn't exist.
const SUGGESTIONS = [
  { find: "between Multi-Bids LLC and ______________________", replaceWith: "between Multi-Bids LLC and {{client_company}}", key: "client_company" },
  { find: "Contact person: [Client Name]", replaceWith: "Contact person: {{client_name}}", key: "client_name" },
  { find: "Email: [Client Email]", replaceWith: "Email: {{client_email}}", key: "client_email" },
  { find: "This text is not in the agreement", replaceWith: "{{client_name}}", key: "client_name" },
  { find: "The total price is $__________", replaceWith: "The total price is {{made_up_field}}", key: "made_up_field" },
];
// The answer the stand-in gives; the audit-fix steps swap it out.
let reply = { text: JSON.stringify({ suggestions: SUGGESTIONS }), stop: "end_turn" };
const requests = [];
const fakeClaude = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    requests.push({ url: req.url, body: JSON.parse(raw || "{}") });
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

// A PDF of `pages` pages, one line of text on each.
function makePdf(pages) {
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>"];
  const kids = Array.from({ length: pages }, (_, i) => `${4 + i * 2} 0 R`);
  objects.push(`<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages} >>`);
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  for (let i = 0; i < pages; i += 1) {
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`);
    const stream = `BT /F1 12 Tf 72 720 Td (Page ${i + 1} of the agreement, with its terms.) Tj ET`;
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  let out = "%PDF-1.4\n";
  const offsets = objects.map((object, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj\n${object}\nendobj\n`;
    return at;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((at) => `${String(at).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

(async () => {
  await new Promise((resolve) => fakeClaude.listen(3998, resolve));
  await sql(`DELETE FROM "Organization" WHERE slug LIKE $1`, [SLUG_LIKE]);
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
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
  const org = (await sql(`SELECT id FROM "Organization" WHERE slug LIKE $1`, [SLUG_LIKE])).rows[0].id;
  const salesOrder = (await sql(`SELECT id, body FROM "ContractTemplate" WHERE "organizationId"=$1 AND type='Sales Order'`, [org])).rows[0];

  const body = () => page.locator("#body").inputValue();
  const upload = (file) => page.setInputFiles("[data-testid=template-upload-input]", file);

  log("Upload a Word file: its paragraphs land in the body; nothing saved yet");
  await page.goto(`${BASE}/dashboard/contracts/templates/${salesOrder.id}`);
  await upload(path.join(FIXTURES, "agreement.docx"));
  await page.locator("[data-testid=template-swap-note]").getByText("Read from agreement.docx").waitFor();
  let text = await body();
  assert.ok(text.startsWith("MULTI-BIDS SUBCONTRACT AGREEMENT"), text.slice(0, 60));
  assert.match(text, /Contact person: \[Client Name\]/);
  assert.match(text, /\n\n1\. SCOPE/, "paragraphs kept apart");
  assert.equal((await sql(`SELECT body FROM "ContractTemplate" WHERE id=$1`, [salesOrder.id])).rows[0].body, salesOrder.body);

  log("Undo puts the old wording back");
  await page.locator("[data-testid=template-swap-note]").getByRole("button", { name: "Undo" }).click();
  assert.ok((await body()).startsWith("SALES ORDER"));

  log("Upload a PDF with text: its words come in");
  await upload(path.join(FIXTURES, "agreement.pdf"));
  await page.locator("[data-testid=template-swap-note]").getByText("Read from agreement.pdf").waitFor();
  text = await body();
  assert.match(text, /PDF CHANGE ORDER/);
  assert.match(text, /Customer: ____________/);

  log("a scanned PDF is refused with the reason, and the body is left alone");
  const before = await body();
  await upload(path.join(FIXTURES, "scanned.pdf"));
  await page.locator("[data-testid=template-import-error]").getByText("looks like a scan").waitFor();
  assert.equal(await body(), before);

  log("an old .doc and an empty file are refused in plain words");
  await upload({ name: "old.doc", mimeType: "application/msword", buffer: Buffer.from("not really a doc") });
  await page.locator("[data-testid=template-import-error]").getByText("Save As .docx").waitFor();
  await upload({ name: "empty.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: Buffer.alloc(0) });
  await page.locator("[data-testid=template-import-error]").getByText("That file is empty").waitFor();

  log("upload the Word file again and save it: the Sales Order now holds it");
  await upload(path.join(FIXTURES, "agreement.docx"));
  await page.locator("[data-testid=template-swap-note]").getByText("Read from agreement.docx").waitFor();
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByText("Template saved").waitFor();
  assert.match((await sql(`SELECT body FROM "ContractTemplate" WHERE id=$1`, [salesOrder.id])).rows[0].body, /MULTI-BIDS SUBCONTRACT/);

  log("Suggest fields asks Claude with the agreement, and shows only the suggestions that check out");
  await page.reload();
  await page.click("[data-testid=template-suggest]");
  const panel = page.locator("[data-testid=template-suggestions]");
  await panel.getByText("3 suggested fields").waitFor();
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /^\/v1\/messages/);
  assert.equal(requests[0].body.model, "claude-opus-5-5");
  assert.match(JSON.stringify(requests[0].body.messages), /MULTI-BIDS SUBCONTRACT AGREEMENT/);
  assert.equal(await panel.locator("[data-testid=template-suggestion]").count(), 3);
  assert.equal(await panel.getByText("made_up_field").count(), 0);
  await shot(page, "01-suggestions");

  log("untick the email one, put the rest in: two fields placed, the email blank left as it was");
  await panel.locator("[data-testid=template-suggestion]").nth(2).uncheck();
  await panel.locator("[data-testid=template-apply-suggestions]").click();
  await page.locator("[data-testid=template-swap-note]").getByText("Put 2 fields in").waitFor();
  text = await body();
  assert.match(text, /between Multi-Bids LLC and \{\{client_company\}\}/);
  assert.match(text, /Contact person: \{\{client_name\}\}/);
  assert.match(text, /Email: \[Client Email\]/);

  log("Preview shows the placed fields as chips");
  await page.getByRole("button", { name: "Preview" }).click();
  await page.locator("[data-testid=template-preview] [data-merge-key=client_company]").first().waitFor();
  await page.getByRole("button", { name: "Back to editing" }).click();

  log("Undo takes the placed fields back out; Save keeps them when put back in");
  await page.locator("[data-testid=template-swap-note]").getByRole("button", { name: "Undo" }).click();
  assert.match(await body(), /Contact person: \[Client Name\]/);
  await page.click("[data-testid=template-suggest]");
  await panel.locator("[data-testid=template-apply-suggestions]").click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByText("Template saved").waitFor();
  const saved = (await sql(`SELECT body FROM "ContractTemplate" WHERE id=$1`, [salesOrder.id])).rows[0].body;
  assert.match(saved, /\{\{client_email\}\}/);
  assert.match(saved, /\{\{client_name\}\}/);

  const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const editorIntact = async (expectedStart) => {
    assert.equal(await page.locator("#body").count(), 1, "the editor is still on the page");
    if (expectedStart) assert.ok((await body()).startsWith(expectedStart), (await body()).slice(0, 60));
  };

  log("audit fixes: the file is read in the browser and never posted; a Word file with a 6 MB picture reads");
  await page.goto(`${BASE}/dashboard/contracts/templates/${salesOrder.id}`);
  const posts = [];
  const onRequest = (request) => {
    if (request.method() === "POST") posts.push(request.url());
  };
  page.on("request", onRequest);
  const parts = unzipSync(fs.readFileSync(path.join(FIXTURES, "agreement.docx")));
  const heavy = zipSync({ ...parts, "word/media/photo.png": [crypto.randomBytes(6 * 1024 * 1024), { level: 0 }] });
  assert.ok(heavy.length > 6 * 1024 * 1024);
  await upload({ name: "with-photo.docx", mimeType: DOCX, buffer: Buffer.from(heavy) });
  await page.locator("[data-testid=template-swap-note]").getByText("Read from with-photo.docx").waitFor();
  assert.ok((await body()).startsWith("MULTI-BIDS SUBCONTRACT AGREEMENT"));
  page.off("request", onRequest);
  assert.deepEqual(posts, [], "nothing was sent to the server");

  log("audit fixes: a Word file that unpacks to more than an agreement, and a 301-page PDF, are refused in words");
  const wording = await body();
  const bomb = zipSync({
    "[Content_Types].xml": Buffer.from('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
    "word/document.xml": Buffer.alloc(13 * 1024 * 1024, "<w:p/>"),
  });
  assert.ok(bomb.length < 200 * 1024, `the bomb is small: ${bomb.length}`);
  await upload({ name: "bomb.docx", mimeType: DOCX, buffer: Buffer.from(bomb) });
  await page.locator("[data-testid=template-import-error]").getByText("unpacks to far more than an agreement").waitFor();
  assert.equal(await body(), wording);
  await upload({ name: "manual.pdf", mimeType: "application/pdf", buffer: makePdf(301) });
  await page.locator("[data-testid=template-import-error]").getByText("That PDF is 301 pages").waitFor();
  assert.equal(await body(), wording);
  await upload({ name: "short.pdf", mimeType: "application/pdf", buffer: makePdf(3) });
  await page.locator("[data-testid=template-swap-note]").getByText("Read from short.pdf").waitFor();
  assert.match(await body(), /Page 3 of the agreement/);

  log("audit fixes: ANSI (Windows-1252) and UTF-16 .txt files read as written");
  const typed = "The Client\u2019s deposit of \u201c50%\u201d is due \u2014 within 30 days. Caf\u00e9 terms apply.";
  const cp1252 = Buffer.from(typed.replace(/\u2019/g, "\x92").replace(/\u201c/g, "\x93").replace(/\u201d/g, "\x94").replace(/\u2014/g, "\x97"), "latin1");
  await upload({ name: "ansi.txt", mimeType: "text/plain", buffer: cp1252 });
  await page.locator("[data-testid=template-swap-note]").getByText("Read from ansi.txt").waitFor();
  assert.equal(await body(), typed);
  await upload({ name: "unicode.txt", mimeType: "text/plain", buffer: Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(typed, "utf16le")]) });
  await page.locator("[data-testid=template-swap-note]").getByText("Read from unicode.txt").waitFor();
  assert.equal(await body(), typed);

  log("audit fixes: an agreement just under 60,000 characters with 400 line breaks saves");
  const line = `Clause ${"terms ".repeat(30)}`.slice(0, 147) + ".";
  const long = Array.from({ length: 401 }, () => line).join("\n");
  assert.ok(long.length < 60000 && long.length + 400 > 60000, `${long.length}`);
  await upload({ name: "long.txt", mimeType: "text/plain", buffer: Buffer.from(long) });
  await page.locator("[data-testid=template-swap-note]").getByText("Read from long.txt").waitFor();
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByText("Template saved").waitFor();
  assert.equal((await sql(`SELECT body FROM "ContractTemplate" WHERE id=$1`, [salesOrder.id])).rows[0].body.replace(/\r\n/g, "\n"), long);

  log("audit fixes: a cut-off answer is a message and the editor keeps its wording; a suggestion that changes more than its blank is dropped");
  await upload(path.join(FIXTURES, "agreement.docx"));
  await page.locator("[data-testid=template-swap-note]").getByText("Read from agreement.docx").waitFor();
  reply = { text: '{"suggestions":[{"find":"between Multi-Bids LLC and ____', stop: "max_tokens" };
  await page.click("[data-testid=template-suggest]");
  await page.locator("[data-testid=template-import-error]").getByText("came back cut short").waitFor();
  await editorIntact("MULTI-BIDS SUBCONTRACT AGREEMENT");
  reply = { text: "not json at all", stop: "end_turn" };
  await page.click("[data-testid=template-suggest]");
  await page.locator("[data-testid=template-import-error]").getByText("came back cut short").waitFor();
  await editorIntact("MULTI-BIDS SUBCONTRACT AGREEMENT");
  reply = {
    text: JSON.stringify({
      suggestions: [
        ...SUGGESTIONS,
        {
          find: "1. SCOPE. Subcontractor will perform the work described in the attached bid.",
          replaceWith: "1. SCOPE. {{client_company}} will perform the work described in the attached bid and any extras we ask for.",
          key: "client_company",
        },
      ],
    }),
    stop: "end_turn",
  };
  await page.click("[data-testid=template-suggest]");
  await panel.getByText("3 suggested fields").waitFor();
  const changes = await panel.locator("[data-testid=template-suggestion-change]").allTextContents();
  assert.deepEqual(changes, [
    "\u201c______________________\u201d becomes {{client_company}}",
    "\u201c[Client Name]\u201d becomes {{client_name}}",
    "\u201c[Client Email]\u201d becomes {{client_email}}",
  ]);
  await panel.locator("[data-testid=template-apply-suggestions]").click();
  assert.match(await body(), /1\. SCOPE\. Subcontractor will perform the work described in the attached bid\.\n/);

  log("audit fixes: after 20 suggestions in a day the workspace is told so, and Claude isn't asked");
  const used = (await sql(`SELECT count(*)::int n FROM "AiRequest" WHERE "organizationId"=$1 AND kind='SUGGEST_FIELDS'`, [org])).rows[0].n;
  assert.equal(used, requests.length, "one row per call");
  for (let i = used; i < 20; i += 1) {
    await sql(`INSERT INTO "AiRequest" (id,"organizationId",kind) VALUES ($1,$2,'SUGGEST_FIELDS')`, [`air_tpi_${i}`, org]);
  }
  const asked = requests.length;
  await page.click("[data-testid=template-suggest]");
  await page.locator("[data-testid=template-import-error]").getByText("used 20 times in your workspace").waitFor();
  assert.equal(requests.length, asked);
  assert.equal((await sql(`SELECT count(*)::int n FROM "AiRequest" WHERE "organizationId"=$1`, [org])).rows[0].n, 20, "the refused one isn't counted");
  await sql(`UPDATE "AiRequest" SET "createdAt" = now() - interval '25 hours' WHERE "organizationId"=$1`, [org]);
  // A day later it opens again. (The fields are already placed, so there
  // is nothing left to suggest; what matters is that Claude is asked.)
  reply = { text: JSON.stringify({ suggestions: SUGGESTIONS }), stop: "end_turn" };
  await page.click("[data-testid=template-suggest]");
  await panel.getByText("No spots for fields found").waitFor();
  assert.equal(requests.length, asked + 1);

  await browser.close();
  fakeClaude.close();
  await sql(`DELETE FROM "Organization" WHERE slug LIKE $1`, [SLUG_LIKE]);
  console.log(`\nAll ${step} steps passed. Screenshots in ${OUT}`);
})().catch((err) => {
  console.error(err);
  fakeClaude.close();
  process.exit(1);
});
