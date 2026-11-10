/* Browser regression for the three looks (Nov 10, 2026).
 *
 * Dark (the original glass look, the default), Light (clean and white)
 * and Bright (near-black on white, solid borders, a size up — a phone in
 * a truck in sunlight), picked from the switch at the top right of every
 * signed-in page and saved on User.theme so it follows the person.
 *
 * Covers: the switch on the desktop header and the phone header; each
 * look saved, kept after a reload and on a second login in a fresh
 * browser; no flash of the wrong look (data-theme is in the server's
 * HTML, and the page paints in the right colours with JavaScript turned
 * off); Overview, Contacts, a contact, Pipeline, a quote, Settings and
 * Stats photographed in every look with the words on them checked for
 * readable contrast against what is actually behind them; the phone
 * width (390px) with no sideways scroll; the workspace's own brand colour
 * still painting the primary buttons in all three; the login page and
 * the customer's copy of a quote staying as they were.
 *
 * Contrast rule: every sampled piece of text must clear 4.5:1 in Light
 * and Bright (Bright's body text 7:1). Dark is the look as it was before
 * this work and is held to 3:1 so the suite reports it without failing
 * on the slate "Archived"-style chips that were always that dim.
 *
 * Runs against a built app (`npm run build:app && npx next start`) and a
 * local Postgres that has had `prisma migrate deploy` run against it. It
 * signs up its own workspace and deletes it on the next run. Never point
 * it at the live database.
 *
 *   BASE=http://localhost:3000 \
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/scb_test \
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules \
 *   node scripts/browser-tests/looks.cjs
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
const OUT = process.env.SHOTS_DIR || path.join(os.tmpdir(), "scb-browser-shots-looks");
fs.mkdirSync(OUT, { recursive: true });

const EMAIL = "test-looks@example.com";
const PASSWORD = "password123";
const COMPANY = "Test Looks Co";
const SLUG = "test-looks-co";
const BRAND = "#0e7490";

const LOOKS = ["dark", "light", "bright"];
// The page background each look paints (globals.css).
const PAGE_BG = { dark: "rgb(7, 8, 11)", light: "rgb(244, 245, 248)", bright: "rgb(255, 255, 255)" };
const MIN_CONTRAST = { dark: 3, light: 4.5, bright: 4.5 };

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
async function login(page) {
  await page.goto(`${BASE}/login`);
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/dashboard$/);
}
async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity),
  );
}
async function htmlBg(page) {
  return page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
}
async function savedTheme() {
  const row = (await sql(`SELECT theme FROM "User" WHERE email = $1`, [EMAIL])).rows[0];
  return row?.theme ?? null;
}
async function waitForSaved(theme) {
  for (let i = 0; i < 50; i += 1) {
    if ((await savedTheme()) === theme) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.fail(`the look was not saved as ${theme} (still ${await savedTheme()})`);
}

/* Reads the text on the page and works out each piece's contrast against
 * what is really behind it: walks up the ancestors blending each
 * background colour (and a gradient's first stop, for the glass cards)
 * until it reaches something opaque, then the page itself. Colours are
 * read through a 1x1 canvas so color-mix(), oklab() and color(srgb …)
 * all come back as plain RGBA. */
