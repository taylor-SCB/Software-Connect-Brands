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
        content: [{ type: "text", text: JSON.stringify({ suggestions: SUGGESTIONS }) }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
    );
  });
});

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

  await browser.close();
  fakeClaude.close();
  await sql(`DELETE FROM "Organization" WHERE slug LIKE $1`, [SLUG_LIKE]);
  console.log(`\nAll ${step} steps passed. Screenshots in ${OUT}`);
})().catch((err) => {
  console.error(err);
  fakeClaude.close();
  process.exit(1);
});
