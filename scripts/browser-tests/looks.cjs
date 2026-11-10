/* Browser regression for the two looks (Nov 10, 2026).
 *
 * Dark (the original glass look, the default) and Light (the same layout
 * on white — Taylor: "same layout and design but one is a black backdrop
 * and the other white"), picked from the switch under the workspace name
 * in the sidebar (the phone's top bar on a phone, the top right corner
 * of the signed-out pages) and saved on User.theme so it follows the
 * person; a signed-out visitor's pick is a cookie.
 *
 * Covers: the switch in the sidebar and the phone header; each look
 * saved, kept after a reload and on a second login in a fresh browser;
 * no flash (data-theme is in the server's HTML, and the page paints in
 * the right colours with JavaScript turned off); nothing in the page
 * moved for the switch (the page's own top padding, the header at the
 * same place in both looks and with the switch taken out); Overview,
 * Contacts, a contact, Pipeline, a quote, Settings and Stats
 * photographed in both looks with the words on them checked for readable
 * contrast against what is actually behind them; the signed-out pages
 * (home, login, signup, signup submitted, forgot and reset password)
 * following the browser's pick, a signed-in person's saved look winning
 * over it, and someone who never picked inheriting it; the phone width
 * (390px) with no sideways scroll; the workspace's own brand colour
 * still painting the primary buttons; the customer's copy of a quote
 * staying as it was; an old "bright" or a forged value reading Dark; and the
 * Nov 10 audit fixes (Log out reachable on a 1440x790 laptop, the switch
 * working for a browser whose person was deleted).
 *
 * Contrast rule: every sampled piece of text must clear 4.5:1 in Light.
 * Dark is the look as it was before this work and is held to 3:1 so the
 * suite reports it without failing on the slate "Archived"-style chips
 * that were always that dim.
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

const LOOKS = ["dark", "light"];
// The page background each look paints (globals.css).
const PAGE_BG = { dark: "rgb(7, 8, 11)", light: "rgb(244, 245, 248)" };
const MIN_CONTRAST = { dark: 3, light: 4.5 };

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
  const SIGNED_OUT = [
    ["home", "/"],
    ["login", "/login"],
    ["signup", "/signup"],
    ["signup-submitted", "/signup/submitted"],
    ["forgot-password", "/forgot-password"],
    ["reset-password", "/reset-password/not-a-real-token"],
  ];

  log("a new person starts on Dark, and the server's HTML says so");
  assert.equal(await savedTheme(), null, "nobody has picked a look yet");
  await page.goto(`${BASE}/dashboard`);
  let html = await (await page.request.get(`${BASE}/dashboard`)).text();
  assert.match(html, /data-theme="dark"/, "the server renders the shell with data-theme=dark");
  assert.equal(await htmlBg(page), PAGE_BG.dark);
  const sw = page.locator("[data-testid=look-switch]:visible");
  assert.equal(await sw.count(), 1, "one switch showing on the desktop");
  assert.equal(await sw.locator("[data-testid=look-dark]").getAttribute("aria-pressed"), "true");
  assert.equal(await sw.locator("button").count(), 2, "two looks: Dark and Light");
  assert.equal(await page.locator("aside [data-testid=look-switch]").count(), 1, "the switch is in the sidebar");
  assert.equal(await page.locator("main [data-testid=look-switch]").count(), 0, "nothing of the switch is in the page itself");
  const box = await sw.boundingBox();
  assert.ok(box.x < 240 && box.y < 120, `the switch sits under the workspace name (${JSON.stringify(box)})`);

  log("nothing in the page moved for the switch: same place as before this work, in both looks");
  // Before this work the page's content started at main's own 32px
  // padding (p-8) with nothing above it. It still must, the header has to
  // land in the same spot in Dark and Light, and taking the switch out of
  // the page altogether must not move it by a pixel.
  const where = async () =>
    page.evaluate(() => {
      const main = document.querySelector("main");
      const content = main.querySelector(".fade-up");
      const h1 = main.querySelector("h1");
      const m = main.getBoundingClientRect();
      return {
        padTop: getComputedStyle(main).paddingTop,
        contentTop: Math.round(content.getBoundingClientRect().top - m.top),
        h1: [Math.round(h1.getBoundingClientRect().left), Math.round(h1.getBoundingClientRect().top)],
        mainLeft: Math.round(m.left),
      };
    });
  const layout = {};
  for (const look of LOOKS) {
    await sql(`UPDATE "User" SET theme = $2 WHERE email = $1`, [EMAIL, look]);
    for (const [name, url] of [["overview", "/dashboard"], ["contacts", "/dashboard/contacts"]]) {
      await page.goto(`${BASE}${url}`);
      await settle(page);
      const at = await where();
      assert.equal(at.padTop, "32px", `${look} ${name}: the page's top padding changed (${at.padTop})`);
      assert.equal(at.contentTop, 32, `${look} ${name}: the page content no longer starts at the top padding (${at.contentTop})`);
      assert.equal(at.mainLeft, 240, `${look} ${name}: the sidebar changed width (${at.mainLeft})`);
      await page.evaluate(() => document.querySelectorAll("[data-testid=look-switch]").forEach((el) => el.remove()));
      assert.deepEqual(await where(), at, `${look} ${name}: the header moves when the switch is taken out`);
      if (layout[name]) assert.deepEqual(at.h1, layout[name], `${name}: the header sits somewhere else in ${look} (${at.h1} vs ${layout[name]})`);
      layout[name] = at.h1;
    }
  }
  console.log(`     Overview header at ${layout.overview}, Contacts at ${layout.contacts} in both looks`);
  // Back to someone who has never picked, in a browser that has not either
  // (the switch keeps the browser's cookie on the look it shows).
  await sql(`UPDATE "User" SET theme = NULL WHERE email = $1`, [EMAIL]);
  await context.clearCookies({ name: "scb-look" });

  for (const look of ["light", "dark"]) {
    log(`switch to ${look} from the sidebar: it paints at once, is saved, and survives a reload`);
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

    if (look === "light") {
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

  log("signed-out pages: a visitor's pick is remembered in this browser, with no flash");
  {
    const anon = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    const visitor = await anon.newPage();
    await visitor.goto(`${BASE}/login`);
    assert.equal(await htmlBg(visitor), PAGE_BG.dark, "a first visit is Dark");
    assert.equal(await visitor.locator("[data-testid=look-switch]:visible").count(), 1, "the login page has the switch");
    const spot = async () => Object.values(await visitor.locator("h1").boundingBox()).map(Math.round);
    await settle(visitor);
    const before = await spot();
    await visitor.locator("[data-testid=look-switch]:visible [data-testid=look-light]").click();
    await visitor.waitForFunction((bg) => getComputedStyle(document.documentElement).backgroundColor === bg, PAGE_BG.light);
    assert.deepEqual(await spot(), before, "the login form does not move between looks");
    for (let i = 0; i < 50 && !(await anon.cookies()).some((c) => c.name === "scb-look" && c.value === "light"); i += 1) await visitor.waitForTimeout(100);
    for (const [name, url] of SIGNED_OUT) {
      const raw = await (await visitor.request.get(`${BASE}${url}`)).text();
      assert.match(raw, /data-theme="light"/, `${name}: the server renders the visitor's pick`);
      await visitor.goto(`${BASE}${url}`);
      await settle(visitor);
      assert.equal(await htmlBg(visitor), PAGE_BG.light, `${name} follows the visitor's pick`);
      await visitor.screenshot({ path: path.join(OUT, `light-signed-out-${name}.png`), fullPage: true });
      const report = await contrastReport(visitor, "body");
      const bad = report.filter((r) => r.ratio < MIN_CONTRAST.light);
      assert.equal(bad.length, 0, `light ${name}: text too faint — ${bad.slice(0, 4).map((r) => `"${r.text}" ${r.ratio}:1`).join("; ")}`);
    }
    const noJs = await browser.newContext({ viewport: { width: 1360, height: 900 }, javaScriptEnabled: false, storageState: await anon.storageState() });
    const still = await noJs.newPage();
    await still.goto(`${BASE}/login`);
    assert.equal(await htmlBg(still), PAGE_BG.light, "the login page is Light before any script runs");
    await noJs.close();

    await visitor.goto(`${BASE}/login`);
    await visitor.locator("[data-testid=look-switch]:visible [data-testid=look-dark]").click();
    await visitor.waitForFunction((bg) => getComputedStyle(document.documentElement).backgroundColor === bg, PAGE_BG.dark);
    for (let i = 0; i < 50 && !(await anon.cookies()).some((c) => c.name === "scb-look" && c.value === "dark"); i += 1) await visitor.waitForTimeout(100);
    for (const [name, url] of SIGNED_OUT) {
      await visitor.goto(`${BASE}${url}`);
      await settle(visitor);
      assert.equal(await htmlBg(visitor), PAGE_BG.dark, `${name} back on Dark`);
      await visitor.screenshot({ path: path.join(OUT, `dark-signed-out-${name}.png`), fullPage: true });
    }
    await anon.close();
  }

  log("a signed-in person's saved look wins over the browser's; someone who never picked inherits it");
  {
    await sql(`UPDATE "User" SET theme = 'dark' WHERE email = $1`, [EMAIL]);
    const anon = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    const visitor = await anon.newPage();
    await visitor.goto(`${BASE}/login`);
    await visitor.locator("[data-testid=look-switch]:visible [data-testid=look-light]").click();
    await visitor.waitForFunction((bg) => getComputedStyle(document.documentElement).backgroundColor === bg, PAGE_BG.light);
    for (let i = 0; i < 50 && !(await anon.cookies()).some((c) => c.name === "scb-look" && c.value === "light"); i += 1) await visitor.waitForTimeout(100);
    await login(visitor);
    assert.equal(await visitor.locator("[data-theme]").first().getAttribute("data-theme"), "dark", "the saved Dark wins over the login page's Light");
    assert.equal(await savedTheme(), "dark", "logging in did not overwrite the saved look");
    // The browser now follows the person, so the login page after Log
    // out matches what they last saw.
    await visitor.getByRole("button", { name: /Log out/i }).first().click();
    await visitor.waitForURL(/\/login/);
    assert.equal(await htmlBg(visitor), PAGE_BG.dark, "after Log out the login page shows the person's look");

    await sql(`UPDATE "User" SET theme = NULL WHERE email = $1`, [EMAIL]);
    await visitor.locator("[data-testid=look-switch]:visible [data-testid=look-light]").click();
    await visitor.waitForFunction((bg) => getComputedStyle(document.documentElement).backgroundColor === bg, PAGE_BG.light);
    for (let i = 0; i < 50 && !(await anon.cookies()).some((c) => c.name === "scb-look" && c.value === "light"); i += 1) await visitor.waitForTimeout(100);
    await sql(`UPDATE "User" SET theme = NULL WHERE email = $1`, [EMAIL]);
    await login(visitor);
    assert.equal(await visitor.locator("[data-theme]").first().getAttribute("data-theme"), "light", "never picked: the login page's Light carries in");
    await anon.close();
  }

  log("a second login in a fresh browser picks up the saved look");
  await sql(`UPDATE "User" SET theme = NULL WHERE email = $1`, [EMAIL]);
  await context.clearCookies({ name: "scb-look" });
  await page.goto(`${BASE}/dashboard`);
  await page.locator("[data-testid=look-switch]:visible [data-testid=look-light]").click();
  await waitForSaved("light");
  {
    const other = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const phone = await other.newPage();
    await login(phone);
    assert.equal(await phone.locator("[data-theme]").first().getAttribute("data-theme"), "light");
    assert.equal(await htmlBg(phone), PAGE_BG.light);
    const visible = phone.locator("[data-testid=look-switch]:visible");
    assert.equal(await visible.count(), 1, "the phone header has its own switch");
    assert.equal(await visible.locator("[data-testid=look-light]").getAttribute("aria-pressed"), "true");
    await other.close();
  }

  log("the phone (390px): both looks, every sampled page and the login page, no sideways scroll");
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
    const anon = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const visitor = await anon.newPage();
    await visitor.goto(`${BASE}/login`);
    const width = await visitor.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(width <= 391, `the login page on a phone scrolls sideways (${width}px wide)`);
    const sw2 = await visitor.locator("[data-testid=look-switch]:visible").boundingBox();
    const h1 = await visitor.locator("h1").boundingBox();
    assert.ok(sw2.y + sw2.height <= h1.y || sw2.x >= h1.x + h1.width, "the switch does not sit on the login form on a phone");
    await visitor.screenshot({ path: path.join(OUT, "phone-dark-login.png"), fullPage: true });
    await anon.close();
    await mobile.close();
  }

  log("audit fixes: on a short laptop screen (1440×790) Log out stays reachable at the foot of the sidebar");
  const laptop = await browser.newContext({ viewport: { width: 1440, height: 790 } });
  const lp = await laptop.newPage();
  await login(lp);
  for (const url of ["/dashboard/settings", "/dashboard/contacts", "/dashboard/settings/account"]) {
    await lp.goto(`${BASE}${url}`);
    await lp.evaluate(() => window.scrollTo(0, 1e6));
    await lp.waitForTimeout(200);
    const out = await lp.evaluate(() => {
      const button = Array.from(document.querySelectorAll("aside button")).find((b) => /Log out/.test(b.textContent));
      const box = button.getBoundingClientRect();
      return { bottom: Math.round(box.bottom), vh: window.innerHeight };
    });
    assert.ok(out.bottom <= out.vh, `${url}: Log out ends at ${out.bottom}px in a ${out.vh}px window`);
  }
  // The nav itself scrolls inside the sidebar instead.
  await lp.goto(`${BASE}/dashboard/settings`);
  const navScroll = await lp.evaluate(() => {
    const box = document.querySelector("aside > div");
    return { scrollable: box.scrollHeight >= box.clientHeight, overflow: getComputedStyle(box).overflowY };
  });
  assert.equal(navScroll.overflow, "auto");
  await laptop.close();

  log("audit fixes: the look switch still works for a browser whose person was deleted while signed in");
  const goneEmail = "test-looks-gone@example.com";
  await sql(`DELETE FROM "User" WHERE email = $1`, [goneEmail]);
  await sql(
    `INSERT INTO "User" (id, name, email, "passwordHash", role, "organizationId")
     SELECT 'usr_looks_gone', 'Gone Person', $1, "passwordHash", 'MEMBER', "organizationId" FROM "User" WHERE email = $2`,
    [goneEmail, EMAIL],
  );
  const goneCtx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const gp = await goneCtx.newPage();
  const gpErrors = [];
  gp.on("pageerror", (err) => gpErrors.push(err.message));
  await gp.goto(`${BASE}/login`);
  await gp.fill("#email", goneEmail);
  await gp.fill("#password", PASSWORD);
  await gp.click("button[type=submit]");
  await gp.waitForURL(/\/dashboard$/);
  await sql(`DELETE FROM "User" WHERE id = 'usr_looks_gone'`);
  await gp.goto(`${BASE}/dashboard`);
  await gp.waitForURL(/\/login/);
  const pressed = gp.locator("[data-testid=look-switch]:visible [data-testid=look-light]");
  await pressed.click();
  await gp.waitForFunction((bg) => getComputedStyle(document.documentElement).backgroundColor === bg, PAGE_BG.light);
  await gp.waitForTimeout(500);
  assert.equal(await gp.getByText(/Application error/).count(), 0, "no error screen");
  assert.equal(await pressed.getAttribute("aria-pressed"), "true");
  assert.deepEqual(gpErrors, [], "nothing thrown in the page");
  await goneCtx.close();

  log("the customer's copy of a quote stays as it was");
  await sql(`UPDATE "User" SET theme = 'light' WHERE email = $1`, [EMAIL]);
  await context.addCookies([{ name: "scb-look", value: "light", url: BASE }]);
  await page.goto(`${BASE}/q/${quoteToken}`);
  assert.equal(await page.locator("[data-theme]").count(), 0, "the customer's quote carries no look");
  assert.equal(await htmlBg(page), PAGE_BG.dark, "the customer's quote is untouched by the contractor's look");
  await page.screenshot({ path: path.join(OUT, "customer-quote-while-light.png"), fullPage: true });

  log("only the two names: an old Bright or a forged value reads Dark");
  for (const stored of ["bright", "neon"]) {
    await sql(`UPDATE "User" SET theme = $2 WHERE email = $1`, [EMAIL, stored]);
    await page.goto(`${BASE}/dashboard`);
    assert.equal(await page.locator("[data-theme]").first().getAttribute("data-theme"), "dark", `stored "${stored}" reads Dark`);
    assert.equal(await htmlBg(page), PAGE_BG.dark);
  }
  const forged = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  await forged.addCookies([{ name: "scb-look", value: "bright", url: BASE }]);
  const fp = await forged.newPage();
  await fp.goto(`${BASE}/login`);
  assert.equal(await fp.locator("[data-theme]").first().getAttribute("data-theme"), "dark", "a forged cookie reads Dark");
  await forged.close();
  await sql(`UPDATE "User" SET theme = NULL WHERE email = $1`, [EMAIL]);

  await browser.close();
  console.log(`\nAll ${step} steps passed. Screenshots in ${OUT}`);
})().catch((err) => {
  console.error("\nFAILED:", err.message);
  process.exit(1);
});
