/* Browser regression for account types and Admin Create Account
 * (Release 2, Oct 25, 2026).
 *
 * Covers: the four types at signup (Business / Vendor picked to start, a
 * refused signup keeping what was typed, a taken email in another case),
 * the operator console (the type on a pending row, Approve, Create
 * Account with a duplicate email refused and kept, the email the new
 * owner receives and setting a password from it, Resend invite killing
 * the old link, the type select, the "Waiting on you" count), Settings →
 * General (the type card, Request a change, two tabs racing for one open
 * request, Cancel, Decline, Approve, the operator's direct change
 * answering a matching request, a Member seeing no form), and the
 * "On Software Connect Brands" section of the three supplier pickers:
 * who is listed (approved Distributor / Hardware / OEM / Software
 * Provider accounts other than yourself; never a Business, a pending or
 * paused account), linking from the product form, Import Ratesheet (onto
 * a same-named supplier already on file, without doubling it) and a quote
 * line, the typed-name match, forged platform ids, and the phone layout.
 *
 * Stands up a catcher on :3999 like password-reset.cjs, so the server
 * must be started with RESEND_API_KEY, EMAIL_FROM and
 * RESEND_ENDPOINT=http://localhost:3999/emails in .env. Fake values are
 * right; nothing leaves the machine.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/scb_test \
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules \
 *   node scripts/browser-tests/account-types.cjs
 */
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS on purpose: NODE_PATH only resolves the global playwright for require() */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { chromium } = require("playwright");
const { Client } = require("pg");
const bcrypt = require("bcryptjs");
const assert = require("node:assert/strict");

const BASE = process.env.BASE || "http://localhost:3000";
const DB = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5433/scb_test";
const CATCHER_PORT = 3999;
const OUT = process.env.SHOTS_DIR || os.tmpdir();

const SLUG_LIKE = "test-at-%";
const DOMAIN = "attest.example.com";
const OPERATOR = { company: "Test AT Operator", name: "Opal Operator", email: `opal@${DOMAIN}`, password: "Operator-Pass-1" };
const SUPPLY = { company: "Test AT Supply", name: "Sid Supply", email: `sid@${DOMAIN}`, password: "Supply-Pass-1" };
const PENDING_OEM = { company: "Test AT Pending OEM", name: "Pat Pending", email: `pat@${DOMAIN}`, password: "Pending-Pass-1" };
const SPIRIT = { company: "Test AT Spirit", first: "Sam", last: "Spirit", email: `sam@${DOMAIN}`, password: "Spirit-Pass-1" };
const MEMBER = { name: "Mo Member", email: `mo@${DOMAIN}`, password: "Member-Pass-1" };

let step = 0;
const log = (m) => console.log(`[${String(++step).padStart(2, "0")}] ${m}`);

async function sql(text, params) {
  const client = new Client({ connectionString: DB });
  await client.connect();
  try {
    return await client.query(text, params);
  } finally {
    await client.end();
  }
}

const inbox = [];
function startCatcher() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        try {
          inbox.push(JSON.parse(body));
        } catch {
          inbox.push({ raw: body });
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: `caught-${inbox.length}` }));
      });
    });
    server.listen(CATCHER_PORT, () => resolve(server));
  });
}

async function waitForMail(count) {
  for (let i = 0; i < 100 && inbox.length < count; i++) await new Promise((r) => setTimeout(r, 200));
  assert.equal(inbox.length, count, `expected ${count} emails caught, got ${inbox.length}`);
}

const linkFrom = (mail) => (mail.text.match(/https?:\/\/\S+\/reset-password\/\S+/) || [])[0];

async function login(page, who) {
  await page.goto(`${BASE}/login`);
  await page.fill("#email", who.email);
  await page.fill("#password", who.password);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/dashboard$/, { timeout: 20000 });
}

async function logout(page) {
  await page.context().clearCookies();
}

async function signup(page, who, type) {
  await page.goto(`${BASE}/signup`);
  await page.fill('input[name="companyName"]', who.company);
  if (type) await page.check(`input[name="accountType"][value="${type}"]`);
  await page.fill('input[name="name"]', who.name);
  await page.fill('input[name="email"]', who.email);
  await page.fill('input[name="phone"]', "5551234567");
  await page.fill('input[name="password"]', who.password);
  await page.click('button[type="submit"]');
}

const orgNamed = async (name) =>
  (await sql(`SELECT * FROM "Organization" WHERE name=$1 AND slug LIKE $2`, [name, SLUG_LIKE])).rows[0];

// The labels of the "On Software Connect Brands" options in a select.
async function platformOptions(page, selector) {
  return page.locator(selector).evaluate((select) =>
    Array.from(select.querySelectorAll('optgroup[label="On Software Connect Brands"] option')).map((o) => o.textContent),
  );
}

async function createAccount(page, { company, type, first, last, email, phone }) {
  await page.goto(`${BASE}/admin`);
  const form = page.getByTestId("create-account-form");
  if (!(await form.isVisible())) await page.getByRole("button", { name: "Create Account" }).click();
  await page.fill("#create-company", company);
  await page.selectOption("#create-type", type);
  await page.fill("#create-first", first);
  await page.fill("#create-last", last);
  await page.fill("#create-email", email);
  if (phone) await page.fill("#create-phone", phone);
  await page.getByRole("button", { name: "Create and send link" }).click();
}

const row = (page, name) => page.locator("div.px-5.py-4", { has: page.getByRole("heading", { name, exact: true }) });

let browser;

