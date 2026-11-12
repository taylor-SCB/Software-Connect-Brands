/* Browser regression for the apparel pack (Nov 12, 2026): "We do apparel /
 * custom print".
 *
 * The switch on Settings -> General (and on /admin) with its Print location
 * list; artwork on a company page (PNG, SVG, PDF, EPS with a picture added,
 * the printer's file kept as sent, staff-only pictures, the look-alike
 * warning that never blocks); proofs on a quote's product lines (a panel per
 * print location on a product picture or a plain garment, dragged and
 * sized, sizes sharing a proof, versions); Send proofs (its own share sheet,
 * the quote never marked sent); the customer's approval page /pf/<token>
 * with Approve and Ask for changes and its guarded writes; the calendar;
 * the customer's quote; contracts carrying picked proofs and the printer's
 * download; re-orders; the phone.
 *
 * Runs against a built app started with STORAGE_DRIVER=local and no
 * BLOB_READ_WRITE_TOKEN, ANTHROPIC_API_KEY=test-key and ANTHROPIC_ENDPOINT
 * pointing at the stand-in Claude this suite starts (FAKE_CLAUDE_PORT,
 * default 3998), and a local Postgres that has had `prisma migrate deploy`
 * run against it. It signs up its own workspace and deletes it again on the
 * next run. Never point it at the live database.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/scb_test \
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules \
 *   node scripts/browser-tests/apparel-pack.cjs
 */
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS on purpose: NODE_PATH only resolves the global playwright for require() */
const os = require("node:os");
const { chromium, devices } = require("playwright");
const { Client } = require("pg");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { randomBytes } = require("node:crypto");
const { startFakeClaude } = require("./fake-claude.cjs");

const BASE = process.env.BASE || "http://localhost:3000";
const DB = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5433/scb_test";
const OUT = process.env.SHOTS_DIR || path.join(os.tmpdir(), "scb-browser-shots-apparel");
fs.mkdirSync(OUT, { recursive: true });

const EMAIL = "test-apparel@example.com";
const PASSWORD = "password123";
const COMPANY = "Test Apparel Co";
const SLUG = "test-apparel-co%";

let step = 0;
function log(msg) {
  step += 1;
  console.log(`[${String(step).padStart(2, "0")}] ${msg}`);
}
async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `ap-${name}.png`), fullPage: true });
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
const cuid = () => `c${randomBytes(12).toString("hex")}`;
async function login(page, email = EMAIL) {
  await page.goto(`${BASE}/login`);
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/dashboard$/);
}
// networkidle, then every animation finished or infinite (CLAUDE.md).
async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming?.().endTime !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
}

// A logo drawn in the page: navy and gold on a transparent background.
async function drawLogo(page, { type = "image/png", w = 600, h = 400, white = false } = {}) {
  const b64 = await page.evaluate(
    async ({ type, w, h, white }) => {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const context = canvas.getContext("2d");
      context.fillStyle = white ? "#ffffff" : "#1f2a44";
      context.beginPath();
      context.arc(w / 2, h / 2, Math.min(w, h) * 0.4, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = white ? "#ffffff" : "#d9a520";
      context.fillRect(w * 0.3, h * 0.42, w * 0.4, h * 0.16);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.92));
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let text = "";
      for (const byte of bytes) text += String.fromCharCode(byte);
      return btoa(text);
    },
    { type, w, h, white },
  );
  return Buffer.from(b64, "base64");
}

// A one-page PDF with a filled shape on it, offsets worked out so readers
// that check the table are happy.
function makePdf(text = "") {
  const content = `0.12 0.16 0.27 rg 20 20 160 60 re f${text ? ` BT /F1 12 Tf 30 85 Td (${text}) Tj ET` : ""}`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(out.length);
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

const SVG = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60" viewBox="0 0 120 60"><rect x="5" y="5" width="110" height="50" rx="10" fill="#9e1b32"/><script>window.__svgRan = true</script></svg>`,
);
const EPS = Buffer.from("%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 100 100\nnewpath 10 10 moveto 90 90 lineto stroke\n%%EOF\n");

