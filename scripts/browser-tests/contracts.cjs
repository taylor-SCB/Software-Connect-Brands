/* Browser regression for Contracts v1.
 *
 * Covers: the two-column template page (Agreement | silver line | Customer
 * Information), merge-field chips and their ALL / Contacts / Companies /
 * Pipeline / Products / Quotes / Contracts tabs, dropping a chip into the
 * body, "+ Add new type" on the Type list, "Who can send?" with its All
 * company users switch and search, Preview (filled chips vs. flashing
 * "Missing Information"), generating a contract from the right column,
 * the contract page's Customer Information column, the send restriction
 * being honoured, the New contract page, and the customer's signing page.
 *
 * Audit fixes (UX review, Nov 10, 2026), an "audit fixes (UX review):"
 * step: Mark signed (signed on paper) on a contract made from a sent quote
 * accepts that quote, dated the day it was signed, and takes its open
 * follow-up off the calendar; and a contract signed before that fix, its
 * quote still Sent, is caught up by the migration
 * 20261111140000_paperwork_accept_signed_quotes (a sent contract, a
 * purchase order and another workspace's contract are left alone; a
 * second run changes nothing).
 *
 * Runs against a built app (`npm run build:app && npx next start`) and a
 * local Postgres that has had `prisma migrate deploy` run against it. It
 * signs up its own workspace, activates it with SQL, and deletes it again
 * on the next run, so it never touches real data. Never point it at the
 * live database.
 *
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/scb_test \
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules \
 *   node scripts/browser-tests/contracts.cjs
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
const OUT = process.env.SHOTS_DIR || path.join(os.tmpdir(), "scb-browser-shots-contracts");
fs.mkdirSync(OUT, { recursive: true });

const EMAIL = "test-contracts@example.com";
const PASSWORD = "password123";
const COMPANY = "Test Contracts Co";
const SLUG_LIKE = "test-contracts-co%";

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
// Every chip in the template preview, with its state and text.
async function previewChips(page) {
  return page.locator("[data-testid=template-preview] [data-merge-key]").evaluateAll((nodes) =>
    nodes.map((node) => ({
      key: node.dataset.mergeKey,
      state: node.dataset.mergeState,
      text: node.textContent,
    })),
  );
}

(async () => {
  await sql(`DELETE FROM "Organization" WHERE slug LIKE $1`, [SLUG_LIKE]);

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
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
  await sql(`UPDATE "Organization" SET status='ACTIVE', "reviewedAt"=now() WHERE slug LIKE $1`, [SLUG_LIKE]);
  await login(page);

  const org = (await sql(`SELECT id FROM "Organization" WHERE slug LIKE $1`, [SLUG_LIKE])).rows[0].id;
  const user = (await sql(`SELECT id FROM "User" WHERE email=$1`, [EMAIL])).rows[0].id;

  log("a new workspace starts with the built-in types and templates (six templates since Sept 10, 2026)");
  const types = await sql(`SELECT name FROM "ContractTypeOption" WHERE "organizationId"=$1 ORDER BY name`, [org]);
  assert.deepEqual(types.rows.map((r) => r.name), ["Change Order", "Compliance", "Custom", "Invoice", "Purchase Order", "Sales Order", "Service Agreement"]);
  const seeded = await sql(`SELECT name, type FROM "ContractTemplate" WHERE "organizationId"=$1 ORDER BY name`, [org]);
  assert.equal(seeded.rows.length, 6);
  assert.ok(seeded.rows.some((r) => r.name === "Service Agreement" && r.type === "Service Agreement"));
  assert.ok(seeded.rows.some((r) => r.name === "Change Order" && r.type === "Change Order"));

  log("seed a customer with a company, a deal and a quote with two lines, plus a residential contact");
  await sql(
    `INSERT INTO "Company" (id,"organizationId",name,phone,city,state,"updatedAt")
     VALUES ('cmp_ct','${org}','Palmetto Roofing','555-0100','Columbia','SC',now())`,
  );
  await sql(
    `INSERT INTO "Contact" (id,"organizationId","companyId",name,title,email,phone,city,state,"updatedAt")
     VALUES ('ctc_ct','${org}','cmp_ct','Danny Ortiz','Owner','danny@palmetto.com','555-0101','Columbia','SC',now()),
            ('ctc_resi','${org}',NULL,'Resi Homeowner',NULL,NULL,NULL,'Lexington','SC',now())`,
  );
  await sql(
    `INSERT INTO "Deal" (id,"organizationId","contactId",title,stage,"updatedAt")
     VALUES ('deal_ct','${org}','ctc_ct','Kitchen remodel','QUOTE_SENT',now())`,
  );
  await sql(
    `INSERT INTO "Quote" (id,"organizationId","contactId","dealId",number,title,status,"publicToken","updatedAt")
     VALUES ('quo_ct','${org}','ctc_ct','deal_ct',1000,'Kitchen quote','SENT','tok_quo_ct_0123456789',now())`,
  );
  await sql(
    `INSERT INTO "QuoteLineItem" (id,"quoteId",name,quantity,"unitPriceCents",tag,position)
     VALUES ('qli_1','quo_ct','Demo labor',2,10000,'LABOR',0),('qli_2','quo_ct','Tile',1,5000,'MATERIALS',1)`,
  );

  log("templates list: six cards, each 'Anyone can send'");
  await page.goto(`${BASE}/dashboard/contracts/templates`);
  await page.getByRole("heading", { name: "Contract templates" }).waitFor();
  assert.equal(await page.getByText("Anyone can send").count(), 6);
  await shot(page, "01-templates-list");

  log("open Service Agreement: Agreement on the left, silver line, Customer Information on the right");
  await page.getByRole("link", { name: /Service Agreement/ }).click();
  await page.waitForURL(/\/dashboard\/contracts\/templates\/[a-z0-9]+$/);
  const templateUrl = page.url();
  await page.getByRole("heading", { name: "Agreement", exact: true }).waitFor();
  await page.getByRole("heading", { name: "Customer Information" }).waitFor();
  assert.ok(await page.locator(".divider-silver").isVisible(), "silver line between the columns");
  assert.ok(await page.getByRole("button", { name: "Generate contract" }).isVisible());
  assert.ok(await page.getByRole("button", { name: "Preview" }).isVisible(), "Preview sits by Save changes");
  assert.equal(await page.getByRole("link", { name: /Use template/ }).count(), 0, "the tiny Use template box is gone");
  await shot(page, "02-template-two-columns");

  log("merge fields are chips with labels, grouped by tab");
  const tabs = await page.getByRole("tab").allTextContents();
  assert.deepEqual(tabs, [
    "ALL",
    "Contacts",
    "Companies",
    "Pipeline",
    "Products",
    "Quotes",
    "Contracts",
    "Projects",
    "Settings",
  ]);
  const palette = page.getByRole("tabpanel");
  assert.ok(await palette.getByRole("button", { name: "Company Name", exact: true }).isVisible());
  assert.equal(await palette.getByText("{{", { exact: false }).count(), 0, "no raw {{tokens}} in the palette");
  await page.getByRole("tab", { name: "Contacts" }).click();
  const contactChips = await palette.getByRole("button").allTextContents();
  assert.deepEqual(contactChips, ["Contact Name", "Contact Title", "Contact Email", "Contact Phone", "Contact City", "Contact State"]);
  await page.getByRole("tab", { name: "Quotes" }).click();
  assert.ok(await palette.getByRole("button", { name: "Quote ID" }).isVisible());
  assert.equal(await palette.getByRole("button", { name: "Contact Name" }).count(), 0, "Quotes tab hides Contact fields");
  await page.getByRole("tab", { name: "Projects" }).click();
  const projectChips = await palette.getByRole("button").allTextContents();
  assert.deepEqual(projectChips, ["Job Number", "Job Name", "Job Site Address"]);
  await shot(page, "03-palette-quotes-tab");

  log("clicking a chip drops its field into the body at the cursor");
  const body = page.locator("#body");
  await body.focus();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\nProject: ");
  await page.getByRole("tab", { name: "Pipeline" }).click();
  await palette.getByRole("button", { name: "Deal Name" }).click();
  await page.keyboard.type(" for ");
  await page.getByRole("tab", { name: "Quotes" }).click();
  await palette.getByRole("button", { name: "Quote Total" }).click();
  const tail = (await body.inputValue()).slice(-80);
  assert.ok(tail.endsWith("Project: {{deal_name}} for {{quote_total}}"), `tokens landed at the cursor, got: ${JSON.stringify(tail)}`);

  log("+ Add new type reveals a name box");
  await page.selectOption("#type", "__new__");
  const newType = page.getByLabel("New type name");
  await newType.waitFor();
  await newType.fill("Commission Agreement");

  log("Who can send: switch All company users off, search, tick a person");
  const sw = page.getByRole("switch", { name: "All company users can send" });
  assert.equal(await sw.getAttribute("aria-checked"), "true");
  await sw.click();
  await page.getByLabel("Search people", { exact: true }).fill("tayl");
  const me = page.getByRole("checkbox", { name: /Taylor Test/ });
  await me.waitFor();
  await me.check();
  await page.getByText("Only Taylor Test can send.").waitFor();
  await page.getByLabel("Search people", { exact: true }).fill("zzz");
  await page.getByText("Nobody matches.").waitFor();
  await page.getByLabel("Search people", { exact: true }).fill("");
  await shot(page, "04-type-and-senders");

  log("Preview with nobody picked: missing chips flash red, workspace fields fill in");
  await page.getByRole("button", { name: "Preview" }).click();
  await page.locator("[data-testid=template-preview]").waitFor();
  await page.locator("[data-merge-state=filled]").first().waitFor();
  let chips = await previewChips(page);
  const byKey = (key) => chips.filter((c) => c.key === key);
  assert.equal(byKey("client_name")[0].state, "missing");
  assert.equal(byKey("client_name")[0].text, "Missing Information");
  assert.equal(byKey("deal_name")[0].state, "missing");
  assert.equal(byKey("company_name")[0].state, "filled");
  assert.equal(byKey("company_name")[0].text, COMPANY);
  assert.equal(byKey("contract_number")[0].text, "CON-1000", "shows the number the next contract will get");
  assert.ok(await page.getByText(/\d+ missing/).isVisible());
  assert.ok(await body.isHidden(), "the textarea steps aside while previewing");
  await shot(page, "05-preview-missing");

  log("pick the customer and deal on the right: the preview fills in live");
  await page.selectOption("#contactId", "ctc_ct");
  await page.locator("[data-merge-key=client_name][data-merge-state=filled]").first().waitFor();
  await page.fill("#dealTitle", "Kitchen");
  await page.getByRole("option", { name: /Kitchen remodel/ }).click();
  await page.locator("[data-merge-key=deal_name][data-merge-state=filled]").first().waitFor();
  assert.equal(await page.locator("#quoteId").inputValue(), "quo_ct", "the deal's quote is picked by default");
  await page.locator("[data-merge-key=quote_total][data-merge-state=filled]").first().waitFor();
  chips = await previewChips(page);
  assert.equal(byKey("client_name")[0].text, "Danny Ortiz");
  assert.equal(byKey("client_company")[0].text, "Palmetto Roofing");
  assert.equal(byKey("client_email")[0].text, "danny@palmetto.com");
  assert.equal(byKey("deal_name")[0].text, "Kitchen remodel");
  assert.equal(byKey("quote_total")[0].text, "$250.00");
  assert.equal(await page.locator("[data-testid=template-preview] [data-merge-state=missing]").count(), 0, "everything filled");
  await page.getByText("0 missing").waitFor();
  await shot(page, "06-preview-filled");

  log("back to editing, save: type and senders stick");
  await page.getByRole("button", { name: "Back to editing" }).click();
  assert.ok(await body.isVisible());
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByText("Template saved").waitFor();
  await page.reload();
  assert.equal(await page.locator("#type").inputValue(), "Commission Agreement");
  assert.equal(await page.getByRole("switch").getAttribute("aria-checked"), "false");
  await page.getByText("Only Taylor Test can send.").waitFor();
  const saved = await sql(`SELECT type, "allUsersCanSend", "senderUserIds" FROM "ContractTemplate" WHERE name='Service Agreement' AND "organizationId"=$1`, [org]);
  assert.deepEqual(saved.rows[0], { type: "Commission Agreement", allUsersCanSend: false, senderUserIds: [user] });
  const typeCount = await sql(`SELECT count(*)::int AS n FROM "ContractTypeOption" WHERE "organizationId"=$1`, [org]);
  assert.equal(typeCount.rows[0].n, 8, "the new type joined the pick list (seven built-in + one)");

  log("the new type is in the dropdown next time, and typing it again doesn't duplicate it");
  const options = await page.locator("#type option").allTextContents();
  assert.ok(options.includes("Commission Agreement"));
  assert.equal(options.at(-1), "+ Add new type…");

  log("generate a contract from the Customer Information column");
  await page.selectOption("#contactId", "ctc_ct");
  await page.fill("#dealTitle", "Kitchen");
  await page.getByRole("option", { name: /Kitchen remodel/ }).click();
  await page.getByRole("button", { name: "Generate contract" }).click();
  await page.waitForURL(/\/dashboard\/contracts\/(?!new$|templates)[a-z0-9]+$/);
  const contractUrl = page.url();
  await page.getByRole("heading", { name: "Customer Information" }).waitFor();
  const info = page.locator("dl");
  assert.ok(await info.getByRole("link", { name: "Danny Ortiz" }).isVisible());
  assert.ok(await info.getByRole("link", { name: "Palmetto Roofing" }).isVisible());
  assert.ok(await info.getByRole("link", { name: "Kitchen remodel" }).isVisible());
  assert.ok(await info.getByRole("link", { name: /QUO-1000/ }).isVisible());
  const contractBody = await page.locator("#body").inputValue();
  assert.ok(contractBody.includes("Project: Kitchen remodel for $250.00"), "fields resolved in the generated text");
  assert.ok(contractBody.includes("Attn: Danny Ortiz · danny@palmetto.com · 555-0101"));
  assert.ok(!contractBody.includes("{{"), "no tokens left behind");
  assert.ok(await page.getByText("Commission Agreement").first().isVisible(), "type badge");
  assert.equal(await page.getByRole("button", { name: "Send for signature" }).count(), 2, "header and Sending card");
  await shot(page, "07-contract-page");

  const contractId = contractUrl.split("/").pop();
  const stored = await sql(`SELECT type, "quoteId", "dealId" FROM "Contract" WHERE id=$1`, [contractId]);
  assert.deepEqual(stored.rows[0], { type: "Commission Agreement", quoteId: "quo_ct", dealId: "deal_ct" });

  log("someone not on the template's sender list can't send, on screen or in the action");
  await sql(`UPDATE "ContractTemplate" SET "senderUserIds"=ARRAY['someone_else'] WHERE name='Service Agreement' AND "organizationId"=$1`, [org]);
  await page.reload();
  assert.equal(await page.getByRole("button", { name: "Send for signature" }).count(), 0);
  await page.getByRole("note").waitFor();
  assert.ok((await page.getByRole("note").textContent()).includes("can send"));
  await shot(page, "08-cannot-send");
  await sql(`UPDATE "ContractTemplate" SET "senderUserIds"=ARRAY[$2::text] WHERE name='Service Agreement' AND "organizationId"=$1`, [org, user]);
  await page.reload();
  await page.getByRole("button", { name: "Send for signature" }).first().waitFor();

  log("send: status Sent, signature link in the Sending card, deal moves to Contract Sent");
  await page.getByRole("button", { name: "Send for signature" }).first().click();
  await page.getByLabel("Public document link").waitFor();
  const link = await page.getByLabel("Public document link").inputValue();
  assert.match(link, /\/c\/[A-Za-z0-9_-]+$/);
  const stage = await sql(`SELECT stage FROM "Deal" WHERE id='deal_ct'`);
  assert.equal(stage.rows[0].stage, "CONTRACT_SENT");
  await shot(page, "09-contract-sent");

  log("the customer's signing page renders with the new type");
  await page.goto(link);
  await page.getByText("Commission Agreement").first().waitFor();
  assert.ok(await page.getByText("Project: Kitchen remodel for $250.00").isVisible());
  await shot(page, "10-public-sign");

  log("Sprint: the sign box's name starts empty; on a phone a pinned Review and sign bar with the total takes them to it");
  assert.equal(await page.locator("[name=signerName]").inputValue(), "", "the customer's name was typed in for them");
  assert.equal(await page.locator("[name=signerName]").getAttribute("placeholder"), "Type your full name");
  assert.equal(await page.getByTestId("review-and-sign-bar").isVisible(), false, "the phone bar shows on a wide screen");
  {
    const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    const phone = await phoneCtx.newPage();
    await phone.goto(link);
    const bar = phone.getByTestId("review-and-sign-bar");
    await bar.waitFor();
    const barBox = await bar.boundingBox();
    assert.ok(barBox.y + barBox.height <= 845 && barBox.y > 700, `the bar isn't pinned to the foot (${barBox.y})`);
    assert.match(await bar.textContent(), /Review and sign ↓/);
    await bar.getByRole("link").click();
    await phone.waitForFunction(() => location.hash === "#sign");
    const signBox = await phone.locator("#sign").boundingBox();
    assert.ok(signBox.y < 844, "the link didn't bring the sign box on screen");
    assert.ok((await phone.evaluate(() => document.documentElement.scrollWidth)) <= 390, "the customer's page scrolls sideways");
    await phoneCtx.close();
  }

  log("Sprint: a sent contract's wording is locked on screen and on the server, with Pull back to draft to edit");
  await page.goto(contractUrl);
  await page.getByTestId("contract-body-sent").waitFor();
  assert.equal(await page.locator("#body").count(), 0, "the body is editable while it is out for signature");
  await page.getByTestId("pull-back-to-edit").click();
  await page.locator("#body").waitFor();
  assert.equal((await sql(`SELECT status FROM "Contract" WHERE id=$1`, [contractId])).rows[0].status, "DRAFT");
  // A second tab still holds the editor when the first sends it again.
  const staleTab = await context.newPage();
  await staleTab.goto(contractUrl);
  await staleTab.locator("#body").waitFor();
  await page.getByRole("button", { name: "Send for signature" }).first().click();
  await page.getByTestId("contract-body-sent").waitFor();
  const bodyBefore = (await sql(`SELECT body FROM "Contract" WHERE id=$1`, [contractId])).rows[0].body;
  await staleTab.locator("#body").fill(`${bodyBefore}\nA sneaky extra clause.`);
  await staleTab.getByRole("button", { name: "Save changes" }).click();
  await staleTab.getByText("This contract is out for signature. Pull it back to draft to edit it.").waitFor();
  assert.equal((await sql(`SELECT body FROM "Contract" WHERE id=$1`, [contractId])).rows[0].body, bodyBefore, "the server saved new wording on a sent contract");
  await staleTab.close();

  log("audit fixes (UX review): Mark signed on a contract made from a sent quote accepts the quote and takes its follow-up off the calendar");
  // The quote goes out from its page, so its follow-up is on the calendar.
  await page.goto(`${BASE}/dashboard/quotes/quo_ct`);
  await page.getByRole("button", { name: "Back to draft" }).click();
  await page.getByTestId("send-quote").click();
  await page.getByTestId("send-quote-mark").click();
  await page.getByRole("button", { name: "Back to draft" }).waitFor();
  const openFollowUps = async () =>
    (
      await sql(
        `SELECT count(*)::int AS n FROM "CalendarEvent" WHERE "quoteId"='quo_ct' AND type IN ('Quote follow up','Quote due') AND "doneAt" IS NULL`,
      )
    ).rows[0].n;
  assert.ok((await openFollowUps()) > 0, "marking the quote sent writes its follow-up");
  await page.goto(contractUrl);
  await page.locator("[data-testid=mark-signed]").first().click();
  await page.locator("[data-testid=mark-signed-name]").first().fill("Danny Ortiz");
  await page.locator("[data-testid=mark-signed-date]").first().fill("2026-11-09");
  await page.locator("[data-testid=mark-signed-save]").first().click();
  await page.getByText(/Signed offline/).waitFor();
  // Before the fix the quote stayed Sent, its follow-up stayed on the
  // calendar and in Coming up, and the deal's value could fall to a newer
  // draft.
  const answered = (await sql(`SELECT status, "respondedAt"::date::text AS day FROM "Quote" WHERE id='quo_ct'`)).rows[0];
  assert.equal(answered.status, "ACCEPTED", "the quote the signed contract came from is still Sent");
  assert.equal(answered.day, "2026-11-09", "accepted on the day it was signed");
  assert.equal(await openFollowUps(), 0, "the signed quote's follow-up is still on the calendar");
  await page.goto(`${BASE}/dashboard/quotes/quo_ct`);
  await page.locator("main span.badge", { hasText: "Accepted" }).first().waitFor();

  log("Sprint: a contract signed before the fix is caught up by the paperwork_accept_signed_quotes migration, safely twice");
  // The state the review found in the live data: the contract signed, its
  // quote still Sent with its follow-up open. The quote goes out again
  // from its page while the contract stays signed. The catch-up used to be
  // scripts/accept-signed-quotes.ts, run by hand; it is a migration now,
  // so it runs on release. Its SQL is run here straight from the file.
  await page.getByRole("button", { name: "Back to draft" }).click();
  await page.getByTestId("send-quote").click();
  await page.getByTestId("send-quote-mark").click();
  await page.getByRole("button", { name: "Back to draft" }).waitFor();
  assert.equal((await sql(`SELECT status FROM "Quote" WHERE id='quo_ct'`)).rows[0].status, "SENT");
  assert.equal((await sql(`SELECT status FROM "Contract" WHERE id=$1`, [contractId])).rows[0].status, "SIGNED");
  assert.ok((await openFollowUps()) > 0, "the quote's follow-up is back on the calendar");
  const migrationSql = fs.readFileSync(
    path.join(process.cwd(), "prisma/migrations/20261111140000_paperwork_accept_signed_quotes/migration.sql"),
    "utf8",
  );
  const catchUp = () => sql(migrationSql);
  // Left alone: the contract only sent, not signed.
  await sql(`UPDATE "Contract" SET status='SENT' WHERE id=$1`, [contractId]);
  await catchUp();
  assert.equal((await sql(`SELECT status FROM "Quote" WHERE id='quo_ct'`)).rows[0].status, "SENT", "an unsigned contract accepted its quote");
  // Left alone: a signed purchase order is not the customer saying yes.
  await sql(`UPDATE "Contract" SET status='SIGNED', payable=true WHERE id=$1`, [contractId]);
  await catchUp();
  assert.equal((await sql(`SELECT status FROM "Quote" WHERE id='quo_ct'`)).rows[0].status, "SENT", "a signed purchase order accepted its quote");
  // Left alone: a contract in another workspace pointing at this quote.
  const foreignOrg = `test-foreign-${Date.now()}`;
  await sql(`INSERT INTO "Organization" (id, name, slug, "updatedAt") VALUES ($1, 'Foreign', $1, now())`, [foreignOrg]);
  await sql(`UPDATE "Contract" SET payable=false, "organizationId"=$2 WHERE id=$1`, [contractId, foreignOrg]);
  await catchUp();
  assert.equal((await sql(`SELECT status FROM "Quote" WHERE id='quo_ct'`)).rows[0].status, "SENT", "another workspace's contract accepted this quote");
  await sql(`UPDATE "Contract" SET "organizationId"=$2 WHERE id=$1`, [contractId, org]);
  await sql(`DELETE FROM "Organization" WHERE id=$1`, [foreignOrg]);
  // Caught up: the quote is Accepted, dated the day the contract was signed.
  await catchUp();
  const backfilled = (await sql(`SELECT status, "respondedAt"::date::text AS day FROM "Quote" WHERE id='quo_ct'`)).rows[0];
  assert.deepEqual(backfilled, { status: "ACCEPTED", day: "2026-11-09" }, "accepted, dated the day the contract was signed");
  assert.equal(await openFollowUps(), 0, "the follow-up is still on the calendar after the catch-up");
  const quoteSentKept = (await sql(`SELECT count(*)::int AS n FROM "CalendarEvent" WHERE "quoteId"='quo_ct' AND type='Quote sent'`)).rows[0].n;
  assert.ok(quoteSentKept > 0, "the Quote sent history line was taken off too");
  // A second run changes nothing.
  const before = (await sql(`SELECT "respondedAt"::text AS r, "updatedAt"::text AS u FROM "Quote" WHERE id='quo_ct'`)).rows[0];
  await catchUp();
  const after = (await sql(`SELECT "respondedAt"::text AS r, "updatedAt"::text AS u FROM "Quote" WHERE id='quo_ct'`)).rows[0];
  assert.deepEqual(after, before, "a second run touched the quote again");
  await page.reload();
  await page.locator("main span.badge", { hasText: "Accepted" }).first().waitFor();

  log("New contract: same two columns, template dropdown, preview, residential customer with no deal");
  await page.goto(`${BASE}/dashboard/contracts/new`);
  await page.getByRole("heading", { name: "Agreement", exact: true }).waitFor();
  await page.getByRole("heading", { name: "Customer Information" }).waitFor();
  await page.selectOption("#pickTemplate", { label: "Change Order · Change Order" });
  assert.ok(await page.locator("[data-testid=template-preview] [data-merge-key=client_company]").first().isVisible(), "template shown with label chips");
  await page.getByRole("button", { name: "Preview" }).click();
  await page.locator("[data-merge-state=missing]").first().waitFor();
  await page.selectOption("#contactId", "ctc_resi");
  await page.locator("[data-merge-key=client_name][data-merge-state=filled]").first().waitFor();
  chips = await previewChips(page);
  assert.equal(byKey("client_company")[0].text, "Resi Homeowner", "no company: the contact's name stands in");
  assert.equal(byKey("client_email")[0].state, "missing");
  await shot(page, "11-new-contract");
  await page.getByRole("button", { name: "Generate contract" }).click();
  await page.waitForURL(/\/dashboard\/contracts\/(?!new$|templates)[a-z0-9]+$/);
  await page.getByRole("heading", { name: "Change Order" }).waitFor();
  assert.ok(await page.locator("dl").getByText("None · residential").isVisible());
  const resiBody = await page.locator("#body").inputValue();
  assert.ok(resiBody.includes("Client: Resi Homeowner"));
  assert.ok(resiBody.includes("{{client_email}}"), "a field with nothing to fill it stays visible rather than blank");

  log("templates list shows the new type and the sender restriction");
  await page.goto(`${BASE}/dashboard/contracts/templates`);
  const card = page.locator("a.card", { hasText: "Service Agreement" });
  assert.ok(await card.getByText("Commission Agreement").isVisible());
  assert.ok(await card.getByText("Only Taylor Test can send").isVisible());
  assert.ok(await page.locator("a.card", { hasText: "Change Order" }).getByText("Anyone can send").isVisible());

  log("New template page: both columns, Generate waits for a save, Preview still works");
  await page.goto(`${BASE}/dashboard/contracts/templates/new`);
  await page.getByRole("heading", { name: "Customer Information" }).waitFor();
  assert.ok(await page.getByRole("button", { name: "Generate contract" }).isDisabled());
  await page.getByText("Save the template first").waitFor();
  await page.fill("#name", "Tradeshow Sponsor");
  await page.selectOption("#type", "__new__");
  await page.getByLabel("New type name").fill("Tradeshow Sponsor");
  await page.locator("#body").fill("Sponsor: ");
  await page.getByRole("tab", { name: "Companies" }).click();
  await page.getByRole("tabpanel").getByRole("button", { name: "Company Name", exact: true }).click();
  await page.keyboard.type(" agrees to sponsor. Signed by ");
  await page.getByRole("tab", { name: "Contacts" }).click();
  await page.getByRole("tabpanel").getByRole("button", { name: "Contact Name" }).click();
  await page.getByRole("button", { name: "Save template" }).click();
  await page.waitForURL(/\/dashboard\/contracts\/templates\/[a-z0-9]+$/);
  await page.getByRole("heading", { name: "Tradeshow Sponsor" }).waitFor();
  assert.equal(await page.locator("#type").inputValue(), "Tradeshow Sponsor");
  assert.ok(await page.getByRole("button", { name: "Generate contract" }).isEnabled(), "saved: Generate is live");
  await shot(page, "12-new-template-saved");

  log("contracts list shows the types as plain labels");
  await page.goto(`${BASE}/dashboard/contracts`);
  assert.equal(await page.locator("tr", { hasText: "CON-1000" }).locator("span.badge").first().textContent(), "Commission Agreement");
  assert.equal(await page.locator("tr", { hasText: "CON-1001" }).locator("span.badge").first().textContent(), "Change Order");
  await shot(page, "13-contracts-list");

  await browser.close();
  // The older suites look contracts and deals up by number and name without
  // scoping to their own workspace, so leave nothing behind for them to find.
  await sql(`DELETE FROM "Organization" WHERE slug LIKE $1`, [SLUG_LIKE]);
  console.log(`\nPASS — ${step} steps. Screenshots in ${OUT}`);
  void templateUrl;
})().catch((err) => {
  console.error("\nFAIL at step", step, err);
  process.exit(1);
});
