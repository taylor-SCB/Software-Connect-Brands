/* Browser regression for Company Users + email marketing (Sept 27, 2026).
 *
 * Covers: adding a teammate and the invitation they receive, setting a
 * password from it, what a Member can't do, Marketing Templates with
 * merge chips, the Email window from a contact, from a marketing file,
 * from a template and from the Contacts list, "+ Add new contact" inside
 * it, the message that actually goes out (sender name, reply-to, filled
 * fields, attachment, footer address, unsubscribe header), the Activity
 * it logs, the 40-a-day counter and its refusal, unsubscribe (page,
 * one-click, duplicates), and removing and restoring a user.
 *
 * Stands up a catcher on :3999 like password-reset.cjs, so the server
 * must be started with RESEND_API_KEY, EMAIL_FROM and
 * RESEND_ENDPOINT=http://localhost:3999/emails in .env. Fake values are
 * right; nothing leaves the machine.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/scb_test \
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules \
 *   node scripts/browser-tests/email-marketing-users.cjs
 */
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS on purpose: NODE_PATH only resolves the global playwright for require() */
const http = require("node:http");
const { chromium } = require("playwright");
const { Client } = require("pg");
const assert = require("node:assert/strict");

const BASE = process.env.BASE || "http://localhost:3000";
const DB = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5433/scb_test";
const CATCHER_PORT = 3999;

const COMPANY = "Test Mail Co";
const SLUG_LIKE = "test-mail-co%";
const OWNER = { name: "Olive Owner", email: "owner@mailtest.example.com", password: "Owner-Password-1" };
const MEMBER = { name: "Max Member", email: "max@mailtest.example.com", password: "Member-Password-1" };

let step = 0;
const log = (m) => console.log(`[${String(++step).padStart(2, "0")}] ${m}`);

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

async function login(page, who) {
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', who.email);
  await page.fill('input[name="password"]', who.password);
  await page.click('button[type="submit"]');
}

