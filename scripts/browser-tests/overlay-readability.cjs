/* Browser regression for overlay readability.
 *
 * Covers: every panel that floats ON TOP of other content — the company
 * search dropdown on a contact, the deal picker on a new quote, the
 * multi-select filter menus on the Contacts list, and dialogs over the
 * page. All of them used the glass `.card` surface, which is ~4% white,
 * so the words underneath read straight through the panel and neither
 * layer could be made out (reported Sept 20, 2026 with a screenshot of
 * the company picker sitting on top of "Industry & company type").
 *
 * The test is not "does it look right". It photographs each panel, hides
 * everything on the page except that panel, photographs it again, and
 * requires the two to be identical to the pixel: if what is behind a
 * panel can be removed without changing the panel, nothing was showing
 * through it. A negative control puts the old glass background back and
 * asserts the same check FAILS — it reports 100% against 0% — so a change
 * that makes overlays see-through again cannot pass this file quietly.
 * It also asserts every overlay paints the one shared colour, because a
 * dialog had already been patched with a hex of its own.
 *
 * Also checks the form fields stayed legible: every input keeps the
 * stronger border, de-emphasised text clears 4.5:1 against the page, and
 * the select's chevron survives focus (the focus rule used the
 * `background` shorthand, which reset background-image and wiped the
 * arrow the moment you clicked the field).
 *
 * Runs against a built app (`bash scripts/dev-serve.sh`) and a
 * local Postgres that has had `prisma migrate deploy` run against it. It
 * signs up its own workspace, activates it with SQL, and deletes it again
 * on the next run, so it never touches real data. Never point it at the
 * live database.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/scb_test \
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules \
 *   node scripts/browser-tests/overlay-readability.cjs
 */
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS on purpose: NODE_PATH only resolves the global playwright for require() */
const os = require("node:os");
const { chromium } = require("playwright");
const { Client } = require("pg");
const sharp = require("sharp");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const BASE = process.env.BASE || "http://localhost:3000";
const DB = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5433/scb_test";
const OUT = process.env.SHOTS_DIR || path.join(os.tmpdir(), "scb-browser-shots-overlay");
fs.mkdirSync(OUT, { recursive: true });

const EMAIL = "test-overlay@example.com";
const PASSWORD = "password123";
const COMPANY = "Test Overlay Co";
const SLUG = "test-overlay-co";

// Companies seeded behind the dropdown, long enough that the panel is
// taller than one row and genuinely covers the fields underneath.
const SEEDED = ["Asset Living", "Burlington Capital", "SouthBay Hardware", "Spirit Communications, LLC"];

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
async function login(page) {
  await page.goto(`${BASE}/login`);
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/dashboard$/);
}

function pct(fraction) {
  return `${(fraction * 100).toFixed(1)}%`;
}

function parseRgb(value) {
  const nums = value.match(/[\d.]+/g);
  assert.ok(nums && nums.length >= 3, `could not read a colour out of ${value}`);
  return { r: +nums[0], g: +nums[1], b: +nums[2], a: nums.length > 3 ? +nums[3] : 1 };
}

// Every overlay's colour, gathered as they are checked. One shared
// surface is the point: a dialog had been patched with its own hex once,
// and that is how the app drifts back apart.
const surfaces = [];

// What a floating panel must be, whatever it is: a solid colour, no
// see-through gradient, and no blur standing in for one.
async function assertOpaqueSurface(locator, what) {
  const style = await locator.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      backgroundColor: s.backgroundColor,
      backgroundImage: s.backgroundImage,
      backdropFilter: s.backdropFilter || s.webkitBackdropFilter,
    };
  });
  const bg = parseRgb(style.backgroundColor);
  assert.equal(bg.a, 1, `${what}: background is see-through (${style.backgroundColor})`);
  assert.equal(style.backgroundImage, "none", `${what}: still has a translucent gradient (${style.backgroundImage})`);
  assert.ok(
    style.backdropFilter === "none" || !style.backdropFilter,
    `${what}: blurs what is behind instead of covering it (${style.backdropFilter})`,
  );
  surfaces.push({ what, colour: `${bg.r},${bg.g},${bg.b}` });
  return bg;
}

