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
 * UX review fixes (Nov 10, 2026, "audit fixes (UX review): ..." steps):
 * Light's outlines on ghost buttons, fields, filter chips and cards clear
 * 3:1 against themselves and what is around them, and Dark's tokens are
 * unchanged; a field clicked into (search box, note box, Rep picker) is
 * outlined at least as strongly as at rest in Light, where the old
 * see-through brand edge faded it, and Dark's focus edge is as it was;
 * lines that only separate (a card's divider, a table's header line, the
 * sidebar's edge and its divider, the phone bar's line) stay the soft
 * --hairline-3 in Light and as they were in Dark; the Contract Coordinator's disabled "Tick rows to create
 * contracts" reads at 4.5:1 in Light, not faded as a whole; table footers
 * carry their rows' padding and a seeded contract's $6,754.00 grand total
 * ends inside its card at 1440 in both looks; the phone's strip of links
 * (and the Products tabs) draws no stray bar beside the page you are on,
 * while the sidebar keeps it.
 *
 * BDR sprint, the look (Nov 11, 2026, "Sprint: ..." steps): the fixed
 * health tokens in both looks and under the workspace's brand; numbers in
 * the sans font with even-width digits and document numbers still mono;
 * status chips on one brand ramp (Connected included), closed grey, words
 * at 4.5:1; the lifecycle meter, health ring, word, dot and DealJourney
 * (drawn from scripts/health-check.ts --render onto a card, since no page
 * mounts them yet) in the health colours with readable words, the next
 * step outlined, breathing only without reduced motion, solid/outlined in
 * forced colours, keyboard focus drawn; and on a 390px phone the folded
 * header, 8px steps, 44px targets and no sideways scroll.
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

/* UX review (Nov 10, 2026). The colour maths of contrastReport, for one
 * element: what is really behind it (its own fill and every see-through
 * layer under it, down to the page) and the effective opacity it is drawn
 * at (every ancestor's opacity multiplied). */