(async () => {
  const db = new Client({ connectionString: DB });
  await db.connect();
  await db.query(`DELETE FROM "User" WHERE email LIKE '%@mailtest.example.com'`);
  await db.query(`DELETE FROM "Organization" WHERE slug LIKE $1`, [SLUG_LIKE]);

  const catcher = await startCatcher();
  const browser = await chromium.launch();
  const ownerCtx = await browser.newContext();
  const page = await ownerCtx.newPage();
  page.on("dialog", (dialog) => dialog.accept());

  log("sign up, activate, log in as the owner");
  await page.goto(`${BASE}/signup`);
  await page.fill('input[name="companyName"]', COMPANY);
  await page.fill('input[name="name"]', OWNER.name);
  await page.fill('input[name="email"]', OWNER.email);
  await page.fill('input[name="phone"]', "5551234567");
  await page.fill('input[name="password"]', OWNER.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/signup\/submitted/, { timeout: 20000 });
  await db.query(`UPDATE "Organization" SET status='ACTIVE' WHERE slug LIKE $1`, [SLUG_LIKE]);
  await login(page, OWNER);
  await page.waitForURL(/dashboard/, { timeout: 20000 });
  const org = (await db.query(`SELECT id FROM "Organization" WHERE slug LIKE $1`, [SLUG_LIKE])).rows[0];
  const ownerRow = (await db.query(`SELECT id FROM "User" WHERE email=$1`, [OWNER.email])).rows[0];

  log("the Email window refuses to send until the business address is filled in");
  await page.goto(`${BASE}/dashboard/contacts`);
  await page.click('button:has-text("Email")');
  await page.waitForSelector("text=Add your business address", { timeout: 20000 });
  await page.click('[role="dialog"] button[aria-label="Close"]');
  await db.query(
    `UPDATE "Organization" SET "addressLine1"='12 Main St', city='Austin', state='TX', "postalCode"='78701', phone='512-555-0100' WHERE id=$1`,
    [org.id],
  );

  log("the owner adds a Member and the invitation goes out as the business");
  await page.goto(`${BASE}/dashboard/settings/users`);
  await page.click('button:has-text("Add user")');
  await page.fill("#add-user-name", MEMBER.name);
  await page.fill("#add-user-email", MEMBER.email.toUpperCase());
  await page.fill("#add-user-title", "Estimator");
  await page.selectOption("#add-user-role", "MEMBER");
  await page.click('button:has-text("Add and send invitation")');
  await page.waitForSelector(`text=Invitation sent to ${MEMBER.email}`, { timeout: 20000 });
  await waitForMail(1);
  const invite = inbox[0];
  assert.equal(invite.to[0], MEMBER.email, "stored and sent lower-cased");
  assert.match(invite.from, new RegExp(`^"${COMPANY}" <`), "sent under the business's name");
  assert.equal(invite.reply_to, OWNER.email);
  assert.match(invite.subject, /Olive Owner added you to Test Mail Co/);
  assert.match(invite.text, /7 days/);
  const inviteLink = (invite.text.match(/https?:\/\/\S+\/reset-password\/\S+/) || [])[0];
  assert.ok(inviteLink, "the invitation carries a link");
  const memberRow = (await db.query(`SELECT id, role, "organizationId" FROM "User" WHERE email=$1`, [MEMBER.email])).rows[0];
  assert.equal(memberRow.role, "MEMBER");
  assert.equal(memberRow.organizationId, org.id);

  log("adding the same person again is refused, and the form keeps what was typed");
  await page.goto(`${BASE}/dashboard/settings/users`);
  await page.click('button:has-text("Add user")');
  await page.fill("#add-user-name", MEMBER.name);
  await page.fill("#add-user-email", MEMBER.email);
  await page.click('button:has-text("Add and send invitation")');
  await page.waitForSelector("text=already on the account", { timeout: 20000 });
  assert.equal(await page.inputValue("#add-user-email"), MEMBER.email);
  assert.equal(inbox.length, 1, "no second invitation");

  log("the invitation page says Set your password, and it works");
  const memberCtx = await browser.newContext();
  const m = await memberCtx.newPage();
  await m.goto(inviteLink);
  await m.waitForSelector("text=Set your password", { timeout: 20000 });
  await m.fill('input[name="password"]', MEMBER.password);
  await m.fill('input[name="confirm"]', MEMBER.password);
  await m.click('button[type="submit"]');
  await m.waitForSelector("text=/log in/i", { timeout: 20000 });
  await login(m, MEMBER);
  await m.waitForURL(/dashboard/, { timeout: 20000 });

  log("a Member sees the users but cannot add, upload or write templates");
  await m.goto(`${BASE}/dashboard/settings/users`);
  await m.waitForSelector('[data-testid="user-row"]');
  assert.equal(await m.locator('button:has-text("Add user")').count(), 0);
  assert.equal(await m.locator('button:has-text("Remove")').count(), 0);
  await m.goto(`${BASE}/dashboard/settings/marketing`);
  assert.equal(await m.locator('button:has-text("Upload")').count(), 0);
  assert.equal(await m.locator('a:has-text("New template")').count(), 0);
  await m.goto(`${BASE}/dashboard/settings/marketing/templates/new`);
  await m.waitForURL(/settings\/marketing$/, { timeout: 20000 });

  log("the owner uploads a marketing file");
  await page.goto(`${BASE}/dashboard/settings/marketing`);
  await page.setInputFiles('input[name="file"]', {
    name: "brochure.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 test brochure"),
  });
  await page.fill('input[name="name"]', "Spring Brochure");
  await page.click('button:has-text("Upload")');
  await page.waitForSelector("text=Spring Brochure", { timeout: 20000 });

  log("the owner writes a template, dropping fields in with the chips");
  await page.click('a:has-text("New template")');
  await page.fill("#tpl-name", "Spring promo");
  await page.fill("#tpl-subject", "A spring offer for ");
  await page.click('button.merge-chip:has-text("First Name")');
  await page.click("#tpl-body");
  await page.fill("#tpl-body", "Hi ");
  await page.click('button.merge-chip:has-text("First Name")');
  await page.locator("#tpl-body").press("End");
  await page.locator("#tpl-body").pressSequentially(",\n\nOur spring brochure is attached.\n\n");
  await page.click('button.merge-chip:has-text("Your Name")');
  assert.equal(await page.inputValue("#tpl-subject"), "A spring offer for {{first_name}}");
  assert.match(await page.inputValue("#tpl-body"), /^Hi \{\{first_name\}\},\n\nOur spring brochure is attached\.\n\n\{\{sender_name\}\}$/);
  await page.click('button:has-text("Save template")');
  await page.waitForURL(/settings\/marketing$/, { timeout: 20000 });
  await page.waitForSelector('[data-testid="marketing-template-row"]:has-text("Spring promo")');

  log("seed contacts: three with email, one without, one unsubscribed");
  const seed = async (name, email, optOut = false) =>
    (
      await db.query(
        `INSERT INTO "Contact" (id, "organizationId", name, email, "emailOptOutAt", "updatedAt")
         VALUES ('c' || md5(random()::text), $1, $2, $3, $4, now()) RETURNING id`,
        [org.id, name, email, optOut ? new Date() : null],
      )
    ).rows[0].id;
  const alice = await seed("Alice Adams", "alice@mailtest.example.com");
  await seed("Ben Brown", "ben@mailtest.example.com");
  await seed("Cara Cole", "cara@mailtest.example.com");
  await seed("Dan Nomail", null);
  await seed("Eve Gone", "eve@mailtest.example.com", true);

  log("Email from a contact: template, file, one person, the counter");
  await page.goto(`${BASE}/dashboard/contacts/${alice}`);
  await page.click('button:has-text("Email")');
  await page.waitForSelector('[data-testid="email-counter"]:has-text("0 of 40 sent today")', { timeout: 20000 });
  assert.match(await page.textContent('[data-testid="email-recipients"]'), /Alice Adams/);
  await page.selectOption("#email-template", { label: "Spring promo" });
  assert.equal(await page.inputValue("#email-subject"), "A spring offer for {{first_name}}");
  await page.click('button:has-text("Add Marketing File")');
  await page.click('label:has-text("Spring Brochure") input');
  await page.waitForSelector('[data-testid="email-attachments"]:has-text("Spring Brochure")');
  await page.click('[role="dialog"] button:has-text("Send")');
  await page.waitForSelector('[data-testid="email-outcome"]:has-text("Sent to 1 person")', { timeout: 30000 });
  await page.waitForSelector('[data-testid="email-counter"]:has-text("1 of 40 sent today")');
  await waitForMail(2);
  const promo = inbox[1];
  assert.equal(promo.to[0], "alice@mailtest.example.com");
  assert.match(promo.from, new RegExp(`^"${COMPANY}" <`));
  assert.equal(promo.reply_to, OWNER.email);
  assert.equal(promo.subject, "A spring offer for Alice");
  assert.match(promo.text, /^Hi Alice,\n\nOur spring brochure is attached\.\n\nOlive Owner/);
  assert.match(promo.text, /Test Mail Co · 12 Main St, Austin, TX 78701/, "the mailing address is in the footer");
  assert.equal(promo.attachments.length, 1);
  assert.equal(promo.attachments[0].filename, "brochure.pdf");
  assert.equal(Buffer.from(promo.attachments[0].content, "base64").toString(), "%PDF-1.4 test brochure");
  assert.match(promo.headers["List-Unsubscribe"], /\/u\/[\w-]+\/one-click>$/);
  assert.equal(promo.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  assert.ok(!/\{\{/.test(promo.html + promo.text), "no raw token reaches a customer");
  await page.click('button:has-text("Done")');
  const activity = await db.query(
    `SELECT type, body FROM "Activity" WHERE "contactId"=$1 AND "organizationId"=$2`,
    [alice, org.id],
  );
  assert.equal(activity.rows.length, 1);
  assert.equal(activity.rows[0].type, "EMAIL");
  assert.match(activity.rows[0].body, /Emailed “A spring offer for Alice” with brochure\.pdf/);
  await page.waitForSelector("text=Emailed “A spring offer for Alice”");

  log("Email from a marketing file: search and multi-pick; the no-email contact is skipped");
  await page.goto(`${BASE}/dashboard/settings/marketing`);
  await page.click('button[title="Email Spring Brochure"]');
  await page.waitForSelector('[data-testid="email-attachments"]:has-text("Spring Brochure")', { timeout: 20000 });
  await page.click('button:has-text("Search contacts")');
  await page.fill('input[aria-label="Search contacts to email"]', "b");
  await page.click('label:has-text("Ben Brown") input');
  await page.fill('input[aria-label="Search contacts to email"]', "cara");
  await page.click('label:has-text("Cara Cole") input');
  await page.fill('input[aria-label="Search contacts to email"]', "eve");
  await page.waitForSelector('label:has-text("Eve Gone"):has-text("unsubscribed")');
  await page.click('label:has-text("Eve Gone") input');
  await page.fill('input[aria-label="Search contacts to email"]', "dan");
  await page.click('label:has-text("Dan Nomail") input');
  await page.click('[role="dialog"] button:has-text("Done")');
  assert.match(await page.textContent('[data-testid="email-summary"]'), /Sends 2 emails · 37 left today after this/);
  await page.fill("#email-subject", "Our brochure");
  await page.fill("#email-body", "Hello {{first_name}} at {{contact_company}}.");
  await page.click('[role="dialog"] button:has-text("Send")');
  await page.waitForSelector('[data-testid="email-outcome"]:has-text("Sent to 2 people")', { timeout: 30000 });
  await waitForMail(4);
  assert.deepEqual(inbox.slice(2).map((mail) => mail.to[0]).sort(), ["ben@mailtest.example.com", "cara@mailtest.example.com"]);
  assert.match(inbox[2].text, /^Hello (Ben|Cara) at \.\n/, "a blank field fills in as nothing, not a token");
  assert.ok(inbox.slice(2).every((mail) => mail.attachments.length === 1), "each copy carries the file");
  await page.click('button:has-text("Done")');

  log("Email from a template row, with + Add new contact inside the window");
  await page.click('button[title="Email Spring promo"]');
  await page.waitForSelector('[data-testid="email-counter"]:has-text("3 of 40")', { timeout: 20000 });
  assert.equal(await page.inputValue("#email-subject"), "A spring offer for {{first_name}}");
  await page.click('button:has-text("+ Add new contact")');
  await page.fill('input[aria-label="New contact name"]', "Fran Fresh");
  await page.fill('input[aria-label="New contact email"]', "fran@mailtest.example.com");
  await page.click('button:has-text("Add to email")');
  await page.waitForSelector('[data-testid="email-recipients"]:has-text("Fran Fresh")');
  const fran = await db.query(`SELECT id FROM "Contact" WHERE "organizationId"=$1 AND email='fran@mailtest.example.com'`, [org.id]);
  assert.equal(fran.rows.length, 1, "the new contact is saved");
  await page.click('[role="dialog"] button:has-text("Send")');
  await page.waitForSelector('[data-testid="email-outcome"]:has-text("Sent to 1 person")', { timeout: 30000 });
  await waitForMail(5);
  assert.equal(inbox[4].subject, "A spring offer for Fran");
  await page.click('button:has-text("Done")');

  log("adding a contact whose address already exists hands back the existing one");
  const again = await page.evaluate(async () => {
    const response = await fetch("/dashboard/email/contact", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Fran Twin", email: "FRAN@mailtest.example.com" }),
    });
    return response.json();
  });
  assert.equal(again.existed, true);
  assert.equal(again.contact.name, "Fran Fresh");

  log("unsubscribe: opening the page changes nothing, the button does, and duplicates go too");
  await seed("Ben Twin", "BEN@mailtest.example.com");
  const benLink = (inbox.find((mail) => mail.to[0] === "ben@mailtest.example.com").text.match(/Unsubscribe: (\S+)/) || [])[1];
  const guest = await (await browser.newContext()).newPage();
  await guest.goto(benLink);
  await guest.waitForSelector("text=Stop emails from Test Mail Co to ben@mailtest.example.com?", { timeout: 20000 });
  let bens = await db.query(`SELECT "emailOptOutAt" FROM "Contact" WHERE "organizationId"=$1 AND lower(email)='ben@mailtest.example.com'`, [org.id]);
  assert.ok(bens.rows.every((row) => row.emailOptOutAt === null), "opening the link alone must not unsubscribe");
  await guest.click('button:has-text("Unsubscribe")');
  await guest.waitForSelector('[data-testid="unsubscribed"]', { timeout: 20000 });
  bens = await db.query(`SELECT "emailOptOutAt" FROM "Contact" WHERE "organizationId"=$1 AND lower(email)='ben@mailtest.example.com'`, [org.id]);
  assert.equal(bens.rows.length, 2);
  assert.ok(bens.rows.every((row) => row.emailOptOutAt !== null), "both Ben rows are unsubscribed");

  log("one-click unsubscribe from the mail client's own button");
  const caraHeader = inbox.find((mail) => mail.to[0] === "cara@mailtest.example.com").headers["List-Unsubscribe"].slice(1, -1);
  const oneClick = await fetch(caraHeader, { method: "POST", body: "List-Unsubscribe=One-Click" });
  assert.equal(oneClick.status, 200);
  const cara = await db.query(`SELECT "emailOptOutAt" FROM "Contact" WHERE "organizationId"=$1 AND email='cara@mailtest.example.com'`, [org.id]);
  assert.ok(cara.rows[0].emailOptOutAt, "Cara is unsubscribed");

  log("the server refuses to email someone who unsubscribed, even if asked directly");
  const caraId = (await db.query(`SELECT id FROM "Contact" WHERE "organizationId"=$1 AND email='cara@mailtest.example.com'`, [org.id])).rows[0].id;
  const refused = await page.evaluate(async (id) => {
    const response = await fetch("/dashboard/email/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contactIds: [id], subject: "x", body: "y", templateId: null, fileIds: [] }),
    });
    return response.json();
  }, caraId);
  assert.equal(refused.ok, false);
  assert.match(refused.error, /unsubscribed/);
  assert.equal(inbox.length, 5);

  log("the daily limit: 38 used leaves 2, three picked cannot be sent");
  await db.query(
    `INSERT INTO "EmailSend" (id, "organizationId", "userId", "toEmail", subject, "attachmentNames", status, "unsubscribeToken")
     SELECT 'es' || md5(random()::text), $1, $2, 'x@example.com', 'seeded', '{}', 'SENT', 'tok' || md5(random()::text)
     FROM generate_series(1, 34)`,
    [org.id, ownerRow.id],
  );
  const g1 = await seed("Gia One", "gia1@mailtest.example.com");
  const g2 = await seed("Gia Two", "gia2@mailtest.example.com");
  const g3 = await seed("Gia Three", "gia3@mailtest.example.com");
  await page.goto(`${BASE}/dashboard/contacts`);
  await page.click('button:has-text("Email")');
  await page.waitForSelector('[data-testid="email-counter"]:has-text("38 of 40 sent today")', { timeout: 20000 });
  await page.click('button:has-text("Search contacts")');
  await page.fill('input[aria-label="Search contacts to email"]', "gia");
  for (const name of ["Gia One", "Gia Two", "Gia Three"]) await page.click(`label:has-text("${name}") input`);
  await page.click('[role="dialog"] button:has-text("Done")');
  await page.fill("#email-subject", "Limit test");
  await page.fill("#email-body", "Body");
  assert.match(await page.textContent('[data-testid="email-summary"]'), /3 picked, but only 2 left today/);
  assert.ok(await page.locator('[role="dialog"] button:has-text("Send")').isDisabled());
  const over = await page.evaluate(async (ids) => {
    const response = await fetch("/dashboard/email/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contactIds: ids, subject: "x", body: "y", templateId: null, fileIds: [] }),
    });
    return response.json();
  }, [g1, g2, g3]);
  assert.equal(over.ok, false);
  assert.match(over.error, /3 emails and you have 2 left today/);
  assert.equal(inbox.length, 5, "a refused batch sends nothing at all");

  log("dropping to two sends them and the counter reads 40 of 40");
  await page.click('[data-testid="email-recipients"] button[aria-label="Remove Gia Three"]');
  await page.click('[role="dialog"] button:has-text("Send")');
  await page.waitForSelector('[data-testid="email-outcome"]:has-text("Sent to 2 people")', { timeout: 30000 });
  await page.waitForSelector('[data-testid="email-counter"]:has-text("40 of 40 sent today")');
  await waitForMail(7);
  await page.click('button:has-text("Done")');

  log("the member has their own allowance, and Company Users shows each count");
  await m.goto(`${BASE}/dashboard/contacts`);
  await m.click('button:has-text("Email")');
  await m.waitForSelector('[data-testid="email-counter"]:has-text("0 of 40 sent today")', { timeout: 20000 });
  await page.goto(`${BASE}/dashboard/settings/users`);
  assert.match(await page.textContent(`[data-testid="user-row"]:has-text("${OWNER.name}")`), /40 \/ 40/);
  assert.match(await page.textContent(`[data-testid="user-row"]:has-text("${MEMBER.name}")`), /0 \/ 40/);

  log("the owner makes the member an Admin, then removes them");
  const memberRowEl = page.locator(`[data-testid="user-row"]:has-text("${MEMBER.name}")`);
  await memberRowEl.locator("select").selectOption("ADMIN");
  await page.waitForSelector("text=is now an Admin", { timeout: 20000 });
  assert.equal((await db.query(`SELECT role FROM "User" WHERE id=$1`, [memberRow.id])).rows[0].role, "ADMIN");
  assert.equal(
    await page.locator(`[data-testid="user-row"]:has-text("${OWNER.name}") button:has-text("Remove")`).count(),
    0,
    "no controls on the owner's own row",
  );
  await memberRowEl.locator('button:has-text("Remove")').click();
  await memberRowEl.locator('button.btn-danger:has-text("Remove")').click();
  await page.waitForSelector("text=can no longer log in", { timeout: 20000 });

  log("a removed user is thrown out of their open session and cannot log back in");
  await m.goto(`${BASE}/dashboard`);
  await m.waitForURL(/login/, { timeout: 20000 });
  await login(m, MEMBER);
  await m.waitForSelector("text=taken off its workspace", { timeout: 20000 });
  const before = inbox.length;
  await m.goto(`${BASE}/forgot-password`);
  await m.fill('input[name="email"]', MEMBER.email);
  await m.click('button[type="submit"]');
  await m.waitForSelector("text=If that address has an account", { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(inbox.length, before, "no reset link for a removed login");

  log("their notes and activity stay; restoring them lets them back in");
  const kept = await db.query(`SELECT count(*)::int AS n FROM "User" WHERE id=$1`, [memberRow.id]);
  assert.equal(kept.rows[0].n, 1, "the row is kept, not deleted");
  await page.goto(`${BASE}/dashboard/settings/users`);
  await page.locator(`[data-testid="user-row"]:has-text("${MEMBER.name}") button:has-text("Restore")`).click();
  await page.waitForSelector("text=can log in again", { timeout: 20000 });
  await login(m, MEMBER);
  await m.waitForURL(/dashboard/, { timeout: 20000 });

  log("clean up the test workspace");
  await db.query(`DELETE FROM "Organization" WHERE id=$1`, [org.id]);
  await browser.close();
  catcher.close();
  await db.end();
  console.log("\nALL PASSED");
})().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