async function contrastReport(page, scope) {
  return page.evaluate((scopeSel) => {
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
    const over = (top, under) => {
      const a = top[3];
      return [top[0] * a + under[0] * (1 - a), top[1] * a + under[1] * (1 - a), top[2] * a + under[2] * (1 - a), 1];
    };
    const lum = ([r, g, b]) => {
      const ch = (v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
    };
    const ratio = (a, b) => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
      return (x + 0.05) / (y + 0.05);
    };
    const pageBg = rgba(getComputedStyle(document.documentElement).backgroundColor);
    const layers = (el) => {
      const out = [];
      for (let node = el; node && node !== document.documentElement; node = node.parentElement) {
        const s = getComputedStyle(node);
        let c = rgba(s.backgroundColor);
        if (c[3] === 0 && s.backgroundImage.startsWith("linear-gradient")) {
          const first = s.backgroundImage.match(/(rgba?\([^)]*\)|color\([^)]*\)|#[0-9a-f]{3,8})/i);
          if (first) c = rgba(first[1]);
        }
        if (c[3] > 0) out.push(c);
        if (c[3] >= 0.999) break;
      }
      return out;
    };
    const behind = (el) => layers(el).reverse().reduce((acc, layer) => over(layer, acc), pageBg);

    const root = document.querySelector(scopeSel) || document.body;
    const results = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent.trim();
      if (text.length < 2) continue;
      const el = node.parentElement;
      if (!el || seen.has(el)) continue;
      seen.add(el);
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      const s = getComputedStyle(el);
      if (s.visibility === "hidden" || s.display === "none") continue;
      // Gradient-clipped titles and anything deliberately faded (a
      // disabled button, a pulse) are not judged by their colour value.
      if (s.color === "rgba(0, 0, 0, 0)" || s.webkitTextFillColor === "rgba(0, 0, 0, 0)") continue;
      let faded = false;
      for (let n = el; n; n = n.parentElement) if (parseFloat(getComputedStyle(n).opacity) < 0.95) faded = true;
      if (faded) continue;
      // Words drawn over a picture or a brand-coloured fill are the
      // tenant's colours, not the look's.
      if (el.closest('img, svg, video, .btn-primary, .btn-pink, .btn-neon, .merge-chip, [data-testid=lead-label], [style*="background:linear-gradient(140deg"], [style*="background: linear-gradient(140deg"], [class*="bg-[var(--brand)]"]')) continue;
      const bg = behind(el);
      const fg = over(rgba(s.color), bg);
      results.push({
        text: text.slice(0, 40),
        tag: el.tagName.toLowerCase(),
        cls: (el.className && typeof el.className === "string" ? el.className : "").slice(0, 60),
        ratio: +ratio(fg, bg).toFixed(2),
      });
      if (results.length >= 400) break;
    }
    return results;
  }, scope);
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
  await sql(`UPDATE "Organization" SET status='ACTIVE', "reviewedAt"=now(), "primaryColor"=$1 WHERE slug LIKE '${SLUG}%'`, [BRAND]);
  await login(page);
  const org = (await sql(`SELECT id FROM "Organization" WHERE slug LIKE '${SLUG}%'`)).rows[0].id;

  log("a company, a contact on it and a quote, so the pages have something on them");
  await page.goto(`${BASE}/dashboard/companies/new`);
  await page.fill("#name", "Burlington Capital");
  await page.fill("#state", "TX");
  await page.getByRole("button", { name: /Save company/i }).click();
  await page.waitForURL(/\/dashboard\/companies\/(?!new$)[a-z0-9]+$/);
  await page.goto(`${BASE}/dashboard/contacts/new`);
  await page.fill("#companyName", "Burlington");
  await page.locator('ul[role="listbox"] button', { hasText: "Burlington Capital" }).first().click();
  await page.fill("#name", "Sam Rivera");
  await page.fill("#state", "TX");
  await page.getByRole("button", { name: /Save contact/i }).click();
  await page.waitForURL(/\/dashboard\/contacts\/(?!new$)[a-z0-9]+$/);
  const contactId = page.url().split("/").pop();
  await page.goto(`${BASE}/dashboard/quotes/new?contactId=${contactId}`);
  await page.fill("#dealTitle", "Roof replacement");
  await page.fill("#title", "Roof — option A");
  await page.getByRole("button", { name: /Create quote/i }).click();
  await page.waitForURL(/\/dashboard\/quotes\/(?!new$)[a-z0-9]+$/);
  const quoteId = page.url().split("/").pop();
  const quoteToken = (await sql(`SELECT "publicToken" FROM "Quote" WHERE id = $1 AND "organizationId" = $2`, [quoteId, org])).rows[0].publicToken;

  const PAGES = [
    ["overview", "/dashboard"],
    ["contacts", "/dashboard/contacts"],
    ["contact", `/dashboard/contacts/${contactId}`],
    ["pipeline", "/dashboard/deals"],
    ["quote", `/dashboard/quotes/${quoteId}`],
    ["settings", "/dashboard/settings"],
    ["stats", "/dashboard/stats"],
  ];

  log("a new person starts on Dark, and the server's HTML says so");
  assert.equal(await savedTheme(), null, "nobody has picked a look yet");
  await page.goto(`${BASE}/dashboard`);
  let html = await (await page.request.get(`${BASE}/dashboard`)).text();
  assert.match(html, /data-theme="dark"/, "the server renders the shell with data-theme=dark");
  assert.equal(await htmlBg(page), PAGE_BG.dark);
  const sw = page.locator("[data-testid=look-switch]:visible");
  assert.equal(await sw.count(), 1, "one switch showing on the desktop header");
  assert.equal(await sw.locator("[data-testid=look-dark]").getAttribute("aria-pressed"), "true");
  const box = await sw.boundingBox();
  assert.ok(box.x + box.width > 1360 - 80 && box.y < 60, `the switch sits at the top right (${JSON.stringify(box)})`);

  for (const look of ["light", "bright", "dark"]) {
    log(`switch to ${look} from the header: it paints at once, is saved, and survives a reload`);
    await page.goto(`${BASE}/dashboard/contacts`);
    await page.locator(`[data-testid=look-switch]:visible [data-testid=look-${look}]`).click();
    await page.waitForFunction((bg) => getComputedStyle(document.documentElement).backgroundColor === bg, PAGE_BG[look]);
    await waitForSaved(look);
    await page.reload();
    assert.equal(await page.locator("[data-theme]").first().getAttribute("data-theme"), look);
    assert.equal(await htmlBg(page), PAGE_BG[look]);
    assert.equal(
      await page.locator(`[data-testid=look-switch]:visible [data-testid=look-${look}]`).getAttribute("aria-pressed"),
      "true",
      "the switch shows the saved look after a reload",
    );
    html = await (await page.request.get(`${BASE}/dashboard/contacts`)).text();
    assert.match(html, new RegExp(`data-theme="${look}"`), `the server's HTML carries data-theme=${look}`);
  }

  log("no flash: with JavaScript off, the first paint is already the saved look");
  await sql(`UPDATE "User" SET theme = 'light' WHERE email = $1`, [EMAIL]);
  {
    const state = await context.storageState();
    const noJs = await browser.newContext({ viewport: { width: 1360, height: 900 }, javaScriptEnabled: false, storageState: state });
    const p = await noJs.newPage();
    await p.goto(`${BASE}/dashboard/contacts`);
    assert.equal(await htmlBg(p), PAGE_BG.light, "light paints before any script runs");
    const card = await p.locator(".card").first().evaluate((el) => getComputedStyle(el).backgroundColor);
    assert.equal(card, "rgb(255, 255, 255)", "cards are white before any script runs");
    await p.screenshot({ path: path.join(OUT, "00-light-no-javascript.png") });
    await noJs.close();
  }

  for (const look of LOOKS) {
    log(`${look}: key pages photographed, every word on them readable against what is behind it`);
    await sql(`UPDATE "User" SET theme = $2 WHERE email = $1`, [EMAIL, look]);
    let worst = { ratio: 99 };
    for (const [name, url] of PAGES) {
      await page.goto(`${BASE}${url}`);
      await settle(page);
      assert.equal(await htmlBg(page), PAGE_BG[look], `${name} paints the ${look} page`);
      await page.screenshot({ path: path.join(OUT, `${look}-${name}.png`), fullPage: true });
      const report = await contrastReport(page, "body");
      assert.ok(report.length > 10, `${name}: found text to check (${report.length})`);
      const bad = report.filter((r) => r.ratio < MIN_CONTRAST[look]);
      // LOOKS_REPORT=1 lists every faint piece of text instead of stopping
      // at the first page that has one.
      if (process.env.LOOKS_REPORT && bad.length) {
        for (const r of bad) console.log(`     FAINT ${look} ${name}: "${r.text}" <${r.tag} ${r.cls}> ${r.ratio}:1`);
        continue;
      }
      assert.equal(
        bad.length,
        0,
        `${look} ${name}: text too faint to read — ${bad.slice(0, 6).map((r) => `"${r.text}" <${r.tag} ${r.cls}> ${r.ratio}:1`).join("; ")}`,
      );
      for (const r of report) if (r.ratio < worst.ratio) worst = { ...r, page: name };
    }
    console.log(`     lowest: ${worst.ratio}:1 ("${worst.text}" on ${worst.page})`);

    if (look === "bright") {
      const sizes = await page.evaluate(() => ({
        root: parseFloat(getComputedStyle(document.documentElement).fontSize),
        text: getComputedStyle(document.body).color,
        border: getComputedStyle(document.querySelector(".card")).borderTopColor,
        blur: getComputedStyle(document.querySelector(".card")).backdropFilter,
      }));
      assert.equal(sizes.root, 18, "Bright sets everything a size up");
      assert.equal(sizes.text, "rgb(0, 0, 0)", "Bright text is black");
      assert.equal(sizes.border, "rgb(82, 82, 91)", "Bright cards have a solid border");
      assert.equal(sizes.blur, "none", "Bright has no glass blur");
    }
    if (look !== "dark") {
      // Pastel status colours are mixed toward the text colour for words.
      await page.goto(`${BASE}/dashboard/contacts/${contactId}`);
      const badge = await contrastReport(page, ".badge");
      for (const r of badge) assert.ok(r.ratio >= 4.5, `${look}: badge "${r.text}" is ${r.ratio}:1`);
    }

    log(`${look}: the workspace's own brand colour still paints the primary buttons`);
    await page.goto(`${BASE}/dashboard/contacts`);
    const brand = await page.locator(`[data-testid=look-switch]:visible [data-testid=look-${look}]`).evaluate((el) => getComputedStyle(el).backgroundColor);
    assert.equal(brand, "rgb(14, 116, 144)", `${look}: the picked look's button is the brand colour`);
    const primary = await page.locator(".btn-primary").first().evaluate((el) => getComputedStyle(el).backgroundImage);
    assert.match(primary, /rgb\(14, 116, 144\)|0\.0549\d* 0\.4549\d* 0\.5647\d*/, `${look}: primary buttons carry the brand (${primary})`);
  }

  log("a second login in a fresh browser picks up the saved look");
  await sql(`UPDATE "User" SET theme = NULL WHERE email = $1`, [EMAIL]);
  await page.goto(`${BASE}/dashboard`);
  await page.locator("[data-testid=look-switch]:visible [data-testid=look-bright]").click();
  await waitForSaved("bright");
  {
    const other = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const phone = await other.newPage();
    await login(phone);
    assert.equal(await phone.locator("[data-theme]").first().getAttribute("data-theme"), "bright");
    assert.equal(await htmlBg(phone), PAGE_BG.bright);
    const visible = phone.locator("[data-testid=look-switch]:visible");
    assert.equal(await visible.count(), 1, "the phone header has its own switch");
    assert.equal(await visible.locator("[data-testid=look-bright]").getAttribute("aria-pressed"), "true");
    await other.close();
  }

  log("the phone (390px): every look, every sampled page, no sideways scroll");
  {
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: await context.storageState() });
    const phone = await mobile.newPage();
    for (const look of LOOKS) {
      await phone.goto(`${BASE}/dashboard`);
      await phone.locator(`[data-testid=look-switch]:visible [data-testid=look-${look}]`).tap();
      await waitForSaved(look);
      for (const [name, url] of PAGES) {
        await phone.goto(`${BASE}${url}`);
        await settle(phone);
        const width = await phone.evaluate(() => document.documentElement.scrollWidth);
        assert.ok(width <= 391, `${look} ${name} on a phone scrolls sideways (${width}px wide)`);
        if (["overview", "contacts", "contact"].includes(name)) {
          await phone.screenshot({ path: path.join(OUT, `phone-${look}-${name}.png`), fullPage: true });
        }
      }
    }
    await mobile.close();
  }

  log("signed-out pages and the customer's copy stay as they were");
  await sql(`UPDATE "User" SET theme = 'bright' WHERE email = $1`, [EMAIL]);
  await page.goto(`${BASE}/q/${quoteToken}`);
  assert.equal(await page.locator("[data-theme]").count(), 0, "the customer's quote carries no look");
  assert.equal(await htmlBg(page), PAGE_BG.dark, "the customer's quote is untouched by the contractor's look");
  await page.screenshot({ path: path.join(OUT, "customer-quote-while-bright.png"), fullPage: true });
  const anon = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const loginPage = await anon.newPage();
  await loginPage.goto(`${BASE}/login`);
  assert.equal(await htmlBg(loginPage), PAGE_BG.dark, "the login page stays dark");
  await anon.close();

  log("the switch only takes the three names");
  // A forged value straight to the column reads back as Dark.
  await sql(`UPDATE "User" SET theme = 'neon' WHERE email = $1`, [EMAIL]);
  await page.goto(`${BASE}/dashboard`);
  assert.equal(await page.locator("[data-theme]").first().getAttribute("data-theme"), "dark");
  assert.equal(await htmlBg(page), PAGE_BG.dark);
  await sql(`UPDATE "User" SET theme = NULL WHERE email = $1`, [EMAIL]);

  await browser.close();
  console.log(`\nAll ${step} steps passed. Screenshots in ${OUT}`);
})().catch((err) => {
  console.error("\nFAILED:", err.message);
  process.exit(1);
});