const COLOUR_MATHS = `{
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
    const ch = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
  };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return +((x + 0.05) / (y + 0.05)).toFixed(2); };
  const pageBg = rgba(getComputedStyle(document.documentElement).backgroundColor);
  const behind = (el) => {
    const out = [];
    for (let node = el; node && node !== document.documentElement; node = node.parentElement) {
      const s = getComputedStyle(node);
      let c = rgba(s.backgroundColor);
      if (c[3] === 0 && s.backgroundImage.startsWith("linear-gradient")) {
        const first = s.backgroundImage.match(/(rgba?\\([^)]*\\)|color\\([^)]*\\)|#[0-9a-f]{3,8})/i);
        if (first) c = rgba(first[1]);
      }
      if (c[3] > 0) out.push(c);
      if (c[3] >= 0.999) break;
    }
    return out.reverse().reduce((acc, layer) => over(layer, acc), pageBg);
  };
  const opacityOf = (el) => { let o = 1; for (let n = el; n; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity); return +o.toFixed(2); };
  window.__uxColour = { rgba, over, ratio, behind, opacityOf };
}`;
// An outline against the element's own fill and against what is around it.
async function outlineContrast(locator) {
  await locator.page().evaluate(COLOUR_MATHS);
  return locator.evaluate((el) => {
    const { rgba, over, ratio, behind } = window.__uxColour;
    const inside = behind(el);
    const outside = el.parentElement ? behind(el.parentElement) : inside;
    const border = getComputedStyle(el).borderTopColor;
    const line = over(rgba(border), inside);
    return { inside: ratio(line, inside), outside: ratio(line, outside), border };
  });
}
// An element's words against what is behind them, and its opacity.
async function textContrast(locator) {
  await locator.page().evaluate(COLOUR_MATHS);
  return locator.evaluate((el) => {
    const { rgba, over, ratio, behind, opacityOf } = window.__uxColour;
    const bg = behind(el);
    const opacity = opacityOf(el);
    // A faded element is drawn over the page at that opacity: blend both
    // its fill and its words into what is under it.
    const under = el.parentElement ? behind(el.parentElement) : bg;
    const shownBg = over([...bg.slice(0, 3), opacity], under);
    const fg = over(rgba(getComputedStyle(el).color), bg);
    const shownFg = over([...fg.slice(0, 3), opacity], under);
    return { ratio: ratio(shownFg, shownBg), opacity };
  });
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

  // ---- UX review fixes (Nov 10, 2026) ---------------------------------

  log("audit fixes (UX review): Light outlines on buttons, fields, filter chips and cards clear 3:1; Dark's are unchanged");
  await sql(`UPDATE "User" SET theme = 'light' WHERE email = $1`, [EMAIL]);
  const OUTLINED = [
    ["/dashboard/contacts", "Import CSV button", (p) => p.getByRole("button", { name: /Import CSV/i }).first()],
    ["/dashboard/contacts", "State filter chip", (p) => p.locator("[data-testid=filter-state]")],
    ["/dashboard/contacts", "search box", (p) => p.getByPlaceholder(/Search contacts/)],
    ["/dashboard/contacts", "the list's card", (p) => p.locator("main .card").first()],
    [`/dashboard/contacts/${contactId}`, "Log phone call", (p) => p.getByRole("button", { name: /Log phone call/ })],
    [`/dashboard/contacts/${contactId}`, "+ Include multiple contacts", (p) => p.getByRole("button", { name: /Include multiple contacts/ }).first()],
    [`/dashboard/contacts/${contactId}`, "note box", (p) => p.locator("main textarea").first()],
  ];
  for (const [url, what, find] of OUTLINED) {
    if (page.url() !== `${BASE}${url}`) {
      await page.goto(`${BASE}${url}`);
      await settle(page);
    }
    const c = await outlineContrast(find(page));
    // The reviewer measured 1.3:1 (--border) and 1.6:1 (--border-strong).
    assert.ok(c.inside >= 3 && c.outside >= 3, `light ${what}: its outline is ${c.inside}:1 against itself and ${c.outside}:1 against what is around it (${c.border}); needs 3:1`);
    console.log(`     ${what}: ${c.inside}:1 inside, ${c.outside}:1 outside`);
  }
  await page.screenshot({ path: path.join(OUT, "ux-light-outlines-contact.png"), fullPage: true });
  await sql(`UPDATE "User" SET theme = 'dark' WHERE email = $1`, [EMAIL]);
  await page.goto(`${BASE}/dashboard/contacts`);
  await page.evaluate(COLOUR_MATHS);
  const darkTokens = await page.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    // The build writes these as hex (#ffffff13), so read them as colours.
    return ["--border", "--border-strong"].map((name) => window.__uxColour.rgba(s.getPropertyValue(name).trim()).map((v) => +v.toFixed(3)));
  });
  // rgb(255 255 255 / 0.075) and / 0.15, as before the review.
  assert.deepEqual(darkTokens.map((c) => c.slice(0, 3)), [[255, 255, 255], [255, 255, 255]], `Dark's outlines are still white (${JSON.stringify(darkTokens)})`);
  assert.ok(Math.abs(darkTokens[0][3] - 0.075) < 0.006 && Math.abs(darkTokens[1][3] - 0.15) < 0.006, `Dark's outlines are as they were (${JSON.stringify(darkTokens)})`);

  log("audit fixes (UX review): in Light a field you click into is outlined at least as strongly as at rest (it used to fade); Dark's focus is as it was");
  {
    const FIELDS = [
      ["/dashboard/contacts", "search box", (p) => p.getByPlaceholder(/Search contacts/)],
      [`/dashboard/contacts/${contactId}`, "note box", (p) => p.locator("main textarea").first()],
      [`/dashboard/contacts/${contactId}`, "Rep picker", (p) => p.locator("main select.select").first()],
    ];
    const settleField = async (field) => {
      await page.waitForTimeout(60);
      await field.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    };
    for (const look of LOOKS) {
      await sql(`UPDATE "User" SET theme = $2 WHERE email = $1`, [EMAIL, look]);
      for (const [url, what, find] of FIELDS) {
        await page.goto(`${BASE}${url}`);
        await settle(page);
        const field = find(page);
        const rest = await outlineContrast(field);
        await field.focus();
        await settleField(field);
        const focused = await outlineContrast(field);
        if (look === "dark") {
          // Dark keeps the see-through brand edge (55%).
          assert.match(focused.border, /\/ 0\.55\)$|, 0\.55\)$/, `dark ${what}: the focused edge changed (${focused.border})`);
          console.log(`     dark ${what}: ${rest.inside}:1 at rest, ${focused.inside}:1 focused (unchanged rule)`);
          continue;
        }
        // The old Light focus edge, painted on the same field, reads under
        // its resting outline: the check below would have caught it.
        const old = await field.evaluate((el) => {
          el.style.transition = "none";
          el.style.borderColor = "color-mix(in srgb, var(--brand) 55%, transparent)";
          const { rgba, over, ratio, behind } = window.__uxColour;
          const inside = behind(el);
          const out = ratio(over(rgba(getComputedStyle(el).borderTopColor), inside), inside);
          el.style.borderColor = "";
          el.style.transition = "";
          return out;
        });
        assert.ok(old < rest.inside, `light ${what}: the old focus edge (${old}:1) should read under the resting one (${rest.inside}:1)`);
        assert.ok(focused.inside >= 3, `light ${what}: the focused outline is ${focused.inside}:1 (${focused.border}); needs 3:1`);
        assert.ok(focused.inside >= rest.inside, `light ${what}: clicking in fades the outline from ${rest.inside}:1 to ${focused.inside}:1`);
        console.log(`     light ${what}: ${rest.inside}:1 at rest, ${focused.inside}:1 focused (was ${old}:1)`);
        if (what === "search box") await field.screenshot({ path: path.join(OUT, "ux-light-focused-search.png") });
      }
    }
  }

  log("audit fixes (UX review): the active page's glowing bar in the sidebar isn't clipped by the nav's scroll box");
  {
    await page.goto(`${BASE}/dashboard/contacts`);
    await settle(page);
    const clip = await page.evaluate(() => {
      const item = document.querySelector("aside .nav-item-active");
      const bar = getComputedStyle(item, "::before");
      let box = item.parentElement;
      while (box && getComputedStyle(box).overflowY !== "auto") box = box.parentElement;
      const barLeft = item.getBoundingClientRect().left + parseFloat(bar.left);
      return { barLeft: Math.round(barLeft), boxLeft: Math.round(box.getBoundingClientRect().left) };
    });
    assert.ok(clip.boxLeft <= clip.barLeft - 4, `the bar starts at ${clip.barLeft}px but the scroll box clips from ${clip.boxLeft}px`);
  }

  log("audit fixes (UX review): Light lines that only separate (a divider, a table's header line, the sidebar's edge, the phone bar's line) stay soft; Dark's are as they were");
  {
    // Each line's colour and its contrast against what is behind it.
    const lineOf = async (p, js) => {
      await p.evaluate(COLOUR_MATHS);
      return p.evaluate(`(() => {
        const { rgba, over, ratio, behind } = window.__uxColour;
        const [el, colour] = (${js})();
        const c = rgba(colour);
        const bg = behind(el.parentElement || el);
        return { alpha: +c[3].toFixed(3), rgb: c.slice(0, 3), ratio: ratio(over(c, bg), bg) };
      })()`);
    };
    const DESKTOP = [
      ["/dashboard/contacts", "the list's header line", `() => { const th = document.querySelector("main .table thead th"); return [th, getComputedStyle(th).borderBottomColor]; }`],
      ["/dashboard/contacts", "the sidebar's edge", `() => { const a = document.querySelector("aside"); return [a, getComputedStyle(a).borderRightColor]; }`],
      ["/dashboard/contacts", "the sidebar's divider", `() => { const d = document.querySelector("aside .divider"); return [d, getComputedStyle(d).backgroundColor]; }`],
      [`/dashboard/contacts/${contactId}`, "a divider in a card", `() => { const d = document.querySelector("main .divider"); return [d, getComputedStyle(d).backgroundColor]; }`],
      // Follow-up: every one-sided separator moved to --hairline-3, the
      // line under each card's header the most visible of them.
      [`/dashboard/contacts/${contactId}`, "the line under a card header", `() => { const d = document.querySelector("main .card h2").closest("div.border-b"); return [d, getComputedStyle(d).borderBottomColor]; }`],
      ["/dashboard/contacts", "the Showing 1–N footer's line", `() => { const d = [...document.querySelectorAll("main div.border-t")].find((x) => /Showing/.test(x.textContent)); return [d, getComputedStyle(d).borderTopColor]; }`],
    ];
    // The bar holding the phone's look switch: its first ancestor with a
    // line along the bottom only (the switch has an outline all round).
    const PHONE_BAR = `() => { let n = [...document.querySelectorAll("[data-testid=look-switch]")].find((e) => e.offsetParent); n = n.parentElement; while (n && !(getComputedStyle(n).borderBottomWidth === "1px" && getComputedStyle(n).borderTopWidth === "0px")) n = n.parentElement; return [n, getComputedStyle(n).borderBottomColor]; }`;
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: await context.storageState() });
    const phone = await mobile.newPage();
    for (const look of LOOKS) {
      await sql(`UPDATE "User" SET theme = $2 WHERE email = $1`, [EMAIL, look]);
      const lines = [];
      for (const [i, [url, what, js]] of DESKTOP.entries()) {
        // Always load the first page afresh, so the new look applies.
        if (i === 0 || page.url() !== `${BASE}${url}`) {
          await page.goto(`${BASE}${url}`);
          await settle(page);
        }
        lines.push([what, await lineOf(page, js)]);
      }
      await phone.goto(`${BASE}/dashboard/contacts`);
      await settle(phone);
      lines.push(["the phone bar's line", await lineOf(phone, PHONE_BAR)]);
      for (const [what, line] of lines) {
        if (look === "light") {
          // --hairline-3 (slate at 0.12), about the 0.11 these were before
          // the review; with --border (0.5) they read 3.1:1, as heavy as a
          // button's outline.
          // (A faint colour read back from a canvas can be a shade off in rgb.)
          const slate = [15, 23, 42].every((v, i) => Math.abs(line.rgb[i] - v) <= 3);
          assert.ok(Math.abs(line.alpha - 0.12) <= 0.01 && slate, `light ${what}: ${JSON.stringify(line)} is not the soft --hairline-3`);
          assert.ok(line.ratio < 1.6, `light ${what}: reads ${line.ratio}:1, as heavy as an outline`);
        } else {
          // Dark: white at 0.075 (--border) as before, or 0.08 (--hairline-3).
          assert.ok(line.rgb.join() === "255,255,255" && Math.abs(line.alpha - 0.0775) <= 0.006, `dark ${what}: ${JSON.stringify(line)} changed`);
        }
        console.log(`     ${look} ${what}: alpha ${line.alpha}, ${line.ratio}:1`);
      }
    }
    await mobile.close();
    // The outlines beside them keep their 3:1 (light, checked again here
    // on the same page as the lines).
    await sql(`UPDATE "User" SET theme = 'light' WHERE email = $1`, [EMAIL]);
    await page.goto(`${BASE}/dashboard/contacts`);
    await settle(page);
    const card = await outlineContrast(page.locator("main .card").first());
    assert.ok(card.inside >= 3, `light: the list's card outline fell to ${card.inside}:1`);
    await page.screenshot({ path: path.join(OUT, "ux-light-soft-lines-contacts.png") });
  }

  log("audit fixes (UX review): a disabled primary button keeps readable words in Light (Contract Coordinator's \"Tick rows to create contracts\")");
  const dealId = (await sql(`SELECT "dealId" FROM "Quote" WHERE id = $1 AND "organizationId" = $2`, [quoteId, org])).rows[0].dealId;
  for (const look of LOOKS) {
    await sql(`UPDATE "User" SET theme = $2 WHERE email = $1`, [EMAIL, look]);
    await page.goto(`${BASE}/dashboard/deals/tracker?dealId=${dealId}`);
    await settle(page);
    const create = page.getByTestId("create-contracts");
    assert.equal(await create.isDisabled(), true, "nothing is ticked, so Create is disabled");
    assert.equal((await create.textContent()).trim(), "Tick rows to create contracts");
    const words = await textContrast(create);
    if (look === "light") {
      // Was white at half opacity on a pale brand colour, about 1.9:1.
      assert.ok(words.opacity >= 0.95, `light: the disabled button is still faded as a whole (opacity ${words.opacity})`);
      assert.ok(words.ratio >= 4.5, `light: "Tick rows to create contracts" reads at ${words.ratio}:1`);
      await create.screenshot({ path: path.join(OUT, "ux-light-disabled-create.png") });
    }
    console.log(`     ${look}: ${words.ratio}:1 at opacity ${words.opacity}`);
  }

  log("audit fixes (UX review): table footers are padded like their rows; the contract's grand total sits inside its card");
  // A contract with two rows ($5,124 + $1,630 = $6,754, the reviewer's
  // total) and a two-row payment table, seeded in SQL.
  await sql(
    `INSERT INTO "Contract" (id,"organizationId","contactId",number,title,type,body,status,payable,"publicToken","updatedAt")
     VALUES ('ctr_looks_ux',$1,$2,990101,'Kitchen remodel','Sales Order','Body','DRAFT',false,'tok_ctr_looks_ux_0123456',now())`,
    [org, contactId],
  );
  await sql(
    `INSERT INTO "ContractLineItem" (id,"contractId",name,quantity,"unitPriceCents",tag,position) VALUES
       ('cli_looks_ux_1','ctr_looks_ux','Cabinets',1,512400,'MATERIALS',0),
       ('cli_looks_ux_2','ctr_looks_ux','Install',1,163000,'LABOR',1)`,
  );
  await sql(
    `INSERT INTO "ContractPayment" (id,"contractId","organizationId",label,kind,"amountCents",position) VALUES
       ('cp_looks_ux_1','ctr_looks_ux',$1,'Deposit — at signature','FIXED',337700,0),
       ('cp_looks_ux_2','ctr_looks_ux',$1,'Final Pay — at project completion','FIXED',337700,1)`,
    [org],
  );
  await sql(`UPDATE "Organization" SET "nextContractNumber" = GREATEST("nextContractNumber", 990102) WHERE id = $1`, [org]);
  {
    const wide = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: await context.storageState() });
    const wp = await wide.newPage();
    for (const look of LOOKS) {
      await sql(`UPDATE "User" SET theme = $2 WHERE email = $1`, [EMAIL, look]);
      await wp.goto(`${BASE}/dashboard/contracts/ctr_looks_ux`);
      await settle(wp);
      const foot = await wp.evaluate(() => {
        const total = document.querySelector("[data-testid=contract-total]");
        const row = document.querySelector("[data-testid=contract-line-items] tbody td");
        const range = document.createRange();
        range.selectNodeContents(total);
        const card = total.closest(".card").getBoundingClientRect();
        const cells = [...document.querySelectorAll(".table:not(.table-tight) tfoot td")].map((td) => {
          const s = getComputedStyle(td);
          return { left: s.paddingLeft, right: s.paddingRight, text: td.textContent.trim().slice(0, 30) };
        });
        return {
          text: total.textContent.trim(),
          right: getComputedStyle(total).paddingRight,
          rowPad: getComputedStyle(row).paddingRight,
          inset: Math.round(card.right - range.getBoundingClientRect().right),
          cells,
          tables: document.querySelectorAll(".table:not(.table-tight) tfoot").length,
          // The payment table became .table-tight in the same review (its
          // phone layout); it pads its own footer, a little less.
          tight: [...document.querySelectorAll(".table-tight tfoot td")].map((td) => parseFloat(getComputedStyle(td).paddingRight)),
        };
      });
      assert.equal(foot.text, "$6,754.00");
      assert.equal(foot.right, foot.rowPad, `${look}: the grand total's cell is padded ${foot.right}, its rows ${foot.rowPad}`);
      // Flush to the card's edge was 0px (and under its rounded corner).
      assert.ok(foot.inset >= 12, `${look}: the grand total ends ${foot.inset}px from the card's right edge`);
      assert.ok(foot.tables >= 1, `${look}: the line items have a footer (${foot.tables})`);
      assert.ok(foot.tight.length > 0 && foot.tight.every((pad) => pad >= 6), `${look}: the payment table's footer cells are padded (${foot.tight.join(", ")})`);
      for (const cell of foot.cells) {
        assert.equal(cell.left, foot.rowPad, `${look}: footer cell "${cell.text}" has no left padding (${cell.left})`);
        assert.equal(cell.right, foot.rowPad, `${look}: footer cell "${cell.text}" has no right padding (${cell.right})`);
      }
      console.log(`     ${look}: $6,754.00 ends ${foot.inset}px inside its card; ${foot.cells.length} footer cells padded ${foot.rowPad}`);
      await wp.screenshot({ path: path.join(OUT, `ux-${look}-contract-footers.png`), fullPage: true });
    }
    await wide.close();
  }

  log("audit fixes (UX review): the phone's strip of links has no stray bar beside the page you are on; the sidebar keeps its own");
  {
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: await context.storageState() });
    const phone = await mobile.newPage();
    for (const look of LOOKS) {
      await sql(`UPDATE "User" SET theme = $2 WHERE email = $1`, [EMAIL, look]);
      for (const url of ["/dashboard/contacts", "/dashboard/calendar", "/dashboard/deals"]) {
        await phone.goto(`${BASE}${url}`);
        await settle(phone);
        const here = phone.locator("nav a[aria-current=page]:visible");
        assert.equal(await here.count(), 1, `${look} ${url}: one link in the strip marks the page`);
        // It was a 3px glowing bar 9px left of the pill, in the gap after
        // the link before it ("Calendar | Contacts").
        const bar = await here.evaluate((el) => getComputedStyle(el, "::before").content);
        assert.equal(bar, "none", `${look} ${url}: the strip still draws the sidebar's bar (${bar})`);
      }
      await phone.goto(`${BASE}/dashboard/contacts`);
      await settle(phone);
      await phone.screenshot({ path: path.join(OUT, `ux-phone-${look}-nav-strip.png`) });
    }
    await mobile.close();
    // The same rule on the desktop: the sidebar still has its bar, the
    // Products tabs (another sideways strip) don't.
    await page.goto(`${BASE}/dashboard/products`);
    await settle(page);
    assert.equal(await page.locator("aside a[aria-current=page]").first().evaluate((el) => getComputedStyle(el, "::before").content), '""', "the sidebar keeps its bar");
    assert.equal(await page.locator("main a[aria-current=page]").first().evaluate((el) => getComputedStyle(el, "::before").content), "none", "the Products tabs draw no bar");
  }
  await sql(`UPDATE "User" SET theme = NULL WHERE email = $1`, [EMAIL]);

  /* ---------------- BDR sprint: the look and health (Nov 11, 2026) ---------------- */
  const HEALTH_HEX = {
    dark: { good: "#0d9488", warn: "#d97706", risk: "#e11d48", none: "#7e889c" },
    light: { good: "#0d9488", warn: "#d97706", risk: "#be123c", none: "#5b6473" },
  };
  const rgbOf = (hex) => `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`;
  // A computed colour ("rgb(…)", "rgba(…)" or "color(srgb … / a)") as
  // [r, g, b, a] without a canvas round-trip, which loses the hue of a
  // 5%-strong fill.
  const parseColour = (css) => {
    let m = css.match(/^color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.e-]+))?\)$/);
    if (m) return [+m[1] * 255, +m[2] * 255, +m[3] * 255, m[4] === undefined ? 1 : +m[4]];
    m = css.match(/^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/);
    if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
    throw new Error(`unreadable colour ${css}`);
  };

  log("Sprint: the health colours are fixed tokens in both looks, the same under the workspace's brand colour");
  for (const look of LOOKS) {
    await sql(`UPDATE "User" SET theme = $2 WHERE email = $1`, [EMAIL, look]);
    await page.goto(`${BASE}/dashboard/contacts`);
    await settle(page);
    const tokens = await page.evaluate(() => {
      const read = (el) => {
        const s = getComputedStyle(el);
        return Object.fromEntries(["good", "warn", "risk", "none"].map((k) => [k, s.getPropertyValue(`--health-${k}`).trim().toLowerCase()]));
      };
      const main = document.querySelector("main");
      return { root: read(document.documentElement), main: read(main), brand: getComputedStyle(main).getPropertyValue("--brand").trim().toLowerCase() };
    });
    assert.deepEqual(tokens.root, HEALTH_HEX[look], `${look}: the health tokens`);
    assert.deepEqual(tokens.main, HEALTH_HEX[look], `${look}: the same inside the workspace's branded shell`);
    assert.equal(tokens.brand, BRAND, `${look}: the shell carries the workspace's brand`);
  }

  log("Sprint: numbers, dates and phones in the normal sans font with even-width digits; document numbers stay mono");
  {
    await page.goto(`${BASE}/dashboard/quotes`);
    await settle(page);
    const fonts = await page.evaluate(() => {
      const num = document.querySelector("main .num");
      const doc = document.querySelector("main .docnum");
      return {
        body: getComputedStyle(document.body).fontFamily,
        num: num && getComputedStyle(num).fontFamily,
        digits: num && getComputedStyle(num).fontVariantNumeric,
        doc: doc && getComputedStyle(doc).fontFamily,
        docText: doc && doc.textContent.trim(),
      };
    });
    assert.ok(fonts.num, "a number on the quotes list");
    assert.equal(fonts.num, fonts.body, `numbers use the page's own sans font (${fonts.num})`);
    assert.match(fonts.digits, /tabular-nums/, "with even-width digits");
    assert.match(fonts.docText, /^QUO-\d+$/);
    assert.notEqual(fonts.doc, fonts.body);
    assert.match(fonts.doc, /mono/i, `the document number keeps the mono font (${fonts.doc})`);
  }

  log("Sprint: status chips are one brand ramp, light to dark (Connected included); closed is grey; no amber or red; words read in both looks");
  {
    const LADDER = ["CONTACTED", "CONNECTED", "INTERESTED", "MEETING_SET", "MEETING_COMPLETED", "QUOTE_SENT", "CONTRACT_SENT", "WON"];
    const seeded = [...LADDER, "NOT_INTERESTED"];
    for (const [i, status] of seeded.entries()) {
      await sql(`INSERT INTO "Contact" (id,"organizationId",name,status,"updatedAt") VALUES ($1,$2,$3,$4,now()) ON CONFLICT (id) DO NOTHING`, [
        `lk_ramp_${i}`,
        org,
        `Ramp ${String(i).padStart(2, "0")} ${status}`,
        status,
      ]);
    }
    const brand = [parseInt(BRAND.slice(1, 3), 16), parseInt(BRAND.slice(3, 5), 16), parseInt(BRAND.slice(5, 7), 16)];
    for (const look of LOOKS) {
      await sql(`UPDATE "User" SET theme = $2 WHERE email = $1`, [EMAIL, look]);
      await page.goto(`${BASE}/dashboard/contacts`);
      await settle(page);
      const chips = await page.evaluate((statuses) =>
        statuses.map((s) => {
          const el = document.querySelector(`main .status-chip[data-status="${s}"]`);
          if (!el) return { s, missing: true };
          return {
            s,
            ramp: el.dataset.ramp,
            text: el.textContent.trim(),
            fill: getComputedStyle(el).backgroundColor,
            dot: getComputedStyle(el.querySelector(".badge-dot")).backgroundColor,
          };
        }),
      seeded);
      for (const chip of chips) assert.ok(!chip.missing, `${look}: a ${chip.s} chip on the Contacts list`);
      const ladder = chips.slice(0, LADDER.length).map((chip) => ({ ...chip, fillRgba: parseColour(chip.fill), dotRgba: parseColour(chip.dot) }));
      for (const chip of ladder) {
        for (const [k, v] of chip.fillRgba.slice(0, 3).entries()) assert.ok(Math.abs(v - brand[k]) <= 2, `${look} ${chip.s}: the fill is the brand (${chip.fill})`);
        for (const [k, v] of chip.dotRgba.slice(0, 3).entries()) assert.ok(Math.abs(v - brand[k]) <= 2, `${look} ${chip.s}: the dot is the brand (${chip.dot})`);
      }
      for (let i = 1; i < ladder.length; i += 1) {
        assert.ok(
          ladder[i].fillRgba[3] > ladder[i - 1].fillRgba[3] && ladder[i].dotRgba[3] >= ladder[i - 1].dotRgba[3],
          `${look}: ${ladder[i].s} is stronger than ${ladder[i - 1].s} (${ladder[i].fill} vs ${ladder[i - 1].fill})`,
        );
      }
      assert.equal(chips.find((c) => c.s === "CONNECTED").text, "Connected");
      const closed = chips.find((c) => c.s === "NOT_INTERESTED");
      assert.equal(closed.ramp, "closed", "Not Interested is grey, off the ramp");
      assert.equal(parseColour(closed.dot).slice(0, 3).map(Math.round).join(","), rgbOf(HEALTH_HEX[look].none).replace(/[^\d,]/g, ""));
      for (const status of seeded) {
        const r = await textContrast(page.locator(`main .status-chip[data-status="${status}"]`).first());
        assert.ok(r.ratio >= 4.5, `${look}: the ${status} chip's words are ${r.ratio}:1`);
      }
    }
  }

  log("Sprint: the lifecycle meter, health ring, word and dot on a card: fixed health colours, words at 4.5:1, the next step outlined, breathing only without reduced motion, solid and outlined in forced colours");
  {
    // The components aren't on any page yet (the screen work mounts them),
    // so the suite draws them with the app's own stylesheet: the markup
    // comes from the components rendered on the server by
    // scripts/health-check.ts --render and is put on a card on Contacts.
    const { execFileSync } = require("node:child_process");
    const samples = JSON.parse(
      execFileSync("npx", ["tsx", "scripts/health-check.ts", "--render"], {
        cwd: path.join(__dirname, "..", ".."),
        encoding: "utf8",
        maxBuffer: 1 << 24,
      }),
    );
    const markup =
      samples.people.map((p) => `<div data-person="${p.name}" data-tone="${p.tone}" class="space-y-3">${p.header}${p.mini}</div>`).join("") + samples.journey;
    const inject = (p) =>
      p.evaluate((html) => {
        const box = document.createElement("div");
        box.id = "sprint-health";
        box.className = "card mb-6 space-y-8 p-5";
        box.tabIndex = -1;
        box.innerHTML = html;
        document.querySelector("main").prepend(box);
      }, markup);
    for (const look of LOOKS) {
      await sql(`UPDATE "User" SET theme = $2 WHERE email = $1`, [EMAIL, look]);
      await page.emulateMedia({ reducedMotion: "no-preference", forcedColors: "none" });
      await page.goto(`${BASE}/dashboard/contacts`);
      await settle(page);
      await inject(page);
      await page.locator("#sprint-health").screenshot({ path: path.join(OUT, `sprint-health-${look}.png`) });

      // The fill of each person's reached steps is their health colour.
      await page.evaluate(COLOUR_MATHS);
      const people = await page.evaluate(() => {
        const { rgba, ratio, behind } = window.__uxColour;
        return [...document.querySelectorAll("#sprint-health [data-person]")].map((el) => {
          const seg = el.querySelector('.lm-header .lm-seg[data-state="done"], .lm-header .lm-seg[data-state="current"], .lm-header .lm-seg[data-state="closed"]');
          const next = el.querySelector('.lm-header .lm-seg[data-state="next"]');
          const card = document.querySelector("#sprint-health");
          return {
            name: el.dataset.person,
            tone: el.dataset.tone,
            fill: seg && getComputedStyle(seg).backgroundColor,
            state: seg && seg.dataset.state,
            vsCard: seg && ratio(rgba(getComputedStyle(seg).backgroundColor), behind(card)),
            next: next && { bg: getComputedStyle(next).backgroundColor, ring: getComputedStyle(next).boxShadow },
          };
        });
      });
      for (const person of people) {
        if (!person.fill) continue; // Seth: nothing reached yet
        const expected = person.state === "closed" ? HEALTH_HEX[look].none : HEALTH_HEX[look][person.tone];
        assert.equal(person.fill, rgbOf(expected), `${look} ${person.name}: the meter is the ${person.tone} health colour`);
        assert.ok(person.vsCard >= 3, `${look} ${person.name}: the meter's colour is ${person.vsCard}:1 on the card`);
        if (person.next) {
          assert.equal(person.next.bg, "rgba(0, 0, 0, 0)", `${look} ${person.name}: the next step is an outline`);
          assert.match(person.next.ring, /inset/, `${look} ${person.name}: the next step is outlined`);
        }
      }
      assert.ok(people.filter((p) => p.fill).length >= 5, "the sample people were drawn");

      // Words: names, dates, reasons, captions, the word chips, DealJourney.
      const report = await contrastReport(page, "#sprint-health");
      assert.ok(report.length > 40, `found the meter's words (${report.length})`);
      const faint = report.filter((r) => r.ratio < 4.5);
      assert.equal(faint.length, 0, `${look}: faint words on the meter — ${faint.slice(0, 5).map((r) => `"${r.text}" ${r.ratio}:1`).join("; ")}`);
      const text = await page.locator("#sprint-health").innerText();
      assert.doesNotMatch(text, /= \d+|Recent \d+/, "the number is only in the breakdown, never on the card");

      // The current step breathes on the header size; the mini one doesn't.
      const breathing = await page.evaluate(() => {
        const header = document.querySelector('#sprint-health [data-person="Jessica Moreno"] .lm-header .lm-seg[data-state="current"]');
        const mini = document.querySelector('#sprint-health [data-person="Jessica Moreno"] .lm-mini .lm-seg[data-state="current"]');
        return { header: header.getAnimations().map((a) => a.animationName), mini: mini.getAnimations().length };
      });
      assert.deepEqual(breathing.header, ["lmBreathe"], `${look}: the header's current step breathes`);
      assert.equal(breathing.mini, 0, "the mini size stays still");
      await page.emulateMedia({ reducedMotion: "reduce" });
      const still = await page.evaluate(() => [...document.querySelectorAll("#sprint-health .lm-seg")].reduce((n, el) => n + el.getAnimations().length, 0));
      assert.equal(still, 0, `${look}: nothing moves under reduced motion`);

      // Keyboard focus is visible on the meter's controls.
      await page.locator("#sprint-health").focus();
      await page.keyboard.press("Tab");
      const focus = await page.evaluate(() => {
        const el = document.activeElement;
        const s = getComputedStyle(el);
        return { testid: el.dataset.testid, visible: el.matches(":focus-visible"), outline: s.outlineStyle, width: parseFloat(s.outlineWidth) };
      });
      assert.equal(focus.testid, "health-word", "the first stop is Kristen's health word");
      assert.ok(focus.visible && focus.outline !== "none" && focus.width >= 2, `${look}: focus is drawn (${JSON.stringify(focus)})`);

      // High contrast: reached steps solid, the rest outlines.
      await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
      const forced = await page.evaluate(() => {
        const header = document.querySelector('#sprint-health [data-person="Jessica Moreno"] .lm-header');
        const done = getComputedStyle(header.querySelector('.lm-seg[data-state="done"]'));
        const todo = getComputedStyle(header.querySelector('.lm-seg[data-state="todo"]'));
        return { done: done.backgroundColor, todo: todo.backgroundColor, todoRing: todo.boxShadow };
      });
      assert.notEqual(forced.done, forced.todo, `${look}: in forced colours a reached step is solid (${JSON.stringify(forced)})`);
      assert.match(forced.todoRing, /inset/, `${look}: and a step to come is an outline`);
      await page.emulateMedia({ reducedMotion: "no-preference", forcedColors: "none" });
    }

    log("Sprint: on a phone (390px) the meter header names only the current and next step, runs full width at 8px, the mini meter is a 44px target, DealJourney folds to dots, nothing scrolls sideways");
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: await context.storageState() });
    const phone = await mobile.newPage();
    for (const look of LOOKS) {
      await sql(`UPDATE "User" SET theme = $2 WHERE email = $1`, [EMAIL, look]);
      await phone.goto(`${BASE}/dashboard/contacts`);
      await settle(phone);
      await inject(phone);
      const width = await phone.evaluate(() => document.documentElement.scrollWidth);
      assert.ok(width <= 391, `${look}: the meter card scrolls sideways on a phone (${width}px)`);
      const jessica = phone.locator('#sprint-health [data-person="Jessica Moreno"]');
      assert.equal(await jessica.locator("[data-testid=lifecycle-phone]").innerText(), "Meeting Set → next: Meeting Completed");
      assert.equal(await jessica.locator(".lm-names").isVisible(), false, "the seven names fold away");
      const seg = await jessica.locator(".lm-header .lm-seg").first().boundingBox();
      assert.equal(Math.round(seg.height), 8, "8px steps on a phone");
      const bars = await jessica.locator(".lm-header .lm-bars").boundingBox();
      const card = await phone.locator("#sprint-health").boundingBox();
      assert.ok(bars.width >= card.width - 2 * 21 - 1, `the steps run the card's width (${bars.width} of ${card.width})`);
      const mini = await jessica.locator("button.lm-mini").boundingBox();
      assert.ok(mini.height >= 44, `the mini meter is a 44px target on touch (${mini.height})`);
      // The word chip stays small but a thumb landing just above it still
      // hits it (a 44px reach on touch screens).
      const chip = await jessica.locator("button[data-testid=health-word]").boundingBox();
      const reach = await phone.evaluate(
        ([x, y]) => document.elementFromPoint(x, y)?.closest("button")?.dataset.testid ?? null,
        [chip.x + chip.width / 2, chip.y + chip.height / 2 - 20],
      );
      assert.ok(chip.height < 44 && reach === "health-word", `the word chip has a 44px reach (${chip.height}px tall, hit ${reach})`);
      assert.equal(await phone.locator("#sprint-health [data-testid=deal-journey-summary]").isVisible(), true);
      assert.match(await phone.locator("#sprint-health [data-testid=deal-journey-summary]").innerText(), /Step 4 of 5 · Contract sent/);
      assert.equal(await phone.locator("#sprint-health .dj-steps").isVisible(), false);
      const report = await contrastReport(phone, "#sprint-health");
      const faint = report.filter((r) => r.ratio < 4.5);
      assert.equal(faint.length, 0, `${look} phone: faint words — ${faint.slice(0, 5).map((r) => `"${r.text}" ${r.ratio}:1`).join("; ")}`);
      await phone.locator("#sprint-health").screenshot({ path: path.join(OUT, `sprint-health-phone-${look}.png`) });
    }
    await mobile.close();
  }
  await sql(`UPDATE "User" SET theme = NULL WHERE email = $1`, [EMAIL]);

  await browser.close();
  console.log(`\nAll ${step} steps passed. Screenshots in ${OUT}`);
})().catch((err) => {
  console.error("\nFAILED:", err.message);
  process.exit(1);
});