/* Proves a panel is opaque without guessing at thresholds.
 *
 * Photograph the panel. Then hide everything on the page except the panel
 * itself and photograph it again. `visibility: hidden` paints nothing and
 * reflows nothing, so the panel does not move by a pixel — the only thing
 * that changed is what sits behind it. A panel that covers what is behind
 * it comes back byte-for-byte identical. A see-through one does not,
 * because the words underneath were part of the first picture.
 *
 * The comparison is inset CORNER px on every side: the corners are
 * rounded, so the page legitimately shows through them, and the drop
 * shadow falls outside the box entirely. */
const CORNER = 20;

async function bleedThrough(page, locator, name) {
  const box = await locator.boundingBox();
  // A one-row dropdown is only ~46px tall, which still leaves a band to
  // compare once both corners are stepped over.
  assert.ok(
    box && box.width > CORNER * 2 + 4 && box.height > CORNER * 2 + 4,
    `${name}: panel is too small to sample past its corners (${JSON.stringify(box)})`,
  );
  const clip = {
    x: Math.round(box.x + CORNER),
    y: Math.round(box.y + CORNER),
    width: Math.round(box.width - CORNER * 2),
    height: Math.round(box.height - CORNER * 2),
  };

  // Blank the panel's own contents for both shots. This is about the
  // panel's back, not its rows, and leaving the text in compares glyph
  // edges: Chromium picks a different antialiasing mode once the page
  // behind is gone, which is a rendering detail and not a leak.
  await locator.evaluate((el) => {
    for (const child of el.children) child.style.visibility = "hidden";
  });
  const before = await page.screenshot({ clip });

  // Visibility inherits, and a descendant can turn it back on. So this
  // blanks the whole page and re-lights the panel alone — its rows stay
  // hidden, because they were told to be.
  await locator.evaluate((el) => {
    document.body.style.visibility = "hidden";
    el.style.visibility = "visible";
  });
  const after = await page.screenshot({ clip });
  await locator.evaluate((el) => {
    document.body.style.visibility = "";
    el.style.visibility = "";
    for (const child of el.children) child.style.visibility = "";
  });

  if (name) {
    fs.writeFileSync(path.join(OUT, `${name}-over-page.png`), before);
    fs.writeFileSync(path.join(OUT, `${name}-over-nothing.png`), after);
  }

  const a = await sharp(before).raw().toBuffer({ resolveWithObject: true });
  const b = await sharp(after).raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual(a.info.width, b.info.width, `${name}: the panel moved between shots`);
  assert.deepEqual(a.info.height, b.info.height, `${name}: the panel moved between shots`);

  const ch = a.info.channels;
  const total = a.info.width * a.info.height;
  let differing = 0;
  for (let i = 0; i < a.data.length; i += ch) {
    for (let c = 0; c < 3; c += 1) {
      if (Math.abs(a.data[i + c] - b.data[i + c]) > 1) {
        differing += 1;
        break;
      }
    }
  }
  return differing / total;
}

// Re-applies the pre-fix glass background to one panel so the pixel check
// can be shown to fail on the old styling. Returns a function that undoes it.
async function withOldGlass(page, selector, body) {
  await page.addStyleTag({
    content: `${selector} {
      background: linear-gradient(180deg, rgb(255 255 255 / 0.04), rgb(255 255 255 / 0.015)) !important;
      backdrop-filter: blur(14px) !important;
      box-shadow: none !important;
    }`,
  });
  try {
    return await body();
  } finally {
    await page.reload();
  }
}

