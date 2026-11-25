/* Browser regression: a removed user is signed out everywhere (Nov 25, 2026).
 *
 * Taylor removed a sales contractor and asked that an open tab force-log
 * him out. Before this, a removed person's tab kept showing its page until
 * they clicked, Back brought pages back, and links to documents they had
 * opened kept downloading on their old login cookie. Covers: a tab nobody
 * touches signing itself out within a minute (the browser clock is
 * fast-forwarded), the reason on the login page, the login cookie wiped, a
 * click and a save after removal, Back, a saved document link and an
 * artwork file on the old cookie, a paused workspace, a second tab, a link
 * to /session-ended that signs nobody out, someone still allowed staying
 * signed in, and Restore letting them back in.
 *
 * Seeds its own workspace (slug test-removed-…) and deletes it at the end.
 * Plain server, no email needed.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/scb_test \
 *   BASE=http://localhost:3400 \
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules \
 *   node scripts/browser-tests/removed-user.cjs
 */
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS on purpose: NODE_PATH only resolves the global playwright for require() */
const { chromium } = require("playwright");
const { Client } = require("pg");
const bcrypt = require("bcryptjs");
const assert = require("node:assert/strict");

const BASE = process.env.BASE || "http://localhost:3000";
const DB = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5433/scb_test";
const R = Math.random().toString(36).slice(2, 8);
const PASS = "Removed-user-123";
const OWNER = { name: `Olive Owner ${R}`, email: `owner-${R}@removed.example.com` };
const MEMBER = { name: `Nico Member ${R}`, email: `member-${R}@removed.example.com` };
const STAYER = { name: `Sam Stayer ${R}`, email: `stayer-${R}@removed.example.com` };
const REMOVED_NOTICE = "taken off its workspace";
const PAUSED_NOTICE = "This workspace has been paused";

let step = 0;
const log = (s) => console.log(`\n[${++step}] ${s}`);

async function login(page, who) {
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', who.email);
  await page.fill('input[name="password"]', PASS);
  await page.click('button[type="submit"]');
}

