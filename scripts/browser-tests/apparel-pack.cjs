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

  console.log(`\nPart one passed (${step} steps).`);
  if (pageErrors.length) throw new Error(`page errors: ${pageErrors.join(" | ")}`);
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
