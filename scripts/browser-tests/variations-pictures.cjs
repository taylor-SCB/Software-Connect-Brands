/* Browser regression for Release 3b (Nov 6, 2026): variation labels,
 * a workspace's own units and product pictures.
 *
 * Labels in groups (Unit, Color, Size built in, the workspace's own beside
 * them) ticked on a product's Variations card, which posts only what changed
 * and only once touched; custom units ("Box of 12" contains 12 Each) in the
 * Unit box on Labor and Materials products; up to six pictures a product,
 * made small in the browser, the first one main, one per Color; Add product
 * lands on the new product's page; labels picked on a quote line and printed
 * under the name on the customer's copy, the contract and the supplier's
 * purchase order; a sent quote keeping the picture it went out with; the
 * Labels & Units tab, where only an Owner or Admin renames or retires.
 *
 * Runs against a built app started with STORAGE_DRIVER=local and no
 * BLOB_READ_WRITE_TOKEN in .env, and a local Postgres that has had
 * `prisma migrate deploy` run against it. It signs up its own workspace and
 * deletes it again on the next run. Never point it at the live database.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/scb_test \
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules \
 *   node scripts/browser-tests/variations-pictures.cjs
 */
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS on purpose: NODE_PATH only resolves the global playwright for require() */
const os = require("node:os");
const { chromium, devices } = require("playwright");
const { Client } = require("pg");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const BASE = process.env.BASE || "http://localhost:3000";
const DB = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5433/scb_test";
const OUT = process.env.SHOTS_DIR || path.join(os.tmpdir(), "scb-browser-shots-variations");
const STORE = path.join(process.cwd(), ".local-storage");
fs.mkdirSync(OUT, { recursive: true });

const EMAIL = "test-variations@example.com";
const MEMBER_EMAIL = "test-variations-member@example.com";
const PASSWORD = "password123";
const COMPANY = "Test Variations Co";
const SLUG = "test-variations-co%";

let step = 0;
function log(msg) {
  step += 1;
  console.log(`[${String(step).padStart(2, "0")}] ${msg}`);
}
async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `vp-${name}.png`), fullPage: true });
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
async function login(page, email = EMAIL) {
  await page.goto(`${BASE}/login`);
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/dashboard$/);
}

// A picture drawn in the page: a coloured square with a transparent corner,
// so a JPEG made from it shows whether it was flattened on white.
async function makePicture(page, color, size = 900, type = "image/png") {
  const b64 = await page.evaluate(
    async ({ color, size, type }) => {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = Math.round(size * 0.75);
      const context = canvas.getContext("2d");
      context.fillStyle = color;
      context.fillRect(size * 0.25, 0, size * 0.75, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.92));
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let text = "";
      for (const byte of bytes) text += String.fromCharCode(byte);
      return btoa(text);
    },
    { color, size, type },
  );
  return Buffer.from(b64, "base64");
}