// A member's browser with a controllable clock, signed in on Contacts.
async function signedIn(browser, who) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.clock.install();
  const page = await ctx.newPage();
  await login(page, who);
  await page.waitForURL(/\/dashboard/, { timeout: 60000 });
  await page.goto(`${BASE}/dashboard/contacts`, { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForSelector(`text=Casey Customer ${R}`, { timeout: 60000 });
  return { ctx, page };
}

const sessionCookies = async (ctx) => (await ctx.cookies()).filter((c) => /session-token/.test(c.name));

async function onLogin(page, notice) {
  await page.waitForURL(/\/login/, { timeout: 30000 });
  if (notice) await page.waitForSelector(`text=${notice}`, { timeout: 15000 });
}

(async () => {
  const db = new Client({ connectionString: DB });
  await db.connect();
  const hash = await bcrypt.hash(PASS, 10);
  const org = `orm${R}`;
  const ids = { owner: `uo${R}`, member: `um${R}`, stayer: `us${R}` };
  await db.query(
    `INSERT INTO "Organization"(id, name, slug, status, "updatedAt") VALUES ($1, $2, $3, 'ACTIVE', now())`,
    [org, `Removed Co ${R}`, `test-removed-${R}`],
  );
  await db.query(
    `INSERT INTO "User"(id, name, email, "passwordHash", role, "organizationId") VALUES
       ($1, $2, $3, $4, 'OWNER', $10), ($5, $6, $7, $4, 'MEMBER', $10), ($8, $9, $11, $4, 'MEMBER', $10)`,
    [ids.owner, OWNER.name, OWNER.email, hash, ids.member, MEMBER.name, MEMBER.email, ids.stayer, STAYER.name, org, STAYER.email],
  );
  // Owned by both members so it shows on their "Mine" list.
  await db.query(
    `INSERT INTO "Contact"(id, "organizationId", name, "ownerId", "updatedAt") VALUES ($1, $2, $3, $4, now()), ($5, $2, $3, $6, now())`,
    [`cm${R}`, org, `Casey Customer ${R}`, ids.member, `cs${R}`, ids.stayer],
  );
  const docToken = `removeddoc${R}${R}`;
  await db.query(
    `INSERT INTO "Upload"(id, "organizationId", kind, name, "fileName", "mimeType", "sizeBytes", data, "publicToken", "updatedAt")
     VALUES ($1, $2, 'COMPLIANCE', 'W-9', 'w9.txt', 'text/plain', 5, convert_to('hello', 'UTF8'), $3, now())`,
    [`up${R}`, org, docToken],
  );

  const browser = await chromium.launch();
  const ownerCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const owner = await ownerCtx.newPage();
  await login(owner, OWNER);
  await owner.waitForURL(/\/dashboard/, { timeout: 60000 });

  async function removeMember() {
    await owner.goto(`${BASE}/dashboard/settings/users`);
    const row = owner.locator(`[data-testid="user-row"]:has-text("${MEMBER.name}")`);
    await row.locator('button:has-text("Remove")').click();
    await row.locator('button.btn-danger:has-text("Remove")').click();
    await owner.waitForSelector("text=can no longer log in", { timeout: 20000 });
  }
  async function restoreMember() {
    await owner.goto(`${BASE}/dashboard/settings/users`);
    await owner.locator(`[data-testid="user-row"]:has-text("${MEMBER.name}") button:has-text("Restore")`).click();
    await owner.waitForSelector("text=can log in again", { timeout: 20000 });
  }

  log("a tab nobody touches signs itself out within a minute of the owner's Remove, with the reason");
  {
    const stay = await signedIn(browser, STAYER);
    const m = await signedIn(browser, MEMBER);
    const doc = await m.ctx.request.get(`${BASE}/files/${docToken}`);
    assert.equal(doc.status(), 200, "the document opens for a member before removal");
    const oldCookies = await sessionCookies(m.ctx);
    assert.ok(oldCookies.length > 0, "signed in with a login cookie");

    await removeMember();
    assert.match(new URL(m.page.url()).pathname, /\/dashboard\/contacts/, "nothing moves before the check");
    await m.ctx.clock.fastForward("01:05");
    await onLogin(m.page, REMOVED_NOTICE);

    log("the login cookie is wiped, and the old cookie no longer opens a saved document link");
    assert.equal((await sessionCookies(m.ctx)).length, 0, "no login cookie left in the browser");
    const replay = await browser.newContext();
    await replay.addCookies(oldCookies);
    assert.equal((await replay.request.get(`${BASE}/files/${docToken}`)).status(), 404, "document link refused");
    assert.equal(
      (await replay.request.get(`${BASE}/dashboard/artwork/none-${R}/picture`)).status(),
      404,
      "artwork route refused",
    );
    const api = await replay.request.get(`${BASE}/api/session`);
    assert.deepEqual(await api.json(), { ok: false, reason: "removed" }, "the old cookie reads removed");
    await replay.close();

    log("Back doesn't bring the page back");
    await m.page.goBack().catch(() => {});
    await m.page.waitForTimeout(3000);
    assert.ok(!/\/dashboard/.test(new URL(m.page.url()).pathname), `Back stays out (${m.page.url()})`);

    log("logging in again is refused with the reason");
    await login(m.page, MEMBER);
    await m.page.waitForSelector(`text=${REMOVED_NOTICE}`, { timeout: 20000 });

    log("a teammate still on the account stays signed in through the same minutes");
    await stay.ctx.clock.fastForward("03:00");
    await stay.page.waitForTimeout(2000);
    assert.match(new URL(stay.page.url()).pathname, /\/dashboard\/contacts/, "the stayer is still in");
    await stay.page.locator('a[href="/dashboard/companies"]').first().click();
    await stay.page.waitForURL(/\/dashboard\/companies/, { timeout: 30000 });

    log("a link to /session-ended signs nobody out");
    await stay.page.goto(`${BASE}/session-ended?reason=removed`);
    await stay.page.waitForURL(/\/dashboard/, { timeout: 30000 });
    assert.ok((await sessionCookies(stay.ctx)).length > 0, "the stayer keeps their login");
    await stay.ctx.close();
    await m.ctx.close();
  }

  log("restored, they can log in again, and their tab is left alone");
  await restoreMember();
  {
    const m = await signedIn(browser, MEMBER);
    await m.ctx.clock.fastForward("02:00");
    await m.page.waitForTimeout(1500);
    assert.match(new URL(m.page.url()).pathname, /\/dashboard\/contacts/);

    log("removed again: the next click goes to the login page with the reason, and wipes the cookie");
    await removeMember();
    await m.page.locator('a[href="/dashboard/companies"]').first().click();
    await onLogin(m.page, REMOVED_NOTICE);
    assert.equal((await sessionCookies(m.ctx)).length, 0, "no login cookie after the click");
    await m.ctx.close();
  }

  log("removed mid-save: the save goes to the login page with the reason");
  await restoreMember();
  {
    const m = await signedIn(browser, MEMBER);
    await removeMember();
    await m.page.locator('[data-testid="star"]').first().click();
    await onLogin(m.page, REMOVED_NOTICE);
    const fav = await db.query(`SELECT count(*)::int AS n FROM "Contact" WHERE "organizationId" = $1 AND favorite`, [org]);
    assert.equal(fav.rows[0].n, 0, "the save didn't land");
    await m.ctx.close();
  }

  log("a second open tab follows the first one out");
  await restoreMember();
  {
    const m = await signedIn(browser, MEMBER);
    const second = await m.ctx.newPage();
    await second.goto(`${BASE}/dashboard/companies`, { waitUntil: "networkidle", timeout: 120000 });
    await removeMember();
    await m.ctx.clock.fastForward("01:05");
    await onLogin(m.page);
    await onLogin(second);
    assert.equal((await sessionCookies(m.ctx)).length, 0);
    await m.ctx.close();
  }

  log("a paused workspace signs an open tab out with its own reason");
  await restoreMember();
  {
    const m = await signedIn(browser, MEMBER);
    await db.query(`UPDATE "Organization" SET status = 'PAUSED' WHERE id = $1`, [org]);
    await m.ctx.clock.fastForward("01:05");
    await onLogin(m.page, PAUSED_NOTICE);
    assert.equal((await sessionCookies(m.ctx)).length, 0);
    await db.query(`UPDATE "Organization" SET status = 'ACTIVE' WHERE id = $1`, [org]);
    await m.ctx.close();
  }

  log("clean up the test workspace");
  await browser.close();
  await db.query(`DELETE FROM "Organization" WHERE id = $1`, [org]);
  await db.end();
  console.log("\nALL PASSED");
})().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
