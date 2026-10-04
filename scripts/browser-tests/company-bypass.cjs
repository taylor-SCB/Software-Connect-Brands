/* Browser regression for "an activity on the company page is with a
 * person" (Oct 4, 2026): the bypass box, "<who> Bypassed", Other
 * Contacts and claiming, plus the Company / People split on the company
 * page's Notes.
 *
 * Covers: logging on a company page with nobody ticked is refused and
 * keeps what was typed; ticking "I'm choosing not to link a contact for
 * these activities" lets it through, the feed reads "Taylor Test
 * Bypassed", and it sits in Other Contacts under that name; ticking a
 * person clears the bypass; the follow-up box still opens after a
 * bypassed log; Claim moves one activity onto a person (history,
 * Contacted status and the calendar entry follow), Claim all moves the
 * rest, a new contact can be added and claimed in one go, and a person
 * from another company is refused; an activity logged on the company
 * before today (seeded with SQL) is claimable too; and Notes on the
 * company page split into All / Company / People / Personal.
 *
 * Runs against a built app (`bash scripts/dev-serve.sh`) and a local
 * Postgres that has had `prisma migrate deploy` run against it. It signs
 * up its own workspace and deletes it again on the next run. Never point
 * it at the live database.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/scb_test \
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules \
 *   node scripts/browser-tests/company-bypass.cjs
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
const OUT = process.env.SHOTS_DIR || path.join(os.tmpdir(), "scb-browser-shots-company-bypass");
fs.mkdirSync(OUT, { recursive: true });

const EMAIL = "test-bypass@example.com";
const NIC_EMAIL = "test-bypass-nic@example.com";
const PASSWORD = "password123";
const COMPANY = "Test Bypass Co";
const SLUG_LIKE = "test-bypass-co%";

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
async function login(page, email) {
  await page.goto(`${BASE}/login`);
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/dashboard$/);
}
async function until(fn, what) {
  for (let i = 0; i < 40; i += 1) {
    if (await fn()) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`timed out waiting for ${what}`);
}
const status = async (table, id) => (await sql(`SELECT status FROM "${table}" WHERE id=$1`, [id])).rows[0].status;
const activity = async (body, org) =>
  (await sql(`SELECT id, "contactId", "companyId", type FROM "Activity" WHERE "organizationId"=$1 AND body=$2`, [org, body])).rows[0];

(async () => {
  await sql(`DELETE FROM "Organization" WHERE slug LIKE $1`, [SLUG_LIKE]);
  await sql(`DELETE FROM "User" WHERE email = $1`, [NIC_EMAIL]);

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await context.newPage();
  page.on("pageerror", (err) => console.error("PAGE ERROR:", err.message));

  log("signup + activate + login, plus a teammate");
  await page.goto(`${BASE}/signup`);
  await page.fill("[name=companyName]", COMPANY);
  await page.fill("[name=name]", "Taylor Test");
  await page.fill("[name=email]", EMAIL);
  await page.fill("[name=phone]", "5550000000");
  await page.fill("[name=password]", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/signup\/submitted/);
  await sql(`UPDATE "Organization" SET status='ACTIVE', "reviewedAt"=now() WHERE slug LIKE $1`, [SLUG_LIKE]);
  await login(page, EMAIL);
  const org = (await sql(`SELECT id FROM "Organization" WHERE slug LIKE $1`, [SLUG_LIKE])).rows[0].id;
  const taylor = (await sql(`SELECT id, "passwordHash" FROM "User" WHERE email = $1`, [EMAIL])).rows[0];
  const nicId = "usr_bypass_nic";
  await sql(
    `INSERT INTO "User" (id, name, email, "passwordHash", role, "organizationId") VALUES ($1, 'Nic Steffl', $2, $3, 'MEMBER', $4)`,
    [nicId, NIC_EMAIL, taylor.passwordHash, org],
  );

  await sql(
    `INSERT INTO "Company" (id,"organizationId",name,"updatedAt") VALUES
       ('cmp_by_harbor',$1,'Harbor Dental',now()),
       ('cmp_by_other',$1,'Elsewhere Inc',now())`,
    [org],
  );
  await sql(
    `INSERT INTO "Contact" (id,"organizationId",name,"companyId","updatedAt") VALUES
       ('ctc_by_dana',$1,'Dana Ruiz','cmp_by_harbor',now()),
       ('ctc_by_eli',$1,'Eli Park','cmp_by_harbor',now()),
       ('ctc_by_zed',$1,'Zed Stone','cmp_by_other',now())`,
    [org],
  );
  // Logged on the company before today, by Nic, with nobody linked: the
  // kind of row that exists from before this rule.
  await sql(
    `INSERT INTO "Activity" (id,"organizationId","companyId","userId",type,body,"occurredAt") VALUES
       ('act_by_old',$1,'cmp_by_harbor',$2,'EMAIL','Old email to the office',now() - interval '10 days')`,
    [org, nicId],
  );
  // One note on the company, one on Dana, for the split.
  await sql(
    `INSERT INTO "Note" (id,"organizationId","companyId","authorId",body) VALUES ('note_by_co',$1,'cmp_by_harbor',$2,'They move buildings in March')`,
    [org, taylor.id],
  );
  await sql(
    `INSERT INTO "Note" (id,"organizationId","contactId","authorId",body,label) VALUES ('note_by_dana',$1,'ctc_by_dana',$2,'Dana likes sailing','HOBBIES')`,
    [org, taylor.id],
  );

  const form = page.locator("[data-testid=log-activity-form]");
  const picker = form.locator("[data-testid=company-people-picker]");
  const other = page.locator("[data-testid=other-contacts]");

  log("nobody ticked: refused, and what was typed is still there");
  await page.goto(`${BASE}/dashboard/companies/cmp_by_harbor`);
  await form.locator("textarea[name=body]").fill("Spoke to reception about parking");
  await form.locator("[data-testid=activity-time]").fill("10:15");
  await form.locator("[data-testid=activity-submit]").click();
  await form.getByRole("alert").waitFor();
  assert.match(await form.getByRole("alert").textContent(), /Tick who at this company it was with, or tick/);
  assert.equal(await form.locator("textarea[name=body]").inputValue(), "Spoke to reception about parking", "body kept");
  assert.equal(await form.locator("[data-testid=activity-time]").inputValue(), "10:15", "time kept");
  assert.equal((await sql(`SELECT count(*)::int n FROM "Activity" WHERE "organizationId"=$1`, [org])).rows[0].n, 1, "nothing written");
  await shot(page, "01-refused");

  log("ticking the bypass box lets it through; the feed reads 'Taylor Test Bypassed'");
  const bypass = form.locator("[data-testid=company-bypass]");
  assert.match(await bypass.textContent(), /I'm choosing not to link a contact for these activities/);
  await form.locator("[data-testid=company-bypass-tick]").check();
  assert.match(await bypass.textContent(), /as “Taylor Test Bypassed” until someone claims it/);
  await form.locator("[data-testid=activity-submit]").click();
  await page.locator("[data-testid=follow-up-prompt]").waitFor();
  const parking = await activity("Spoke to reception about parking", org);
  assert.deepEqual({ contactId: parking.contactId, companyId: parking.companyId }, { contactId: null, companyId: "cmp_by_harbor" });
  await page.locator("[data-testid=follow-up-skip]").click();
  await page.reload();
  const feedRow = page.locator("#activity li", { hasText: "Spoke to reception about parking" });
  await feedRow.waitFor();
  assert.match(await feedRow.locator("[data-testid=activity-bypassed]").textContent(), /^Taylor Test Bypassed$/);
  await shot(page, "02-bypassed-feed");

  log("Other Contacts lists it under Taylor Test Bypassed, and Nic's old email under Nic Steffl Bypassed");
  await other.waitFor();
  assert.match(await other.textContent(), /2 activities logged here with nobody linked/);
  const taylorGroup = other.locator(`[data-testid=bypass-group][data-user-id="${taylor.id}"]`);
  const nicGroup = other.locator(`[data-testid=bypass-group][data-user-id="${nicId}"]`);
  assert.match(await taylorGroup.textContent(), /Taylor Test Bypassed/);
  assert.match(await taylorGroup.textContent(), /Spoke to reception about parking/);
  assert.match(await nicGroup.textContent(), /Nic Steffl Bypassed/);
  assert.match(await nicGroup.textContent(), /Old email to the office/);
  assert.equal(await taylorGroup.locator("[data-testid=claim-all]").count(), 0, "one activity: no Claim all");
  await shot(page, "03-other-contacts");

  log("ticking a person clears the bypass, and the log lands on them as before");
  await form.locator("[data-testid=company-bypass-tick]").check();
  await picker.locator("[data-testid=company-person-chip]", { hasText: "Dana Ruiz" }).click();
  assert.equal(await form.locator("[data-testid=company-bypass-tick]").isChecked(), false, "bypass unticked by the tick");
  assert.ok(await form.locator("[data-testid=company-bypass-tick]").isDisabled(), "and disabled while somebody is ticked");
  await form.locator("textarea[name=body]").fill("Dana confirmed the appointment");
  await form.locator("[data-testid=activity-submit]").click();
  await page.locator("[data-testid=follow-up-prompt]").waitFor();
  await page.locator("[data-testid=follow-up-skip]").click();
  const confirmed = await activity("Dana confirmed the appointment", org);
  assert.deepEqual({ contactId: confirmed.contactId, companyId: confirmed.companyId }, { contactId: "ctc_by_dana", companyId: null });

  log("bypass two more as Taylor, so the group has three and a Claim all");
  for (const body of ["Front desk said call back Monday", "Left a brochure"]) {
    await page.goto(`${BASE}/dashboard/companies/cmp_by_harbor`);
    await form.locator("textarea[name=body]").fill(body);
    await form.locator("[data-testid=company-bypass-tick]").check();
    await form.locator("[data-testid=activity-submit]").click();
    await page.locator("[data-testid=follow-up-prompt]").waitFor();
    await page.locator("[data-testid=follow-up-skip]").click();
  }
  await page.reload();
  await until(async () => (await taylorGroup.locator("[data-testid=unclaimed-row]").count()) === 3, "three unclaimed");
  assert.equal(await taylorGroup.locator("[data-testid=claim-all]").count(), 1);

  log("Claim one: it moves onto Eli, with his history, Contacted status and calendar entry");
  assert.equal(await status("Contact", "ctc_by_eli"), "NOT_ACTIONED");
  const parkingRow = taylorGroup.locator(`[data-testid=unclaimed-row][data-activity-id="${parking.id}"]`);
  await parkingRow.locator("[data-testid=claim-one]").click();
  const claimBox = parkingRow.locator("[data-testid=claim-box]");
  await claimBox.waitFor();
  assert.match(await claimBox.textContent(), /Who was this activity with\?/);
  await shot(page, "04-claim-box");
  await claimBox.locator("[data-testid=claim-person]", { hasText: "Eli Park" }).click();
  await until(async () => (await activity("Spoke to reception about parking", org)).contactId === "ctc_by_eli", "claimed for Eli");
  const claimed = await activity("Spoke to reception about parking", org);
  assert.equal(claimed.companyId, null, "the company link is cleared, like a touch logged on him");
  assert.equal(await status("Contact", "ctc_by_eli"), "CONTACTED", "Eli is Contacted now");
  const event = (await sql(`SELECT "contactId", "companyId" FROM "CalendarEvent" WHERE "activityId"=$1`, [claimed.id])).rows[0];
  assert.deepEqual(event, { contactId: "ctc_by_eli", companyId: "cmp_by_harbor" }, "the calendar entry follows");
  await until(async () => (await taylorGroup.locator("[data-testid=unclaimed-row]").count()) === 2, "two left");
  await page.goto(`${BASE}/dashboard/contacts/ctc_by_eli`);
  await page.locator("#activity li", { hasText: "Spoke to reception about parking" }).waitFor();

  log("a person from another company is refused");
  await page.goto(`${BASE}/dashboard/companies/cmp_by_harbor`);
  await taylorGroup.locator("[data-testid=claim-one]").first().click();
  const box2 = taylorGroup.locator("[data-testid=claim-box]");
  await box2.locator("input[type=search]").fill("Zed");
  await box2.getByText("Nobody here by that name.").waitFor();
  assert.equal(await box2.locator("[data-testid=claim-person]", { hasText: "Zed Stone" }).count(), 0, "not offered");
  await box2.getByLabel("Cancel claim").click();

  log("Claim all with a new contact added on the spot: both move onto them");
  await taylorGroup.locator("[data-testid=claim-all]").click();
  const allBox = taylorGroup.locator("[data-testid=claim-box]");
  assert.match(await allBox.textContent(), /Who was all 2 of Taylor Test's with\?/);
  await allBox.locator("[data-testid=claim-add]").click();
  await allBox.getByLabel("New contact name").fill("Pat Lee");
  await allBox.getByLabel("New contact email").fill("pat@harbordental.com");
  await allBox.locator("[data-testid=claim-add-save]").click();
  await until(async () => (await sql(`SELECT count(*)::int n FROM "Contact" WHERE "organizationId"=$1 AND name='Pat Lee'`, [org])).rows[0].n === 1, "Pat made");
  const pat = (await sql(`SELECT id, "companyId" FROM "Contact" WHERE "organizationId"=$1 AND name='Pat Lee'`, [org])).rows[0];
  assert.equal(pat.companyId, "cmp_by_harbor");
  await until(async () => (await activity("Left a brochure", org)).contactId === pat.id, "brochure claimed");
  assert.equal((await activity("Front desk said call back Monday", org)).contactId, pat.id);
  assert.equal(await status("Contact", pat.id), "CONTACTED");
  await until(async () => (await taylorGroup.count()) === 0, "Taylor's group gone");
  assert.equal(await nicGroup.count(), 1, "Nic's old one is still there to claim");
  await shot(page, "05-after-claims");

  log("Nic's old email, from before the rule, is claimable too");
  await nicGroup.locator("[data-testid=claim-one]").click();
  await nicGroup.locator("[data-testid=claim-person]", { hasText: "Dana Ruiz" }).click();
  await until(async () => (await activity("Old email to the office", org)).contactId === "ctc_by_dana", "old one claimed");
  await until(async () => (await other.count()) === 0, "Other Contacts gone when empty");

  log("Notes on the company page split: All 2 · Company 1 · People 1 · Personal 1");
  const tabs = page.locator("[data-testid=notes-tabs]");
  assert.deepEqual((await tabs.locator("button").allTextContents()).map((t) => t.replace(/\s+/g, "").trim()), ["All2", "Company1", "People1", "Personal1"]);
  await tabs.locator("[data-testid=notes-tab-company]").click();
  assert.deepEqual(await page.locator("[data-testid=note-row] p.text-sm").allTextContents(), ["They move buildings in March"]);
  await tabs.locator("[data-testid=notes-tab-people]").click();
  assert.deepEqual(await page.locator("[data-testid=note-row] p.text-sm").allTextContents(), ["Dana likes sailing"]);
  assert.match(await page.locator("[data-testid=note-row]").textContent(), /Dana Ruiz/);
  await shot(page, "06-notes-split");

  log("a contact's page keeps the plain All / Personal tabs");
  await page.goto(`${BASE}/dashboard/contacts/ctc_by_dana`);
  await page.locator("[data-testid=notes-tabs]").waitFor();
  assert.deepEqual((await page.locator("[data-testid=notes-tabs] button").allTextContents()).map((t) => t.replace(/\s+/g, "").trim()), ["All1", "Personal1"]);

  await browser.close();
  console.log(`\nAll ${step} steps passed. Screenshots in ${OUT}`);
  process.exit(0);
})().catch((err) => {
  console.error("\nFAILED at step", step, "\n", err);
  process.exit(1);
});
