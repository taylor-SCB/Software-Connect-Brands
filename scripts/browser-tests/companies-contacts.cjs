/* Browser regression for Companies + Contacts v1.
 *
 * Covers: the Companies module, contact title / city / state / birthday,
 * the company picker on a contact, every quote living on a deal (picker,
 * "+ Add new deal", several quotes per deal), the six-stage pipeline and
 * its automatic moves, deal value read from quotes, "how I got there is
 * how I go back", notes with labels and the Personal view, logging one
 * note or call on several contacts at once, the Activity overview box,
 * and company roll-ups.
 *
 * Runs against a built app (`npm run build:app && npx next start`) and a
 * local Postgres that has had `prisma migrate deploy` run against it. It
 * signs up its own workspace, activates it with SQL, and deletes it again
 * on the next run, so it never touches real data. Never point it at the
 * live database.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/scb_test \
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules \
 *   node scripts/browser-tests/companies-contacts.cjs
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
const OUT = process.env.SHOTS_DIR || path.join(os.tmpdir(), "scb-browser-shots-cc");
fs.mkdirSync(OUT, { recursive: true });

const EMAIL = "test-cc@example.com";
const PASSWORD = "password123";
const COMPANY = "Test Companies Co";

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
// The Back link at the top of a page.
function backLink(page) {
  return page.locator("main a.faint.mb-3").first();
}

(async () => {
  await sql(`DELETE FROM "Organization" WHERE slug LIKE 'test-companies-co%'`);

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
  await sql(`UPDATE "Organization" SET status='ACTIVE', "reviewedAt"=now() WHERE slug LIKE 'test-companies-co%'`);
  await login(page);

  log("Companies is in the sidebar and starts empty");
  await page.locator("aside").getByRole("link", { name: "Companies" }).click();
  await page.waitForURL(/\/dashboard\/companies$/);
  await page.getByText("No companies yet").waitFor();

  log("create a contact, typing a brand-new company into the picker, with title / birthday / city / state");
  await page.goto(`${BASE}/dashboard/contacts/new`);
  await page.fill("#companyName", "Spirit Communications");
  await page.getByText("New company").waitFor();
  await page.fill("#name", "Danny Ortiz");
  await page.fill("#title", "Owner");
  await page.fill("#email", "danny@spirit.com");
  await page.fill("#phone", "555-0101");
  await page.fill("#birthday", "1984-03-09");
  await page.fill("#city", "Columbia");
  await page.fill("#state", "SC");
  await shot(page, "01-contact-form");
  await page.getByRole("button", { name: "Save contact" }).click();
  await page.waitForURL(/\/dashboard\/contacts\/(?!new$)[a-z0-9]+$/);
  const dannyUrl = page.url();
  await page.getByRole("heading", { name: "Danny Ortiz" }).waitFor();
  assert.ok(await page.getByText("Owner").first().isVisible(), "title under the name");
  const details = page.locator("dl").first();
  assert.ok(await details.getByRole("link", { name: "Spirit Communications" }).isVisible(), "company is a link in Details");
  assert.ok(await details.getByText("Mar 9, 1984").isVisible(), "birthday shown");
  const labels = await details.locator("dt").allTextContents();
  assert.deepEqual(labels.slice(-2), ["City", "State"], "city and state are the last two lines of Details");
  assert.ok(await page.getByText("Activity overview").isVisible(), "overview box present");
  assert.ok(await page.getByText("Never").isVisible(), "no touches yet");
  await shot(page, "02-contact-page");

  log("Companies list has the company with 1 person; company page lists Danny");
  await page.goto(`${BASE}/dashboard/companies`);
  const spiritRow = page.locator("tr", { hasText: "Spirit Communications" });
  await spiritRow.waitFor();
  assert.ok(await spiritRow.getByRole("link", { name: "1" }).isVisible(), "people count 1");
  await spiritRow.getByRole("link", { name: "Spirit Communications" }).click();
  await page.waitForURL(/\/dashboard\/companies\/[a-z0-9]+$/);
  const spiritUrl = page.url();
  await page.getByRole("heading", { name: "Spirit Communications" }).waitFor();
  const people = page.locator("#people");
  assert.ok(await people.getByText("Danny Ortiz").isVisible());
  assert.ok(await people.getByText(/Owner/).isVisible(), "title shown under the person");

  log("+ Add person from the company page pre-fills the company; picker says Existing");
  await page.getByRole("link", { name: "Add person" }).click();
  await page.waitForURL(/\/dashboard\/contacts\/new\?companyId=/);
  assert.equal(await page.locator("#companyName").inputValue(), "Spirit Communications");
  await page.getByText("Existing").waitFor();
  await page.fill("#name", "Sara Lee");
  await page.fill("#title", "Office Manager");
  await page.getByRole("button", { name: "Save contact" }).click();
  await page.waitForURL(/\/dashboard\/contacts\/(?!new$)[a-z0-9]+$/);
  const saraUrl = page.url();
  const companies = await sql(`SELECT count(*)::int AS n FROM "Company" WHERE name ILIKE 'spirit communications'`);
  assert.equal(companies.rows[0].n, 1, "typing the same company twice makes one company");

  log("a residential contact needs no company");
  await page.goto(`${BASE}/dashboard/contacts/new`);
  await page.fill("#name", "Resi Homeowner");
  await page.fill("#city", "Lexington");
  await page.fill("#state", "SC");
  await page.getByRole("button", { name: "Save contact" }).click();
  await page.waitForURL(/\/dashboard\/contacts\/(?!new$)[a-z0-9]+$/);
  const resiUrl = page.url();

  log("contacts list: company column links to the company, title under the name");
  await page.goto(`${BASE}/dashboard/contacts`);
  const dannyRow = page.locator("tr", { hasText: "Danny Ortiz" });
  assert.ok(await dannyRow.getByRole("link", { name: "Spirit Communications" }).isVisible());
  assert.ok(await dannyRow.getByText("Owner").isVisible());
  await page.fill("[name=q]", "spirit");
  await page.press("[name=q]", "Enter");
  await page.waitForURL(/q=spirit/);
  assert.equal(await page.locator("tbody tr").count(), 2, "search matches by company name, case-insensitive");
  await shot(page, "03-contacts-list");

  log("new quote from a contact: customer preselected, deal typed as new via + Add new deal");
  await page.goto(dannyUrl);
  await page.getByRole("link", { name: "New quote" }).first().click();
  await page.waitForURL(/\/dashboard\/quotes\/new\?contactId=/);
  assert.ok((await page.locator("#contactId option:checked").textContent()).includes("Danny Ortiz"));
  await page.fill("#dealTitle", "Fiber install");
  await page.getByRole("button", { name: "Add new deal" }).click();
  await page.getByText("will be created as a new deal").waitFor();
  await page.fill("#title", "Fiber install — option A");
  await shot(page, "04-new-quote");
  await page.getByRole("button", { name: "Create quote" }).click();
  await page.waitForURL(/\/dashboard\/quotes\/(?!new$)[a-z0-9]+$/);
  const quoteAUrl = page.url();
  assert.ok(await page.getByText(/QUO-1000 · Fiber install · Spirit Communications/).isVisible(), "eyebrow carries the deal");

  log("how I got there is how I go back: Back on the quote says Danny Ortiz, not Quotes");
  await backLink(page).getByText("Danny Ortiz").waitFor();
  await shot(page, "05-quote-back-to-contact");
  await backLink(page).click();
  await page.waitForURL(dannyUrl);
  const dealsCard = page.locator("div.card", { hasText: "a deal is one job" });
  assert.ok(await dealsCard.getByText("Fiber install").first().isVisible(), "deal appears on the contact");
  assert.ok(await dealsCard.getByText("1 quote").isVisible());
  assert.ok(await dealsCard.getByText("Lead").isVisible(), "new deal starts at Lead");
  const quotesCard = page.locator("div.card", { hasText: "QUO-1000" });
  assert.ok(await quotesCard.getByText("QUO-1000 · Fiber install").isVisible(), "quote row names its deal");

  log("second quote on the same deal from the deal row; the picker shows the existing deal");
  await dealsCard.getByRole("link", { name: "Quote" }).click();
  await page.waitForURL(/dealId=/);
  assert.equal(await page.locator("#dealTitle").inputValue(), "Fiber install");
  await page.getByText("Lead", { exact: true }).waitFor();
  await page.fill("#title", "Fiber install — option B");
  await page.getByRole("button", { name: "Create quote" }).click();
  await page.waitForURL(/\/dashboard\/quotes\/(?!new$)[a-z0-9]+$/);
  const quoteBUrl = page.url();
  const dealCount = await sql(`SELECT count(*)::int AS n FROM "Deal" WHERE title='Fiber install'`);
  assert.equal(dealCount.rows[0].n, 1, "two quotes, one deal");

  log("typing an existing deal name without clicking it still lands on that deal");
  await page.goto(`${BASE}/dashboard/quotes/new?contactId=${dannyUrl.split("/").pop()}`);
  await page.fill("#dealTitle", "fiber INSTALL");
  await page.getByRole("button", { name: "Add new deal" }).click();
  await page.fill("#title", "Fiber install — option C");
  await page.getByRole("button", { name: "Create quote" }).click();
  await page.waitForURL(/\/dashboard\/quotes\/(?!new$)[a-z0-9]+$/);
  const quoteCUrl = page.url();
  const dealCount2 = await sql(`SELECT count(*)::int AS n FROM "Deal" WHERE title ILIKE 'fiber install'`);
  assert.equal(dealCount2.rows[0].n, 1, "name match is case-insensitive");

  log("Back from the quote list goes to the list; the trail is per route, not per record");
  await page.goto(`${BASE}/dashboard/quotes`);
  await page.getByRole("link", { name: "Fiber install — option A" }).click();
  await page.waitForURL(quoteAUrl);
  await backLink(page).getByText("Quotes").waitFor();
  await backLink(page).click();
  await page.waitForURL(/\/dashboard\/quotes$/);

  log("deal value comes from its quotes; marking sent moves the deal to Quote Sent");
  const quoteA = await sql(`SELECT id FROM "Quote" WHERE title='Fiber install — option A'`);
  await sql(
    `INSERT INTO "QuoteLineItem" (id,"quoteId",name,quantity,"unitPriceCents",tag,position) VALUES ('li-a',$1,'Fiber run',10,12500,'LABOR',0)`,
    [quoteA.rows[0].id],
  );
  await page.goto(quoteAUrl);
  await page.getByRole("button", { name: "Mark as sent" }).click();
  await page.getByText("Customer link").waitFor();
  await page.goto(`${BASE}/dashboard/deals`);
  const columns = page.locator("h2");
  assert.deepEqual(await columns.allTextContents(), ["Lead", "Contacted", "Quote Sent", "Contract Sent", "Won", "Lost"]);
  const quoteSentCol = page.locator("div.card", { has: page.locator("h2", { hasText: "Quote Sent" }) }).first();
  assert.ok(await quoteSentCol.getByText("Fiber install").first().isVisible(), "deal moved to Quote Sent");
  assert.ok(await quoteSentCol.getByText("$1,250.00").first().isVisible(), "value read from the sent quote");
  assert.ok(await quoteSentCol.getByText("QUO-1000").isVisible(), "quotes listed on the deal card");
  assert.equal(await page.locator("select[aria-label='Deal stage'] >> nth=0 >> option").count(), 6);
  assert.ok(await page.getByText("$1,250.00 in open deals").isVisible());
  await shot(page, "06-pipeline");

  log("Back from a contact reached via the pipeline says Pipeline");
  await quoteSentCol.getByRole("link", { name: /Spirit Communications/ }).click();
  await page.waitForURL(dannyUrl);
  await backLink(page).getByText("Pipeline").waitFor();
  assert.ok(await page.getByText("$1,250.00").first().isVisible(), "open pipeline on the contact reads the quote");

  log("a note with the Birthday label, logged on Danny and Sara at once");
  const noteForm = page.locator("form", { has: page.locator("textarea[name=body]") }).nth(1);
  await noteForm.locator("textarea[name=body]").fill("Birthday is March 9 — likes bourbon");
  await noteForm.getByRole("button", { name: "Birthday" }).click();
  await noteForm.getByRole("button", { name: "+ Include multiple contacts" }).click();
  const dialog = page.getByRole("dialog", { name: "Include multiple contacts" });
  await dialog.waitFor();
  assert.ok(await dialog.getByText("this contact").isVisible(), "current contact locked in");
  await dialog.getByPlaceholder("Search contacts…").fill("sara");
  assert.equal(await dialog.locator("input[type=checkbox]").count(), 1, "search narrows the list");
  await dialog.locator("input[type=checkbox]").check();
  await shot(page, "07-include-multiple");
  await dialog.getByRole("button", { name: "Done" }).click();
  await noteForm.getByRole("button", { name: "Includes 2 contacts" }).waitFor();
  await noteForm.getByRole("button", { name: "Add note" }).click();
  const notesCard = page.locator("#notes");
  await notesCard.getByText("Birthday is March 9").waitFor();
  assert.ok(await notesCard.getByText("also on 1 other").isVisible());
  assert.ok(await notesCard.locator("span.badge", { hasText: "Birthday" }).isVisible(), "label chip on the note");
  await noteForm.getByRole("button", { name: "+ Include multiple contacts" }).waitFor();
  await notesCard.locator("button.btn", { hasText: /^Personal/ }).click();
  assert.ok(await notesCard.getByText("Birthday is March 9").isVisible(), "personal view keeps the labeled note");
  await notesCard.locator("textarea[name=body]").fill("Wants the invoice split in two");
  await noteForm.getByRole("button", { name: "Add note" }).click();
  await notesCard.locator("button.btn", { hasText: /^All/ }).getByText("2").waitFor();
  assert.equal(await notesCard.getByText("Wants the invoice split").count(), 0, "unlabeled note hidden from Personal");
  await notesCard.locator("button.btn", { hasText: /^All/ }).click();
  await notesCard.getByText("Wants the invoice split").waitFor();
  await shot(page, "08-notes-personal");

  log("log a call on Danny and Resi at once; overview shows Calls 1 and Last touch Today");
  const activityForm = page.locator("form", { has: page.locator("textarea[name=body]") }).nth(0);
  await activityForm.locator("textarea[name=body]").fill("Walked the site, quote by Friday");
  await activityForm.getByRole("button", { name: "+ Include multiple contacts" }).click();
  await page.getByRole("dialog").getByPlaceholder("Search contacts…").fill("resi");
  await page.getByRole("dialog").locator("input[type=checkbox]").check();
  await page.getByRole("dialog").getByRole("button", { name: "Done" }).click();
  await activityForm.getByRole("button", { name: "Log phone call" }).click();
  await page.locator("#activity").getByText("Walked the site").waitFor();
  const overview = page.locator("div.card", { hasText: "Activity overview" });
  assert.ok(await overview.getByText("Today").isVisible());
  assert.ok(await overview.getByText("1 touch logged").isVisible());
  await shot(page, "09-overview");

  log("Sara and Resi got their copies; Sara's Personal view has the birthday note");
  await page.goto(saraUrl);
  await page.locator("#notes").getByText("Birthday is March 9").waitFor();
  await page.goto(resiUrl);
  await page.locator("#activity").getByText("Walked the site").waitFor();

  log("company page rolls up its people's notes and activity, and takes its own note");
  await page.goto(spiritUrl);
  const companyNotes = page.locator("#notes");
  assert.equal(await companyNotes.getByText("Birthday is March 9").count(), 2, "one copy per person, each named");
  assert.ok(await companyNotes.getByRole("link", { name: "Sara Lee" }).first().isVisible());
  assert.ok(await page.locator("#activity").getByText("Walked the site").isVisible());
  await companyNotes.locator("textarea[name=body]").fill("Net-30 terms agreed for the whole account");
  await companyNotes.getByRole("button", { name: "Add note" }).click();
  await companyNotes.getByText("Net-30 terms").waitFor();
  assert.ok(await page.getByText("$1,250.00").first().isVisible(), "company sees its people's pipeline");
  await shot(page, "10-company-page");

  log("a contract can name the deal; sending moves it to Contract Sent, signing wins it");
  await page.goto(`${BASE}/dashboard/contracts/new?contactId=${dannyUrl.split("/").pop()}`);
  await page.fill("#dealTitle", "Fiber");
  await page.getByRole("option", { name: /Fiber install/ }).click();
  await page.getByText("Quote Sent").waitFor();
  await page.getByRole("button", { name: "Generate contract" }).click();
  await page.waitForURL(/\/dashboard\/contracts\/(?!new$)[a-z0-9]+$/);
  assert.ok(await page.getByText(/CON-1000 · Fiber install · Spirit Communications/).isVisible());
  await page.getByRole("button", { name: "Send for signature" }).click();
  await page.getByText("Signature link").waitFor();
  let stage = await sql(`SELECT stage FROM "Deal" WHERE title='Fiber install'`);
  assert.equal(stage.rows[0].stage, "CONTRACT_SENT");
  const token = await sql(`SELECT "publicToken" FROM "Contract" WHERE number=1000`);
  await page.goto(`${BASE}/c/${token.rows[0].publicToken}`);
  await page.fill("[name=signerName]", "Danny Ortiz");
  await page.check("[name=agree]");
  await page.getByRole("button", { name: "Sign contract" }).click();
  await page.getByRole("button", { name: "Sign contract" }).waitFor({ state: "detached" });
  await page.waitForLoadState("networkidle");
  stage = await sql(`SELECT stage FROM "Deal" WHERE title='Fiber install'`);
  assert.equal(stage.rows[0].stage, "WON", "a signature wins the deal");

  log("a residential quote works with no company anywhere");
  await page.goto(`${BASE}/dashboard/quotes/new?contactId=${resiUrl.split("/").pop()}`);
  await page.fill("#dealTitle", "Backyard fence");
  await page.getByRole("button", { name: "Add new deal" }).click();
  await page.fill("#title", "Cedar fence 120ft");
  await page.getByRole("button", { name: "Create quote" }).click();
  await page.waitForURL(/\/dashboard\/quotes\/(?!new$)[a-z0-9]+$/);
  assert.ok(await page.getByText(/· Backyard fence · Resi Homeowner/).isVisible());

  log("edit and delete a company: people stay, company link clears");
  await page.goto(`${spiritUrl}/edit`);
  await page.fill("#city", "Greenville");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByText("Company saved").waitFor();
  await page.goto(`${BASE}/dashboard/companies/new`);
  await page.fill("#name", "spirit communications");
  await page.getByRole("button", { name: "Save company" }).click();
  await page.getByText("already exists").waitFor();
  await page.goto(`${spiritUrl}/edit`);
  await page.getByRole("button", { name: "Delete company" }).click();
  await page.waitForURL(/\/dashboard\/companies$/);
  await page.goto(dannyUrl);
  await page.getByRole("heading", { name: "Danny Ortiz" }).waitFor();
  assert.equal(await page.locator("dl").first().getByRole("link", { name: "Spirit Communications" }).count(), 0);
  const remaining = await sql(`SELECT count(*)::int AS n FROM "Contact" WHERE name IN ('Danny Ortiz','Sara Lee')`);
  assert.equal(remaining.rows[0].n, 2, "deleting a company keeps its people");

  void quoteBUrl;
  void quoteCUrl;
  await browser.close();
  console.log(`\nALL ${step} STEPS PASSED. Screenshots in ${OUT}`);
})().catch((err) => {
  console.error("\nFAILED at step", step, "\n", err);
  process.exit(1);
});