(async () => {
  await sql(`DELETE FROM "Organization" WHERE slug LIKE $1`, [SLUG]);

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (err) => {
    pageErrors.push(err.message);
    console.error("PAGE ERROR:", err.message);
  });

  log("signup, activate, login");
  await page.goto(`${BASE}/signup`);
  await page.fill("[name=companyName]", COMPANY);
  await page.fill("[name=name]", "Vera Test");
  await page.fill("[name=email]", EMAIL);
  await page.fill("[name=phone]", "5550000000");
  await page.fill("[name=password]", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/signup\/submitted/);
  await sql(`UPDATE "Organization" SET status='ACTIVE', "reviewedAt"=now() WHERE slug LIKE $1`, [SLUG]);
  const org = (await sql(`SELECT id FROM "Organization" WHERE slug LIKE $1`, [SLUG])).rows[0].id;
  await login(page);

  const productNamed = async (name) =>
    (await sql(`SELECT * FROM "Product" WHERE "organizationId"=$1 AND name=$2`, [org, name])).rows[0];
  const labelsOf = async (productId) =>
    (
      await sql(
        `SELECT g.name AS "group", o.name FROM "ProductVariation" pv
           JOIN "VariationOption" o ON o.id = pv."optionId" JOIN "VariationGroup" g ON g.id = o."groupId"
          WHERE pv."organizationId"=$1 AND pv."productId"=$2 ORDER BY g.name, o.name`,
        [org, productId],
      )
    ).rows.map((row) => `${row.group}:${row.name}`);
  const optionId = async (group, name) =>
    (
      await sql(
        `SELECT o.id FROM "VariationOption" o JOIN "VariationGroup" g ON g.id=o."groupId"
          WHERE o."organizationId"=$1 AND g.name=$2 AND o.name=$3`,
        [org, group, name],
      )
    ).rows[0]?.id;
  const picturesOf = async (productId) =>
    (
      await sql(
        `SELECT id, position, "colorOptionId", "storageKey", "thumbKey", "docKey", "contentType", "publicToken", "removedAt"
           FROM "ProductImage" WHERE "organizationId"=$1 AND "productId"=$2 ORDER BY position NULLS LAST, "createdAt"`,
        [org, productId],
      )
    ).rows;
  const group = (name) => page.locator(`[data-testid=variation-group][data-group="${name}"]`);
  const chip = (groupName, label) =>
    group(groupName).locator("[data-testid=label-chip]", { hasText: new RegExp(`^(✓ )?${label}( \\(retired\\))?$`) });
  // The box stays open after a label, ready for the next.
  async function addLabel(groupName, label) {
    if (!(await group(groupName).locator("[data-testid=label-add-input]").isVisible())) {
      await group(groupName).locator("[data-testid=label-add]").click();
    }
    await group(groupName).locator("[data-testid=label-add-input]").fill(label);
    await group(groupName).locator("[data-testid=label-add-input]").press("Enter");
  }
  // Waits for the save itself: the previous save's "Product saved" may
  // still be on screen.
  async function saveProduct() {
    const answered = page.waitForResponse((r) => r.request().method() === "POST" && !!r.request().headers()["next-action"]);
    await page.click("button[type=submit]:has-text('Save changes')");
    await answered;
    await page.waitForFunction(() => !document.querySelector("button[type=submit]")?.textContent?.includes("Saving"));
    const refused = page.locator("[data-testid=form-error], .form-error, [role=alert]").filter({ hasText: /./ });
    if (await refused.count()) {
      const text = (await refused.allInnerTexts()).join(" | ");
      if (!/Product saved/.test(text) && text.trim()) throw new Error(`save refused: ${text}`);
    }
  }

  /* ------------------------------ Product page ----------------------------- */

  log("Add product: built-in groups seeded, labels typed, a custom unit, lands on the product's page");
  await page.goto(`${BASE}/dashboard/products/new`);
  await page.fill("[name=name]", "Classic Tee");
  await page.selectOption("#defaultTag", "MATERIALS");
  await page.fill("#cost", "4.00");
  await page.fill("#unitPrice", "12.00");
  for (const name of ["Unit", "Color", "Size"]) await group(name).first().waitFor();
  assert.equal(await group("Unit").locator("[data-testid=label-chip]").count(), 8, "the eight Materials units");
  await addLabel("Color", "Black");
  await addLabel("Color", "Navy");
  await addLabel("Size", "L");
  // Typed again in other capitals: no second chip.
  await addLabel("Size", "l");
  assert.equal(await group("Size").locator("[data-testid=label-chip-new]").count(), 1);
  await page.selectOption("#unitOfMeasure", "__newunit__");
  await page.fill("[name=newUnitName]", "Box of 12");
  await page.fill("[name=newUnitContains]", "12");
  await page.selectOption("[name=newUnitBase]", "EACH");
  await page.click("button[type=submit]:has-text('Save product')");
  await page.waitForURL(/\/dashboard\/products\/[^/]+\?added=1$/);
  await page.locator("[data-testid=product-added]").waitFor();
  let tee = await productNamed("Classic Tee");
  assert.equal(tee.unitOfMeasure, null);
  assert.ok(tee.customUnitId, "custom unit saved");
  const box = (await sql(`SELECT name, contains, "baseUnit", tag FROM "VariationOption" WHERE id=$1`, [tee.customUnitId])).rows[0];
  assert.deepEqual(box, { name: "Box of 12", contains: 12, baseUnit: "EACH", tag: "MATERIALS" });
  assert.deepEqual(await labelsOf(tee.id), ["Color:Black", "Color:Navy", "Size:L"]);
  assert.equal(await page.locator("#unitOfMeasure").inputValue(), `cu:${tee.customUnitId}`);
  assert.match(await page.locator("[data-testid=unit-contains]").innerText(), /Box of 12 contains 12 Each/);
  assert.equal(await chip("Color", "Black").getAttribute("aria-pressed"), "true");
  await shot(page, "01-added");

  log("a price save leaves labels alone, even one another tab added meanwhile");
  const navyId = await optionId("Color", "Navy");
  await addLabel("Color", "Red");
  await chip("Color", "Black").click(); // untick, then tick back: nothing changed
  await chip("Color", "Black").click();
  await page.goto(`${BASE}/dashboard/products/${tee.id}`);
  // Another tab ticks a new Size on this product.
  await sql(
    `INSERT INTO "VariationOption" (id,"organizationId","groupId",name,position,"updatedAt")
       SELECT 'opt_vp_xl', $1, id, 'XL', 50, now() FROM "VariationGroup" WHERE "organizationId"=$1 AND name='Size'`,
    [org],
  );
  await sql(`INSERT INTO "ProductVariation" ("productId","optionId","organizationId") VALUES ($1,'opt_vp_xl',$2)`, [tee.id, org]);
  await page.fill("#unitPrice", "13.00");
  await saveProduct();
  assert.deepEqual(await labelsOf(tee.id), ["Color:Black", "Color:Navy", "Size:L", "Size:XL"]);
  assert.equal((await productNamed("Classic Tee")).unitPriceCents, 1300);

  log("untick one label: only that one comes off; a second Save re-sends nothing");
  await page.reload();
  await chip("Color", "Navy").click();
  await saveProduct();
  assert.deepEqual(await labelsOf(tee.id), ["Color:Black", "Size:L", "Size:XL"]);
  await sql(`INSERT INTO "ProductVariation" ("productId","optionId","organizationId") VALUES ($1,$2,$3)`, [tee.id, navyId, org]);
  await page.fill("#unitPrice", "14.00");
  await saveProduct();
  assert.deepEqual(await labelsOf(tee.id), ["Color:Black", "Color:Navy", "Size:L", "Size:XL"], "Navy put back elsewhere stays");

  log("a retired label the product has shows (retired), survives a save, and isn't re-added by typing it");
  await sql(`UPDATE "VariationOption" SET "archivedAt"=now() WHERE id=$1`, [navyId]);
  await page.reload();
  assert.equal(await chip("Color", "Navy").getAttribute("aria-pressed"), "true");
  assert.match(await chip("Color", "Navy").innerText(), /retired/);
  await page.fill("#unitPrice", "15.00");
  await saveProduct();
  assert.ok((await labelsOf(tee.id)).includes("Color:Navy"));
  const other = await sql(
    `INSERT INTO "Product" (id,"organizationId",name,"unitPriceCents","defaultTag",active,"updatedAt")
       VALUES ('prd_vp_hoodie',$1,'Hoodie',3000,'MATERIALS',true,now()) RETURNING id`,
    [org],
  );
  const hoodieId = other.rows[0].id;
  await page.goto(`${BASE}/dashboard/products/${hoodieId}`);
  assert.equal(await chip("Color", "Navy").count(), 0, "a retired label isn't offered on a product without it");
  await addLabel("Color", "navy");
  assert.match(await page.locator("[data-testid=label-problem]").innerText(), /Navy was retired/);
  await sql(`UPDATE "VariationOption" SET "archivedAt"=NULL WHERE id=$1`, [navyId]);

  log("a tag change takes the old list's units off; Software offers no custom unit");
  await page.goto(`${BASE}/dashboard/products/${hoodieId}`);
  await chip("Unit", "Each").click();
  await saveProduct();
  assert.deepEqual(await labelsOf(hoodieId), ["Unit:Each"]);
  await page.selectOption("#defaultTag", "LABOR");
  assert.match(await page.locator("[data-testid=unit-note]").innerText(), /Each will be taken off when you save/);
  await page.selectOption("#defaultTag", "SOFTWARE");
  assert.equal(await page.locator("#unitOfMeasure option[value=__newunit__]").count(), 0);
  assert.equal(await page.locator(`#unitOfMeasure option[value="cu:${tee.customUnitId}"]`).count(), 0);
  await page.selectOption("#unitOfMeasure", "PER_DEVICE");
  await page.selectOption("#softwareRate", "PER_MONTH");
  await page.fill("#softwareTerm", "12");
  await saveProduct();
  const hoodie = await productNamed("Hoodie");
  assert.deepEqual([hoodie.defaultTag, hoodie.unitOfMeasure, hoodie.softwareRate, hoodie.softwareTerm, hoodie.customUnitId], [
    "SOFTWARE",
    "PER_DEVICE",
    "PER_MONTH",
    12,
    null,
  ]);
  assert.deepEqual(await labelsOf(hoodieId), [], "Each went with the Materials list");
  await page.selectOption("#defaultTag", "MATERIALS");
  await page.selectOption("#unitOfMeasure", `cu:${tee.customUnitId}`);
  await saveProduct();
  assert.equal((await productNamed("Hoodie")).customUnitId, tee.customUnitId);
  assert.equal((await productNamed("Hoodie")).unitOfMeasure, null);

  log("a custom unit retired keeps its place on the product that has it");
  await sql(`UPDATE "VariationOption" SET "archivedAt"=now() WHERE id=$1`, [tee.customUnitId]);
  await page.reload();
  assert.equal(await page.locator("#unitOfMeasure").inputValue(), `cu:${tee.customUnitId}`);
  assert.match(await page.locator("#unitOfMeasure option:checked").innerText(), /retired/);
  await page.fill("#unitPrice", "31.00");
  await saveProduct();
  assert.equal((await productNamed("Hoodie")).customUnitId, tee.customUnitId);
  await sql(`UPDATE "VariationOption" SET "archivedAt"=NULL WHERE id=$1`, [tee.customUnitId]);

  /* -------------------------------- Pictures ------------------------------- */

  log("pictures: two added at once, made small in the browser, the first main");
  await page.goto(`${BASE}/dashboard/products/${tee.id}`);
  const black = await makePicture(page, "#111111");
  const navy = await makePicture(page, "#1e3a8a", 2400);
  await page.setInputFiles("[data-testid=picture-input]", [
    { name: "black.png", mimeType: "image/png", buffer: black },
    { name: "navy.png", mimeType: "image/png", buffer: navy },
  ]);
  await page.locator("[data-testid=picture-tile]").nth(1).waitFor();
  let pics = await picturesOf(tee.id);
  assert.deepEqual(pics.map((p) => p.position), [0, 1]);
  assert.equal(pics[0].contentType, "image/webp");
  for (const p of pics) {
    assert.match(p.storageKey, new RegExp(`^org/${org}/products/${tee.id}/[\\w-]+\\.webp$`));
    for (const key of [p.storageKey, p.thumbKey, p.docKey]) assert.ok(fs.existsSync(path.join(STORE, key)), key);
    assert.ok(fs.statSync(path.join(STORE, p.storageKey)).size <= 2 * 1024 * 1024);
    assert.ok(fs.statSync(path.join(STORE, p.docKey)).size <= 60 * 1024);
  }
  assert.equal(await page.locator("[data-testid=picture-main]").count(), 1);
  const doc = await page.request.get(`${BASE}/files/${pics[0].publicToken}?v=doc`);
  assert.equal(doc.status(), 200);
  assert.equal(doc.headers()["content-type"], "image/jpeg");
  assert.match(doc.headers()["cache-control"], /s-maxage=31536000/);
  const thumb = await page.request.get(`${BASE}/files/${pics[1].publicToken}?v=thumb`);
  assert.equal(thumb.headers()["content-type"], "image/webp");
  // The 2400 px original came out at 1600 across.
  const dims = (await sql(`SELECT width, height FROM "ProductImage" WHERE id=$1`, [pics[1].id])).rows[0];
  assert.deepEqual(dims, { width: 1600, height: 1200 });
  await shot(page, "02-pictures");

  log("Make main swaps places; a picture's Color is saved");
  await page.locator("[data-testid=picture-make-main]").first().click();
  await page.waitForFunction(
    (token) => document.querySelector("[data-testid=picture-tile] img")?.getAttribute("src")?.includes(token),
    pics[1].publicToken,
  );
  pics = await picturesOf(tee.id);
  assert.deepEqual(pics.map((p) => p.publicToken.slice(0, 6)), [pics[0].publicToken.slice(0, 6), pics[1].publicToken.slice(0, 6)]);
  const navyPic = pics[0];
  const blackPic = pics[1];
  await page.locator("[data-testid=picture-color]").nth(1).selectOption(await optionId("Color", "Black"));
  for (let i = 0; i < 20 && !(await picturesOf(tee.id))[1].colorOptionId; i += 1) await page.waitForTimeout(150);
  assert.equal((await picturesOf(tee.id))[1].colorOptionId, await optionId("Color", "Black"));
  assert.ok(navyPic.storageKey !== blackPic.storageKey);

  log("Safari: no WebP from the canvas, so a transparent PNG goes in as JPEG on white");
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      return original.call(this, callback, type === "image/webp" ? "image/png" : type, quality);
    };
  });
  await page.setInputFiles("[data-testid=picture-input]", [{ name: "cutout.png", mimeType: "image/png", buffer: black }]);
  await page.locator("[data-testid=picture-tile]").nth(2).waitFor();
  pics = await picturesOf(tee.id);
  assert.equal(pics[2].contentType, "image/jpeg");
  assert.match(pics[2].storageKey, /\.jpg$/);
  // Top-left corner was transparent: white, not black, once flattened.
  const corner = await page.evaluate(async (token) => {
    const response = await fetch(`/files/${token}`);
    const bitmap = await createImageBitmap(await response.blob());
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    context.drawImage(bitmap, 0, 0);
    return Array.from(context.getImageData(2, 2, 1, 1).data).slice(0, 3);
  }, pics[2].publicToken);
  assert.ok(corner.every((value) => value > 240), `white corner, got ${corner}`);
  await page.reload();

  log("up to six: a seventh is left out with a note");
  const many = [];
  for (let i = 0; i < 4; i += 1) many.push({ name: `extra-${i}.png`, mimeType: "image/png", buffer: await makePicture(page, `hsl(${i * 80},70%,50%)`, 300) });
  await page.setInputFiles("[data-testid=picture-input]", many);
  await page.locator("[data-testid=picture-note]").waitFor();
  assert.match(await page.locator("[data-testid=picture-note]").innerText(), /added the first 3, left out 1/);
  await page.locator("[data-testid=picture-tile]").nth(5).waitFor();
  assert.equal((await picturesOf(tee.id)).length, 6);
  assert.equal(await page.locator("[data-testid=picture-input]").count(), 0, "no Add picture at six");

  log("Remove the main picture: the next one is main and the rest close up");
  await page.locator("[data-testid=picture-remove]").first().click();
  await page.waitForFunction(() => document.querySelectorAll("[data-testid=picture-tile]").length === 5);
  pics = await picturesOf(tee.id);
  assert.deepEqual(pics.map((p) => p.position), [0, 1, 2, 3, 4]);
  assert.equal(pics[0].id, blackPic.id, "the old second picture is main");
  assert.ok(!fs.existsSync(path.join(STORE, navyPic.storageKey)), "its files went with it");
  await page.setInputFiles("[data-testid=picture-input]", [{ name: "late.png", mimeType: "image/png", buffer: await makePicture(page, "#16a34a", 300) }]);
  await page.locator("[data-testid=picture-tile]").nth(5).waitFor();
  pics = await picturesOf(tee.id);
  assert.equal(pics[0].id, blackPic.id, "a new upload never becomes main");
  assert.equal(pics[5].position, 5);

  log("the Products list shows the main picture and the label counts");
  await page.goto(`${BASE}/dashboard/products?q=Classic`);
  const row = page.locator("tr", { hasText: "Classic Tee" }).first();
  assert.match(await row.locator("[data-testid=product-thumb]").getAttribute("src"), new RegExp(blackPic.publicToken));
  assert.equal(await row.locator("[data-testid=product-label-counts]").innerText(), "2 colors · 2 sizes");
  assert.match(await row.innerText(), /Box of 12/);

  log("clone copies labels, the custom unit and the pictures (same files, own rows)");
  await page.goto(`${BASE}/dashboard/products/${tee.id}`);
  const cloneId = await (async () => {
    await sql(`SELECT 1`);
    const before = new Set((await sql(`SELECT id FROM "Product" WHERE "organizationId"=$1`, [org])).rows.map((r) => r.id));
    await page.goto(`${BASE}/dashboard/products?q=Classic`);
    await page.locator("tr", { hasText: "Classic Tee" }).first().locator("button:has-text('Clone')").click();
    await page.waitForURL(/\/dashboard\/products\/[^/?]+$/);
    const after = (await sql(`SELECT id FROM "Product" WHERE "organizationId"=$1`, [org])).rows.map((r) => r.id);
    return after.find((id) => !before.has(id));
  })();
  assert.deepEqual(await labelsOf(cloneId), await labelsOf(tee.id));
  const clone = (await sql(`SELECT "customUnitId" FROM "Product" WHERE id=$1`, [cloneId])).rows[0];
  assert.equal(clone.customUnitId, tee.customUnitId);
  const clonePics = await picturesOf(cloneId);
  assert.deepEqual(clonePics.map((p) => p.storageKey), (await picturesOf(tee.id)).map((p) => p.storageKey));
  assert.ok(clonePics.every((p, i) => p.publicToken !== pics[i].publicToken));

  log("deleting the clone keeps the source's files; deleting a product with no quotes takes its pictures");
  await page.locator("button:has-text('Delete product')").click();
  await page.waitForURL(/\/dashboard\/products(\?.*)?$/);
  assert.equal((await sql(`SELECT count(*)::int AS n FROM "ProductImage" WHERE "organizationId"=$1 AND "productId" IS NULL`, [org])).rows[0].n, 0);
  for (const p of await picturesOf(tee.id)) assert.ok(fs.existsSync(path.join(STORE, p.storageKey)));

  /* ------------------------------- Quote lines ------------------------------ */

  const blackId = await optionId("Color", "Black");
  const navyOpt = await optionId("Color", "Navy");
  const sizeL = await optionId("Size", "L");
  const sizeXL = await optionId("Size", "XL");
  pics = await picturesOf(tee.id);
  // The main picture is Black's; the second one shows Navy.
  await sql(`UPDATE "ProductImage" SET "colorOptionId"=$1 WHERE id=$2`, [navyOpt, pics[1].id]);
  const mainPic = pics[0];
  const navyPicture = pics[1];
  await sql(`INSERT INTO "Distributor" (id,"organizationId",name,"updatedAt") VALUES ('dst_vp',$1,'Tee Supply',now())`, [org]);
  await sql(`UPDATE "Product" SET "distributorId"='dst_vp', "costCents"=400 WHERE id=$1`, [tee.id]);
  await sql(`INSERT INTO "Company" (id,"organizationId",name,"updatedAt") VALUES ('cmp_vp',$1,'Lincoln High',now())`, [org]);
  await sql(`INSERT INTO "Contact" (id,"organizationId","companyId",name,email,"updatedAt") VALUES ('ctc_vp',$1,'cmp_vp','Coach Reyes','coach@lincoln.example',now())`, [org]);
  await sql(`INSERT INTO "Deal" (id,"organizationId","contactId",title,stage,"updatedAt") VALUES ('deal_vp',$1,'ctc_vp','Team tees','QUOTE_SENT',now())`, [org]);
  await sql(
    `INSERT INTO "Quote" (id,"organizationId","contactId","dealId",number,title,status,"publicToken","updatedAt")
     VALUES ('quo_vp',$1,'ctc_vp','deal_vp',1000,'Team tees','DRAFT','tok_quo_vp_0123456789',now()),
            ('quo_vp2',$1,'ctc_vp','deal_vp',1001,'Spare tees','DRAFT','tok_quo_vp2_012345678',now())`,
    [org],
  );
  const linesOf = async (quoteId) =>
    (
      await sql(
        `SELECT id, variations, "variationText", "customUnitId", "unitLabel", "imageId", "unitOfMeasure", quantity
           FROM "QuoteLineItem" WHERE "quoteId"=$1 ORDER BY position`,
        [quoteId],
      )
    ).rows;
  const labelSelect = (line, groupName) => page.locator(`select[aria-label="Line ${line} ${groupName}"]`);
  async function saveLines() {
    await page.getByTestId("quote-save").click();
    await page.getByText("Line items saved").waitFor();
  }

  log("a quote line picks a Color and a Size, keeps the Box of 12 unit, and its picture follows the Color");
  await page.goto(`${BASE}/dashboard/quotes/quo_vp`);
  const catalog = page.getByLabel("Add product from catalog");
  await catalog.fill("Classic");
  await page.getByTestId("catalog-results").getByRole("option").first().waitFor();
  assert.match(await page.getByTestId("catalog-results").innerText(), /Box of 12/);
  await catalog.press("Enter");
  await labelSelect(1, "Color").waitFor();
  assert.equal(await page.locator("select[aria-label='Line 1 unit']").inputValue(), `cu:${tee.customUnitId}`);
  assert.match(await page.locator("[data-testid=line-picture]").first().getAttribute("src"), new RegExp(mainPic.publicToken));
  await labelSelect(1, "Color").selectOption(navyOpt);
  await labelSelect(1, "Size").selectOption(sizeL);
  assert.match(await page.locator("[data-testid=line-picture]").first().getAttribute("src"), new RegExp(navyPicture.publicToken));
  await catalog.fill("Classic");
  await page.getByTestId("catalog-results").getByRole("option").first().waitFor();
  await catalog.press("Enter");
  await labelSelect(2, "Color").waitFor();
  await labelSelect(2, "Color").selectOption(blackId);
  await labelSelect(2, "Size").selectOption(sizeXL);
  await page.getByLabel("Line 2 quantity").fill("2");
  await saveLines();
  let lines = await linesOf("quo_vp");
  assert.deepEqual(lines.map((line) => line.variationText), ["Navy · L", "Black · XL"]);
  assert.deepEqual(lines[0].variations.map((entry) => `${entry.group}:${entry.label}`), ["Color:Navy", "Size:L"]);
  assert.deepEqual(lines.map((line) => [line.customUnitId, line.unitLabel, line.unitOfMeasure]), [
    [tee.customUnitId, "Box of 12", null],
    [tee.customUnitId, "Box of 12", null],
  ]);
  assert.deepEqual(lines.map((line) => line.imageId), [null, null], "a draft shows the product's pictures live");
  await shot(page, "03-quote-lines");

  log("the customer's copy prints the labels, the unit and the small picture");
  await page.goto(`${BASE}/q/tok_quo_vp_0123456789`);
  assert.deepEqual(await page.locator("[data-testid=document-line-labels]").allInnerTexts(), ["Navy · L", "Black · XL"]);
  assert.deepEqual(await page.locator("[data-testid=document-line-unit]").allInnerTexts(), ["Box of 12", "Box of 12"]);
  const docPics = await page.locator("[data-testid=document-line-picture]").evaluateAll((els) => els.map((el) => el.getAttribute("src")));
  assert.deepEqual(docPics, [`/files/${navyPicture.publicToken}?v=doc`, `/files/${mainPic.publicToken}?v=doc`]);
  assert.ok(await page.locator("[data-testid=document-line-picture]").first().evaluate((img) => img.complete && img.naturalWidth > 0));
  await shot(page, "04-customer-copy");

  log("Mark as sent: each line keeps the picture it went out with");
  await page.goto(`${BASE}/dashboard/quotes/quo_vp`);
  // Send quote (was Mark as sent) opens a share sheet; Just mark it sent marks it.
  await page.getByTestId("send-quote").click();
  await page.getByTestId("send-quote-mark").click();
  for (let i = 0; i < 40 && (await linesOf("quo_vp"))[0].imageId === null; i += 1) await page.waitForTimeout(150);
  lines = await linesOf("quo_vp");
  assert.deepEqual(lines.map((line) => line.imageId), [navyPicture.id, mainPic.id]);

  log("a rename on Labels & Units and editing another line never rewrite what the sent quote says");
  await sql(`UPDATE "VariationOption" SET name='Midnight' WHERE id=$1`, [navyOpt]);
  await sql(`UPDATE "VariationOption" SET name='Case of 12' WHERE id=$1`, [tee.customUnitId]);
  await page.goto(`${BASE}/dashboard/quotes/quo_vp`);
  await page.getByLabel("Line 2 quantity").fill("3");
  await saveLines();
  lines = await linesOf("quo_vp");
  assert.equal(lines[0].variationText, "Navy · L");
  assert.equal(lines[0].unitLabel, "Box of 12");
  assert.equal(lines[1].quantity, 3);
  await page.goto(`${BASE}/q/tok_quo_vp_0123456789`);
  assert.deepEqual(await page.locator("[data-testid=document-line-labels]").allInnerTexts(), ["Navy · L", "Black · XL"]);
  await sql(`UPDATE "VariationOption" SET name='Navy' WHERE id=$1`, [navyOpt]);
  await sql(`UPDATE "VariationOption" SET name='Box of 12' WHERE id=$1`, [tee.customUnitId]);

  log("a label taken off the product stays on the line that has it, offered back");
  await sql(`DELETE FROM "ProductVariation" WHERE "productId"=$1 AND "optionId"=$2`, [tee.id, sizeXL]);
  await page.goto(`${BASE}/dashboard/quotes/quo_vp`);
  assert.equal(await labelSelect(2, "Size").inputValue(), sizeXL);
  assert.match(await labelSelect(2, "Size").locator("option:checked").innerText(), /XL \(no longer offered\)/);
  await page.getByLabel("Line 1 quantity").fill("4");
  await saveLines();
  assert.equal((await linesOf("quo_vp"))[1].variationText, "Black · XL");
  await sql(`INSERT INTO "ProductVariation" ("productId","optionId","organizationId") VALUES ($1,$2,$3)`, [tee.id, sizeXL, org]);

  log("a picture removed from the product: the sent quote keeps it, a draft lets it go");
  await sql(
    `INSERT INTO "QuoteLineItem" (id,"quoteId","productId",name,quantity,"unitPriceCents",tag,position,variations,"variationText")
     VALUES ('qli_vp_draft','quo_vp2',$1,'Classic Tee',1,1500,'MATERIALS',0,$2::jsonb,'Navy')`,
    [tee.id, JSON.stringify([{ groupId: "g", group: "Color", optionId: navyOpt, label: "Navy" }])],
  );
  await page.goto(`${BASE}/q/tok_quo_vp2_012345678`);
  assert.match(await page.locator("[data-testid=document-line-picture]").getAttribute("src"), new RegExp(navyPicture.publicToken));
  await page.goto(`${BASE}/dashboard/products/${tee.id}`);
  await page.locator("[data-testid=picture-remove]").nth(1).click();
  await page.waitForFunction(() => document.querySelectorAll("[data-testid=picture-tile]").length === 5);
  const kept = (await sql(`SELECT position, "removedAt" FROM "ProductImage" WHERE id=$1`, [navyPicture.id])).rows[0];
  assert.equal(kept.position, null);
  assert.ok(kept.removedAt, "kept for the sent quote");
  assert.ok(fs.existsSync(path.join(STORE, navyPicture.docKey)));
  await page.goto(`${BASE}/q/tok_quo_vp2_012345678`);
  assert.match(await page.locator("[data-testid=document-line-picture]").getAttribute("src"), new RegExp(mainPic.publicToken), "the draft falls back to the main picture");
  await page.goto(`${BASE}/q/tok_quo_vp_0123456789`);
  assert.match(await page.locator("[data-testid=document-line-picture]").first().getAttribute("src"), new RegExp(navyPicture.publicToken));

  log("changing a sent line's Color takes that Color's picture; an enum unit set by older code wins");
  await page.goto(`${BASE}/dashboard/quotes/quo_vp`);
  await labelSelect(1, "Color").selectOption(blackId);
  await saveLines();
  lines = await linesOf("quo_vp");
  assert.equal(lines[0].variationText, "Black · L");
  assert.equal(lines[0].imageId, mainPic.id);
  await sql(`UPDATE "QuoteLineItem" SET "unitOfMeasure"='EACH' WHERE id=$1`, [lines[1].id]);
  await page.goto(`${BASE}/q/tok_quo_vp_0123456789`);
  assert.deepEqual(await page.locator("[data-testid=document-line-unit]").allInnerTexts(), ["Box of 12"], "line 2 reads Each, printed as before (nothing)");
  await page.goto(`${BASE}/dashboard/quotes/quo_vp`);
  assert.equal(await page.locator("select[aria-label='Line 2 unit']").inputValue(), "EACH");
  await page.getByLabel("Line 2 quantity").fill("5");
  await saveLines();
  lines = await linesOf("quo_vp");
  assert.deepEqual([lines[1].unitOfMeasure, lines[1].customUnitId, lines[1].unitLabel], ["EACH", null, null]);

  log("a draft's PDF is made with its pictures, signed in as its owner");
  const pdf = await page.request.get(`${BASE}/q/tok_quo_vp2_012345678/pdf`);
  assert.equal(pdf.status(), 200);
  assert.equal(pdf.headers()["content-type"], "application/pdf");
  const pdfBytes = await pdf.body();
  assert.ok(pdfBytes.length > 2000 && pdfBytes.length < 4 * 1024 * 1024, `PDF size ${pdfBytes.length}`);
  assert.match(pdfBytes.toString("latin1"), /\/Subtype\s*\/Image/, "the picture is in the PDF");

  /* ------------------------ Contracts and purchase orders ------------------------ */

  log("the Contract Coordinator copies the labels onto the contract, which prints them");
  // A third line with no labels and a built-in unit.
  await sql(
    `INSERT INTO "QuoteLineItem" (id,"quoteId","productId",name,quantity,"unitPriceCents",tag,position,"unitOfMeasure")
     VALUES ('qli_vp_plain','quo_vp',$1,'Classic Tee',1,1500,'MATERIALS',2,'EACH')`,
    [tee.id],
  );
  await page.goto(`${BASE}/dashboard/deals/tracker?dealId=deal_vp`);
  await page.locator("[data-testid=tracker-row]").first().waitFor();
  assert.deepEqual(await page.locator("[data-testid=tracker-row-labels]").allInnerTexts(), ["Black · L", "Black · XL"]);
  const boxes = page.getByRole("checkbox", { name: "Put Classic Tee on Contract A" });
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await boxes.nth(2).check();
  await page.locator("[data-testid=create-contracts]").click();
  // Release B's price check before Create: say what it found, then go ahead.
  {
    await page.getByTestId("price-check").waitFor();
    const found = await page.getByTestId("price-check-item").evaluateAll((items) => items.map((item) => item.dataset.code));
    assert.deepEqual(found, ["UNIT", "UNIT"], "two lines carry the Each an older build wrote, over the product's Box of 12");
    await page.getByTestId("price-check-create-anyway").click();
  }
  await page.waitForURL(/created=\d+/);
  const sale = (await sql(`SELECT id, "publicToken" FROM "Contract" WHERE "organizationId"=$1 AND payable=false`, [org])).rows[0];
  const saleRows = (
    await sql(`SELECT "variationText", "unitLabel", variations::text AS v FROM "ContractLineItem" WHERE "contractId"=$1 ORDER BY position`, [sale.id])
  ).rows;
  assert.deepEqual(saleRows.map((row) => [row.variationText, row.unitLabel]), [
    ["Black · L", "Box of 12"],
    ["Black · XL", null],
    [null, null],
  ]);
  assert.equal(saleRows[2].v, "[]", "a row made from 3b on with no labels says so, unlike a row from before it");
  await page.goto(`${BASE}/dashboard/contracts/${sale.id}`);
  await page.getByRole("button", { name: /Mark as sent|Send for signature/ }).first().click();
  await page.getByText(/Sent/).first().waitFor();
  const signer = await browser.newContext();
  const signPage = await signer.newPage();
  await signPage.goto(`${BASE}/c/${sale.publicToken}`);
  assert.deepEqual(await signPage.locator("[data-testid=document-line-labels]").allInnerTexts(), ["Black · L", "Black · XL"]);
  assert.deepEqual(await signPage.locator("[data-testid=document-line-unit]").allInnerTexts(), ["Box of 12"]);
  await signPage.fill("[name=signerName]", "Coach Reyes");
  await signPage.check("[name=agree]");
  await signPage.click("button[type=submit]");
  await signPage.getByText("Accepted electronically").waitFor();
  await signer.close();

  log("Order materials: the supplier's purchase order carries the labels, and its body totals at cost (audit fix: a row signed with no labels gets none from a later quote edit)");
  await page.goto(`${BASE}/dashboard/quotes/quo_vp`);
  await labelSelect(3, "Color").selectOption(navyOpt);
  await saveLines();
  assert.equal((await linesOf("quo_vp"))[2].variationText, "Navy", "the quote line changed after signing");
  const project = (await sql(`SELECT id FROM "Project" WHERE "organizationId"=$1`, [org])).rows[0];
  await page.goto(`${BASE}/dashboard/projects/${project.id}/money`);
  await page.locator("[data-testid=order-materials]").click();
  await page.locator("[data-testid=order-from-supplier]").first().click();
  await page.waitForURL(/\/dashboard\/contracts\/[a-z0-9]+$/, { timeout: 20000 });
  const po = (await sql(`SELECT id, body FROM "Contract" WHERE "organizationId"=$1 AND payable=true`, [org])).rows[0];
  const poRows = (await sql(`SELECT "variationText", "unitLabel", quantity, "unitPriceCents" FROM "ContractLineItem" WHERE "contractId"=$1 ORDER BY position`, [po.id])).rows;
  assert.deepEqual(poRows.map((row) => [row.variationText, row.unitLabel, row.unitPriceCents]), [
    ["Black · L", "Box of 12", 400],
    ["Black · XL", null, 400],
    [null, null, 400],
  ]);
  const costTotal = poRows.reduce((sum, row) => sum + Math.round(row.quantity * row.unitPriceCents), 0);
  assert.match(po.body, new RegExp(`ORDER TOTAL: \\$${(costTotal / 100).toFixed(2).replace(".", "\\.")}`), "the PO body is at cost, not the customer's total");
  assert.match(await page.locator("body").innerText(), /Black · XL/);

  /* ------------------------------ Labels & Units ------------------------------ */

  log("Labels & Units: anyone adds; a Member sees no rename, retire or reorder");
  await sql(
    `INSERT INTO "User" (id,name,email,"passwordHash",role,"organizationId")
       SELECT 'usr_vp_member','Mo Member',$1,"passwordHash",'MEMBER',"organizationId" FROM "User" WHERE email=$2`,
    [MEMBER_EMAIL, EMAIL],
  );
  const memberContext = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const member = await memberContext.newPage();
  member.on("pageerror", (err) => pageErrors.push(err.message));
  await login(member, MEMBER_EMAIL);
  await member.goto(`${BASE}/dashboard/products/labels`);
  await member.locator("[data-testid=labels-member-note]").waitFor();
  assert.equal(await member.locator("[data-testid=labels-rename], [data-testid=labels-retire]").count(), 0);
  const colorCard = member.locator("[data-testid=labels-group][data-group=Color]");
  await colorCard.locator("[data-testid=labels-add]").click();
  await colorCard.locator("[data-testid=labels-box] input").fill("Heather");
  await colorCard.locator("[data-testid=labels-box-save]").click();
  await colorCard.locator("[data-testid=labels-option][data-name=Heather]").waitFor();
  await memberContext.close();

  log("an Owner renames, retires and brings back a label, adds a unit and a group");
  await page.goto(`${BASE}/dashboard/products/labels`);
  const color = page.locator("[data-testid=labels-group][data-group=Color]");
  await color.locator("[data-testid=labels-option][data-name=Heather] [data-testid=labels-rename]").click();
  await color.locator("[data-testid=labels-box] input").fill("Heather Grey");
  await color.locator("[data-testid=labels-box-save]").click();
  await color.locator("[data-testid=labels-option][data-name='Heather Grey']").waitFor();
  await color.locator("[data-testid=labels-option][data-name=Navy] [data-testid=labels-retire]").click();
  await color.locator("[data-testid=labels-retired] [data-testid=labels-option][data-name=Navy]").waitFor();
  assert.match(await color.locator("[data-testid=labels-option][data-name=Navy]").innerText(), /on 1 product/);
  await color.locator("[data-testid=labels-retired] [data-testid=labels-restore]").click();
  await page.waitForFunction(() => !document.querySelector("[data-testid=labels-group][data-group=Color] [data-testid=labels-retired]"));
  const units = page.locator("[data-testid=labels-group][data-group=Unit]");
  await units.locator("[data-testid=labels-add-unit]").click();
  await units.locator("[aria-label='New unit name']").fill("Case of 6");
  await units.locator("[aria-label='How many it contains']").fill("6");
  await units.locator("[aria-label='Of which unit']").selectOption("EACH");
  await units.locator("[data-testid=labels-unit-save]").click();
  await units.locator("[data-testid=labels-option][data-name='Case of 6']").waitFor();
  assert.match(await units.locator("[data-testid=labels-option][data-name='Case of 6']").innerText(), /contains 6 Each/);
  await units.locator("[data-testid=labels-add-unit]").click();
  await units.locator("[aria-label='New unit name']").fill("each");
  await units.locator("[aria-label='How many it contains']").fill("1");
  await units.locator("[aria-label='Of which unit']").selectOption("EACH");
  await units.locator("[data-testid=labels-unit-save]").click();
  await page.getByText("each is one of the built-in units").waitFor();
  await page.locator("[data-testid=labels-add-group]").click();
  await page.locator("[data-testid=labels-box] input").fill("Print location");
  await page.locator("[data-testid=labels-box-save]").click();
  await page.locator("[data-testid=labels-group][data-group='Print location']").waitFor();
  await shot(page, "05-labels");
  await page.goto(`${BASE}/dashboard/products/${tee.id}`);
  await group("Print location").waitFor();

  /* ------------------------------- Audit fixes ------------------------------- */

  log("audit fixes: Mark accepted keeps a sent quote's pictures; Mark as sent shows in the editor; Back to draft lets go");
  pics = await picturesOf(tee.id);
  const heldMain = pics[0];
  assert.equal((await linesOf("quo_vp"))[0].imageId, heldMain.id, "the sent line holds the main picture");
  await page.goto(`${BASE}/dashboard/products/${tee.id}`);
  const tilesBefore = await page.locator("[data-testid=picture-tile]").count();
  await page.locator("[data-testid=picture-remove]").first().click();
  await page.waitForFunction((n) => document.querySelectorAll("[data-testid=picture-tile]").length === n - 1, tilesBefore);
  const newMain = (await picturesOf(tee.id))[0];
  await page.goto(`${BASE}/dashboard/quotes/quo_vp`);
  await page.getByRole("button", { name: "Mark accepted" }).click();
  for (let i = 0; i < 40 && (await sql(`SELECT status FROM "Quote" WHERE id='quo_vp'`)).rows[0].status !== "ACCEPTED"; i += 1) {
    await page.waitForTimeout(150);
  }
  assert.equal((await linesOf("quo_vp"))[0].imageId, heldMain.id, "an answer never swaps the picture it went out with");
  await page.goto(`${BASE}/q/tok_quo_vp_0123456789`);
  assert.match(await page.locator("[data-testid=document-line-picture]").first().getAttribute("src"), new RegExp(heldMain.publicToken));
  await page.goto(`${BASE}/dashboard/quotes/quo_vp2`);
  await page.locator("[data-testid=line-picture]").first().waitFor();
  // Send quote (was Mark as sent) opens a share sheet; Just mark it sent marks it.
  await page.getByTestId("send-quote").click();
  await page.getByTestId("send-quote-mark").click();
  for (let i = 0; i < 40 && (await linesOf("quo_vp2"))[0].imageId === null; i += 1) await page.waitForTimeout(150);
  assert.equal((await linesOf("quo_vp2"))[0].imageId, newMain.id);
  await page.waitForFunction(
    (token) => document.querySelector("[data-testid=line-picture]")?.getAttribute("src")?.includes(token),
    newMain.publicToken,
  );
  await page.getByRole("button", { name: "Back to draft" }).click();
  for (let i = 0; i < 40 && (await linesOf("quo_vp2"))[0].imageId !== null; i += 1) await page.waitForTimeout(150);
  assert.equal((await linesOf("quo_vp2"))[0].imageId, null, "a draft shows the product's picture live again");

  log("audit fixes: the Variations card keeps another tab's labels, and a tag changed back keeps the units");
  const heather = await optionId("Color", "Heather Grey");
  await page.goto(`${BASE}/dashboard/products/${tee.id}`);
  await chip("Size", "XL").click();
  await sql(`INSERT INTO "ProductVariation" ("productId","optionId","organizationId") VALUES ($1,$2,$3)`, [tee.id, heather, org]);
  // A picture change refreshes the page, bringing in what the other tab did.
  await page.locator("[data-testid=picture-color]").first().selectOption(navyOpt);
  for (let i = 0; i < 50 && (await chip("Color", "Heather Grey").getAttribute("aria-pressed")) !== "true"; i += 1) {
    await page.waitForTimeout(100);
  }
  assert.equal(await chip("Color", "Heather Grey").getAttribute("aria-pressed"), "true", "the refresh brought it in");
  assert.equal(await chip("Size", "XL").getAttribute("aria-pressed"), "false");
  await saveProduct();
  let teeLabels = await labelsOf(tee.id);
  assert.ok(teeLabels.includes("Color:Heather Grey"), "the other tab's label stays");
  assert.ok(!teeLabels.includes("Size:XL"), "the one unticked here comes off");
  await page.goto(`${BASE}/dashboard/products/${hoodieId}`);
  if ((await chip("Unit", "Each").getAttribute("aria-pressed")) !== "true") await chip("Unit", "Each").click();
  await saveProduct();
  assert.ok((await labelsOf(hoodieId)).includes("Unit:Each"));
  await page.selectOption("#defaultTag", "LABOR");
  assert.match(await page.locator("[data-testid=unit-note]").innerText(), /Each will be taken off when you save/);
  await page.selectOption("#defaultTag", "MATERIALS");
  assert.equal(await page.locator("[data-testid=unit-note]").count(), 0);
  await saveProduct();
  assert.ok((await labelsOf(hoodieId)).includes("Unit:Each"), "back on Materials, Each stays");

  log("audit fixes: twelve labels on one line save; a typed line linked by name takes the picture; counts are per product");
  await sql(
    `INSERT INTO "VariationGroup" (id,"organizationId",kind,name,position,"updatedAt")
     SELECT 'vg_vp_' || g, $1, 'CUSTOM', 'Extra ' || g, 20 + g, now() FROM generate_series(1, 10) g`,
    [org],
  );
  await sql(
    `INSERT INTO "VariationOption" (id,"organizationId","groupId",name,position,"updatedAt")
     SELECT 'vo_vp_' || g, $1, 'vg_vp_' || g, 'Option ' || g, 0, now() FROM generate_series(1, 10) g`,
    [org],
  );
  await sql(
    `INSERT INTO "ProductVariation" ("productId","optionId","organizationId") SELECT $1, 'vo_vp_' || g, $2 FROM generate_series(1, 10) g`,
    [tee.id, org],
  );
  await page.goto(`${BASE}/dashboard/quotes/quo_vp2`);
  await catalog.fill("Classic");
  await page.getByTestId("catalog-results").getByRole("option").first().waitFor();
  await catalog.press("Enter");
  const lineNo = (await linesOf("quo_vp2")).length + 1;
  await labelSelect(lineNo, "Color").waitFor();
  await labelSelect(lineNo, "Color").selectOption(blackId);
  await labelSelect(lineNo, "Size").selectOption(sizeL);
  for (let g = 1; g <= 10; g += 1) await labelSelect(lineNo, `Extra ${g}`).selectOption(`vo_vp_${g}`);
  await saveLines();
  const twelve = (await linesOf("quo_vp2"))[lineNo - 1];
  assert.equal(twelve.variationText.split(" · ").length, 12);
  await page.goto(`${BASE}/dashboard/quotes/quo_vp`);
  await page.getByRole("button", { name: "Blank line" }).click();
  const typedNo = (await linesOf("quo_vp")).length + 1;
  await page.getByLabel(`Line ${typedNo} product`, { exact: true }).fill("Classic Tee");
  await saveLines();
  const typed = (await linesOf("quo_vp"))[typedNo - 1];
  const linked = (await sql(`SELECT "productId" FROM "QuoteLineItem" WHERE id=$1`, [typed.id])).rows[0].productId;
  assert.equal(linked, tee.id, "linked to the catalog's Classic Tee by name");
  assert.equal(typed.imageId, (await picturesOf(tee.id))[0].id, "and on a sent quote it takes the product's picture");
  await sql(`UPDATE "VariationGroup" SET "archivedAt"=now() WHERE id LIKE 'vg_vp_%'`);
  await sql(
    `INSERT INTO "Product" (id,"organizationId",name,"unitPriceCents","defaultTag",active,"updatedAt")
     VALUES ('prd_vp_polo',$1,'Polo',2000,'MATERIALS',true,now())`,
    [org],
  );
  await sql(`INSERT INTO "ProductVariation" ("productId","optionId","organizationId") VALUES ('prd_vp_polo',$1,$2)`, [tee.customUnitId, org]);
  await page.goto(`${BASE}/dashboard/products/labels`);
  const boxRow = page.locator("[data-testid=labels-group][data-group=Unit] [data-testid=labels-option][data-name='Box of 12']");
  // Classic Tee by its unit and Polo by its tick (Hoodie's unit was cleared
  // when its tag went to Labor above): two products, where taking the larger
  // of the two counts said one.
  assert.equal((await productNamed("Hoodie")).customUnitId, null);
  assert.match(await boxRow.innerText(), /on 2 products/);

  console.log("\nPAGE ERRORS:", pageErrors.length);
  assert.equal(pageErrors.length, 0);
  await browser.close();
  console.log("ALL PASSED");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