(async () => {
  await sql(`DELETE FROM "Organization" WHERE slug LIKE $1`, [SLUG]);
  const claude = await startFakeClaude({ port: Number(process.env.FAKE_CLAUDE_PORT || 3998) });

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (err) => {
    pageErrors.push(err.message);
    console.error("PAGE ERROR:", err.message);
  });

  log("signup, activate, login");
  await page.goto(`${BASE}/signup`);
  await page.fill("[name=companyName]", COMPANY);
  await page.fill("[name=name]", "Hal Hauff");
  await page.fill("[name=email]", EMAIL);
  await page.fill("[name=phone]", "5550000000");
  await page.fill("[name=password]", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/signup\/submitted/);
  await sql(`UPDATE "Organization" SET status='ACTIVE', "reviewedAt"=now() WHERE slug LIKE $1`, [SLUG]);
  const org = (await sql(`SELECT id FROM "Organization" WHERE slug LIKE $1`, [SLUG])).rows[0].id;
  const owner = (await sql(`SELECT id FROM "User" WHERE "organizationId"=$1`, [org])).rows[0].id;
  await login(page);

  log("apparel is off to start: no Artwork card, no proofs, nothing seeded");
  const orgRow = async () => (await sql(`SELECT "apparelOn", "printLocationGroupId" FROM "Organization" WHERE id=$1`, [org])).rows[0];
  assert.equal((await orgRow()).apparelOn, false);
  // The label groups are made on first read.
  await page.goto(`${BASE}/dashboard/products/labels`);
  await settle(page);

  log("Settings -> General: turn on \"We do apparel / custom print\"; Print location is made with seven places");
  await page.goto(`${BASE}/dashboard/settings/general#apparel`);
  await settle(page);
  await page.getByTestId("apparel-switch").click();
  await page.getByTestId("apparel-save").click();
  await page.getByText("Apparel is on.").waitFor();
  const turnedOn = await orgRow();
  assert.equal(turnedOn.apparelOn, true);
  const locations = (
    await sql(`SELECT name FROM "VariationOption" WHERE "groupId"=$1 ORDER BY position`, [turnedOn.printLocationGroupId])
  ).rows.map((row) => row.name);
  assert.deepEqual(locations, ["Front", "Back", "Left chest", "Full front", "Full back", "Left sleeve", "Right sleeve"]);
  await shot(page, "01-switch");

  // The customer, the garment and the quote, seeded.
  const companyId = cuid();
  const contactId = cuid();
  const dealId = cuid();
  const quoteId = cuid();
  const productId = cuid();
  await sql(`INSERT INTO "Company" (id, "organizationId", name, "updatedAt") VALUES ($1,$2,'Lincoln High',now())`, [companyId, org]);
  await sql(
    `INSERT INTO "Contact" (id, "organizationId", name, email, phone, "companyId", "updatedAt") VALUES ($1,$2,'Coach Lee','coach@example.com','5551234567',$3,now())`,
    [contactId, org, companyId],
  );
  await sql(`INSERT INTO "Deal" (id, "organizationId", "contactId", title, "updatedAt") VALUES ($1,$2,$3,'Spring tees',now())`, [dealId, org, contactId]);
  await sql(`INSERT INTO "Product" (id, "organizationId", name, "defaultTag", "unitPriceCents", "updatedAt") VALUES ($1,$2,'Classic Tee','MATERIALS',1200,now())`, [productId, org]);
  const groupId = async (kind) => (await sql(`SELECT id FROM "VariationGroup" WHERE "organizationId"=$1 AND kind=$2`, [org, kind])).rows[0].id;
  const colorGroup = await groupId("COLOR");
  const sizeGroup = await groupId("SIZE");
  const option = async (group, name, position) => {
    const id = cuid();
    await sql(`INSERT INTO "VariationOption" (id, "organizationId", "groupId", name, position, "updatedAt") VALUES ($1,$2,$3,$4,$5,now())`, [id, org, group, name, position]);
    await sql(`INSERT INTO "ProductVariation" ("productId", "optionId", "organizationId") VALUES ($1,$2,$3)`, [productId, id, org]);
    return id;
  };
  const navy = await option(colorGroup, "Navy", 0);
  const gold = await option(colorGroup, "Gold", 1);
  const sizes = { S: await option(sizeGroup, "S", 0), M: await option(sizeGroup, "M", 1), L: await option(sizeGroup, "L", 2) };
  const entry = (gid, group, oid, label) => ({ groupId: gid, group, optionId: oid, label });
  const lineVariations = (color, colorName, size) => [entry(colorGroup, "Color", color, colorName), entry(sizeGroup, "Size", sizes[size], size)];
  const quoteNumber = 1001;
  await sql(
    `INSERT INTO "Quote" (id, "organizationId", "contactId", "dealId", number, title, "publicToken", "updatedAt") VALUES ($1,$2,$3,$4,$5,'Spring tees',$6,now())`,
    [quoteId, org, contactId, dealId, quoteNumber, `q${randomBytes(12).toString("hex")}`],
  );
  await sql(`UPDATE "Organization" SET "nextQuoteNumber" = 1002 WHERE id=$1`, [org]);
  const lineIds = {};
  const addLine = async (key, name, product, variations, quantity, position) => {
    const id = cuid();
    lineIds[key] = id;
    await sql(
      `INSERT INTO "QuoteLineItem" (id, "quoteId", "productId", name, quantity, "unitPriceCents", tag, variations, "variationText", position)
       VALUES ($1,$2,$3,$4,$5,1200,'MATERIALS',$6,$7,$8)`,
      [id, quoteId, product, name, quantity, variations ? JSON.stringify(variations) : null, variations ? variations.map((v) => v.label).join(" · ") : null, position],
    );
  };
  await addLine("navyS", "Classic Tee", productId, lineVariations(navy, "Navy", "S"), 12, 0);
  await addLine("navyM", "Classic Tee", productId, lineVariations(navy, "Navy", "M"), 24, 1);
  await addLine("navyL", "Classic Tee", productId, lineVariations(navy, "Navy", "L"), 12, 2);
  await addLine("goldM", "Classic Tee", productId, lineVariations(gold, "Gold", "M"), 6, 3);
  await addLine("print", "Screen print, front (2 colors)", null, null, 54, 4);

  log("a Navy picture of the product, from the product page");
  await page.goto(`${BASE}/dashboard/products/${productId}`);
  await settle(page);
  await page.getByTestId("picture-input").setInputFiles({ name: "navy-tee.png", mimeType: "image/png", buffer: await drawLogo(page, { w: 900, h: 900 }) });
  await page.getByTestId("picture-tile").first().waitFor();
  await page.getByTestId("picture-color").first().selectOption({ label: "Navy" });
  await page.waitForFunction(
    async () => true,
  );
  await settle(page);
  const pictureColor = async () => (await sql(`SELECT "colorOptionId" FROM "ProductImage" WHERE "productId"=$1`, [productId])).rows[0]?.colorOptionId;
  for (let i = 0; i < 20 && (await pictureColor()) !== navy; i += 1) await page.waitForTimeout(250);
  assert.equal(await pictureColor(), navy);

  log("company page: the Artwork card; a transparent PNG becomes a tile with its ink note, its file kept as sent");
  claude.reply("ARTWORK_CHECK", { verdict: "ok", brand: null, note: "A school's own logo." });
  await page.goto(`${BASE}/dashboard/companies/${companyId}`);
  await settle(page);
  const card = page.getByTestId("artwork-card");
  await card.waitFor();
  const png = await drawLogo(page);
  await card.getByTestId("artwork-file").setInputFiles({ name: "lincoln_lions.png", mimeType: "image/png", buffer: png });
  await card.getByTestId("artwork-name").waitFor();
  assert.equal(await card.getByTestId("artwork-name").inputValue(), "lincoln lions");
  await card.getByTestId("artwork-name").fill("Lincoln Lions");
  await card.getByTestId("artwork-ink").fill("2 colors: navy, gold");
  await card.getByTestId("artwork-save").click();
  await card.locator('[data-testid=artwork-row][data-name="Lincoln Lions"]').waitFor();
  const artworkRow = async (name) =>
    (await sql(`SELECT * FROM "Artwork" WHERE "organizationId"=$1 AND name=$2`, [org, name])).rows[0];
  const lions = await artworkRow("Lincoln Lions");
  assert.equal(lions.companyId, companyId);
  assert.equal(lions.inkNote, "2 colors: navy, gold");
  assert.equal(lions.printFormat, "png");
  assert.equal(Number(lions.printSize), png.length);
  assert.match(lions.previewType, /^image\/(webp|png)$/);
  // The look-alike check ran on the stored mid-grey copy.
  for (let i = 0; i < 40 && !(await artworkRow("Lincoln Lions")).checkStatus; i += 1) await page.waitForTimeout(250);
  assert.equal((await artworkRow("Lincoln Lions")).checkStatus, "ok");
  assert.equal(claude.last("ARTWORK_CHECK").images, 1);
  // Transparency kept in the preview: a corner pixel is see-through.
  const cornerAlpha = await page.evaluate(async (id) => {
    const img = new Image();
    img.src = `/dashboard/artwork/${id}/picture`;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const context = canvas.getContext("2d");
    context.drawImage(img, 0, 0);
    return context.getImageData(2, 2, 1, 1).data[3];
  }, lions.id);
  assert.equal(cornerAlpha, 0, "the preview kept its transparency");
  // The printer's file comes back byte for byte, as a download.
  const download = await page.request.get(`${BASE}/dashboard/artwork/${lions.id}/print`);
  assert.equal(download.status(), 200);
  assert.match(download.headers()["content-disposition"], /^attachment; filename="lincoln_lions.png"/);
  assert.equal(download.headers()["content-type"], "application/octet-stream");
  assert.ok(Buffer.from(await download.body()).equals(png));
  await shot(page, "02-artwork");

  log("artwork is never public: signed out, its picture and file are not found");
  const outsider = await browser.newContext();
  for (const url of [`/dashboard/artwork/${lions.id}/picture`, `/dashboard/artwork/${lions.id}/print`]) {
    const response = await outsider.request.get(`${BASE}${url}`, { maxRedirects: 0 });
    assert.ok([404, 307, 302].includes(response.status()), `${url} answered ${response.status()}`);
  }

  log("a famous-looking logo is a warning beside it, never a block");
  claude.reply("ARTWORK_CHECK", { verdict: "famous", brand: "a pro team", note: "It looks like a pro team's mark." });
  await card.getByTestId("artwork-file").setInputFiles({ name: "big-cats.png", mimeType: "image/png", buffer: await drawLogo(page, { w: 500, h: 500 }) });
  await card.getByTestId("artwork-save").click();
  await card.locator('[data-testid=artwork-row][data-name="big cats"]').waitFor();
  for (let i = 0; i < 40 && (await artworkRow("big cats"))?.checkStatus !== "famous"; i += 1) await page.waitForTimeout(250);
  await page.reload();
  await settle(page);
  await card.locator('[data-testid=artwork-row][data-name="big cats"] [data-testid=artwork-warning]').waitFor();
  assert.match(await card.locator('[data-testid=artwork-row][data-name="big cats"] [data-testid=artwork-warning]').innerText(), /Looks like a pro team's logo/);

  log("an SVG is drawn into a picture (its script never runs) and kept as the printer's file");
  claude.reply("ARTWORK_CHECK", { verdict: "ok", brand: null, note: "" });
  await card.getByTestId("artwork-file").setInputFiles({ name: "Lions wordmark.svg", mimeType: "image/svg+xml", buffer: SVG });
  await card.getByTestId("artwork-save").click();
  await card.locator('[data-testid=artwork-row][data-name="Lions wordmark"]').waitFor();
  assert.equal((await artworkRow("Lions wordmark")).printFormat, "svg");
  assert.equal(await page.evaluate(() => window.__svgRan ?? false), false);

  log("a PDF is drawn from its first page; an EPS is kept and asks for a PNG of it");
  await card.getByTestId("artwork-file").setInputFiles({ name: "crest.pdf", mimeType: "application/pdf", buffer: makePdf() });
  await card.getByTestId("artwork-save").waitFor();
  await card.getByTestId("artwork-pending-thumb").waitFor();
  await card.getByTestId("artwork-save").click();
  await card.locator('[data-testid=artwork-row][data-name="crest"]').waitFor();
  assert.equal((await artworkRow("crest")).printFormat, "pdf");
  await card.getByTestId("artwork-file").setInputFiles({ name: "mascot.eps", mimeType: "application/postscript", buffer: EPS });
  await card.getByTestId("artwork-needs-picture").waitFor();
  assert.equal(await card.getByTestId("artwork-save").isDisabled(), true);
  await card.getByTestId("artwork-picture-file").setInputFiles({ name: "mascot.png", mimeType: "image/png", buffer: await drawLogo(page, { w: 300, h: 300 }) });
  await card.getByTestId("artwork-pending-thumb").waitFor();
  await card.getByTestId("artwork-save").click();
  await card.locator('[data-testid=artwork-row][data-name="mascot"]').waitFor();
  const mascot = await artworkRow("mascot");
  assert.equal(mascot.printFormat, "eps");
  const epsBack = await page.request.get(`${BASE}/dashboard/artwork/${mascot.id}/print`);
  assert.ok(Buffer.from(await epsBack.body()).equals(EPS));

  log("quote: each Navy line offers + Proof; the typed print line doesn't");
  await page.goto(`${BASE}/dashboard/quotes/${quoteId}`);
  await settle(page);
  await page.getByTestId("proofs-card").waitFor();
  const rows = page.getByTestId("line-row");
  assert.equal(await rows.count(), 5);
  assert.equal(await rows.nth(0).getByTestId("line-proof-add").count(), 1);
  assert.equal(await rows.nth(4).getByTestId("line-proof-add").count(), 0);

  log("the proof sheet: S, M and L ticked (not Gold), the Navy picture first, the logo placed on Front");
  await rows.nth(0).getByTestId("line-proof-add").click();
  const sheet = page.getByTestId("proof-sheet");
  await sheet.waitFor();
  const lineBoxes = sheet.getByTestId("proof-line");
  assert.equal(await lineBoxes.count(), 3);
  for (let i = 0; i < 3; i += 1) assert.equal(await lineBoxes.nth(i).isChecked(), true);
  assert.equal(await sheet.getByTestId("proof-location").inputValue(), locationsId(await sql(`SELECT id, name FROM "VariationOption" WHERE "groupId"=$1`, [turnedOn.printLocationGroupId]), "Front"));
  assert.equal(await sheet.getByTestId("proof-base-picture").first().getAttribute("aria-pressed"), "true");
  await sheet.locator('[data-testid=proof-artwork][data-name="Lincoln Lions"]').click();
  // Drag the logo right and down, then size it up from its corner.
  const boxBefore = await sheet.getByTestId("proof-artwork-box").boundingBox();
  await page.mouse.move(boxBefore.x + boxBefore.width / 2, boxBefore.y + boxBefore.height / 2);
  await page.mouse.down();
  await page.mouse.move(boxBefore.x + boxBefore.width / 2 + 30, boxBefore.y + boxBefore.height / 2 + 20, { steps: 5 });
  await page.mouse.up();
  const handle = await sheet.getByTestId("proof-artwork-size").boundingBox();
  await page.mouse.move(handle.x + 4, handle.y + 4);
  await page.mouse.down();
  await page.mouse.move(handle.x + 34, handle.y + 34, { steps: 5 });
  await page.mouse.up();
  const boxAfter = await sheet.getByTestId("proof-artwork-box").boundingBox();
  assert.ok(boxAfter.x > boxBefore.x + 20 && boxAfter.width > boxBefore.width + 20, "moved and sized");

  log("a Back panel on a plain garment in the colour (no back picture), with the mascot");
  await sheet.getByTestId("proof-add-panel").click();
  await sheet.getByTestId("proof-location").selectOption({ label: "Back" });
  await sheet.getByTestId("proof-base-plain-back").click();
  assert.equal(await sheet.getByTestId("proof-base-color").inputValue(), "#1f2a44");
  await sheet.locator('[data-testid=proof-artwork][data-name="mascot"]').click();
  await shot(page, "03-proof-sheet");
  await sheet.getByTestId("proof-save").click();
  await sheet.waitFor({ state: "detached" });

  const proofRows = async () =>
    (await sql(`SELECT * FROM "Proof" WHERE "organizationId"=$1 ORDER BY number`, [org])).rows;
  const versionsOf = async (proofId) =>
    (await sql(`SELECT * FROM "ProofVersion" WHERE "proofId"=$1 ORDER BY version`, [proofId])).rows;
  const panelsOf = async (versionId) =>
    (await sql(`SELECT * FROM "ProofPanel" WHERE "versionId"=$1 ORDER BY position`, [versionId])).rows;
  const proofOfLines = async () =>
    Object.fromEntries((await sql(`SELECT id, "proofId" FROM "QuoteLineItem" WHERE "quoteId"=$1`, [quoteId])).rows.map((row) => [row.id, row.proofId]));
  const [proof1] = await proofRows();
  assert.equal(proof1.number, 1);
  assert.equal(proof1.colorOptionId, navy);
  assert.equal(proof1.colorLabel, "Navy");
  const [v1] = await versionsOf(proof1.id);
  assert.equal(v1.status, "DRAFT");
  const v1Panels = await panelsOf(v1.id);
  assert.deepEqual(v1Panels.map((p) => [p.locationLabel, p.artworkName, p.baseKind]), [
    ["Front", "Lincoln Lions", "picture"],
    ["Back", "mascot", "plain-back"],
  ]);
  assert.equal(v1Panels[0].inkNote, "2 colors: navy, gold");
  assert.ok(v1Panels[0].placement.x > 0.32, "the drag was saved");
  const lines1 = await proofOfLines();
  assert.equal(lines1[lineIds.navyS], proof1.id);
  assert.equal(lines1[lineIds.navyM], proof1.id);
  assert.equal(lines1[lineIds.navyL], proof1.id);
  assert.equal(lines1[lineIds.goldM], null);
  await page.getByTestId("proof-row").first().waitFor();
  assert.equal(await rows.nth(0).getByTestId("line-proof").getAttribute("data-proof"), "1");
  assert.match(await rows.nth(1).getByTestId("line-proof").innerText(), /Draft/);
  await shot(page, "04-proof-draft");

  log("a draft's picture is the team's only");
  const draftUrl = `${BASE}/files/${v1.publicToken}`;
  assert.equal((await page.request.get(draftUrl)).status(), 200);
  assert.equal((await outsider.request.get(draftUrl)).status(), 404);

  log("Send proofs: its own sheet; Just mark them sent sends the draft and never the quote");
  await page.getByTestId("send-proofs").click();
  const sendSheet = page.getByTestId("send-proofs-sheet");
  await sendSheet.getByTestId("send-proofs-list").waitFor();
  assert.match(await sendSheet.getByTestId("send-proofs-list").innerText(), /Proof 1 · Classic Tee · Navy/);
  const link = await sendSheet.getByTestId("send-proofs-link").inputValue();
  assert.match(link, /\/pf\/[A-Za-z0-9_-]{20,}$/);
  await sendSheet.getByTestId("send-proofs-mark").click();
  await sendSheet.waitFor({ state: "detached" });
  const [v1Sent] = await versionsOf(proof1.id);
  assert.equal(v1Sent.status, "SENT");
  const quoteRow = (await sql(`SELECT status, "proofToken" FROM "Quote" WHERE id=$1`, [quoteId])).rows[0];
  assert.equal(quoteRow.status, "DRAFT", "the quote itself is not sent");
  assert.ok(link.endsWith(quoteRow.proofToken));
  assert.equal((await outsider.request.get(draftUrl)).status(), 200, "a sent proof's picture is public");

  log("the coach's page: the proof big, what it's for, no prices, nothing to sign in to");
  const coach = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const coachPage = await coach.newPage();
  coachPage.on("pageerror", (err) => pageErrors.push(`coach: ${err.message}`));
  const pfUrl = `${BASE}/pf/${quoteRow.proofToken}`;
  await coachPage.goto(pfUrl);
  await settle(coachPage);
  const pfProof = coachPage.locator('[data-testid=pf-proof][data-proof="1"]');
  await pfProof.waitFor();
  const pfText = await coachPage.locator("body").innerText();
  assert.match(pfText, /Proofs from Test Apparel Co/i);
  assert.match(pfText, /Front: Lincoln Lions · 2 colors: navy, gold/);
  assert.match(pfText, /For 12 × Navy · S, 24 × Navy · M, 12 × Navy · L/);
  assert.doesNotMatch(pfText, /\$\d/, "no prices on the approval page");
  assert.equal(await pfProof.getByTestId("pf-status").innerText(), "Waiting for your answer");
  await shot(coachPage, "05-pf");

  log("an approval needs a name and the tick; a stale tab can't approve a proof the shop has changed since");
  const answer = coachPage.locator(`[data-testid=pf-answer][data-version="${v1.id}"]`);
  await answer.getByTestId("pf-approve").click();
  await coachPage.getByTestId("pf-submit").click();
  await coachPage.getByTestId("pf-error").waitFor();
  assert.match(await coachPage.getByTestId("pf-error").innerText(), /Tick the box/);
  // Meanwhile the shop opens the proof and saves a change: version 2, a draft.
  await page.getByTestId("proof-open").first().click();
  await sheet.waitFor();
  await sheet.getByTestId("proof-new-version-note").waitFor();
  await sheet.getByTestId("proof-artwork-box").focus();
  await page.keyboard.press("ArrowUp");
  await sheet.getByTestId("proof-save").click();
  await sheet.waitFor({ state: "detached" });
  const [, v2] = await versionsOf(proof1.id);
  assert.equal(v2.version, 2);
  assert.equal(v2.status, "DRAFT");
  assert.equal((await versionsOf(proof1.id))[0].status, "SENT", "the coach still sees version 1 until version 2 is sent");
  await coachPage.getByTestId("pf-name").fill("Coach Lee");
  await coachPage.getByTestId("pf-confirm").check();
  await coachPage.getByTestId("pf-submit").click();
  await coachPage.getByTestId("pf-error").filter({ hasText: "This proof was updated" }).waitFor({ timeout: 8000 }).catch(async (error) => {
    console.log("DEBUG pf:", await coachPage.locator("[data-testid=pf-answers], [data-testid=pf-done]").first().innerText().catch(() => "?"));
    console.log("DEBUG versions:", (await versionsOf(proof1.id)).map((v) => [v.version, v.status]));
    throw error;
  });
  assert.equal((await versionsOf(proof1.id))[0].status, "SENT", "nothing was approved");
  await coachPage.reload();
  await settle(coachPage);
  assert.match(await pfProof.getByTestId("pf-status").innerText(), /Being updated by Test Apparel Co/);
  assert.equal(await coachPage.getByTestId("pf-answers").count(), 0, "no buttons while a new version is being made");

  log("Send proofs sends version 2 and replaces version 1; a tab still on version 1 is refused");
  await page.getByTestId("send-proofs").click();
  await sendSheet.getByTestId("send-proofs-list").waitFor();
  await sendSheet.getByTestId("send-proofs-mark").click();
  await sendSheet.waitFor({ state: "detached" });
  let versions = await versionsOf(proof1.id);
  assert.deepEqual(versions.map((v) => v.status), ["SUPERSEDED", "SENT"]);
  await coachPage.reload();
  await settle(coachPage);
  assert.equal(await pfProof.getByTestId("pf-status").innerText(), "Waiting for your answer");

  log("the coach approves version 2: approved with their name; the calendar says so; the quote line shows it");
  await coachPage.locator(`[data-testid=pf-answer][data-version="${v2.id}"]`).getByTestId("pf-approve").click();
  await coachPage.getByTestId("pf-name").fill("Coach Lee");
  await coachPage.getByTestId("pf-confirm").check();
  await coachPage.getByTestId("pf-submit").click();
  await Promise.race([coachPage.getByTestId("pf-done").waitFor(), coachPage.getByTestId("pf-error").waitFor()]);
  if (await coachPage.getByTestId("pf-error").count()) throw new Error(`refused: ${await coachPage.getByTestId("pf-error").innerText()}`);
  versions = await versionsOf(proof1.id);
  assert.equal(versions[1].status, "APPROVED");
  assert.equal(versions[1].approvedByName, "Coach Lee");
  assert.equal(versions[1].approvedOffline, false);
  assert.equal(versions[0].status, "SUPERSEDED", "the replaced version stays replaced");
  const events = async (type) =>
    (await sql(`SELECT title, "doneAt", notes FROM "CalendarEvent" WHERE "organizationId"=$1 AND "quoteId"=$2 AND type=$3`, [org, quoteId, type])).rows;
  const approvedEvents = await events("Proofs approved");
  assert.equal(approvedEvents.length, 1);
  assert.equal(approvedEvents[0].title, "Proofs approved · Coach Lee");
  assert.ok(approvedEvents[0].doneAt);
  await coachPage.reload();
  await settle(coachPage);
  assert.match(await pfProof.getByTestId("pf-status").innerText(), /^Approved by Coach Lee/);
  // A double tap from another tab is a success that changes nothing.
  await page.reload();
  await settle(page);
  assert.match(await page.getByTestId("line-row").nth(0).getByTestId("line-proof").innerText(), /Approved/);

  log("a Gold proof on a plain front; the coach asks for changes; the rep gets an open calendar entry");
  await page.getByTestId("line-row").nth(3).getByTestId("line-proof-add").click();
  await sheet.waitFor();
  assert.equal(await sheet.getByTestId("proof-line").count(), 1);
  await sheet.getByTestId("proof-no-color-picture").waitFor();
  assert.equal(await sheet.getByTestId("proof-base-plain-front").getAttribute("aria-pressed"), "true");
  assert.equal(await sheet.getByTestId("proof-base-color").inputValue(), "#d9a520");
  await sheet.locator('[data-testid=proof-artwork][data-name="Lincoln Lions"]').click();
  await sheet.getByTestId("proof-save").click();
  await sheet.waitFor({ state: "detached" });
  const proof2 = (await proofRows())[1];
  assert.equal(proof2.number, 2);
  assert.equal(proof2.colorOptionId, gold);
  await page.getByTestId("send-proofs").click();
  await sendSheet.getByTestId("send-proofs-list").waitFor();
  assert.match(await sendSheet.getByTestId("send-proofs-list").innerText(), /^Proof 2 · Classic Tee · Gold$/);
  await sendSheet.getByTestId("send-proofs-mark").click();
  await sendSheet.waitFor({ state: "detached" });
  await coachPage.reload();
  await settle(coachPage);
  const p2v1 = (await versionsOf(proof2.id))[0];
  const gAnswer = coachPage.locator(`[data-testid=pf-answer][data-version="${p2v1.id}"]`);
  await gAnswer.getByTestId("pf-changes").click();
  await coachPage.getByTestId("pf-name").fill("Coach Lee");
  await coachPage.getByTestId("pf-submit").click();
  await coachPage.getByTestId("pf-error").filter({ hasText: "Tell us what to change" }).waitFor();
  await gAnswer.getByTestId("pf-note").fill("Make the logo bigger please");
  await coachPage.getByTestId("pf-submit").click();
  await coachPage.getByTestId("pf-done").waitFor();
  assert.equal((await versionsOf(proof2.id))[0].status, "CHANGES");
  const changeEvents = await events("Proof changes");
  assert.equal(changeEvents.length, 1);
  assert.equal(changeEvents[0].doneAt, null);
  assert.match(changeEvents[0].notes, /Proof 2: Coach Lee asked for changes — Make the logo bigger please/);
  await page.reload();
  await settle(page);
  assert.match(await page.locator('[data-testid=proof-row][data-proof="2"] [data-testid=proof-words]').innerText(), /asked for changes: Make the logo bigger please/);

  log("the rep makes version 2 and marks it approved by hand (approved on the phone); the changes entry goes");
  await page.locator('[data-testid=proof-row][data-proof="2"]').getByTestId("proof-open").click();
  await sheet.waitFor();
  await sheet.getByTestId("proof-artwork-box").focus();
  await page.keyboard.press("+");
  await page.keyboard.press("+");
  await sheet.getByTestId("proof-save").click();
  await sheet.waitFor({ state: "detached" });
  const row2 = page.locator('[data-testid=proof-row][data-proof="2"]');
  await row2.getByTestId("proof-mark-approved").click();
  await row2.getByTestId("proof-mark-approved-name").fill("Coach Lee (phone)");
  await row2.getByTestId("proof-mark-approved-save").click();
  await row2.getByText(/Approved by Coach Lee \(phone\) \(marked by the team\)/).waitFor();
  const p2 = await versionsOf(proof2.id);
  assert.deepEqual(p2.map((v) => v.status), ["SUPERSEDED", "APPROVED"]);
  assert.equal(p2[1].approvedOffline, true);
  assert.equal(p2[1].approvedById, owner);
  assert.equal((await events("Proof changes")).length, 0, "the open changes entry came off");

  log("a size added later joins its garment's one proof; a line moved to Gold moves to the Gold proof");
  const xl = cuid();
  await sql(`INSERT INTO "VariationOption" (id, "organizationId", "groupId", name, position, "updatedAt") VALUES ($1,$2,$3,'XL',3,now())`, [xl, org, sizeGroup]);
  await sql(`INSERT INTO "ProductVariation" ("productId", "optionId", "organizationId") VALUES ($1,$2,$3)`, [productId, xl, org]);
  await page.reload();
  await settle(page);
  const catalog = page.getByLabel("Add product from catalog");
  await catalog.fill("Classic");
  await page.getByTestId("catalog-results").getByRole("option").first().waitFor();
  await catalog.press("Enter");
  const newRow = page.getByTestId("line-row").nth(5);
  await newRow.locator('[data-testid=line-label][data-group="Color"]').selectOption({ label: "Navy" });
  await newRow.locator('[data-testid=line-label][data-group="Size"]').selectOption({ label: "XL" });
  assert.equal(await newRow.getByTestId("line-proof-save-first").count(), 1, "a new line needs saving before a proof");
  // Move the M line to Gold in the same save.
  await page.getByTestId("line-row").nth(1).locator('[data-testid=line-label][data-group="Color"]').selectOption({ label: "Gold" });
  await page.getByTestId("quote-save").click();
  await page.getByTestId("quote-save-status").filter({ hasText: "All changes saved" }).waitFor();
  const xlLine = (await sql(`SELECT id, "proofId" FROM "QuoteLineItem" WHERE "quoteId"=$1 AND "variationText"='Navy · XL'`, [quoteId])).rows[0];
  assert.equal(xlLine.proofId, proof1.id, "the XL line joined the Navy proof");
  const lines2 = await proofOfLines();
  assert.equal(lines2[lineIds.navyM], proof2.id, "the line now Gold is on the Gold proof");
  assert.equal(lines2[lineIds.navyS], proof1.id);
  assert.equal((await versionsOf(proof1.id)).length, 2, "joining lines made no new version");
  await coachPage.reload();
  await settle(coachPage);
  assert.match(await pfProof.innerText(), /12 × Navy · S, 12 × Navy · L, 1 × Navy · XL/);

  log("the customer's quote shows each line's proof instead of the product picture, linking to the approval page");
  await page.getByTestId("send-quote").first().click();
  await page.getByTestId("send-quote-mark").click();
  for (let i = 0; i < 40 && (await sql(`SELECT status FROM "Quote" WHERE id=$1`, [quoteId])).rows[0].status !== "SENT"; i += 1) await page.waitForTimeout(250);
  const publicToken = (await sql(`SELECT "publicToken" FROM "Quote" WHERE id=$1`, [quoteId])).rows[0].publicToken;
  await coachPage.goto(`${BASE}/q/${publicToken}`);
  await settle(coachPage);
  const docProof = coachPage.getByTestId("document-line-proof");
  assert.ok((await docProof.count()) >= 4);
  assert.match(await docProof.first().innerText(), /Proof 1: approved/);
  assert.equal(await docProof.first().locator("a").getAttribute("href"), `/pf/${quoteRow.proofToken}`);
  const firstPicture = await coachPage.getByTestId("document-line-picture").first().getAttribute("src");
  assert.equal(firstPicture, `/files/${(await versionsOf(proof1.id))[1].publicToken}?v=doc`);

  log("contracts: the customer's Sales Order carries the proofs; a blank supplier's order doesn't; the printer's does, with its files");
  const salesOrder = cuid();
  const blankPo = cuid();
  const printerPo = cuid();
  const supplier = cuid();
  await sql(`INSERT INTO "Company" (id, "organizationId", name, "updatedAt") VALUES ($1,$2,'Ace Printing',now())`, [supplier, org]);
  const contract = async (id, number, payable, title, status) =>
    sql(
      `INSERT INTO "Contract" (id, "organizationId", "contactId", "companyId", "dealId", "quoteId", number, title, body, status, payable, "publicToken", "updatedAt", "sentAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Terms.',$9::"ContractStatus",$10,$11,now(), CASE WHEN $9::text <> 'DRAFT' THEN now() END)`,
      [id, org, contactId, payable ? supplier : companyId, dealId, quoteId, number, title, status, payable, `c${randomBytes(12).toString("hex")}`],
    );
  await contract(salesOrder, 1, false, "Sales Order", "DRAFT");
  await contract(blankPo, 2, true, "Blank tees", "DRAFT");
  await contract(printerPo, 3, true, "Printing", "DRAFT");
  await sql(`UPDATE "Organization" SET "nextContractNumber" = 4 WHERE id=$1`, [org]);
  for (const [id, line] of [[salesOrder, lineIds.navyS], [salesOrder, lineIds.goldM], [blankPo, lineIds.navyS], [printerPo, lineIds.print]]) {
    await sql(
      `INSERT INTO "ContractLineItem" (id, "contractId", "quoteLineItemId", name, quantity, "unitPriceCents", tag) VALUES ($1,$2,$3,'Row',1,100,'MATERIALS')`,
      [cuid(), id, line],
    );
  }
  await page.goto(`${BASE}/dashboard/contracts/${printerPo}`);
  await settle(page);
  const proofsCard = page.getByTestId("contract-proofs");
  await proofsCard.waitFor();
  assert.equal(await proofsCard.getByTestId("contract-proof").count(), 2);
  await proofsCard.locator('[data-testid=contract-proof][data-proof="1"]').check();
  await proofsCard.locator('[data-testid=contract-proof][data-proof="2"]').check();
  await proofsCard.getByTestId("contract-proofs-save").click();
  await proofsCard.getByText("Saved.").waitFor();
  const held = async (id) =>
    (await sql(`SELECT cp."versionId", cp.covers FROM "ContractProof" cp WHERE cp."contractId"=$1 ORDER BY position`, [id])).rows;
  const printerHeld = await held(printerPo);
  assert.equal(printerHeld.length, 2);
  assert.match(printerHeld[0].covers, /^Classic Tee · Navy: 12 × Navy · S, 12 × Navy · L, 1 × Navy · XL$/);
  assert.equal((await held(blankPo)).length, 0);
  // A draft order's file isn't out yet.
  const printerToken = (await sql(`SELECT "publicToken" FROM "Contract" WHERE id=$1`, [printerPo])).rows[0].publicToken;
  const approvedV2 = (await versionsOf(proof1.id))[1];
  const printUrl = `${BASE}/c/${printerToken}/print/${approvedV2.id}?p=0`;
  assert.equal((await outsider.request.get(printUrl)).status(), 404, "not while a draft");
  await sql(`UPDATE "Contract" SET status='SENT', "sentAt"=now() WHERE id=$1`, [printerPo]);
  await coachPage.goto(`${BASE}/c/${printerToken}`);
  await settle(coachPage);
  const docProofs = coachPage.getByTestId("document-proof");
  assert.equal(await docProofs.count(), 2);
  assert.match(await docProofs.first().getByTestId("document-proof-status").innerText(), /^Approved by Coach Lee/);
  assert.equal(await coachPage.getByTestId("document-print-file").count(), 3, "Navy front and back, and Gold front, each with its file");
  const printDownload = await outsider.request.get(printUrl);
  assert.equal(printDownload.status(), 200);
  assert.match(printDownload.headers()["content-disposition"], /^attachment; filename="lincoln_lions.png"/);
  assert.ok(Buffer.from(await printDownload.body()).equals(png));
  await shot(coachPage, "06-printer-po");

  log("the customer's Sales Order shows what they approved but no print files; a proof another contract doesn't carry can't be fetched");
  await page.goto(`${BASE}/dashboard/contracts/${salesOrder}`);
  await settle(page);
  assert.equal(await page.getByTestId("contract-proof").count(), 2);
  await page.locator('[data-testid=contract-proof][data-proof="1"]').check();
  await page.getByTestId("contract-proofs-save").click();
  await page.getByTestId("contract-proofs").getByText("Saved.").waitFor();
  await sql(`UPDATE "Contract" SET status='SENT', "sentAt"=now() WHERE id=$1`, [salesOrder]);
  const soToken = (await sql(`SELECT "publicToken" FROM "Contract" WHERE id=$1`, [salesOrder])).rows[0].publicToken;
  await coachPage.goto(`${BASE}/c/${soToken}`);
  await settle(coachPage);
  assert.equal(await coachPage.getByTestId("document-proof").count(), 1);
  assert.equal(await coachPage.getByTestId("document-print-file").count(), 0);
  assert.equal((await outsider.request.get(`${BASE}/c/${soToken}/print/${approvedV2.id}?p=0`)).status(), 404, "money in: no files");
  const blankToken = (await sql(`SELECT "publicToken" FROM "Contract" WHERE id=$1`, [blankPo])).rows[0].publicToken;
  await sql(`UPDATE "Contract" SET status='SENT', "sentAt"=now() WHERE id=$1`, [blankPo]);
  assert.equal((await outsider.request.get(`${BASE}/c/${blankToken}/print/${approvedV2.id}?p=0`)).status(), 404, "not carried: no files");

  log("a sent contract's proofs are locked; a newer version after signing leaves the signed order its file, flagged");
  await page.goto(`${BASE}/dashboard/contracts/${printerPo}`);
  await settle(page);
  assert.equal(await page.getByTestId("contract-proof").first().isDisabled(), true);
  await sql(`UPDATE "Contract" SET status='SIGNED', "signedAt"=now(), "signerName"='Ace' WHERE id=$1`, [printerPo]);
  await page.goto(`${BASE}/dashboard/quotes/${quoteId}`);
  await settle(page);
  await page.locator('[data-testid=proof-row][data-proof="1"]').getByTestId("proof-open").click();
  await sheet.waitFor();
  await sheet.getByTestId("proof-artwork-box").focus();
  await page.keyboard.press("ArrowDown");
  await sheet.getByTestId("proof-save").click();
  await sheet.waitFor({ state: "detached" });
  await page.getByTestId("send-proofs").click();
  await sendSheet.getByTestId("send-proofs-list").waitFor();
  await sendSheet.getByTestId("send-proofs-mark").click();
  await sendSheet.waitFor({ state: "detached" });
  assert.deepEqual((await versionsOf(proof1.id)).map((v) => v.status), ["SUPERSEDED", "SUPERSEDED", "SENT"]);
  await coachPage.goto(`${BASE}/c/${printerToken}`);
  await settle(coachPage);
  assert.match(await docProofs.first().getByTestId("document-proof-status").innerText(), /since replaced by a newer version: check before printing/);
  assert.equal((await outsider.request.get(printUrl)).status(), 200, "the signed order keeps the file it was signed for");

  log("the Contract Coordinator: Include the proofs is on for money in, off for money out, and warns about one not approved");
  await page.goto(`${BASE}/dashboard/deals/tracker?dealId=${dealId}&quoteId=${quoteId}`);
  await settle(page);
  const header = page.locator("[data-testid=column-header]").first();
  await header.getByTestId("column-change").click();
  const include = page.getByTestId("column-include-proofs").first();
  await include.waitFor();
  assert.equal(await include.isChecked(), true);
  await page.getByTestId("column-unapproved-proofs").first().waitFor();
  assert.match(await page.getByTestId("column-unapproved-proofs").first().innerText(), /Proof 1 isn't approved yet/);
  await page.locator("#col-1-direction").selectOption("out");
  assert.equal(await include.isChecked(), false);
  await page.locator("#col-1-direction").selectOption("in");
  const before = Number((await sql(`SELECT count(*) FROM "Contract" WHERE "organizationId"=$1`, [org])).rows[0].count);
  // The deal already has contracts, so nothing starts ticked.
  await page.getByRole("checkbox", { name: "Put Classic Tee on Contract A" }).first().check();
  await page.locator("[data-testid=create-contracts]").click();
  const anyway = page.getByTestId("price-check-create-anyway");
  await Promise.race([page.waitForURL(/created=1/), anyway.waitFor().then(() => anyway.click())]);
  await page.waitForURL(/created=1/);
  const made = (await sql(`SELECT id FROM "Contract" WHERE "organizationId"=$1 ORDER BY number DESC LIMIT 1`, [org])).rows[0].id;
  assert.equal(Number((await sql(`SELECT count(*) FROM "Contract" WHERE "organizationId"=$1`, [org])).rows[0].count), before + 1);
  assert.ok((await held(made)).length >= 1, "the new Sales Order carries the proofs");

  log("next season: a new quote for Lincoln High reuses the approved proof as a draft that still needs its own yes");
  // Version 3 is approved first (a replaced version is never offered again).
  await page.goto(`${BASE}/dashboard/quotes/${quoteId}`);
  await settle(page);
  const row1 = page.locator('[data-testid=proof-row][data-proof="1"]');
  await row1.getByTestId("proof-mark-approved").click();
  await row1.getByTestId("proof-mark-approved-name").fill("Coach Lee");
  await row1.getByTestId("proof-mark-approved-save").click();
  await row1.getByText(/Approved by Coach Lee \(marked by the team\)/).waitFor();
  const v3 = (await versionsOf(proof1.id))[2];
  assert.equal(v3.status, "APPROVED");
  const quote2 = cuid();
  await sql(
    `INSERT INTO "Quote" (id, "organizationId", "contactId", "dealId", number, title, "publicToken", "updatedAt") VALUES ($1,$2,$3,$4,1002,'Fall tees',$5,now())`,
    [quote2, org, contactId, dealId, `q${randomBytes(12).toString("hex")}`],
  );
  const q2Line = cuid();
  await sql(
    `INSERT INTO "QuoteLineItem" (id, "quoteId", "productId", name, quantity, "unitPriceCents", tag, variations, "variationText", position)
     VALUES ($1,$2,$3,'Classic Tee',30,1200,'MATERIALS',$4,'Navy · S',0)`,
    [q2Line, quote2, productId, JSON.stringify(lineVariations(navy, "Navy", "S"))],
  );
  await page.goto(`${BASE}/dashboard/quotes/${quote2}`);
  await settle(page);
  await page.getByTestId("line-row").first().getByTestId("line-proof-add").click();
  await sheet.waitFor();
  await sheet.getByTestId("proof-earlier").click();
  await sheet.getByTestId("proof-earlier-row").first().waitFor();
  assert.match(await sheet.getByTestId("proof-earlier-row").first().innerText(), /QUO-1001 · Proof 1/);
  await sheet.getByTestId("proof-earlier-use").first().click();
  await sheet.waitFor({ state: "detached" });
  const reused = (await sql(`SELECT * FROM "Proof" WHERE "quoteId"=$1`, [quote2])).rows[0];
  const [reusedVersion] = await versionsOf(reused.id);
  assert.equal(reusedVersion.status, "DRAFT");
  assert.match(reusedVersion.copiedFrom, /^Approved on QUO-1001 by Coach Lee/);
  assert.equal(reusedVersion.displayKey, v3.displayKey, "the files are shared, not copied");
  assert.notEqual(reusedVersion.publicToken, v3.publicToken);
  assert.equal((await panelsOf(reusedVersion.id)).length, 2);

  log("deleting the new quote takes its proof but not the shared files; deleting the first keeps the proofs its contracts carry");
  await sql(`DELETE FROM "Quote" WHERE id=$1`, [quote2]);
  await page.goto(`${BASE}/dashboard/quotes/${quoteId}`);
  await settle(page);
  await page.getByTestId("delete-quote").click();
  await page.getByTestId("delete-quote-yes").click();
  await page.waitForURL(/\/dashboard\/quotes$/);
  const left = (await sql(`SELECT id, "quoteId" FROM "Proof" WHERE "organizationId"=$1 ORDER BY number`, [org])).rows;
  assert.ok(left.every((row) => row.quoteId === null), "quote-less");
  assert.equal(left.filter((row) => row.id === reused.id).length, 0, "the reused draft went with its quote");
  assert.ok(left.some((row) => row.id === proof1.id), "the proof a signed order carries lives on");
  const sharedFile = path.join(process.cwd(), ".local-storage", v3.displayKey);
  assert.ok(fs.existsSync(sharedFile), "the shared picture is still there");
  await coachPage.goto(`${BASE}/c/${printerToken}`);
  await settle(coachPage);
  assert.equal(await coachPage.getByTestId("document-proof").count(), 2);
  assert.equal((await coachPage.goto(pfUrl)).status(), 404, "the approval link went with its quote");

  log("Labels & Units won't retire Print location while apparel is on; turning apparel off hides it all and deletes nothing");
  await page.goto(`${BASE}/dashboard/products/labels`);
  await settle(page);
  const locationGroup = page.locator('[data-testid=labels-group][data-group="Print location"]');
  // The group's own Retire, not a label's.
  await locationGroup.locator("button:not([data-testid=labels-retire])", { hasText: /^Retire$/ }).click();
  await page.getByText("Proofs use this list for their print location").waitFor();
  assert.equal((await sql(`SELECT "archivedAt" FROM "VariationGroup" WHERE id=$1`, [turnedOn.printLocationGroupId])).rows[0].archivedAt, null);
  // The operator can switch it from /admin too.
  await sql(`UPDATE "User" SET "isSuperAdmin"=true WHERE id=$1`, [owner]);
  await page.goto(`${BASE}/admin`);
  await settle(page);
  const adminSwitch = page.locator(`form:has(input[name=organizationId][value="${org}"])`).getByTestId("workspace-apparel");
  assert.equal(await adminSwitch.innerText(), "Turn off");
  await adminSwitch.click();
  for (let i = 0; i < 40 && (await orgRow()).apparelOn; i += 1) await page.waitForTimeout(250);
  assert.equal((await orgRow()).apparelOn, false);
  await sql(`UPDATE "User" SET "isSuperAdmin"=false WHERE id=$1`, [owner]);
  await page.goto(`${BASE}/dashboard/companies/${companyId}`);
  await settle(page);
  assert.equal(await page.getByTestId("artwork-card").count(), 0);
  assert.ok(Number((await sql(`SELECT count(*) FROM "Artwork" WHERE "organizationId"=$1`, [org])).rows[0].count) >= 4);
  await page.goto(`${BASE}/dashboard/settings/general#apparel`);
  await settle(page);
  await page.getByTestId("apparel-switch").click();
  await page.getByTestId("apparel-save").click();
  await page.getByText("Apparel is on.").waitFor();

  log("the phone: the proof sheet is a bottom sheet and the approval page fits");
  const phone = await browser.newContext({ ...devices["iPhone 13"] });
  const phonePage = await phone.newPage();
  await phonePage.goto(`${BASE}/login`);
  await phonePage.fill("#email", EMAIL);
  await phonePage.fill("#password", PASSWORD);
  await phonePage.click("button[type=submit]");
  await phonePage.waitForURL(/\/dashboard$/);
  const q3 = cuid();
  await sql(
    `INSERT INTO "Quote" (id, "organizationId", "contactId", "dealId", number, title, "publicToken", "updatedAt") VALUES ($1,$2,$3,$4,1003,'Phone tees',$5,now())`,
    [q3, org, contactId, dealId, `q${randomBytes(12).toString("hex")}`],
  );
  await sql(
    `INSERT INTO "QuoteLineItem" (id, "quoteId", "productId", name, quantity, "unitPriceCents", tag, variations, "variationText", position)
     VALUES ($1,$2,$3,'Classic Tee',5,1200,'MATERIALS',$4,'Navy · M',0)`,
    [cuid(), q3, productId, JSON.stringify(lineVariations(navy, "Navy", "M"))],
  );
  await phonePage.goto(`${BASE}/dashboard/quotes/${q3}`);
  await settle(phonePage);
  await phonePage.getByTestId("line-proof-add").first().click();
  const phoneSheet = phonePage.getByTestId("proof-sheet");
  await phoneSheet.waitFor();
  const sheetBox = await phoneSheet.boundingBox();
  const viewport = phonePage.viewportSize();
  assert.ok(sheetBox.x <= 1 && sheetBox.width >= viewport.width - 2, "full width on a phone");
  assert.ok(sheetBox.y + sheetBox.height >= viewport.height - 2, "pinned to the bottom");
  const canvasBox = await phoneSheet.getByTestId("proof-canvas").boundingBox();
  assert.ok(canvasBox.width <= viewport.width, "the picture fits");
  await shot(phonePage, "07-phone-sheet");
  await phonePage.keyboard.press("Escape");
  await phone.close();

  console.log(`\nAll ${step} steps passed.`);
  if (pageErrors.length) throw new Error(`page errors: ${pageErrors.join(" | ")}`);
  await coach.close();
  await outsider.close();
  await browser.close();
  await claude.close();
})().catch(async (error) => {
  console.error(error);
  process.exit(1);
});

function locationsId(result, name) {
  return result.rows.find((row) => row.name === name)?.id;
}