(async () => {
  await sql(`DELETE FROM "Organization" WHERE slug LIKE '${SLUG}%'`);

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
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
  await sql(`UPDATE "Organization" SET status='ACTIVE', "reviewedAt"=now() WHERE slug LIKE '${SLUG}%'`);
  await login(page);
  // Every lookup below is scoped to this workspace so another suite's
  // leftovers cannot be mistaken for this one's rows.
  const org = (await sql(`SELECT id FROM "Organization" WHERE slug LIKE '${SLUG}%'`)).rows[0].id;

  log("seed the companies the dropdown will list");
  for (const name of SEEDED) {
    await page.goto(`${BASE}/dashboard/companies/new`);
    await page.fill("#name", name);
    await page.fill("#state", "TX");
    await page.getByRole("button", { name: /Save company/i }).click();
    await page.waitForURL(/\/dashboard\/companies\/(?!new$)[a-z0-9]+$/);
  }
  const seeded = await sql(`SELECT count(*)::int AS n FROM "Company" WHERE "organizationId" = $1`, [org]);
  assert.equal(seeded.rows[0].n, SEEDED.length, "four companies seeded in this workspace");

  log("company picker on a contact: the panel covers the fields under it");
  await page.goto(`${BASE}/dashboard/contacts/new`);
  // Fill the fields the panel will sit over, so there is something to
  // bleed through if it ever goes see-through again.
  await page.fill("#name", "Sam Rivera");
  await page.fill("#title", "Owner");
  await page.fill("#companyName", "a");
  const companyPanel = page.locator('ul[role="listbox"]');
  await companyPanel.waitFor();
  await assertOpaqueSurface(companyPanel, "company picker dropdown");
  const solid = await bleedThrough(page, companyPanel, "01-company-panel");
  assert.equal(solid, 0, `company picker is see-through: ${pct(solid)} of it changes with what is behind it`);
  await shot(page, "01b-company-picker-open");

  log("negative control: the old glass background fails the same check");
  await page.fill("#companyName", "a");
  await companyPanel.waitFor();
  const glass = await withOldGlass(page, 'ul[role="listbox"]', async () => {
    await page.waitForTimeout(150);
    return bleedThrough(page, companyPanel, "02-company-panel-OLD-GLASS");
  });
  assert.ok(
    glass > 0.5,
    `the check does not actually catch a see-through panel (old glass showed only ${pct(glass)} through)`,
  );
  console.log(`     fixed panel lets ${pct(solid)} through, the old glass ${pct(glass)}`);

  log("a contact per company, so the lists and pickers below have something in them");
  const contactIds = [];
  for (const [index, name] of SEEDED.entries()) {
    await page.goto(`${BASE}/dashboard/contacts/new`);
    await page.fill("#companyName", name);
    await page.locator('ul[role="listbox"] button', { hasText: name }).first().click();
    await page.fill("#name", `Sam Rivera ${index + 1}`);
    await page.fill("#state", ["TX", "SC", "CA", "NY"][index]);
    await page.getByRole("button", { name: /Save contact/i }).click();
    await page.waitForURL(/\/dashboard\/contacts\/(?!new$)[a-z0-9]+$/);
    contactIds.push(page.url().split("/").pop());
  }

  log("deal picker on a new quote is the same opaque panel");
  // Give the picker a deal to find: the first quote makes one.
  await page.goto(`${BASE}/dashboard/quotes/new?contactId=${contactIds[0]}`);
  await page.fill("#dealTitle", "Roof replacement");
  await page.fill("#title", "Roof — option A");
  await page.getByRole("button", { name: /Create quote/i }).click();
  await page.waitForURL(/\/dashboard\/quotes\/(?!new$)[a-z0-9]+$/);
  await page.goto(`${BASE}/dashboard/quotes/new?contactId=${contactIds[0]}`);
  await page.fill("#dealTitle", "Roof");
  const dealPanel = page.locator('ul[role="listbox"]').first();
  await dealPanel.waitFor();
  await assertOpaqueSurface(dealPanel, "deal picker dropdown");
  const dealBleed = await bleedThrough(page, dealPanel, "03-deal-picker");
  assert.equal(dealBleed, 0, `deal picker is see-through: ${pct(dealBleed)} shows through`);
  await shot(page, "03b-deal-picker-open");

  log("filter menus on the Contacts list, both the checklist and the search kind");
  await page.goto(`${BASE}/dashboard/contacts`);

  await page.locator('[data-testid="filter-state"]').click();
  const statePanel = page.locator(".popover").first();
  await statePanel.getByText("TX").first().waitFor();
  await assertOpaqueSurface(statePanel, "State filter menu");
  const stateBleed = await bleedThrough(page, statePanel, "04-state-filter");
  assert.equal(stateBleed, 0, `State filter menu is see-through: ${pct(stateBleed)} shows through`);
  await shot(page, "05-state-filter-open");
  await page.keyboard.press("Escape");

  // The one with a search box inside it — the shape that was reported.
  await page.locator('[data-testid="filter-company"]').click();
  const companyFilter = page.locator(".popover").first();
  await companyFilter.getByPlaceholder("Search companies…").fill("a");
  await companyFilter.getByText("Asset Living").waitFor();
  await assertOpaqueSurface(companyFilter, "Company filter menu");
  const filterBleed = await bleedThrough(page, companyFilter, "06-company-filter");
  assert.equal(filterBleed, 0, `Company filter menu is see-through: ${pct(filterBleed)} shows through`);
  await shot(page, "07-company-filter-open");
  await page.keyboard.press("Escape");

  log("a dialog over the page");
  await page.getByRole("button", { name: /Import CSV/i }).first().click();
  const dialog = page.locator('[role="dialog"]');
  await dialog.waitFor();
  await assertOpaqueSurface(dialog, "Import CSV dialog");
  const dialogBleed = await bleedThrough(page, dialog, "08-dialog");
  assert.equal(dialogBleed, 0, `Import CSV dialog is see-through: ${pct(dialogBleed)} shows through`);
  await shot(page, "09-dialog-open");
  await page.keyboard.press("Escape");

  log("fields kept a border you can find, and the select keeps its arrow on focus");
  await page.goto(`${BASE}/dashboard/contacts/new`);
  const field = page.locator("#name");
  const border = parseRgb(await field.evaluate((el) => getComputedStyle(el).borderTopColor));
  // The old 7.5%-white hairline read as no border at all on a dark card.
  assert.ok(
    border.a >= 0.14,
    `inputs lost their visible border (alpha ${border.a})`,
  );
  const select = page.locator("select.select").first();
  await select.focus();
  const arrow = await select.evaluate((el) => getComputedStyle(el).backgroundImage);
  assert.notEqual(arrow, "none", "the select's chevron vanishes while the field is focused");
  await shot(page, "10-contact-form-fields");

  log("placeholder text is readable, not a whisper");
  const placeholder = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--text-faint)";
    document.body.appendChild(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  });
  const faint = parseRgb(placeholder);
  // Relative luminance against the #07080b page: anything under about 4.5:1
  // is the dimness that was reported.
  const channel = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const lum = 0.2126 * channel(faint.r) + 0.7152 * channel(faint.g) + 0.0722 * channel(faint.b);
  const pageLum = 0.2126 * channel(7) + 0.7152 * channel(8) + 0.0722 * channel(11);
  const ratio = (lum + 0.05) / (pageLum + 0.05);
  assert.ok(ratio >= 4.5, `de-emphasised text is too dim to read (${ratio.toFixed(2)}:1, needs 4.5:1)`);
  console.log(`     faint text sits at ${ratio.toFixed(2)}:1 on the page background`);

  log("every overlay in the app paints the one shared surface");
  assert.ok(surfaces.length >= 5, `only ${surfaces.length} overlays were checked`);
  const distinct = [...new Set(surfaces.map((s) => s.colour))];
  assert.equal(
    distinct.length,
    1,
    `overlays have drifted onto different colours: ${surfaces.map((s) => `${s.what} ${s.colour}`).join("; ")}`,
  );
  console.log(`     ${surfaces.length} overlays, all rgb(${distinct[0]})`);

  await browser.close();
  console.log(`\nAll ${step} steps passed. Screenshots in ${OUT}`);
})().catch((err) => {
  console.error("\nFAILED:", err.message);
  process.exit(1);
});
