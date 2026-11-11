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
 * "audit fixes (UX review):" steps (Nov 10, 2026): the + Event form in a
 * contact's narrow Coming up column laid out for its own width and
 * starting on Meeting (the calendar's wide one still in columns); Last
 * touch counted in calendar days on the workspace's clock (late last
 * night is Yesterday, eight dates back warns); a call logged on two
 * people from the company page counted once and shown as one line naming
 * both, and a marketing send to both shown once; the company page on a
 * 390px phone with nothing past the right edge and Claim tappable.
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
  // Every SQL lookup below is scoped to this workspace so other suites'
  // leftovers (another Danny Ortiz, another CON-1000) can't collide.
  const org = (await sql(`SELECT id FROM "Organization" WHERE slug LIKE 'test-companies-co%'`)).rows[0].id;

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
  // Details is the Reach card with "More details", and the Activity
  // overview's tiles sit behind "Show counts" (BDR redesign, Nov 11, 2026).
  const reach = page.locator("[data-testid=reach]");
  assert.ok(await reach.getByRole("link", { name: "Spirit Communications" }).isVisible(), "company is a link in Reach");
  await reach.locator("[data-testid=more-details]").click();
  const details = reach.locator("[data-testid=more-details-list]");
  assert.ok(await details.getByText("Mar 9, 1984").isVisible(), "birthday shown");
  const labels = await details.locator("dt").allTextContents();
  assert.deepEqual(labels.slice(-2), ["City", "State"], "city and state are the last two lines of Details");
  await page.locator("[data-testid=show-counts]").click();
  assert.ok(await page.locator("[data-testid=activity-overview]").isVisible(), "overview box present behind Show counts");
  assert.ok(await page.getByText("Never").isVisible(), "no touches yet");
  await shot(page, "02-contact-page");
  const dannyId = dannyUrl.split("/").pop();
  const me = (await sql(`SELECT id FROM "User" WHERE email=$1`, [EMAIL])).rows[0].id;

  log("audit fixes (UX review): + Event in the narrow Coming up column fits its width and starts on Meeting");
  await page.locator("[data-testid=upcoming-add-event]").click();
  const upcomingForm = page.locator("[data-testid=upcoming-card] [data-testid=event-form]");
  await upcomingForm.waitFor();
  assert.equal(await upcomingForm.locator("[data-testid=event-type]").inputValue(), "Meeting", "a meeting is what gets booked from a person's page, not an Install");
  await upcomingForm.locator("[data-testid=event-timed]").check();
  const narrow = await upcomingForm.evaluate((form) => ({
    width: form.getBoundingClientRect().width,
    fields: [...form.querySelectorAll("input, select")]
      .filter((el) => el.type !== "checkbox" && el.type !== "hidden")
      .map((el) => ({ name: el.name, w: el.getBoundingClientRect().width })),
  }));
  assert.ok(narrow.width < 420, `the form sits in the sidebar column (${narrow.width}px)`);
  assert.ok(narrow.fields.length >= 8, `day, times and pickers measured (${narrow.fields.map((f) => f.name)})`);
  // The date read "11/1" at 65px; every box now has the column to itself.
  for (const field of narrow.fields) {
    assert.ok(field.w >= narrow.width - 2, `${field.name} is ${field.w}px of the column's ${narrow.width}px`);
  }
  await shot(page, "02b-contact-plus-event");
  await page.locator("[data-testid=upcoming-add-event]").click();
  // The calendar's own form is wide and keeps its columns.
  await page.goto(`${BASE}/dashboard/calendar`);
  await page.locator("[data-testid=cal-add-event]").click();
  const wideForm = page.locator("[data-testid=event-form]").first();
  await wideForm.locator("[data-testid=event-timed]").check();
  const tops = await wideForm.evaluate((form) =>
    ["event-title", "event-type", "event-start-on", "event-start-time", "event-end-time", "event-owner", "event-crew", "event-project"].map((id) =>
      Math.round(form.querySelector(`[data-testid=${id}]`).getBoundingClientRect().top),
    ),
  );
  assert.equal(tops[0], tops[1], "title and kind side by side");
  assert.ok(tops[2] === tops[3] && tops[3] === tops[4], `day and both times on one row (${tops})`);
  assert.ok(tops[5] === tops[6] && tops[6] === tops[7], `whose calendar, who is going and which job on one row (${tops})`);
  assert.notEqual(await wideForm.locator("[data-testid=event-type]").inputValue(), "", "the calendar's form still starts on the list's first type");

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
  // Since Sept 30, 2026 Add person opens a search of existing people
  // first; a brand-new person is the link at its foot. Since Nov 11, 2026
  // it sits under the header's ⋯ More.
  await page.locator("[data-testid=company-more]").click();
  await page.locator("[data-testid=add-person]").click();
  await page.locator("[data-testid=add-person-new]").click();
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
  // Under ⋯ More since the BDR redesign (Nov 11, 2026).
  await page.locator("[data-testid=record-more]").click();
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
  // Deals, Quotes and Contracts are one Paperwork card since the BDR
  // redesign (Nov 11, 2026).
  const dealsCard = page.locator("[data-testid=paperwork-deals]");
  assert.ok(await dealsCard.getByText("Fiber install").first().isVisible(), "deal appears on the contact");
  assert.ok(await dealsCard.getByText("1 quote").isVisible());
  // Since Sept 30, 2026 a deal before its quote goes out reads "Quote not sent".
  assert.ok(await dealsCard.getByText("Quote not sent").isVisible(), "new deal starts before the pipeline");
  const quotesCard = page.locator("[data-testid=paperwork-quotes]");
  assert.ok(await quotesCard.getByText("QUO-1000 · Fiber install").isVisible(), "quote row names its deal");

  log("second quote on the same deal from the deal row; the picker shows the existing deal");
  await dealsCard.getByRole("link", { name: "Quote" }).click();
  await page.waitForURL(/dealId=/);
  assert.equal(await page.locator("#dealTitle").inputValue(), "Fiber install");
  await page.getByText("Quote not sent", { exact: true }).waitFor();
  await page.fill("#title", "Fiber install — option B");
  await page.getByRole("button", { name: "Create quote" }).click();
  await page.waitForURL(/\/dashboard\/quotes\/(?!new$)[a-z0-9]+$/);
  const quoteBUrl = page.url();
  const dealCount = await sql(`SELECT count(*)::int AS n FROM "Deal" WHERE title='Fiber install' AND "organizationId"=$1`, [org]);
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
  const quoteA = await sql(`SELECT id FROM "Quote" WHERE title='Fiber install — option A' AND "organizationId"=$1`, [org]);
  await sql(
    `INSERT INTO "QuoteLineItem" (id,"quoteId",name,quantity,"unitPriceCents",tag,position) VALUES ('li-a',$1,'Fiber run',10,12500,'LABOR',0)`,
    [quoteA.rows[0].id],
  );
  await page.goto(quoteAUrl);
  await page.getByRole("button", { name: "Mark as sent" }).click();
  await page.getByText("Customer link").waitFor();
  await page.goto(`${BASE}/dashboard/deals`);
  // The Pipeline starts at Meeting Set (Sept 30, 2026).
  const columns = page.locator("[data-testid^=pipeline-column-] h2");
  assert.deepEqual(await columns.allTextContents(), ["Meeting Set", "Meeting Completed", "Quote Sent", "Contract Sent", "Signed / Won", "Lost"]);
  const quoteSentCol = page.locator("div.card", { has: page.locator("h2", { hasText: "Quote Sent" }) }).first();
  assert.ok(await quoteSentCol.getByText("Fiber install").first().isVisible(), "deal moved to Quote Sent");
  assert.ok(await quoteSentCol.getByText("$1,250.00").first().isVisible(), "value read from the sent quote");
  assert.ok(await quoteSentCol.getByText("QUO-1000").isVisible(), "quotes listed on the deal card");
  // Oct 27, 2026: the tile's stage menu; a deal can't go back to a meeting column.
  await quoteSentCol.locator("[data-testid=pipeline-tile]", { hasText: "Fiber install" }).locator("[data-testid=tile-move]").click();
  assert.equal(await page.locator("[data-testid=tile-move-menu] button:not([disabled])").count(), 4);
  await page.keyboard.press("Escape");
  assert.ok(await page.getByText("$1,250.00 in quotes and contracts out").isVisible());
  await shot(page, "06-pipeline");

  log("Back from a contact reached via the pipeline says Pipeline");
  // Oct 27, 2026: the tile lists its people by name, their company beside them.
  const fiberTile = quoteSentCol.locator("[data-testid=pipeline-tile]", { hasText: "Fiber install" });
  assert.ok(await fiberTile.getByText("Spirit Communications").isVisible());
  await fiberTile.getByRole("link", { name: "Danny Ortiz" }).click();
  await page.waitForURL(dannyUrl);
  await backLink(page).getByText("Pipeline").waitFor();
  assert.ok(await page.getByText("$1,250.00").first().isVisible(), "open pipeline on the contact reads the quote");

  log("a note with the Birthday label, logged on Danny and Sara at once");
  // The Notes card's form: the activity log is the How did it go? sheet
  // behind "What happened with Danny?" since Nov 11, 2026.
  const noteForm = page.locator("#notes form", { has: page.locator("textarea[name=body]") });
  await noteForm.locator("textarea[name=body]").fill("Birthday is March 9 — likes bourbon");
  await noteForm.getByRole("button", { name: "Birthday" }).click();
  await noteForm.getByRole("button", { name: "+ Include multiple contacts" }).click();
  const dialog = page.getByRole("dialog", { name: "Include multiple contacts" });
  await dialog.waitFor();
  assert.ok(await dialog.getByText("this contact").isVisible(), "current contact locked in");
  await dialog.getByPlaceholder("Search contacts…").fill("sara");
  // The picker asks the server as you type (Sept 13, 2026), so wait for the answer.
  await dialog.locator("label", { hasText: "Sara Lee" }).waitFor();
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
  // The log is the How did it go? sheet behind "What happened with Danny?";
  // the overview's tiles open from Show counts (BDR redesign, Nov 11, 2026).
  await page.locator("[data-testid=log-bar]").click();
  const activityForm = page.locator("[data-testid=log-activity-form]");
  await activityForm.locator("textarea[name=body]").fill("Walked the site, quote by Friday");
  await activityForm.getByRole("button", { name: "+ others" }).click();
  await page.getByRole("dialog").getByPlaceholder("Search contacts…").fill("resi");
  await page.getByRole("dialog").locator("input[type=checkbox]").check();
  await page.getByRole("dialog").getByRole("button", { name: "Done" }).click();
  await activityForm.getByRole("button", { name: "Log phone call" }).click();
  await page.locator("#activity").getByText("Walked the site").waitFor();
  // The sheet moves on to the next step; closing it skips that.
  await page.keyboard.press("Escape");
  await activityForm.waitFor({ state: "detached" });
  await page.locator("[data-testid=show-counts]").click();
  const overview = page.locator("[data-testid=activity-overview]");
  assert.ok(await overview.getByText("Today").isVisible());
  assert.equal(await overview.locator("[data-testid=activity-tile][data-label=Calls]").getAttribute("data-value"), "1", "1 touch logged");
  assert.equal(await page.locator("[data-testid=history-count-all]").textContent(), "1");
  await shot(page, "09-overview");

  log("audit fixes (UX review): Last touch counts days on the workspace's calendar: 11:59pm last night is Yesterday, eight dates back warns");
  // Honolulu, where the day turns ten hours after UTC's, so neither 24-hour
  // blocks nor the server's own calendar give these answers.
  await sql(`UPDATE "Organization" SET "timeZone"='Pacific/Honolulu' WHERE id=$1`, [org]);
  await sql(`INSERT INTO "Contact" (id,"organizationId",name,"updatedAt") VALUES ('ctc_cc_late',$1,'Lena Late',now()), ('ctc_cc_eight',$1,'Owen Eight',now())`, [org]);
  const lateLastNight = `(((date_trunc('day', now() AT TIME ZONE 'Pacific/Honolulu') - interval '1 minute') AT TIME ZONE 'Pacific/Honolulu') AT TIME ZONE 'UTC')`;
  await sql(
    `INSERT INTO "Activity" (id,"organizationId","contactId","userId",type,body,"occurredAt") VALUES
       ('act_cc_late',$1,'ctc_cc_late',$2,'PHONE_CALL','Late call',${lateLastNight}),
       ('act_cc_eight',$1,'ctc_cc_eight',$2,'PHONE_CALL','Old call',${lateLastNight} - interval '7 days')`,
    [org, me],
  );
  const lastTouchRow = page.locator("[data-testid=activity-overview]").locator("dl > div", { hasText: "Last touch" });
  await page.goto(`${BASE}/dashboard/contacts/ctc_cc_late`);
  await page.locator("[data-testid=show-counts]").click();
  const yesterdayWords = (await sql(`SELECT to_char((now() AT TIME ZONE 'Pacific/Honolulu') - interval '1 day', 'Mon FMDD, YYYY') AS d`)).rows[0].d;
  assert.equal((await lastTouchRow.locator("dd").innerText()).trim(), `Yesterday · ${yesterdayWords}`, "under 24 hours ago, but yesterday's date");
  assert.doesNotMatch((await lastTouchRow.locator("dt svg").getAttribute("class")) ?? "", /--warn/);
  await page.goto(`${BASE}/dashboard/contacts/ctc_cc_eight`);
  await page.locator("[data-testid=show-counts]").click();
  assert.match(await lastTouchRow.locator("dd").innerText(), /^8 days ago · /, "under 8 × 24 hours ago, eight dates back");
  assert.match((await lastTouchRow.locator("dt svg").getAttribute("class")) ?? "", /--warn/, "the 8-day warning");
  await sql(`UPDATE "Organization" SET "timeZone"='America/Chicago' WHERE id=$1`, [org]);

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
  // The pipeline total sits behind Show counts under the header's meter
  // (BDR redesign, Nov 11, 2026), and the deal in the Paperwork card.
  await page.locator("[data-testid=company-show-counts]").click();
  assert.ok(await page.locator("[data-testid=company-counts]").getByText("$1,250.00").first().isVisible(), "company sees its people's pipeline");
  assert.ok(await page.locator("[data-testid=company-paperwork]").getByText("$1,250.00").first().isVisible(), "and the deal in Paperwork");
  await shot(page, "10-company-page");
  const spiritId = spiritUrl.split("/").pop();
  const saraId = saraUrl.split("/").pop();

  log("audit fixes (UX review): a call logged on two people here at once counts once and is one line naming both");
  const coOverview = page.locator("div.card", { hasText: "Activity overview" });
  const tile = (label) => coOverview.locator("a", { hasText: label }).locator("span.num");
  const callsBefore = Number(await tile("Calls").innerText());
  // Log a touch on the company page opens the How did it go? sheet (Nov 11, 2026).
  await page.locator("[data-testid=company-log-toggle]").click();
  const coForm = page.locator("[data-testid=log-activity-form]");
  const coPicker = coForm.locator("[data-testid=company-people-picker]");
  await coPicker.locator("[data-testid=company-person-chip]", { hasText: "Danny Ortiz" }).click();
  await coPicker.locator("[data-testid=company-person-chip]", { hasText: "Sara Lee" }).click();
  await coForm.locator("textarea[name=body]").fill("Conference call with Danny and Sara");
  await coForm.locator("[data-testid=activity-submit]").click();
  await page.locator("[data-testid=follow-up-prompt]").waitFor();
  await page.locator("[data-testid=follow-up-skip]").click();
  const confLines = page.locator("#activity [data-testid=activity-line]", { hasText: "Conference call with Danny and Sara" });
  await confLines.first().waitFor();
  const confRows = await sql(`SELECT "batchId" FROM "Activity" WHERE "organizationId"=$1 AND body='Conference call with Danny and Sara'`, [org]);
  assert.equal(confRows.rows.length, 2, "one row on each of them…");
  assert.ok(confRows.rows[0].batchId && confRows.rows[0].batchId === confRows.rows[1].batchId, "…sharing a batch");
  assert.equal(await confLines.count(), 1, "one line in the feed");
  assert.equal(await confLines.getByRole("link", { name: "Danny Ortiz" }).count(), 1, "naming Danny");
  assert.equal(await confLines.getByRole("link", { name: "Sara Lee" }).count(), 1, "and Sara");
  assert.doesNotMatch(await confLines.innerText(), /also on/, "nobody left over to count");
  assert.equal(Number(await tile("Calls").innerText()), callsBefore + 1, "Calls goes up by one");
  const distinctTouches = (
    await sql(
      `SELECT count(DISTINCT COALESCE(a."batchId", a.id))::int AS n FROM "Activity" a LEFT JOIN "Contact" c ON c.id = a."contactId"
        WHERE a."organizationId"=$1 AND NOT a.marketing AND (a."companyId"=$2 OR c."companyId"=$2)`,
      [org, spiritId],
    )
  ).rows[0].n;
  assert.match(await coOverview.innerText(), new RegExp(`${distinctTouches} touch(es)? logged`), `the total counts each touch once (${distinctTouches})`);
  // A marketing send to both is one batch too: one line, still no touch.
  await sql(
    `INSERT INTO "Activity" (id,"organizationId","contactId","userId",type,body,marketing,"batchId") VALUES
       ('act_cc_promo1',$1,$2,$4,'EMAIL','Emailed “November promo”',true,'batch_cc_promo'),
       ('act_cc_promo2',$1,$3,$4,'EMAIL','Emailed “November promo”',true,'batch_cc_promo')`,
    [org, dannyId, saraId, me],
  );
  await page.reload();
  const promoLines = page.locator("#activity [data-testid=activity-line]", { hasText: "November promo" });
  await promoLines.first().waitFor();
  assert.equal(await promoLines.count(), 1, "the send is one line");
  assert.equal(await promoLines.getAttribute("data-marketing"), "1");
  assert.match(await coOverview.innerText(), new RegExp(`${distinctTouches} touch(es)? logged`), "and not a touch");
  await shot(page, "10b-company-one-line-per-touch");

  log("audit fixes (UX review): the company page fits a 390px phone: nothing past the right edge, Claim tappable");
  // Something logged here with nobody linked, so Other Contacts offers Claim.
  await sql(
    `INSERT INTO "Activity" (id,"organizationId","companyId","userId",type,body) VALUES ('act_cc_bypass',$1,$2,$3,'PHONE_CALL','Front desk said call back Tuesday')`,
    [org, spiritId, me],
  );
  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: await context.storageState() });
  const phonePage = await phoneContext.newPage();
  await phonePage.goto(spiritUrl);
  await phonePage.getByRole("heading", { name: "Spirit Communications" }).waitFor();
  const fit = await phonePage.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
    past: [...document.querySelectorAll("main .card")]
      .filter((card) => card.getBoundingClientRect().right > document.documentElement.clientWidth + 0.5)
      .map((card) => `${(card.querySelector("h2, h3")?.textContent ?? card.textContent).trim().slice(0, 30)} ends at ${Math.round(card.getBoundingClientRect().right)}`),
  }));
  assert.ok(fit.scroll <= fit.client, `the page is ${fit.scroll}px on a ${fit.client}px phone`);
  assert.deepEqual(fit.past, [], "no card runs past the right edge");
  // The not-linked line opens the list (Nov 11, 2026).
  await phonePage.locator("[data-testid=not-linked-toggle]").tap();
  const claim = phonePage.locator("[data-testid=claim-one]").first();
  await claim.scrollIntoViewIfNeeded();
  const claimBox = await claim.boundingBox();
  assert.ok(claimBox.x >= 0 && claimBox.x + claimBox.width <= 390, `Claim is on screen (${claimBox.x}–${claimBox.x + claimBox.width})`);
  await claim.tap({ trial: true });
  await phonePage.screenshot({ path: path.join(OUT, "10c-company-phone.png"), fullPage: true });
  await phoneContext.close();

  log("a contract can name the deal; sending moves it to Contract Sent, signing wins it");
  await page.goto(`${BASE}/dashboard/contracts/new?contactId=${dannyUrl.split("/").pop()}`);
  await page.fill("#dealTitle", "Fiber");
  await page.getByRole("option", { name: /Fiber install/ }).click();
  await page.getByText("Quote Sent").waitFor();
  await page.getByRole("button", { name: "Generate contract" }).click();
  await page.waitForURL(/\/dashboard\/contracts\/(?!new$)[a-z0-9]+$/);
  assert.ok(await page.getByText(/CON-1000 · Fiber install · Spirit Communications/).isVisible());
  // Contracts v1 shows Send in the header and in the Sending card.
  await page.getByRole("button", { name: "Send for signature" }).first().click();
  await page.getByText("Signature link").waitFor();
  let stage = await sql(`SELECT stage FROM "Deal" WHERE title='Fiber install' AND "organizationId"=$1`, [org]);
  assert.equal(stage.rows[0].stage, "CONTRACT_SENT");
  const token = await sql(`SELECT "publicToken" FROM "Contract" WHERE number=1000 AND "organizationId"=$1`, [org]);
  await page.goto(`${BASE}/c/${token.rows[0].publicToken}`);
  await page.fill("[name=signerName]", "Danny Ortiz");
  await page.check("[name=agree]");
  await page.getByRole("button", { name: "Sign contract" }).click();
  await page.getByRole("button", { name: "Sign contract" }).waitFor({ state: "detached" });
  await page.waitForLoadState("networkidle");
  stage = await sql(`SELECT stage FROM "Deal" WHERE title='Fiber install' AND "organizationId"=$1`, [org]);
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
  const remaining = await sql(`SELECT count(*)::int AS n FROM "Contact" WHERE name IN ('Danny Ortiz','Sara Lee') AND "organizationId"=$1`, [org]);
  assert.equal(remaining.rows[0].n, 2, "deleting a company keeps its people");

  log("audit fixes (UX review): the people picker finds a number however it's typed, and shows a mobile-only person's mobile");
  await sql(
    `INSERT INTO "Contact" (id,"organizationId",name,mobile,"updatedAt") VALUES ('cc_mobile_only',$1,'Mona Mobile','(870) 555-0167',now())`,
    [org],
  );
  for (const typed of ["870-555-0167", "8705550167", "870.555.0167"]) {
    const hits = await (await page.request.get(`${BASE}/dashboard/contacts/search?q=${encodeURIComponent(typed)}`)).json();
    const mona = hits.find((hit) => hit.id === "cc_mobile_only");
    assert.ok(mona, `"${typed}" doesn't find Mona`);
    assert.equal(mona.phone, "(870) 555-0167", "her mobile stands in for the missing phone");
  }

  void quoteBUrl;
  void quoteCUrl;
  await browser.close();
  console.log(`\nALL ${step} STEPS PASSED. Screenshots in ${OUT}`);
})().catch((err) => {
  console.error("\nFAILED at step", step, "\n", err);
  process.exit(1);
});