(async () => {
  await sql(`DELETE FROM "Organization" WHERE slug LIKE $1`, [SLUG_LIKE]);
  await sql(`DELETE FROM "User" WHERE email LIKE $1`, [`%@${DOMAIN}`]);
  const catcher = await startCatcher();
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => console.error("pageerror:", error.message));

  /* ---------------------------------------------------------------- *
   * Signup
   * ---------------------------------------------------------------- */
  log("signup offers the four types, Business / Vendor picked to start");
  await page.goto(`${BASE}/signup`);
  const choices = page.getByTestId("signup-account-type");
  for (const label of ["Business / Vendor", "Distributor", "Hardware / OEM", "Software Provider"]) {
    assert.ok(await choices.getByText(label, { exact: true }).isVisible(), `${label} offered`);
  }
  assert.ok(await page.isChecked('input[name="accountType"][value="BUSINESS"]'));

  log("a refused signup keeps everything typed except the password, including the type");
  await signup(page, { ...SUPPLY, password: "short" }, "DISTRIBUTOR");
  await page.getByText("Password must be at least 8 characters").waitFor();
  assert.equal(await page.inputValue('input[name="companyName"]'), SUPPLY.company);
  assert.equal(await page.inputValue('input[name="name"]'), SUPPLY.name);
  assert.equal(await page.inputValue('input[name="email"]'), SUPPLY.email);
  assert.equal(await page.inputValue('input[name="phone"]'), "5551234567");
  assert.equal(await page.inputValue('input[name="password"]'), "");
  assert.ok(await page.isChecked('input[name="accountType"][value="DISTRIBUTOR"]'), "Distributor still picked");

  log("signing up as a Distributor waits for approval with the type saved");
  await page.fill('input[name="password"]', SUPPLY.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/signup\/submitted/, { timeout: 20000 });
  let supply = await orgNamed(SUPPLY.company);
  assert.equal(supply.status, "PENDING");
  assert.equal(supply.accountType, "DISTRIBUTOR");
  assert.equal(supply.createdById, null);
  assert.equal(
    Number((await sql(`SELECT count(*) FROM "ContractTemplate" WHERE "organizationId"=$1`, [supply.id])).rows[0].count),
    6,
    "the six built-in templates, as before",
  );

  log("a taken email in other capitals is refused as taken (it used to read 'try a different name')");
  await signup(page, { company: "Test AT Copycat", name: "Copy Cat", email: SUPPLY.email.toUpperCase(), password: "Copycat-Pass-1" });
  await page.getByText("An account with that email already exists").waitFor();
  assert.equal(await orgNamed("Test AT Copycat"), undefined);
  assert.equal(await page.inputValue('input[name="companyName"]'), "Test AT Copycat");

  await signup(page, PENDING_OEM, "HARDWARE_OEM");
  await page.waitForURL(/signup\/submitted/, { timeout: 20000 });

  /* ---------------------------------------------------------------- *
   * The operator console
   * ---------------------------------------------------------------- */
  log("the operator sees the type on a pending row, and Approve opens it");
  await signup(page, OPERATOR);
  await page.waitForURL(/signup\/submitted/, { timeout: 20000 });
  const operatorOrg = await orgNamed(OPERATOR.company);
  assert.equal(operatorOrg.accountType, "BUSINESS", "nothing picked is a Business / Vendor");
  await sql(`UPDATE "Organization" SET status='ACTIVE', "reviewedAt"=now() WHERE id=$1`, [operatorOrg.id]);
  await sql(`UPDATE "User" SET "isSuperAdmin"=true WHERE email=$1`, [OPERATOR.email]);
  const operatorId = (await sql(`SELECT id FROM "User" WHERE email=$1`, [OPERATOR.email])).rows[0].id;
  await login(page, OPERATOR);
  await page.goto(`${BASE}/admin`);
  const supplyRow = row(page, SUPPLY.company);
  assert.equal(await supplyRow.getByTestId("workspace-type-label").innerText(), "Distributor");
  assert.equal(await supplyRow.getByTestId("workspace-type").inputValue(), "DISTRIBUTOR");
  await supplyRow.getByRole("button", { name: "Approve" }).click();
  for (let i = 0; i < 50 && (await orgNamed(SUPPLY.company)).status !== "ACTIVE"; i++) await page.waitForTimeout(100);
  supply = await orgNamed(SUPPLY.company);
  assert.equal(supply.status, "ACTIVE");
  await sql(`UPDATE "Organization" SET city='Omaha', state='NE' WHERE id=$1`, [supply.id]);

  log("Create Account refuses an email that already has a login and keeps the form");
  await createAccount(page, {
    company: "Test AT Twice",
    type: "SOFTWARE_PROVIDER",
    first: "Tia",
    last: "Twice",
    email: SUPPLY.email.toUpperCase(),
  });
  await page.getByText(`That email already has a login, on ${SUPPLY.company}.`).waitFor();
  assert.equal(await page.inputValue("#create-company"), "Test AT Twice");
  assert.equal(await page.inputValue("#create-type"), "SOFTWARE_PROVIDER");
  assert.equal(await page.inputValue("#create-first"), "Tia");
  assert.equal(await page.inputValue("#create-last"), "Twice");
  assert.equal(await orgNamed("Test AT Twice"), undefined);

  log("Create Account opens an approved workspace and emails its owner a set-password link");
  const mailBefore = inbox.length;
  await createAccount(page, { company: SPIRIT.company, type: "BUSINESS", first: SPIRIT.first, last: SPIRIT.last, email: SPIRIT.email, phone: "4025550148" });
  await page.getByText(`${SPIRIT.company} is ready. A set-password link went to ${SPIRIT.email}.`).waitFor();
  assert.equal(await page.inputValue("#create-company"), "", "the form clears after a success");
  const spirit = await orgNamed(SPIRIT.company);
  assert.equal(spirit.status, "ACTIVE");
  assert.ok(spirit.reviewedAt, "reviewed when made");
  assert.equal(spirit.accountType, "BUSINESS");
  assert.equal(spirit.createdById, operatorId);
  const owner = (await sql(`SELECT * FROM "User" WHERE "organizationId"=$1`, [spirit.id])).rows;
  assert.equal(owner.length, 1);
  assert.equal(owner[0].role, "OWNER");
  assert.equal(owner[0].name, "Sam Spirit");
  assert.equal(owner[0].phone, "4025550148");
  assert.equal(
    Number((await sql(`SELECT count(*) FROM "ContractTemplate" WHERE "organizationId"=$1`, [spirit.id])).rows[0].count),
    6,
  );
  await waitForMail(mailBefore + 1);
  const ready = inbox[mailBefore];
  assert.equal(ready.to[0], SPIRIT.email);
  assert.match(ready.from, /^"Software Connect Brands" </);
  assert.equal(ready.reply_to, OPERATOR.email);
  assert.equal(ready.subject, `Your ${SPIRIT.company} account is ready`);
  assert.match(ready.text, /Opal Operator set up the Test AT Spirit account for you on Software Connect Brands/);
  assert.match(ready.text, /7 days/);
  const firstLink = linkFrom(ready);
  assert.ok(firstLink, "the email carries a set-password link");
  const spiritRow = row(page, SPIRIT.company);
  await spiritRow.getByText(`Created by ${OPERATOR.name} on`).waitFor();
  assert.ok(await spiritRow.getByRole("button", { name: "Resend invite" }).isVisible());
  assert.ok(!(await row(page, SUPPLY.company).getByRole("button", { name: "Resend invite" }).isVisible()), "a signup chose its own password");

  log("Resend invite sends a fresh link and the old one stops working");
  await spiritRow.getByRole("button", { name: "Resend invite" }).click();
  await spiritRow.getByText(`New link sent to ${SPIRIT.email}.`).waitFor();
  await waitForMail(mailBefore + 2);
  const secondLink = linkFrom(inbox[mailBefore + 1]);
  assert.notEqual(secondLink, firstLink);
  const ownerPage = await (await browser.newContext()).newPage();
  await ownerPage.goto(firstLink);
  await ownerPage.getByText("That link has already been used or has expired").waitFor();
  await ownerPage.goto(secondLink);
  await ownerPage.getByText("Set your password").waitFor();
  await ownerPage.fill('input[name="password"]', SPIRIT.password);
  await ownerPage.fill('input[name="confirm"]', SPIRIT.password);
  await ownerPage.click('button[type="submit"]');
  await ownerPage.getByText(/log in/i).first().waitFor();
  await login(ownerPage, SPIRIT);
  await page.goto(`${BASE}/admin`);
  assert.ok(!(await row(page, SPIRIT.company).getByRole("button", { name: "Resend invite" }).isVisible()), "gone once they've logged in");

  log("more accounts: a Software Provider and a Distributor listed, a Hardware / OEM paused");
  for (const account of [
    { company: "Test AT Cloud", type: "SOFTWARE_PROVIDER", first: "Cleo", last: "Cloud", email: `cleo@${DOMAIN}` },
    { company: "Test AT Wire", type: "DISTRIBUTOR", first: "Wes", last: "Wire", email: `wes@${DOMAIN}` },
    { company: "Test AT Bolt", type: "DISTRIBUTOR", first: "Bea", last: "Bolt", email: `bea@${DOMAIN}` },
    { company: "Test AT Gear", type: "HARDWARE_OEM", first: "Gus", last: "Gear", email: `gus@${DOMAIN}` },
  ]) {
    await createAccount(page, account);
    await page.getByText(`${account.company} is ready.`).waitFor();
  }
  await row(page, "Test AT Gear").getByRole("button", { name: "Pause" }).click();
  for (let i = 0; i < 50 && (await orgNamed("Test AT Gear")).status !== "PAUSED"; i++) await page.waitForTimeout(100);
  assert.equal((await orgNamed("Test AT Gear")).status, "PAUSED");

  log("the operator's type select changes a workspace's type at once");
  await row(page, SPIRIT.company).getByTestId("workspace-type").selectOption("DISTRIBUTOR");
  for (let i = 0; i < 50 && (await orgNamed(SPIRIT.company)).accountType !== "DISTRIBUTOR"; i++) await page.waitForTimeout(100);
  assert.equal((await orgNamed(SPIRIT.company)).accountType, "DISTRIBUTOR");
  await page.reload();
  assert.equal(await row(page, SPIRIT.company).getByTestId("workspace-type-label").innerText(), "Distributor");
  await row(page, SPIRIT.company).getByTestId("workspace-type").selectOption("BUSINESS");
  for (let i = 0; i < 50 && (await orgNamed(SPIRIT.company)).accountType !== "BUSINESS"; i++) await page.waitForTimeout(100);
  assert.equal((await orgNamed(SPIRIT.company)).accountType, "BUSINESS");

  /* ---------------------------------------------------------------- *
   * Settings → General: asking for a change
   * ---------------------------------------------------------------- */
  log("Settings → General shows the type; Request a change waits for the operator, who is emailed");
  await ownerPage.goto(`${BASE}/dashboard/settings/general`);
  const card = ownerPage.getByTestId("account-type-card");
  assert.equal(await card.getByTestId("account-type-current").innerText(), "Business / Vendor");
  await card.getByText("You're not listed as a supplier").waitFor();
  const mailBeforeRequest = inbox.length;
  await card.getByRole("button", { name: "Request a change" }).click();
  await ownerPage.selectOption("#account-type-to", "DISTRIBUTOR");
  await ownerPage.fill("#account-type-note", "We resell <b>40</b> lines");
  await card.getByRole("button", { name: "Send request" }).click();
  await card.getByTestId("account-type-waiting").waitFor();
  assert.match(await card.getByTestId("account-type-waiting").innerText(), /Business \/ Vendor → Distributor, asked .* by Sam Spirit/);
  const pending = (await sql(`SELECT * FROM "AccountTypeRequest" WHERE "organizationId"=$1`, [spirit.id])).rows;
  assert.equal(pending.length, 1);
  assert.equal(pending[0].status, "PENDING");
  assert.equal(pending[0].openFor, spirit.id);
  assert.equal(pending[0].fromType, "BUSINESS");
  assert.equal(pending[0].toType, "DISTRIBUTOR");
  assert.equal(pending[0].note, "We resell <b>40</b> lines");
  await waitForMail(mailBeforeRequest + 1);
  const notice = inbox[mailBeforeRequest];
  assert.equal(notice.to[0], OPERATOR.email);
  assert.equal(notice.subject, `Account type change — ${SPIRIT.company}`);
  assert.ok(notice.html.includes("&lt;b&gt;40&lt;/b&gt;"), "the note is escaped in the operator's email");
  assert.ok(!(await card.getByRole("button", { name: "Request a change" }).isVisible()), "one open request at a time");

  log("the operator console counts it as waiting and lists it");
  await page.goto(`${BASE}/admin`);
  const pendingSignups = Number(
    (await sql(`SELECT count(*) FROM "Organization" WHERE status='PENDING'`)).rows[0].count,
  );
  const pendingRequests = Number(
    (await sql(`SELECT count(*) FROM "AccountTypeRequest" WHERE status='PENDING'`)).rows[0].count,
  );
  assert.equal(
    await page.locator('[data-testid=stat-tile][data-label="Waiting on you"] p.num').innerText(),
    String(pendingSignups + pendingRequests),
    "signups and type changes both wait on the operator",
  );
  const requests = page.getByTestId("type-requests");
  const spiritRequest = requests.getByTestId("type-request").filter({ hasText: SPIRIT.company });
  assert.match(await spiritRequest.innerText(), /Business \/ Vendor → Distributor/);
  assert.match(await spiritRequest.innerText(), /We resell <b>40<\/b> lines/);

  log("Cancel takes it back; then two tabs asking at once leave exactly one open request");
  await card.getByRole("button", { name: "Cancel request" }).click();
  await card.getByText("Request cancelled.").waitFor();
  assert.equal((await sql(`SELECT status, "openFor" FROM "AccountTypeRequest" WHERE id=$1`, [pending[0].id])).rows[0].status, "CANCELLED");
  const tabB = await ownerPage.context().newPage();
  await tabB.goto(`${BASE}/dashboard/settings/general`);
  await ownerPage.reload();
  for (const tab of [ownerPage, tabB]) {
    await tab.getByTestId("account-type-card").getByRole("button", { name: "Request a change" }).click();
    await tab.selectOption("#account-type-to", "SOFTWARE_PROVIDER");
  }
  await Promise.all([
    ownerPage.getByTestId("account-type-card").getByRole("button", { name: "Send request" }).click(),
    tabB.getByTestId("account-type-card").getByRole("button", { name: "Send request" }).click(),
  ]);
  await tabB.waitForFunction(() => /already waiting|Waiting on approval/.test(document.body.innerText));
  await ownerPage.waitForFunction(() => /already waiting|Waiting on approval/.test(document.body.innerText));
  const open = (await sql(`SELECT * FROM "AccountTypeRequest" WHERE "organizationId"=$1 AND status='PENDING'`, [spirit.id])).rows;
  assert.equal(open.length, 1, "the database keeps one open request");
  await tabB.close();

  log("Decline leaves the type alone and the card says so");
  // A fresh load: going to /admin#type-requests from /admin only scrolls,
  // and the request on that old copy of the page was cancelled.
  await page.goto(`${BASE}/admin?at=decline#type-requests`);
  await page.getByTestId("type-request").filter({ hasText: SPIRIT.company }).first().getByRole("button", { name: "Decline" }).click();
  for (let i = 0; i < 50 && (await sql(`SELECT status FROM "AccountTypeRequest" WHERE id=$1`, [open[0].id])).rows[0].status === "PENDING"; i++) await page.waitForTimeout(100);
  assert.equal((await sql(`SELECT status, "openFor", "decidedById" FROM "AccountTypeRequest" WHERE id=$1`, [open[0].id])).rows[0].status, "DECLINED");
  assert.equal((await orgNamed(SPIRIT.company)).accountType, "BUSINESS");
  await ownerPage.reload();
  await ownerPage.getByTestId("account-type-answered").getByText(/Your change to Software Provider was declined on/).waitFor();
  assert.ok(await ownerPage.getByTestId("account-type-card").getByRole("button", { name: "Request a change" }).isVisible());

  log("Approve changes the type, and a second click on the same request changes nothing more");
  await ownerPage.getByTestId("account-type-card").getByRole("button", { name: "Request a change" }).click();
  await ownerPage.selectOption("#account-type-to", "SOFTWARE_PROVIDER");
  await ownerPage.getByTestId("account-type-card").getByRole("button", { name: "Send request" }).click();
  await ownerPage.getByTestId("account-type-waiting").waitFor();
  const approving = (await sql(`SELECT id FROM "AccountTypeRequest" WHERE "organizationId"=$1 AND status='PENDING'`, [spirit.id])).rows[0];
  await page.goto(`${BASE}/admin`);
  const approveForm = page.getByTestId("type-request").filter({ hasText: SPIRIT.company }).first();
  await approveForm.getByRole("button", { name: "Approve" }).click();
  for (let i = 0; i < 50 && (await orgNamed(SPIRIT.company)).accountType !== "SOFTWARE_PROVIDER"; i++) await page.waitForTimeout(100);
  assert.equal((await orgNamed(SPIRIT.company)).accountType, "SOFTWARE_PROVIDER");
  const approved = (await sql(`SELECT * FROM "AccountTypeRequest" WHERE id=$1`, [approving.id])).rows[0];
  assert.equal(approved.status, "APPROVED");
  assert.equal(approved.openFor, null);
  assert.equal(approved.decidedById, operatorId);
  await ownerPage.reload();
  assert.equal(await ownerPage.getByTestId("account-type-current").innerText(), "Software Provider");
  await ownerPage.getByText("Businesses on Software Connect Brands can pick you as a supplier").waitFor();

  log("the operator's direct change answers a waiting request for the same type");
  await ownerPage.getByTestId("account-type-card").getByRole("button", { name: "Request a change" }).click();
  await ownerPage.selectOption("#account-type-to", "BUSINESS");
  await ownerPage.getByTestId("account-type-card").getByRole("button", { name: "Send request" }).click();
  await ownerPage.getByTestId("account-type-waiting").waitFor();
  await page.goto(`${BASE}/admin`);
  await row(page, SPIRIT.company).getByTestId("workspace-type").selectOption("BUSINESS");
  for (let i = 0; i < 50 && (await orgNamed(SPIRIT.company)).accountType !== "BUSINESS"; i++) await page.waitForTimeout(100);
  const answered = (await sql(`SELECT status, "openFor" FROM "AccountTypeRequest" WHERE "organizationId"=$1 ORDER BY "createdAt" DESC LIMIT 1`, [spirit.id])).rows[0];
  assert.equal(answered.status, "APPROVED");
  assert.equal(answered.openFor, null);

  log("a Member sees the type but can't ask");
  await sql(
    `INSERT INTO "User" (id,name,email,"passwordHash",role,"organizationId") VALUES ('usr_at_member',$1,$2,$3,'MEMBER',$4)`,
    [MEMBER.name, MEMBER.email, await bcrypt.hash(MEMBER.password, 10), spirit.id],
  );
  const memberPage = await (await browser.newContext()).newPage();
  await login(memberPage, MEMBER);
  await memberPage.goto(`${BASE}/dashboard/settings/general`);
  assert.equal(await memberPage.getByTestId("account-type-current").innerText(), "Business / Vendor");
  await memberPage.getByText("Ask an owner or admin to request a change.").waitFor();
  assert.equal(await memberPage.getByRole("button", { name: "Request a change" }).count(), 0);
  await memberPage.context().close();

  /* ---------------------------------------------------------------- *
   * Suppliers on the platform
   * ---------------------------------------------------------------- */
  log("the product form lists approved supplier accounts, never a Business, a pending or paused one, or yourself");
  await ownerPage.goto(`${BASE}/dashboard/products/new`);
  let listed = await platformOptions(ownerPage, "#distributorId");
  assert.ok(listed.includes("Test AT Supply — Distributor · Omaha, NE"), `Supply listed: ${listed}`);
  assert.ok(listed.includes("Test AT Cloud — Software Provider"));
  assert.ok(listed.includes("Test AT Wire — Distributor"));
  for (const hidden of ["Test AT Gear", "Test AT Pending OEM", "Test AT Operator", "Test AT Spirit"]) {
    assert.ok(!listed.some((label) => label.startsWith(hidden)), `${hidden} is not listed`);
  }

  log("picking one on a product makes the supplier, linked and bridged to a company");
  await ownerPage.fill("#name", "AT Card Reader");
  await ownerPage.selectOption("#distributorId", `platform:${supply.id}`);
  await ownerPage.getByRole("button", { name: "Save product" }).click();
  await ownerPage.waitForURL(/\/dashboard\/products$/);
  const linkedSupply = (await sql(`SELECT * FROM "Distributor" WHERE "organizationId"=$1 AND "platformOrganizationId"=$2`, [spirit.id, supply.id])).rows;
  assert.equal(linkedSupply.length, 1);
  assert.equal(linkedSupply[0].name, SUPPLY.company);
  assert.ok(linkedSupply[0].companyId, "bridged to a company");
  const supplyCompany = (await sql(`SELECT "companyTypes" FROM "Company" WHERE id=$1`, [linkedSupply[0].companyId])).rows[0];
  assert.ok(supplyCompany.companyTypes.includes("Distributor"));
  const product = (await sql(`SELECT id, "distributorId" FROM "Product" WHERE "organizationId"=$1 AND name='AT Card Reader'`, [spirit.id])).rows[0];
  assert.equal(product.distributorId, linkedSupply[0].id);
  assert.equal(
    Number((await sql(`SELECT count(*) FROM "Distributor" WHERE "organizationId"=$1`, [supply.id])).rows[0].count),
    0,
    "nothing is written into the supplier's own workspace",
  );

  log("afterwards it's one of your suppliers, marked, and no longer in the platform list");
  await ownerPage.goto(`${BASE}/dashboard/products/${product.id}`);
  assert.equal(
    await ownerPage.locator("#distributorId option:checked").innerText(),
    "Test AT Supply · on Software Connect Brands",
  );
  listed = await platformOptions(ownerPage, "#distributorId");
  assert.ok(!listed.some((label) => label.startsWith("Test AT Supply")));

  log("saving an edit with a platform pick keeps the box on the saved supplier");
  await ownerPage.selectOption("#distributorId", `platform:${(await orgNamed("Test AT Wire")).id}`);
  await ownerPage.getByRole("button", { name: "Save changes" }).click();
  await ownerPage.getByText("Product saved").waitFor();
  const wireLocal = (await sql(`SELECT id FROM "Distributor" WHERE "organizationId"=$1 AND name='Test AT Wire'`, [spirit.id])).rows[0];
  assert.ok(wireLocal);
  assert.equal(await ownerPage.locator("#distributorId").inputValue(), wireLocal.id, "not a stale platform value");
  assert.equal(await ownerPage.locator("#distributorId option:checked").innerText(), "Test AT Wire · on Software Connect Brands");
  await ownerPage.getByRole("button", { name: "Save changes" }).click();
  await ownerPage.getByText("Product saved").waitFor();
  assert.equal(
    (await sql(`SELECT "distributorId" FROM "Product" WHERE id=$1`, [product.id])).rows[0].distributorId,
    wireLocal.id,
    "a second save keeps it",
  );

  log("+ Add new distributor with a platform supplier's name offers it rather than a stranger");
  await ownerPage.goto(`${BASE}/dashboard/products/new`);
  await ownerPage.fill("#name", "AT Bolt Kit");
  await ownerPage.selectOption("#distributorId", "__new__");
  await ownerPage.getByLabel("New distributor name").fill("test at bolt");
  await ownerPage.getByRole("button", { name: "Use Test AT Bolt (on Software Connect Brands)" }).click();
  const boltOrg = await orgNamed("Test AT Bolt");
  assert.equal(await ownerPage.locator("#distributorId").inputValue(), `platform:${boltOrg.id}`);
  await ownerPage.getByRole("button", { name: "Save product" }).click();
  await ownerPage.waitForURL(/\/dashboard\/products$/);
  assert.equal(
    (await sql(`SELECT count(*) FROM "Distributor" WHERE "organizationId"=$1 AND "platformOrganizationId"=$2`, [spirit.id, boltOrg.id])).rows[0].count,
    "1",
  );

  log("forged platform ids are refused: a Business, a pending account, a paused one");
  for (const forged of [operatorOrg.id, (await orgNamed(PENDING_OEM.company)).id, (await orgNamed("Test AT Gear")).id]) {
    await ownerPage.goto(`${BASE}/dashboard/products/new`);
    await ownerPage.fill("#name", "AT Forged");
    await ownerPage.locator("#distributorId").evaluate((select, id) => {
      const option = document.createElement("option");
      option.value = `platform:${id}`;
      option.textContent = "forged";
      select.appendChild(option);
    }, forged);
    await ownerPage.selectOption("#distributorId", `platform:${forged}`);
    await ownerPage.getByRole("button", { name: "Save product" }).click();
    await ownerPage.getByText("That company isn't listed on Software Connect Brands any more.").waitFor();
  }
  assert.equal((await sql(`SELECT count(*) FROM "Product" WHERE "organizationId"=$1 AND name='AT Forged'`, [spirit.id])).rows[0].count, "0");
  assert.equal(
    (await sql(`SELECT count(*) FROM "Distributor" WHERE "organizationId"=$1 AND "platformOrganizationId" = ANY($2)`, [spirit.id, [operatorOrg.id]])).rows[0].count,
    "0",
  );

  log("a supplier-type workspace sees the others but never itself, and can't link itself");
  const supplyPage = await (await browser.newContext()).newPage();
  await login(supplyPage, SUPPLY);
  await supplyPage.goto(`${BASE}/dashboard/products/new`);
  listed = await platformOptions(supplyPage, "#distributorId");
  assert.ok(listed.includes("Test AT Cloud — Software Provider"));
  assert.ok(!listed.some((label) => label.startsWith("Test AT Supply")), "not itself");
  await supplyPage.fill("#name", "AT Self");
  await supplyPage.locator("#distributorId").evaluate((select, id) => {
    const option = document.createElement("option");
    option.value = `platform:${id}`;
    select.appendChild(option);
  }, supply.id);
  await supplyPage.selectOption("#distributorId", `platform:${supply.id}`);
  await supplyPage.getByRole("button", { name: "Save product" }).click();
  await supplyPage.getByText("That company isn't listed on Software Connect Brands any more.").waitFor();
  assert.equal(
    (await sql(`SELECT count(*) FROM "Distributor" WHERE "organizationId"=$1 AND "platformOrganizationId"=$1`, [supply.id])).rows[0].count,
    "0",
    "no supplier record pointing at itself",
  );
  await supplyPage.context().close();

  log("Import Ratesheet links a platform supplier onto the same-named one already on file, not a second one");
  const cloudOrg = await orgNamed("Test AT Cloud");
  await sql(
    `INSERT INTO "Distributor" (id,"organizationId",name,"priceRule","priceRuleBasisPoints","updatedAt")
     VALUES ('dst_at_cloud',$1,'Test AT Cloud','MARGIN',2500,now())`,
    [spirit.id],
  );
  await sql(
    `INSERT INTO "DistributorContact" (id,"organizationId","distributorId",name,email) VALUES ('dc_at_cleo',$1,'dst_at_cloud','Cleo Rep','cleo.rep@example.com')`,
    [spirit.id],
  );
  await sql(
    `INSERT INTO "Product" (id,"organizationId",name,sku,"costCents","unitPriceCents","defaultTag","distributorId","updatedAt")
     VALUES ('prd_at_cloud',$1,'Cloud seat','CS-1',1000,1500,'SOFTWARE','dst_at_cloud',now())`,
    [spirit.id],
  );
  await ownerPage.goto(`${BASE}/dashboard/products`);
  await ownerPage.getByRole("button", { name: "Link Ratesheet" }).click();
  await ownerPage.getByRole("button", { name: /Import Ratesheet/ }).click();
  const csv = path.join(OUT, "at-cloud.csv");
  fs.writeFileSync(csv, "Part #,Description,Price,MSRP\nCS-1,Cloud seat,12,20\nCS-2,Cloud admin seat,30,45\n");
  await ownerPage.setInputFiles("#ratesheet-import-file", csv);
  await ownerPage.getByTestId("ratesheet-summary").waitFor();
  listed = await platformOptions(ownerPage, "#ratesheet-supplier");
  assert.ok(listed.includes("Test AT Cloud — Software Provider"), `Cloud listed in Who sent it: ${listed}`);
  await ownerPage.selectOption("#ratesheet-supplier", `platform:${cloudOrg.id}`);
  // It is the Test AT Cloud already on file: its pricing and its people.
  assert.equal(await ownerPage.inputValue("#ratesheet-rule"), "MARGIN", "the supplier's remembered rule");
  assert.equal(await ownerPage.inputValue("#ratesheet-percent"), "25");
  await ownerPage.selectOption("#ratesheet-contact", "dc_at_cleo");
  await ownerPage.getByTestId("ratesheet-import").click();
  await ownerPage.getByTestId("ratesheet-done").waitFor();
  const clouds = (await sql(`SELECT * FROM "Distributor" WHERE "organizationId"=$1 AND lower(name)='test at cloud'`, [spirit.id])).rows;
  assert.equal(clouds.length, 1, "one supplier, not two");
  assert.equal(clouds[0].id, "dst_at_cloud");
  assert.equal(clouds[0].platformOrganizationId, cloudOrg.id);
  const seats = (await sql(`SELECT sku, "costCents", "distributorId" FROM "Product" WHERE "organizationId"=$1 AND sku LIKE 'CS-%' ORDER BY sku`, [spirit.id])).rows;
  assert.deepEqual(
    seats.map((seat) => [seat.sku, seat.costCents, seat.distributorId]),
    [
      ["CS-1", 1200, "dst_at_cloud"],
      ["CS-2", 3000, "dst_at_cloud"],
    ],
    "the existing product updated, the new one added, both on the one supplier",
  );
  assert.equal((await sql(`SELECT "priceRule" FROM "Distributor" WHERE id='dst_at_cloud'`)).rows[0].priceRule, "MARGIN");
  assert.equal(
    (await sql(`SELECT count(*) FROM "_DistributorContactToProduct" j JOIN "Product" p ON p.id=j."B" WHERE j."A"='dc_at_cleo' AND p.sku='CS-2'`)).rows[0].count,
    "1",
    "the picked point of contact is on the new product",
  );
  assert.equal(
    (await sql(`SELECT count(*) FROM "DistributorContact" WHERE "distributorId"='dst_at_cloud'`)).rows[0].count,
    "1",
    "nobody doubled",
  );

  log("a quote line links a platform supplier on the spot and saves its company");
  await sql(
    `INSERT INTO "Contact" (id,"organizationId",name,"updatedAt") VALUES ('ctc_at',$1,'Quinn Customer',now())`,
    [spirit.id],
  );
  await sql(
    `INSERT INTO "Deal" (id,"organizationId","contactId",title,stage,"updatedAt") VALUES ('deal_at',$1,'ctc_at','AT job','QUOTE_SENT',now())`,
    [spirit.id],
  );
  await sql(
    `INSERT INTO "Quote" (id,"organizationId","contactId","dealId",number,title,status,"publicToken","updatedAt")
     VALUES ('quo_at',$1,'ctc_at','deal_at',1000,'AT quote','DRAFT','tok_quo_at_0123456789',now())`,
    [spirit.id],
  );
  await sql(`UPDATE "Organization" SET "nextQuoteNumber"=1001 WHERE id=$1`, [spirit.id]);
  await sql(
    `INSERT INTO "QuoteLineItem" (id,"quoteId",name,quantity,"unitPriceCents",tag,position) VALUES ('li_at','quo_at','Panel',1,10000,'MATERIALS',0)`,
  );
  // A fresh distributor-type account to link from the line.
  await createAccount(page, { company: "Test AT Panel", type: "DISTRIBUTOR", first: "Pia", last: "Panel", email: `pia@${DOMAIN}` });
  await page.getByText("Test AT Panel is ready.").waitFor();
  const panelOrg = await orgNamed("Test AT Panel");
  await ownerPage.goto(`${BASE}/dashboard/quotes/quo_at`);
  listed = await platformOptions(ownerPage, '[data-testid="line-supplier"]');
  assert.ok(listed.includes("Test AT Panel — Distributor"), `Panel listed on the line: ${listed}`);
  assert.ok(!listed.some((label) => label.startsWith("Test AT Supply")), "already linked, so not offered again");
  // Arrow keys move a closed select one option at a time, each a change:
  // running past a platform account must ask, not link it.
  const lineSupplier = ownerPage.getByLabel("Line 1 supplier", { exact: true });
  await lineSupplier.focus();
  for (let i = 0; i < 30 && !(await ownerPage.getByTestId("line-supplier-confirm").isVisible()); i++) {
    await ownerPage.keyboard.press("ArrowDown");
  }
  await ownerPage.getByTestId("line-supplier-confirm").waitFor();
  const linkedSoFar = Number(
    (await sql(`SELECT count(*) FROM "Distributor" WHERE "organizationId"=$1 AND "platformOrganizationId" IS NOT NULL`, [spirit.id])).rows[0].count,
  );
  await ownerPage.getByTestId("line-supplier-confirm").getByRole("button", { name: "Cancel" }).click();
  await lineSupplier.selectOption("");
  await lineSupplier.selectOption(`platform:${panelOrg.id}`);
  await ownerPage.getByTestId("line-supplier-confirm").getByText("Link Test AT Panel as a supplier?").waitFor();
  assert.equal(
    Number((await sql(`SELECT count(*) FROM "Distributor" WHERE "organizationId"=$1 AND "platformOrganizationId" IS NOT NULL`, [spirit.id])).rows[0].count),
    linkedSoFar,
    "nothing linked until Link is clicked",
  );
  assert.equal(
    (await sql(`SELECT count(*) FROM "Company" WHERE "organizationId"=$1 AND name='Test AT Panel'`, [spirit.id])).rows[0].count,
    "0",
    "no company written by passing over it",
  );
  await ownerPage.getByTestId("line-supplier-confirm").getByRole("button", { name: "Link" }).click();
  await ownerPage.waitForFunction(
    () => document.querySelector('[data-testid="line-supplier"]')?.selectedOptions[0]?.textContent?.includes("on Software Connect Brands"),
  );
  await ownerPage.getByRole("button", { name: "Save line items" }).click();
  await ownerPage.getByText("Line items saved", { exact: true }).waitFor();
  const panelLocal = (await sql(`SELECT * FROM "Distributor" WHERE "organizationId"=$1 AND "platformOrganizationId"=$2`, [spirit.id, panelOrg.id])).rows[0];
  assert.ok(panelLocal?.companyId);
  assert.equal((await sql(`SELECT "supplierCompanyId" FROM "QuoteLineItem" WHERE id='li_at'`)).rows[0].supplierCompanyId, panelLocal.companyId);
  listed = await platformOptions(ownerPage, '[data-testid="line-supplier"]');
  assert.ok(!listed.some((label) => label.startsWith("Test AT Panel")), "out of the platform list once linked");

  log("adding a supplier by name never moves one already bridged onto an older same-named company");
  const boltLocal = (await sql(`SELECT id, "companyId" FROM "Distributor" WHERE "organizationId"=$1 AND "platformOrganizationId"=$2`, [spirit.id, boltOrg.id])).rows[0];
  await sql(
    `INSERT INTO "Company" (id,"organizationId",name,"createdAt","updatedAt") VALUES ('cmp_at_oldbolt',$1,'TEST AT BOLT',now() - interval '1 year',now())`,
    [spirit.id],
  );
  await ownerPage.reload();
  await ownerPage.getByLabel("Line 1 supplier", { exact: true }).selectOption("__new__");
  await ownerPage.getByLabel("Line 1 supplier new name", { exact: true }).fill("Test AT Bolt");
  await ownerPage.getByRole("button", { name: "Add", exact: true }).click();
  await ownerPage.getByLabel("Line 1 supplier", { exact: true }).waitFor();
  const boltAfter = (await sql(`SELECT "companyId" FROM "Distributor" WHERE id=$1`, [boltLocal.id])).rows[0];
  assert.equal(boltAfter.companyId, boltLocal.companyId, "the bridge stayed where it was");
  const oldBolt = (await sql(`SELECT "companyTypes" FROM "Company" WHERE id='cmp_at_oldbolt'`)).rows[0];
  assert.deepEqual(oldBolt.companyTypes, [], "the older company wasn't turned into a supplier");

  log("merging the linked supplier's company into another keeps the link, on the kept supplier");
  const wireOrg = await orgNamed("Test AT Wire");
  await sql(
    `INSERT INTO "Company" (id,"organizationId",name,city,state,"companyTypes",industries,"updatedAt")
     VALUES ('cmp_at_wireltd',$1,'Test AT Wire Ltd','Dallas','TX',ARRAY['Distributor'],ARRAY['Service Provider'],now())`,
    [spirit.id],
  );
  await sql(
    `INSERT INTO "Distributor" (id,"organizationId",name,"companyId","updatedAt") VALUES ('dst_at_wireltd',$1,'Test AT Wire Ltd','cmp_at_wireltd',now())`,
    [spirit.id],
  );
  const wireBefore = (await sql(`SELECT id FROM "Distributor" WHERE "organizationId"=$1 AND "platformOrganizationId"=$2`, [spirit.id, wireOrg.id])).rows[0];
  await ownerPage.goto(`${BASE}/dashboard/companies`);
  await ownerPage.locator("[data-testid=merge-open]").click();
  const merge = ownerPage.locator("[data-testid=merge-dialog]");
  await merge.locator("[data-testid=merge-search]").fill("Test AT Wire");
  const mergeResults = merge.locator("[data-testid=merge-results] label");
  await mergeResults.filter({ hasText: "Dallas, TX" }).locator("input").check();
  await mergeResults.filter({ hasNotText: "Dallas, TX" }).first().locator("input").check();
  await merge.locator("[data-testid=merge-picked] label", { hasText: "Dallas, TX" }).locator("input[type=radio]").check();
  await merge.locator("[data-testid=merge-go]").click();
  await merge.locator("[data-testid=merge-yes]").click();
  await ownerPage.waitForURL(/\/dashboard\/companies\/cmp_at_wireltd$/);
  const kept = (await sql(`SELECT "platformOrganizationId", "platformLinkedAs" FROM "Distributor" WHERE id='dst_at_wireltd'`)).rows[0];
  assert.equal(kept.platformOrganizationId, wireOrg.id, "the kept supplier carries the link");
  assert.match(kept.platformLinkedAs, /^Test AT Wire — Distributor/);
  assert.equal((await sql(`SELECT "platformOrganizationId" FROM "Distributor" WHERE id=$1`, [wireBefore.id])).rows[0].platformOrganizationId, null);

  log("a linked supplier whose account is paused loses the mark, and isn't offered to link");
  await page.goto(`${BASE}/admin`);
  await row(page, SUPPLY.company).getByRole("button", { name: "Pause" }).click();
  for (let i = 0; i < 50 && (await orgNamed(SUPPLY.company)).status !== "PAUSED"; i++) await page.waitForTimeout(100);
  await ownerPage.goto(`${BASE}/dashboard/products/${product.id}`);
  const supplyLabel = await ownerPage.locator("#distributorId option", { hasText: SUPPLY.company }).innerText();
  assert.equal(supplyLabel, SUPPLY.company, "no '· on Software Connect Brands' on a paused account");
  assert.ok(!(await platformOptions(ownerPage, "#distributorId")).some((label) => label.startsWith(SUPPLY.company)));
  await page.goto(`${BASE}/admin`);
  await row(page, SUPPLY.company).getByRole("button", { name: "Unpause" }).click();
  for (let i = 0; i < 50 && (await orgNamed(SUPPLY.company)).status !== "ACTIVE"; i++) await page.waitForTimeout(100);

  log("the operator's direct change declines a waiting request for a different type");
  await ownerPage.goto(`${BASE}/dashboard/settings/general`);
  await ownerPage.getByTestId("account-type-card").getByRole("button", { name: "Request a change" }).click();
  await ownerPage.selectOption("#account-type-to", "DISTRIBUTOR");
  await ownerPage.getByTestId("account-type-card").getByRole("button", { name: "Send request" }).click();
  await ownerPage.getByTestId("account-type-waiting").waitFor();
  await page.goto(`${BASE}/admin`);
  await row(page, SPIRIT.company).getByTestId("workspace-type").selectOption("HARDWARE_OEM");
  for (let i = 0; i < 50 && (await orgNamed(SPIRIT.company)).accountType !== "HARDWARE_OEM"; i++) await page.waitForTimeout(100);
  const stale = (await sql(`SELECT status, "openFor" FROM "AccountTypeRequest" WHERE "organizationId"=$1 ORDER BY "createdAt" DESC LIMIT 1`, [spirit.id])).rows[0];
  assert.equal(stale.status, "DECLINED");
  assert.equal(stale.openFor, null);
  await page.goto(`${BASE}/admin`);
  await row(page, SPIRIT.company).getByTestId("workspace-type").selectOption("BUSINESS");
  for (let i = 0; i < 50 && (await orgNamed(SPIRIT.company)).accountType !== "BUSINESS"; i++) await page.waitForTimeout(100);

  log("asking over and over emails the operator the first three times an hour, not every time");
  const askedEmails = inbox.filter((mail) => mail.subject === `Account type change — ${SPIRIT.company}`).length;
  const askedRequests = Number(
    (await sql(`SELECT count(*) FROM "AccountTypeRequest" WHERE "organizationId"=$1`, [spirit.id])).rows[0].count,
  );
  assert.ok(askedRequests > 3, `asked ${askedRequests} times`);
  assert.equal(askedEmails, 3);

  log("an operator taken off their workspace is out of the console too");
  await sql(`UPDATE "User" SET "removedAt"=now() WHERE id=$1`, [operatorId]);
  assert.equal((await page.goto(`${BASE}/admin`)).status(), 404);
  await sql(`UPDATE "User" SET "removedAt"=NULL WHERE id=$1`, [operatorId]);

  /* ---------------------------------------------------------------- *
   * Phone
   * ---------------------------------------------------------------- */
  log("phone: signup, the type card and Create Account fit without sideways scrolling");
  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const fits = async (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  await phone.goto(`${BASE}/signup`);
  assert.ok(await fits(phone), "signup fits");
  await login(phone, SPIRIT);
  await phone.goto(`${BASE}/dashboard/settings/general`);
  await phone.getByTestId("account-type-card").getByRole("button", { name: "Request a change" }).click();
  assert.ok(await fits(phone), "the type card fits");
  await phone.screenshot({ path: path.join(OUT, "at-phone-settings.png"), fullPage: false });
  await phone.context().clearCookies();
  await login(phone, OPERATOR);
  await phone.goto(`${BASE}/admin`);
  await phone.getByRole("button", { name: "Create Account" }).click();
  assert.ok(await fits(phone), "Create Account fits");
  await phone.screenshot({ path: path.join(OUT, "at-phone-admin.png"), fullPage: false });
  await phone.context().close();

  // KEEP=1 leaves the workspaces behind to look at.
  if (!process.env.KEEP) await sql(`DELETE FROM "Organization" WHERE slug LIKE $1`, [SLUG_LIKE]);
  await browser.close();
  catcher.close();
  console.log(`\nAll ${step} steps passed.`);
})().catch(async (error) => {
  console.error(error);
  if (browser) await browser.close().catch(() => {});
  process.exit(1);
});
