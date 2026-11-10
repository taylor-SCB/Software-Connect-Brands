/* Browser regression for the five reports on Overview (Nov 10, 2026).
 *
 * Seeds a workspace with a known spread — two reps, opportunities at both
 * meeting stages, deals at Quote Sent and Contract Sent (one valued from a
 * quote with a line discount and a 10% whole-quote discount, one from an
 * accepted quote beside a newer sent one, one typed), wins and a loss this
 * month and a win last month, touches by both reps with marketing sends
 * beside them, signed paperwork part paid, an invoice 100 days overdue and
 * an unsigned contract, today's calendar and an overdue follow-up — and
 * checks every report's numbers against what was seeded and against SQL:
 * the Daily Rundown (inside Overview's own welcome, tiles and recent
 * activity), Pipeline, Activity, Closing and Money Owed; the period, rep
 * and "Break down by" pickers in the address bar; the write-up (the rules
 * version, its cache, Rewrite; then a second server with a stand-in Claude
 * on :3994 whose good answer is used and whose answer with an invented
 * number is thrown out for the rules version); "Email me this" and its
 * list in Settings → My Account with Remove; the cron refusing without the
 * secret, a forced Monday-6am run sending exactly the due emails (caught
 * on :3993), a second run sending none; the Nov 10 audit fixes (a rep's
 * Overview tiles and activity, Closing's empty tiles, one email on the
 * spring-forward Sunday, invented numbers as words or near the year); each report's open time (budget
 * 2 s — run the server through slow-db-proxy.cjs to measure it the way the
 * live database answers); and the phone width. The UX review fixes (Nov
 * 10, 2026), each an "audit fixes (UX review)" step: the calendar card
 * listing open entries first with the heading counting only those and the
 * write-up starting with the first open one (and the AI told which are
 * done); a rise from 0 reading "▲ up from 0", never "from 0 vs 0"; Owed by
 * rep with nothing in it saying so once; Overview on an isMobile phone
 * staying 390px wide with a long activity line cut with …; and the
 * Activity chart's labels at 11px on a phone and at 1440, bars at most
 * 28px, and the axis on round numbers.
 *
 * The server on BASE needs, in .env: RESEND_API_KEY (any), EMAIL_FROM,
 * RESEND_ENDPOINT=http://localhost:3993/emails, CRON_SECRET=test-cron-secret,
 * REPORTS_TEST_CLOCK=1 and APP_URL=<BASE>, and no ANTHROPIC_API_KEY. The
 * suite starts its own second server (AI_PORT, default 3113) from this
 * checkout's build with ANTHROPIC_API_KEY=test-key and
 * ANTHROPIC_ENDPOINT=http://localhost:3994, and stops it at the end.
 *
 *   BASE=http://localhost:3103 \
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/scb_reports \
 *   NODE_PATH=$(npm root -g):$(pwd)/node_modules \
 *   node scripts/browser-tests/reports.cjs
 */
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS on purpose: NODE_PATH only resolves the global playwright for require() */
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const { Client } = require("pg");

const BASE = process.env.BASE || "http://localhost:3103";
const DB = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5433/scb_reports";
const AI_PORT = Number(process.env.AI_PORT || 3113);
const AI_BASE = `http://localhost:${AI_PORT}`;
const AI_DB = process.env.AI_DATABASE_URL || DB;
const MAIL_PORT = 3993;
const CLAUDE_PORT = 3994;
const SECRET = process.env.CRON_SECRET || "test-cron-secret";
const OUT = process.env.SHOTS_DIR || path.join(os.tmpdir(), "scb-browser-shots-reports");
fs.mkdirSync(OUT, { recursive: true });

const EMAIL = "test-reports-owner@example.com";
const NIC_EMAIL = "test-reports-nic@example.com";
const PASSWORD = "password123";
const COMPANY = "Test Reports Co";
const SLUG_LIKE = "test-reports-co%";
const TZ = "America/Chicago";
const BUDGET_MS = 2000;

let step = 0;
function log(msg) {
  step += 1;
  console.log(`[${String(step).padStart(2, "0")}] ${msg}`);
}
async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
}
const pool = new Client({ connectionString: DB });
async function sql(text, params) {
  return pool.query(text, params);
}

// Every email the app sent, newest last.
const inbox = [];
const mail = http.createServer((req, res) => {
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

// The stand-in Claude: answers with whatever `claudeReply` holds.
let claudeReply = { paragraphs: ["placeholder"] };
const claudeRequests = [];
const claude = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    claudeRequests.push({ url: req.url, body: JSON.parse(raw || "{}") });
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        id: "msg_test",
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content: [{ type: "text", text: JSON.stringify(claudeReply) }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
    );
  });
});

function localIso(at) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}
function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
// Noon on a calendar day in the workspace's zone, as the UTC timestamp the
// app stores.
const noon = (iso) => `((${`'${iso}'`}::date + time '12:00') AT TIME ZONE '${TZ}') AT TIME ZONE 'UTC'`;
const ago = (interval) => `(now() AT TIME ZONE 'UTC') - interval '${interval}'`;

async function tile(page, id) {
  const el = page.locator(`[data-testid=report-tile][data-id=${id}]`);
  await el.waitFor();
  return Number(await el.getAttribute("data-value"));
}
async function open(page, url, report) {
  const started = Date.now();
  const response = await page.goto(url);
  assert.equal(response.status(), 200, url);
  await page.locator(`[data-testid=report][data-report=${report}]`).waitFor();
  return Date.now() - started;
}
async function pick(page, testId, value, report) {
  await page.selectOption(`[data-testid=${testId}]`, value);
  await page.waitForURL((url) => url.searchParams.get(testId.replace("report-", "")) === value || (value === "" && !url.searchParams.get("rep")));
  await page.locator(`[data-testid=report][data-report=${report}]`).waitFor();
  await page.waitForLoadState("networkidle");
}
async function groupRows(page) {
  return page.locator("[data-testid=report-group-table] tbody tr").evaluateAll((rows) =>
    rows.map((row) => Array.from(row.querySelectorAll("td")).map((cell) => cell.textContent.trim())),
  );
}
async function narrativeText(page) {
  return (await page.locator("[data-testid=report-narrative-body]").textContent()).replace(/\s+/g, " ");
}

(async () => {
  await pool.connect();
  await new Promise((resolve) => mail.listen(MAIL_PORT, resolve));
  await new Promise((resolve) => claude.listen(CLAUDE_PORT, resolve));
  await sql(`DELETE FROM "Organization" WHERE slug LIKE $1`, [SLUG_LIKE]);
  await sql(`DELETE FROM "User" WHERE email IN ($1, $2)`, [EMAIL, NIC_EMAIL]);

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on("pageerror", (err) => console.error("PAGE ERROR:", err.message));
  let aiServer = null;
  const timings = {};

  try {
    log("sign up, activate, and add a second rep");
    await page.goto(`${BASE}/signup`);
    await page.fill("[name=companyName]", COMPANY);
    await page.fill("[name=name]", "Taylor Test");
    await page.fill("[name=email]", EMAIL);
    await page.fill("[name=phone]", "5550000000");
    await page.fill("[name=password]", PASSWORD);
    await page.click("button[type=submit]");
    await page.waitForURL(/\/signup\/submitted/);
    await sql(`UPDATE "Organization" SET status='ACTIVE', "reviewedAt"=now(), "timeZone"=$2, "nextContractNumber"=9100, "nextQuoteNumber"=9100 WHERE slug LIKE $1`, [SLUG_LIKE, TZ]);
    const org = (await sql(`SELECT id FROM "Organization" WHERE slug LIKE $1`, [SLUG_LIKE])).rows[0].id;
    const owner = (await sql(`SELECT id, "passwordHash" FROM "User" WHERE email=$1`, [EMAIL])).rows[0];
    const T = owner.id;
    const N = "usr_rpt_nic";
    await sql(`INSERT INTO "User" (id, name, email, "passwordHash", role, "organizationId") VALUES ($1, 'Nic Rivera', $2, $3, 'MEMBER', $4)`, [N, NIC_EMAIL, owner.passwordHash, org]);

    log("seed the known spread");
    const today = localIso(new Date());
    const yesterday = addDays(today, -1);
    const monthStart = `${today.slice(0, 7)}-01`;
    const lastMonth = new Date(`${monthStart}T00:00:00Z`);
    lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1);
    const lastMonthStart = lastMonth.toISOString().slice(0, 10);
    const old = ago("60 days");
    await sql(
      `INSERT INTO "Company" (id,"organizationId",name,industries,state,"createdAt","updatedAt") VALUES
         ('cmp_rpt_acme',$1,'Acme Plumbing','{Plumbing}','TX',${old},now()),
         ('cmp_rpt_bolt',$1,'Bolt Air','{HVAC}','CO',${old},now())`,
      [org],
    );
    await sql(
      `INSERT INTO "Contact" (id,"organizationId","companyId",name,title,state,"ownerId","createdById","createdAt","updatedAt") VALUES
         ('ct_rpt_ann',$1,'cmp_rpt_acme','Ann Acme','Owner',NULL,$2,$2,${old},now()),
         ('ct_rpt_bob',$1,'cmp_rpt_bolt','Bob Bolt','office manager',NULL,$3,$3,${old},now()),
         ('ct_rpt_cal',$1,NULL,'Cal Home',NULL,'TX',NULL,$2,${old},now()),
         ('ct_rpt_dee',$1,'cmp_rpt_acme','Dee Acme',' owner ',NULL,$3,$3,${old},now()),
         ('ct_rpt_eve',$1,NULL,'Eve New',NULL,'CO',$3,$3,${noon(yesterday)},now())`,
      [org, T, N],
    );
    // Deals: two at Quote Sent, one at Contract Sent, two won and one lost
    // this month, one won last month.
    await sql(
      `INSERT INTO "Deal" (id,"organizationId","contactId",title,stage,"valueCents","ownerId","stageChangedAt","createdAt","updatedAt") VALUES
         ('deal_rpt_q1',$1,'ct_rpt_ann','Acme repipe','QUOTE_SENT',0,$2,${ago("10 days")},${ago("12 days")},now()),
         ('deal_rpt_q2',$1,'ct_rpt_bob','Bolt rooftop units','QUOTE_SENT',300000,$3,${ago("100 days")},${ago("120 days")},now()),
         ('deal_rpt_c1',$1,'ct_rpt_bob','Bolt service plan','CONTRACT_SENT',0,$3,${ago("3 days")},${ago("30 days")},now()),
         ('deal_rpt_w1',$1,'ct_rpt_ann','Acme water heaters','WON',0,$2,${ago("5 minutes")},${ago("20 days")},now()),
         ('deal_rpt_w2',$1,'ct_rpt_bob','Bolt duct cleaning','WON',200000,$3,${ago("6 minutes")},${ago("10 days")},now()),
         ('deal_rpt_l1',$1,'ct_rpt_bob','Bolt boiler','LOST',100000,$3,${ago("7 minutes")},${ago("10 days")},now()),
         ('deal_rpt_wp',$1,'ct_rpt_ann','Acme last month','WON',150000,$2,${noon(addDays(lastMonthStart, 1))},${noon(lastMonthStart)},now())`,
      [org, T, N],
    );
    // Quotes: q1 = 2 x $1,000 + $500 less $100 on the line = $2,400, less 10% = $2,160.
    // c1 = the accepted $4,000 quote less $500 = $3,500 (the newer sent $9,999 one loses).
    // w1 = $5,000.
    await sql(
      `INSERT INTO "Quote" (id,"organizationId","contactId","dealId",number,title,status,"discountCents","discountPercent","publicToken","sentAt","createdAt","updatedAt") VALUES
         ('q_rpt_q1',$1,'ct_rpt_ann','deal_rpt_q1',9001,'Repipe','SENT',240,10,'tok_rpt_q1',${noon(yesterday)},now(),${ago("1 day")}),
         ('q_rpt_c1a',$1,'ct_rpt_bob','deal_rpt_c1',9002,'Plan','ACCEPTED',50000,NULL,'tok_rpt_c1a',${ago("20 days")},now(),${ago("10 days")}),
         ('q_rpt_c1b',$1,'ct_rpt_bob','deal_rpt_c1',9003,'Plan v2','SENT',0,NULL,'tok_rpt_c1b',${ago("15 days")},now(),${ago("1 day")}),
         ('q_rpt_w1',$1,'ct_rpt_ann','deal_rpt_w1',9004,'Heaters','ACCEPTED',0,NULL,'tok_rpt_w1',${ago("15 days")},now(),${ago("1 day")})`,
      [org],
    );
    await sql(
      `INSERT INTO "QuoteLineItem" (id,"quoteId",name,quantity,"unitPriceCents","discountCents",tag) VALUES
         ('li_rpt_1','q_rpt_q1','Pipe',2,100000,0,'MATERIALS'),
         ('li_rpt_2','q_rpt_q1','Labor',1,50000,10000,'LABOR'),
         ('li_rpt_3','q_rpt_c1a','Plan',1,400000,0,'LABOR'),
         ('li_rpt_4','q_rpt_c1b','Plan',1,999900,0,'LABOR'),
         ('li_rpt_5','q_rpt_w1','Heaters',1,500000,0,'MATERIALS')`,
    );
    // Opportunities: one per deal, plus one at each meeting stage.
    await sql(
      `INSERT INTO "Opportunity" (id,"organizationId",title,stage,"leadLabel","ownerId","dealId","completedAt","createdAt","updatedAt") VALUES
         ('opp_rpt_m1',$1,'Cal Home','MEETING_SET',NULL,$2,NULL,NULL,${ago("2 days")},now()),
         ('opp_rpt_m2',$1,'Dee Acme','MEETING_COMPLETED','Client',$3,NULL,${ago("40 days")},${ago("45 days")},now()),
         ('opp_rpt_q1',$1,'Acme repipe','MEETING_COMPLETED','Residential',$2,'deal_rpt_q1',NULL,${ago("12 days")},now()),
         ('opp_rpt_q2',$1,'Bolt rooftop units','MEETING_COMPLETED',NULL,$3,'deal_rpt_q2',NULL,${ago("120 days")},now()),
         ('opp_rpt_c1',$1,'Bolt service plan','MEETING_COMPLETED','Client',$3,'deal_rpt_c1',NULL,${ago("30 days")},now()),
         ('opp_rpt_w1',$1,'Acme water heaters','MEETING_COMPLETED','Residential',$2,'deal_rpt_w1',NULL,${ago("20 days")},now()),
         ('opp_rpt_w2',$1,'Bolt duct cleaning','MEETING_COMPLETED',NULL,$3,'deal_rpt_w2',NULL,${ago("10 days")},now()),
         ('opp_rpt_l1',$1,'Bolt boiler','MEETING_COMPLETED',NULL,$3,'deal_rpt_l1',NULL,${ago("10 days")},now()),
         ('opp_rpt_wp',$1,'Acme last month','MEETING_COMPLETED',NULL,$2,'deal_rpt_wp',NULL,${noon(lastMonthStart)},now())`,
      [org, T, N],
    );
    await sql(
      `INSERT INTO "OpportunityContact" (id,"opportunityId","contactId",role) VALUES
         ('oc_rpt_m1','opp_rpt_m1','ct_rpt_cal','PRIMARY'), ('oc_rpt_m2','opp_rpt_m2','ct_rpt_dee','PRIMARY'),
         ('oc_rpt_q1','opp_rpt_q1','ct_rpt_ann','PRIMARY'), ('oc_rpt_q2','opp_rpt_q2','ct_rpt_bob','PRIMARY'),
         ('oc_rpt_c1','opp_rpt_c1','ct_rpt_bob','PRIMARY'), ('oc_rpt_w1','opp_rpt_w1','ct_rpt_ann','PRIMARY'),
         ('oc_rpt_w2','opp_rpt_w2','ct_rpt_bob','PRIMARY'), ('oc_rpt_l1','opp_rpt_l1','ct_rpt_bob','PRIMARY'),
         ('oc_rpt_wp','opp_rpt_wp','ct_rpt_ann','PRIMARY')`,
    );
    // What moved this month: two meetings set and one held (people), and
    // the paperwork steps (deals); one win last month.
    await sql(
      `INSERT INTO "StatusChange" (id,"organizationId","contactId","dealId","userId","fromStatus","toStatus","on") VALUES
         ('sc_rpt_1',$1,'ct_rpt_ann',NULL,$2,'CONTACTED','MEETING_SET',${ago("9 minutes")}),
         ('sc_rpt_2',$1,'ct_rpt_cal',NULL,$2,'CONTACTED','MEETING_SET',${ago("9 minutes")}),
         ('sc_rpt_3',$1,'ct_rpt_ann',NULL,$2,'MEETING_SET','MEETING_COMPLETED',${ago("8 minutes")}),
         ('sc_rpt_4',$1,NULL,'deal_rpt_q1',$2,'LEAD','QUOTE_SENT',${ago("8 minutes")}),
         ('sc_rpt_5',$1,NULL,'deal_rpt_c1',$3,'QUOTE_SENT','CONTRACT_SENT',${ago("8 minutes")}),
         ('sc_rpt_6',$1,NULL,'deal_rpt_w1',$2,'CONTRACT_SENT','WON',${ago("5 minutes")}),
         ('sc_rpt_7',$1,NULL,'deal_rpt_w2',$3,'CONTRACT_SENT','WON',${ago("6 minutes")}),
         ('sc_rpt_8',$1,NULL,'deal_rpt_l1',$3,'CONTRACT_SENT','LOST',${ago("7 minutes")}),
         ('sc_rpt_9',$1,NULL,'deal_rpt_wp',$2,'CONTRACT_SENT','WON',${noon(addDays(lastMonthStart, 1))})`,
      [org, T, N],
    );
    // Touches this week: Taylor 2 calls + a meeting with Ann, Nic an email
    // and a text with Bob; three marketing sends; one call the same days
    // last week.
    await sql(
      `INSERT INTO "Activity" (id,"organizationId","contactId","userId",type,body,marketing,"occurredAt") VALUES
         ('a_rpt_1',$1,'ct_rpt_ann',$2,'PHONE_CALL','Call',false,${ago("5 minutes")}),
         ('a_rpt_2',$1,'ct_rpt_ann',$2,'PHONE_CALL','Call',false,${ago("6 minutes")}),
         ('a_rpt_3',$1,'ct_rpt_ann',$2,'MEETING','Meeting',false,${ago("7 minutes")}),
         ('a_rpt_4',$1,'ct_rpt_bob',$3,'EMAIL','Email',false,${ago("5 minutes")}),
         ('a_rpt_5',$1,'ct_rpt_bob',$3,'TEXT','Text',false,${ago("6 minutes")}),
         ('a_rpt_6',$1,'ct_rpt_cal',$2,'EMAIL','Newsletter',true,${ago("4 minutes")}),
         ('a_rpt_7',$1,'ct_rpt_dee',$2,'EMAIL','Newsletter',true,${ago("4 minutes")}),
         ('a_rpt_8',$1,'ct_rpt_ann',$2,'EMAIL','Newsletter',true,${ago("4 minutes")}),
         ('a_rpt_9',$1,'ct_rpt_ann',$2,'PHONE_CALL','Call',false,${ago("7 days 10 minutes")})`,
      [org, T, N],
    );
    // Money: Acme's signed agreement ($2,000 45 days late, $500 paid
    // yesterday; $3,000 due in 10 days, $250 paid on the 1st of last
    // month), Cal's $1,200 100 days late, and Bolt's unsigned $3,500.
    await sql(
      `INSERT INTO "Contract" (id,"organizationId","contactId","companyId","dealId",number,title,body,status,payable,"publicToken","sentAt","signedAt","discountCents","updatedAt") VALUES
         ('con_rpt_1',$1,'ct_rpt_ann','cmp_rpt_acme','deal_rpt_w1',9001,'Heaters agreement','x','SIGNED',false,'ctok_rpt_1',${ago("50 days")},${ago("49 days")},0,now()),
         ('con_rpt_2',$1,'ct_rpt_cal',NULL,NULL,9002,'Cal invoice','x','SIGNED',false,'ctok_rpt_2',${ago("130 days")},${ago("130 days")},0,now()),
         ('con_rpt_3',$1,'ct_rpt_bob','cmp_rpt_bolt','deal_rpt_c1',9003,'Service plan','x','SENT',false,'ctok_rpt_3',${noon(yesterday)},NULL,0,now())`,
      [org],
    );
    await sql(
      `INSERT INTO "ContractPayment" (id,"contractId","organizationId",label,kind,"amountCents","dueOn",position) VALUES
         ('cp_rpt_1','con_rpt_1',$1,'Deposit','FIXED',200000,$2::date,0),
         ('cp_rpt_2','con_rpt_1',$1,'Balance','BALANCE',300000,$3::date,1),
         ('cp_rpt_3','con_rpt_2',$1,'Invoice','FIXED',120000,$4::date,0),
         ('cp_rpt_4','con_rpt_3',$1,'All','FIXED',350000,NULL,0)`,
      [org, addDays(today, -45), addDays(today, 10), addDays(today, -100)],
    );
    await sql(`INSERT INTO "ContractLineItem" (id,"contractId",name,quantity,"unitPriceCents","discountCents",tag) VALUES ('cli_rpt_1','con_rpt_3','Plan',1,350000,0,'LABOR')`).catch(async (error) => {
      // Older column sets: fall back to the payment table alone.
      console.warn("  (contract line item not seeded:", error.message, ")");
    });
    await sql(
      `INSERT INTO "Payment" (id,"organizationId","contractPaymentId","amountCents","paidOn",method) VALUES
         ('pay_rpt_1',$1,'cp_rpt_1',50000,$2::date,'Check'),
         ('pay_rpt_2',$1,'cp_rpt_2',25000,$3::date,'ACH')`,
      [org, yesterday, lastMonthStart],
    );
    // Today's calendar, an overdue follow-up, and a past install that is not
    // a follow-up.
    await sql(
      `INSERT INTO "CalendarEvent" (id,"organizationId",title,type,"startOn","startTime","ownerId","contactId","updatedAt") VALUES
         ('ev_rpt_1',$1,'Site walk at Acme','Site walk',$2::date,'09:00',$4,'ct_rpt_ann',now()),
         ('ev_rpt_2',$1,'Call Bob','Call',$2::date,NULL,$5,'ct_rpt_bob',now()),
         ('ev_rpt_3',$1,'Follow up · Ann Acme','Quote follow up',$3::date,NULL,$4,'ct_rpt_ann',now()),
         ('ev_rpt_4',$1,'Install at Acme','Install',$3::date,NULL,$4,NULL,now())`,
      [org, today, addDays(today, -3), T, N],
    );

    log("Overview opens on the Daily Rundown, inside the welcome, tiles and recent activity");
    await page.goto(`${BASE}/login`);
    await page.fill("#email", EMAIL);
    await page.fill("#password", PASSWORD);
    await page.click("button[type=submit]");
    await page.waitForURL(/\/dashboard$/);
    timings.daily = await open(page, `${BASE}/dashboard`, "daily");
    const tabs = await page.locator("[data-testid=report-tab]").allTextContents();
    assert.deepEqual(tabs, ["Daily Rundown", "Pipeline", "Activity", "Closing", "Money Owed"]);
    assert.equal(await page.locator("[data-testid=report-tab][aria-current=page]").textContent(), "Daily Rundown");
    await page.getByText(/Welcome back, Taylor/).waitFor();
    await page.locator("[data-testid=owed-where]").waitFor();
    assert.match(await page.locator("[data-testid=stat-tile]").first().textContent(), /Owed to you/);
    await page.getByText("Recent activity").waitFor();
    await page.getByText("Jump in").waitFor();
    const heading = (id) => page.locator(`[data-testid=${id}] h3`).textContent();
    assert.match(await heading("rundown-calendar"), /On the calendar today · 2/);
    assert.match(await page.locator("[data-testid=rundown-calendar]").textContent(), /Site walk at Acme.*09:00/s);
    const overdueSql = (
      await sql(
        `SELECT COUNT(*)::int AS n FROM "CalendarEvent" WHERE "organizationId"=$1 AND "doneAt" IS NULL AND "startOn" < $2::date
           AND type IN ('Call','Meeting','Email','Text','Quote due','Quote follow up','Contract follow up')`,
        [org, today],
      )
    ).rows[0].n;
    assert.equal(overdueSql, 1);
    assert.match(await heading("rundown-overdue"), new RegExp(`Overdue follow-ups · ${overdueSql}`));
    assert.match(await page.locator("[data-testid=rundown-overdue]").textContent(), /Follow up · Ann Acme.*3d late/s);
    assert.match(await heading("rundown-quiet"), /Gone quiet · 1/);
    assert.match(await page.locator("[data-testid=rundown-quiet]").textContent(), /Dee Acme/);
    assert.match(await page.locator("[data-testid=rundown-payments]").textContent(), /\$500.*Acme Plumbing/s);
    assert.match(await page.locator("[data-testid=rundown-sent]").textContent(), /QUO-9001 · Acme Plumbing.*\$2,160.*CON-9003 · Bolt Air/s);
    assert.match(await heading("rundown-contacts"), /New contacts yesterday · 1/);
    assert.match(await page.locator("[data-testid=rundown-contacts]").textContent(), /Eve New/);

    log("the Daily Rundown's write-up is the rules version, from the same numbers");
    assert.equal(await page.locator("[data-testid=report-narrative]").getAttribute("data-source"), "RULES");
    let words = await narrativeText(page);
    assert.match(words, /The team has 2 things on the calendar today, starting with “Site walk at Acme” at 09:00\./);
    assert.match(words, /1 follow-up is overdue — the oldest, “Follow up · Ann Acme” with Ann Acme, is 3 days late\./);
    assert.match(words, /Yesterday \$500 came in from 1 payment, the largest from Acme Plumbing\./);
    assert.match(words, /1 quote worth \$2,160 and 1 contract went out, and 1 new contact was added\./);
    await shot(page, "01-daily");

    log("the rep picker narrows the rundown to Nic's calendar and follow-ups");
    await pick(page, "report-rep", N, "daily");
    assert.match(await heading("rundown-calendar"), /On the calendar today · 1/);
    assert.match(await page.locator("[data-testid=rundown-calendar]").textContent(), /Call Bob/);
    assert.match(await page.locator("[data-testid=rundown-overdue]").textContent(), /Nothing overdue/);
    assert.match(await page.locator("[data-testid=report-scope]").textContent(), /Nic Rivera/);

    log("audit fixes: with a rep picked, the Overview tiles and Recent activity are that rep's too");
    const statValue = async (label) => (await page.locator(`[data-testid=stat-tile][data-label="${label}"] p.num`).textContent()).trim();
    const statHint = async (label) => (await page.locator(`[data-testid=stat-tile][data-label="${label}"] p.faint`).textContent()).trim();
    const count = async (text, params) => (await sql(text, params)).rows[0].n;
    const nicContacts = await count(`SELECT count(*)::int n FROM "Contact" WHERE "organizationId"=$1 AND "ownerId"=$2`, [org, N]);
    const allContacts = await count(`SELECT count(*)::int n FROM "Contact" WHERE "organizationId"=$1`, [org]);
    assert.notEqual(nicContacts, allContacts, "the seed tells a rep from the team");
    assert.equal(await statValue("Contacts"), String(nicContacts));
    const nicOpenDeals = await count(
      `SELECT count(*)::int n FROM "Deal" WHERE "organizationId"=$1 AND "ownerId"=$2 AND stage IN ('LEAD','CONTACTED','QUOTE_SENT','CONTRACT_SENT')`,
      [org, N],
    );
    assert.match(await statHint("Open pipeline"), new RegExp(`^${nicOpenDeals} active deals`));
    const nicSigned = await count(
      `SELECT count(*)::int n FROM "Contract" c JOIN "Deal" d ON d.id = c."dealId" WHERE c."organizationId"=$1 AND c.status='SIGNED' AND d."ownerId"=$2`,
      [org, N],
    );
    assert.equal(await statValue("Signed"), String(nicSigned));
    const nicActs = await count(`SELECT count(*)::int n FROM "Activity" WHERE "organizationId"=$1 AND "userId"=$2 AND marketing=false`, [org, N]);
    await page.getByText("Logged by this rep").waitFor();
    const recent = page.locator(".card", { has: page.locator("h2", { hasText: "Recent activity" }) }).locator("ul > li");
    assert.equal(await recent.count(), Math.min(8, nicActs), "only what Nic logged");
    await pick(page, "report-rep", "", "daily");
    assert.equal(await statValue("Contacts"), String(allContacts), "Whole team again");

    log("audit fixes (UX review): open calendar entries come first, the heading counts what is still open, and the write-up starts with the first open one");
    // Nine calls this morning already ticked done, all before the 09:00
    // site walk: by start time alone they took the card's eight rows, the
    // heading said 11 and the write-up started with a call already made.
    for (let i = 0; i < 9; i += 1) {
      await sql(
        `INSERT INTO "CalendarEvent" (id,"organizationId",title,type,"startOn","startTime","ownerId","doneAt","updatedAt") VALUES ($1,$2,$3,'Call',$4::date,$5,$6,now(),now())`,
        [`ev_rpt_done_${i}`, org, `Done call ${i + 1}`, today, `0${7 + Math.floor(i / 5)}:${String((i % 5) * 10).padStart(2, "0")}`, T],
      );
    }
    const calendarRows = () =>
      page.locator("[data-testid=rundown-calendar] li").evaluateAll((rows) => rows.map((row) => ({ text: row.textContent, done: row.dataset.done === "true" })));
    await open(page, `${BASE}/dashboard`, "daily");
    assert.equal((await heading("rundown-calendar")).trim(), "On the calendar today · 2", "2 still open, not 11");
    assert.match(await page.locator("[data-testid=rundown-calendar]").textContent(), /Still open · 9 already done/);
    let calRows = await calendarRows();
    assert.equal(calRows.length, 8);
    assert.deepEqual(calRows.map((row) => row.done), [false, false, true, true, true, true, true, true], "open first, the done calls after");
    assert.match(calRows[0].text, /Site walk at Acme.*09:00/s);
    assert.match(calRows[1].text, /Call Bob/);
    assert.match(await narrativeText(page), /The team has 11 things on the calendar today, 2 still open, starting with “Site walk at Acme” at 09:00\./);
    await sql(`UPDATE "CalendarEvent" SET "doneAt"=now() WHERE id IN ('ev_rpt_1','ev_rpt_2')`);
    await open(page, `${BASE}/dashboard`, "daily");
    assert.equal((await heading("rundown-calendar")).trim(), "On the calendar today", "nothing open, no count");
    assert.match(await page.locator("[data-testid=rundown-calendar]").textContent(), /All 11 done/);
    calRows = await calendarRows();
    assert.ok(calRows.length === 8 && calRows.every((row) => row.done), "the done entries are still listed");
    words = await narrativeText(page);
    assert.match(words, /The team has 11 things on the calendar today, all done\./);
    assert.doesNotMatch(words, /starting with/);
    await sql(`UPDATE "CalendarEvent" SET "doneAt"=NULL WHERE id IN ('ev_rpt_1','ev_rpt_2')`);
    await sql(`DELETE FROM "CalendarEvent" WHERE id LIKE 'ev_rpt_done_%'`);

    log("Pipeline: open value by stage, from opportunities and deals, matches the seed and SQL");
    timings.pipeline = await open(page, `${BASE}/dashboard?report=pipeline`, "pipeline");
    assert.equal(await tile(page, "open-value"), 866000, "$2,160 + $3,000 + $3,500");
    assert.equal(await tile(page, "quotes-out"), 516000);
    assert.equal(await tile(page, "contracts-out"), 350000);
    assert.equal(await tile(page, "meetings"), 2);
    const openSql = (
      await sql(
        `SELECT (SELECT COUNT(*) FROM "Deal" WHERE "organizationId"=$1 AND stage IN ('QUOTE_SENT','CONTRACT_SENT'))
              + (SELECT COUNT(*) FROM "Opportunity" o LEFT JOIN "Deal" d ON d.id=o."dealId"
                  WHERE o."organizationId"=$1 AND o.stage IN ('MEETING_SET','MEETING_COMPLETED')
                    AND (d.id IS NULL OR d.stage IN ('LEAD','CONTACTED'))) AS n`,
        [org],
      )
    ).rows[0].n;
    const stageRows = await page.locator("[data-testid=pipeline-stage-table] tbody tr").evaluateAll((rows) =>
      rows.map((row) => Array.from(row.querySelectorAll("td")).map((cell) => cell.textContent.trim())),
    );
    assert.deepEqual(
      stageRows.map((row) => row.slice(0, 3)),
      [
        ["Meeting Set", "1", "$0"],
        ["Meeting Completed", "1", "$0"],
        ["Quote Sent", "2", "$5,160"],
        ["Contract Sent", "1", "$3,500"],
      ],
    );
    assert.equal(stageRows.reduce((sum, row) => sum + Number(row[1]), 0), Number(openSql));
    log("Pipeline: what moved this month, conversions, aging and the oldest item");
    const moves = await page.locator("[data-testid=pipeline-moves-table] tbody tr").evaluateAll((rows) =>
      Object.fromEntries(rows.map((row) => [row.dataset.step, Array.from(row.querySelectorAll("td")).map((cell) => cell.textContent.trim())])),
    );
    assert.deepEqual(moves.MEETING_SET.slice(1, 3), ["2", "0"]);
    assert.deepEqual(moves.MEETING_COMPLETED.slice(1, 3), ["1", "0"]);
    assert.deepEqual(moves.QUOTE_SENT.slice(1, 3), ["1", "0"]);
    assert.deepEqual(moves.CONTRACT_SENT.slice(1, 3), ["1", "0"]);
    assert.deepEqual(moves.WON.slice(1, 3), ["2", "1"]);
    assert.equal(moves.WON[4], "$7,000");
    assert.deepEqual(moves.LOST.slice(1, 3), ["1", "0"]);
    assert.match(await page.locator("[data-testid=pipeline-conversions]").textContent(), /Meeting set → Meeting held50%.*Decided → Won67%/s);
    const aging = await page.locator("[data-testid=pipeline-aging]").textContent();
    assert.match(aging, /Under a week.*2.*8–30 days.*1.*31–60 days.*1.*Over 90 days.*1/s);
    assert.match(await page.locator("[data-testid=pipeline-stuck] li").first().textContent(), /Bolt rooftop units.*100 days.*\$3,000/s);
    assert.deepEqual(
      (await groupRows(page)).map((row) => [row[0], row[1], row[5]]),
      [
        ["Nic Rivera", "3", "$6,500"],
        ["Taylor Test", "2", "$2,160"],
      ],
    );
    words = await narrativeText(page);
    assert.match(words, /There is \$8,660 open in the pipeline right now across 5 items: \$5,160 in quotes out \(2 deals\), \$3,500 in contracts waiting on a signature \(1 deal\), and 2 opportunities still at the meeting stage\./);
    assert.match(words, /Nic Rivera carries the most open value at \$6,500, and Taylor Test the least at \$2,160\./);
    await shot(page, "02-pipeline");

    log("Pipeline: Break down by Lead label, and the rep picker to Nic, in the address bar");
    await pick(page, "report-by", "label", "pipeline");
    assert.match(page.url(), /report=pipeline/);
    assert.match(page.url(), /by=label/);
    assert.deepEqual(
      (await groupRows(page)).map((row) => [row[0], row[5]]).sort(),
      [
        ["Client", "$3,500"],
        ["N/A", "$3,000"],
        ["Residential", "$2,160"],
      ],
    );
    await pick(page, "report-rep", N, "pipeline");
    assert.match(page.url(), new RegExp(`rep=${N}`));
    assert.match(page.url(), /by=label/, "the breakdown stays");
    assert.equal(await tile(page, "open-value"), 650000);

    log("Activity: touches by day, kind and rep, marketing on its own, who wasn't touched");
    timings.activity = await open(page, `${BASE}/dashboard?report=activity`, "activity");
    assert.equal(await tile(page, "touches"), 5, "marketing sends are not touches");
    const touchesSql = (
      await sql(
        `SELECT COUNT(*)::int AS n FROM "Activity" WHERE "organizationId"=$1 AND marketing=false AND "occurredAt" >= (now() AT TIME ZONE 'UTC') - interval '1 hour'`,
        [org],
      )
    ).rows[0].n;
    assert.equal(touchesSql, 5);
    assert.equal(Number(await page.locator("[data-testid=report-tile][data-id=touches]").getAttribute("data-value")), touchesSql);
    assert.match(await page.locator("[data-testid=report-tile][data-id=touches]").textContent(), /▲ 400%/, "against 1 the same days last week");
    assert.equal(await tile(page, "people"), 2);
    assert.equal(await tile(page, "calls"), 2);
    assert.equal(await tile(page, "meetings"), 1);
    assert.equal(await tile(page, "marketing"), 3);
    assert.equal(await tile(page, "untouched"), 3, "Cal, Dee and Eve");
    assert.deepEqual(
      (await groupRows(page)).map((row) => [row[0], row[1], row[6]]),
      [
        ["Taylor Test", "3", "0"],
        ["Nic Rivera", "2", "2"],
        ["Unassigned", "0", "1"],
      ],
    );
    assert.match(await page.locator("[data-testid=activity-marketing]").textContent(), /3 sent/);
    words = await narrativeText(page);
    assert.match(words, /The team logged 5 touches this week — 2 calls, 1 email, 1 text and 1 meeting — reaching 2 people, against 1 touch the same days last week\./);
    assert.match(words, /Taylor Test logged the most touches \(3\); Nic Rivera the fewest \(2\)\./, "Unassigned never 'logs' anything");
    assert.match(words, /3 of 5 people \(60%\) had no touch this week, the most under Nic Rivera \(2\)\./);
    assert.match(words, /3 marketing emails went out as well, counted on their own\./);
    await shot(page, "03-activity");
    log("audit fixes (UX review): a rise from nothing reads 'up from 0', never '100%' or 'from 0 vs 0'");
    const meetingsTile = page.locator("[data-testid=report-tile][data-id=meetings]");
    assert.equal(Number(await meetingsTile.getAttribute("data-value")), 1, "one meeting this week, none the same days last week");
    assert.equal((await meetingsTile.getByTestId("report-tile-change").textContent()).trim(), "▲ up from 0");
    assert.equal(
      (await page.locator("[data-testid=report-tile][data-id=touches]").getByTestId("report-tile-change").textContent()).trim(),
      "▲ 400% vs 1",
      "a real baseline still gets its percent and its 'vs'",
    );
    log("Activity: Break down by Job title and by State");
    await pick(page, "report-by", "title", "activity");
    const titles = Object.fromEntries((await groupRows(page)).map((row) => [row[0], [row[1], row[6]]]));
    assert.deepEqual(titles.Owner, ["3", "1"], "Ann and ' owner ' Dee are one title");
    assert.deepEqual(titles["Office Manager"], ["2", "0"]);
    assert.deepEqual(titles["No job title"], ["0", "2"]);
    await pick(page, "report-by", "state", "activity");
    const states = Object.fromEntries((await groupRows(page)).map((row) => [row[0], [row[1], row[6]]]));
    assert.deepEqual(states.TX, ["3", "2"], "Ann and Dee through Acme, Cal on her own");
    assert.deepEqual(states.CO, ["2", "1"]);

    log("Closing: won, lost, win rate, average deal and days to close");
    timings.closing = await open(page, `${BASE}/dashboard?report=closing`, "closing");
    assert.equal(await tile(page, "won-value"), 700000);
    assert.equal(await tile(page, "won-count"), 2);
    assert.equal(Math.round((await tile(page, "win-rate")) * 100), 67);
    assert.equal(await tile(page, "avg-deal"), 350000);
    assert.equal(await tile(page, "days-to-close"), 15);
    assert.equal(await tile(page, "lost-value"), 100000);
    const wonSql = (
      await sql(
        `SELECT COUNT(*)::int AS n FROM "Deal" WHERE "organizationId"=$1 AND stage='WON' AND "stageChangedAt" >= ((date_trunc('month', now() AT TIME ZONE $2)) AT TIME ZONE $2) AT TIME ZONE 'UTC'`,
        [org, TZ],
      )
    ).rows[0].n;
    assert.equal(wonSql, 2);
    assert.match(await page.locator("[data-testid=report-tile][data-id=won-value]").textContent(), /vs \$1,500/);
    assert.deepEqual(
      (await groupRows(page)).map((row) => row.join("|")),
      ["Taylor Test|1|$5,000|0|$0|100%", "Nic Rivera|1|$2,000|1|$1,000|50%"],
    );
    words = await narrativeText(page);
    assert.match(words, /The team won 2 deals worth \$7,000 this month, against 1 deal worth \$1,500 the same days last month\./);
    assert.match(words, /The win rate is 67% \(2 won, 1 lost\)\. The average win was \$3,500 and took 15 days from first meeting to signed\./);
    log("Closing: by Industry, and Last month through the period picker");
    await pick(page, "report-by", "industry", "closing");
    assert.deepEqual(
      (await groupRows(page)).map((row) => [row[0], row[2], row[4]]),
      [
        ["Plumbing", "$5,000", "$0"],
        ["HVAC", "$2,000", "$1,000"],
      ],
    );
    await pick(page, "report-period", "last-month", "closing");
    assert.match(page.url(), /period=last-month/);
    assert.match(await page.locator("[data-testid=report-scope]").textContent(), /Last month/);
    assert.equal(await tile(page, "won-value"), 150000);
    assert.equal(await tile(page, "won-count"), 1);
    await shot(page, "04-closing");

    log("audit fixes: Closing with nothing won shows — for the average and days, never a fake 100% drop");
    assert.equal(
      (await sql(`SELECT count(*)::int n FROM "Deal" WHERE "organizationId"=$1 AND stage='WON' AND "stageChangedAt" >= '2025-01-01' AND "stageChangedAt" < '2026-01-02'`, [org])).rows[0].n,
      0,
      "nothing won last year in the seed",
    );
    await sql(
      `INSERT INTO "Deal" (id,"organizationId","contactId",title,stage,"valueCents","ownerId","stageChangedAt","createdAt","updatedAt")
       VALUES ('rp_audit_won',$1,'ct_rpt_ann','Two years back','WON',120000,$2,'2024-06-15T17:00:00Z','2024-06-01T17:00:00Z',now())`,
      [org, T],
    );
    await open(page, `${BASE}/dashboard?report=closing&period=last-year`, "closing");
    for (const id of ["avg-deal", "days-to-close"]) {
      const el = page.locator(`[data-testid=report-tile][data-id=${id}]`);
      assert.equal((await el.getByTestId("report-tile-value").textContent()).trim(), "—", `${id} has nothing to measure`);
      assert.doesNotMatch(await el.textContent(), /[▲▼]/, `${id} isn't compared with last time`);
      assert.match(await el.textContent(), /Nothing won yet/);
    }
    assert.match(await page.locator("[data-testid=report-tile][data-id=won-value]").textContent(), /▼ 100%/, "Won itself really did fall");
    await sql(`DELETE FROM "Deal" WHERE id='rp_audit_won'`);

    log("Money Owed: the same 'owed' as the Owed to you tile, aged, with the top debtors");
    timings.money = await open(page, `${BASE}/dashboard?report=money`, "money");
    const owedSql = (
      await sql(
        `SELECT COALESCE(SUM(cp."amountCents" - COALESCE(p.total, 0)), 0)::int AS owed
           FROM "Contract" c JOIN "ContractPayment" cp ON cp."contractId" = c.id
           LEFT JOIN LATERAL (SELECT SUM("amountCents") AS total FROM "Payment" WHERE "contractPaymentId" = cp.id) p ON true
          WHERE c."organizationId"=$1 AND c.payable=false AND c.status='SIGNED'`,
        [org],
      )
    ).rows[0].owed;
    assert.equal(owedSql, 545000);
    assert.equal(await tile(page, "owed"), owedSql);
    assert.equal(await tile(page, "overdue"), 270000);
    assert.equal(await tile(page, "late-90"), 120000);
    assert.equal(await tile(page, "collected"), 50000);
    assert.match(await page.locator("[data-testid=report-tile][data-id=collected]").textContent(), /vs \$250/);
    assert.equal(await tile(page, "unsigned"), 350000);
    assert.match(await page.locator("[data-testid=money-aging]").textContent(), /Not due yet.*\$2\.8k.*0–30 days late.*31–60 days late.*\$1\.5k.*61–90 days late.*Over 90 days late.*\$1\.2k/s);
    const debtors = await page.locator("[data-testid=money-debtor-row]").evaluateAll((rows) => rows.map((row) => row.textContent));
    assert.equal(debtors.length, 2);
    assert.match(debtors[0], /Acme Plumbing\$4,250\$1,500.*45d late/);
    assert.match(debtors[1], /Cal Home\$1,200\$1,200.*100d late/);
    assert.match(await page.locator("[data-testid=money-unsigned]").textContent(), /CON-9003 · Bolt Air/);
    // The Overview tile reads the same total.
    words = await narrativeText(page);
    assert.match(words, /Customers owe \$5,450 in all, across 2 customers\. \$2,700 of it is past due, including \$1,200 more than 90 days late\./);
    assert.match(words, /\$500 came in this month, against \$250 the same days last month\./);
    await shot(page, "05-money");
    log("Money Owed: by rep follows the deal's rep; paperwork with no deal is Unassigned");
    assert.deepEqual(
      (await groupRows(page)).map((row) => [row[0], row[1], row[2]]),
      [
        ["Taylor Test", "$4,250", "$1,500"],
        ["Unassigned", "$1,200", "$1,200"],
      ],
    );
    log("audit fixes (UX review): Owed by rep with nothing in it says so once, not once for the chart and again for the table");
    await pick(page, "report-rep", N, "money");
    const owedBy = page.locator("[data-testid=money-groups]");
    const owedByText = await owedBy.textContent();
    assert.equal((owedByText.match(/Nothing (to show|here)/g) ?? []).length, 1, owedByText);
    assert.equal(await owedBy.locator("table").count(), 0);
    await pick(page, "report-rep", T, "money");
    assert.equal(await tile(page, "owed"), 425000);

    log("the write-up is stored once per report and set of numbers, and re-read");
    const narratives = async () => (await sql(`SELECT key, source, "createdAt" FROM "ReportNarrative" WHERE "organizationId"=$1 ORDER BY key`, [org])).rows;
    const before = await narratives();
    assert.ok(before.length >= 8, `one per report view so far (${before.length})`);
    assert.ok(before.every((row) => row.source === "RULES"));
    assert.ok(before.some((row) => row.key.startsWith("MONEY|this-month:") && row.key.includes(`|rep:${T}|by:rep|`)));
    await page.reload();
    await page.locator("[data-testid=report][data-report=money]").waitFor();
    assert.equal((await narratives()).length, before.length, "re-opening reuses it");
    log("Rewrite writes it again");
    const moneyKey = before.find((row) => row.key.startsWith("MONEY|this-month:") && row.key.includes(`|rep:${T}|`));
    await page.locator("[data-testid=report-rewrite]").click();
    await page.waitForFunction(() => !document.querySelector("[data-testid=report-narrative]")?.getAttribute("aria-busy")?.includes("true"));
    for (let i = 0; i < 30; i += 1) {
      const row = (await sql(`SELECT "createdAt" FROM "ReportNarrative" WHERE "organizationId"=$1 AND key=$2`, [org, moneyKey.key])).rows[0];
      if (row && row.createdAt.getTime() > moneyKey.createdAt.getTime()) break;
      if (i === 29) throw new Error("Rewrite did not rewrite");
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    log("a number that changes makes a new write-up and drops the old one");
    await sql(`INSERT INTO "Payment" (id,"organizationId","contractPaymentId","amountCents","paidOn") VALUES ('pay_rpt_3',$1,'cp_rpt_3',20000,$2::date)`, [org, today]);
    await page.reload();
    await page.locator("[data-testid=report][data-report=money]").waitFor();
    assert.equal(await tile(page, "owed"), 425000, "Taylor's view didn't move");
    await page.goto(`${BASE}/dashboard?report=money`);
    assert.equal(await tile(page, "owed"), 525000);
    assert.match(await narrativeText(page), /Customers owe \$5,250 in all/);
    const moneyAll = (await narratives()).filter((row) => row.key.startsWith("MONEY|this-month:") && row.key.includes("|rep:all|by:rep|"));
    assert.equal(moneyAll.length, 1, "the write-up for the old numbers is gone");
    await sql(`DELETE FROM "Payment" WHERE id='pay_rpt_3'`);

    log("Email me this: Weekly Pipeline for me, from the report");
    await page.goto(`${BASE}/dashboard?report=pipeline`);
    await page.locator("[data-testid=email-me-open]").click();
    await page.selectOption("[data-testid=email-me-cadence]", "WEEKLY");
    await page.locator("[data-testid=email-me-save]").click();
    await page.locator("[data-testid=email-me-done]").getByText(/6am/).waitFor();
    let subs = (await sql(`SELECT "recipientId", report, cadence, "repId" FROM "ReportSubscription" WHERE "organizationId"=$1`, [org])).rows;
    assert.deepEqual(subs, [{ recipientId: T, report: "PIPELINE", cadence: "WEEKLY", repId: null }]);
    log("the same again says so and adds nothing");
    await page.locator("[data-testid=email-me-save]").click();
    await page.locator("[data-testid=email-me-done]").getByText(/already get/).waitFor();
    assert.equal((await sql(`SELECT COUNT(*)::int AS n FROM "ReportSubscription" WHERE "organizationId"=$1`, [org])).rows[0].n, 1);
    log("an Owner signs Nic up for Weekly Closing about Nic, and herself for Daily Rundown and Monthly Money Owed");
    await page.goto(`${BASE}/dashboard?report=closing&rep=${N}`);
    await page.locator("[data-testid=email-me-open]").click();
    await page.selectOption("[data-testid=email-me-cadence]", "WEEKLY");
    await page.selectOption("[data-testid=email-me-recipient]", N);
    await page.locator("[data-testid=email-me-save]").click();
    await page.locator("[data-testid=email-me-done]").getByText(/Nic Rivera gets it/).waitFor();
    await page.goto(`${BASE}/dashboard`);
    await page.locator("[data-testid=email-me-open]").click();
    assert.deepEqual(await page.locator("[data-testid=email-me-cadence] option").allTextContents(), ["Daily"], "the rundown is daily only");
    await page.locator("[data-testid=email-me-save]").click();
    await page.locator("[data-testid=email-me-done]").waitFor();
    await page.goto(`${BASE}/dashboard?report=money`);
    await page.locator("[data-testid=email-me-open]").click();
    await page.selectOption("[data-testid=email-me-cadence]", "MONTHLY");
    await page.locator("[data-testid=email-me-save]").click();
    await page.locator("[data-testid=email-me-done]").waitFor();
    subs = (await sql(`SELECT "recipientId", report, cadence, "repId" FROM "ReportSubscription" WHERE "organizationId"=$1 ORDER BY "createdAt"`, [org])).rows;
    assert.deepEqual(
      subs.map((sub) => `${sub.recipientId === T ? "T" : "N"}:${sub.report}:${sub.cadence}:${sub.repId === N ? "N" : "all"}`),
      ["T:PIPELINE:WEEKLY:all", "N:CLOSING:WEEKLY:N", "T:DAILY:DAILY:all", "T:MONEY:MONTHLY:all"],
    );

    log("Settings → My Account lists my report emails, with Remove");
    await page.goto(`${BASE}/dashboard/settings/account`);
    const mine = await page.locator("[data-testid=my-report-email]").allTextContents();
    assert.equal(mine.length, 3);
    assert.match(mine.join("\n"), /Pipeline · Weekly, Mondays · Whole team/);
    assert.match(mine.join("\n"), /Money Owed · Monthly, on the 1st · Whole team/);
    await page.locator("[data-testid=my-report-email]", { hasText: "Money Owed" }).locator("[data-testid=my-report-email-remove]").click();
    await page.waitForFunction(() => document.querySelectorAll("[data-testid=my-report-email]").length === 2);
    assert.equal((await sql(`SELECT COUNT(*)::int AS n FROM "ReportSubscription" WHERE "organizationId"=$1 AND report='MONEY'`, [org])).rows[0].n, 0);
    await sql(
      `INSERT INTO "ReportSubscription" (id,"organizationId","recipientId",report,cadence,"repId") VALUES ('rs_rpt_money',$1,$2,'MONEY','MONTHLY',NULL)`,
      [org, T],
    );

    log("a Member can't sign up a teammate: the form has no To box");
    const nicContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const nic = await nicContext.newPage();
    await nic.goto(`${BASE}/login`);
    await nic.fill("#email", NIC_EMAIL);
    await nic.fill("#password", PASSWORD);
    await nic.click("button[type=submit]");
    await nic.waitForURL(/\/dashboard$/);
    await nic.goto(`${BASE}/dashboard?report=pipeline`);
    await nic.locator("[data-testid=email-me-open]").click();
    assert.equal(await nic.locator("[data-testid=email-me-recipient]").count(), 0);
    assert.equal(await nic.locator("[data-testid=email-me-list] li").count(), 0, "a Member sees only their own");
    await nicContext.close();

    log("the clock refuses a request without the secret, or with the wrong one");
    let response = await fetch(`${BASE}/api/cron/reports`);
    assert.equal(response.status, 401);
    response = await fetch(`${BASE}/api/cron/reports`, { headers: { authorization: "Bearer wrong" } });
    assert.equal(response.status, 401);
    response = await fetch(`${BASE}/api/cron/reports?now=2026-11-16T12:05:00Z`, { headers: { authorization: "Bearer wrong" } });
    assert.equal(response.status, 401, "the test clock is no way in");
    assert.equal(inbox.length, 0);

    const cron = async (now) => {
      const res = await fetch(`${BASE}/api/cron/reports?now=${encodeURIComponent(now)}`, { headers: { authorization: `Bearer ${SECRET}` } });
      assert.equal(res.status, 200);
      return res.json();
    };
    // Monday Nov 16, 2026 in Chicago (UTC-6).
    log("5:30am Monday in the workspace's zone is too early: nothing goes");
    let run = await cron("2026-11-16T11:30:00Z");
    assert.equal(run.sentTo.filter((sent) => [EMAIL, NIC_EMAIL].includes(sent.email)).length, 0);
    log("a forced Monday-6am run sends exactly the due ones");
    run = await cron("2026-11-16T12:05:00Z");
    const ours = run.sentTo.filter((sent) => [EMAIL, NIC_EMAIL].includes(sent.email));
    assert.deepEqual(
      ours.map((sent) => `${sent.email === EMAIL ? "T" : "N"}:${sent.report}:${sent.cadence}`).sort(),
      ["N:CLOSING:WEEKLY", "T:DAILY:DAILY", "T:PIPELINE:WEEKLY"],
      "Monthly Money Owed waits for the 1st",
    );
    const caught = inbox.filter((message) => [EMAIL, NIC_EMAIL].includes(message.to?.[0]));
    assert.equal(caught.length, 3);
    const pipelineMail = caught.find((message) => /Pipeline/.test(message.subject));
    assert.equal(pipelineMail.to[0], EMAIL);
    assert.match(pipelineMail.subject, /^Test Reports Co · Pipeline — Last week · Nov 9 – Nov 15, 2026$/);
    assert.match(pipelineMail.from, /^"Test Reports Co" </);
    assert.match(pipelineMail.html, /Open pipeline/);
    assert.match(pipelineMail.html, new RegExp(`${BASE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/dashboard\\?report=pipeline&amp;period=last-week`));
    assert.match(pipelineMail.text, /Open pipeline: \$8,660/);
    assert.match(pipelineMail.text, /Open right now, by stage/);
    const closingMail = caught.find((message) => /Closing/.test(message.subject));
    assert.equal(closingMail.to[0], NIC_EMAIL);
    assert.match(closingMail.text, /Nic Rivera/);
    assert.match(closingMail.text, new RegExp(`rep=${N}`));
    const dailyMail = caught.find((message) => /Daily Rundown/.test(message.subject));
    assert.match(dailyMail.subject, /Daily Rundown — Nov 16, 2026/);
    assert.match(dailyMail.text, /Overdue follow-ups/);
    const sentAt = (await sql(`SELECT report, "lastSentAt" FROM "ReportSubscription" WHERE "organizationId"=$1 ORDER BY report`, [org])).rows;
    assert.ok(sentAt.filter((row) => row.lastSentAt).length === 3);
    log("a second run that morning sends nothing");
    run = await cron("2026-11-16T12:40:00Z");
    assert.equal(run.sentTo.filter((sent) => [EMAIL, NIC_EMAIL].includes(sent.email)).length, 0);
    assert.equal(inbox.filter((message) => [EMAIL, NIC_EMAIL].includes(message.to?.[0])).length, 3);
    log("Tuesday 6am sends only the daily one; Dec 1 adds the monthly");
    run = await cron("2026-11-17T12:05:00Z");
    assert.deepEqual(
      run.sentTo.filter((sent) => [EMAIL, NIC_EMAIL].includes(sent.email)).map((sent) => sent.report),
      ["DAILY"],
    );
    run = await cron("2026-12-01T12:05:00Z");
    assert.deepEqual(
      run.sentTo.filter((sent) => [EMAIL, NIC_EMAIL].includes(sent.email)).map((sent) => sent.report).sort(),
      ["DAILY", "MONEY"],
    );
    assert.match(inbox.at(-1).subject + inbox.at(-2).subject, /Money Owed — Last month · Nov 1 – Nov 30, 2026/);
    log("audit fixes: on the spring-forward Sunday the 6am email goes once, not at 6 and again at 7");
    // Sunday Mar 14, 2027 in Chicago: 6am is 11:00Z (CDT), 7am is 12:00Z.
    run = await cron("2027-03-14T11:05:00Z");
    assert.deepEqual(run.sentTo.filter((sent) => [EMAIL, NIC_EMAIL].includes(sent.email)).map((sent) => sent.report), ["DAILY"]);
    run = await cron("2027-03-14T12:05:00Z");
    assert.equal(run.sentTo.filter((sent) => [EMAIL, NIC_EMAIL].includes(sent.email)).length, 0, "7am sends nothing again");

    log("with AI on, a good answer from Claude is used (second server, stand-in Claude)");
    aiServer = spawn("npx", ["next", "start", "-p", String(AI_PORT)], {
      cwd: path.resolve(__dirname, "../.."),
      env: { ...process.env, DATABASE_URL: AI_DB, ANTHROPIC_API_KEY: "test-key", ANTHROPIC_ENDPOINT: `http://localhost:${CLAUDE_PORT}`, APP_URL: AI_BASE },
      detached: true,
      stdio: "ignore",
    });
    for (let i = 0; ; i += 1) {
      try {
        if ((await fetch(`${AI_BASE}/login`)).status === 200) break;
      } catch {
        /* still starting */
      }
      if (i > 120) throw new Error("AI server did not start");
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    await sql(`DELETE FROM "ReportNarrative" WHERE "organizationId"=$1`, [org]);
    claudeReply = {
      paragraphs: [
        "Customers owe $5,450 right now and $2,700 of it is past due — Cal Home's $1,200 is more than 90 days late, so that's the first call to make.",
        "Collections are up: $500 came in this month against $250 the same days last month. Acme Plumbing still carries $4,250.",
      ],
    };
    await page.goto(`${AI_BASE}/dashboard?report=money`);
    await page.locator("[data-testid=report-narrative][data-source=CLAUDE]").waitFor({ timeout: 20000 });
    assert.match(await narrativeText(page), /first call to make/);
    const ask = claudeRequests.at(-1);
    assert.match(ask.url, /^\/v1\/messages/);
    const prompt = JSON.stringify(ask.body.messages);
    assert.match(prompt, /Total owed/);
    assert.doesNotMatch(prompt, /test-reports-owner@example\.com/, "only the numbers go, not the CRM");
    assert.match(JSON.stringify(ask.body.system), /ONLY numbers that appear in the data/);
    assert.equal((await sql(`SELECT source FROM "ReportNarrative" WHERE "organizationId"=$1 AND key LIKE 'MONEY|%'`, [org])).rows[0].source, "CLAUDE");
    log("re-opening reuses the AI write-up without asking again");
    const asked = claudeRequests.length;
    await page.reload();
    await page.locator("[data-testid=report-narrative][data-source=CLAUDE]").waitFor();
    await page.waitForTimeout(500);
    assert.equal(claudeRequests.length, asked);
    log("an answer with a number that isn't in the data is thrown out for the rules version");
    claudeReply = { paragraphs: ["Customers owe $5,450, and you should expect $999,999 next quarter."] };
    await page.locator("[data-testid=report-rewrite]").click();
    await page.locator("[data-testid=report-narrative][data-source=RULES]").waitFor({ timeout: 20000 });
    assert.equal(claudeRequests.length, asked + 1);
    words = await narrativeText(page);
    assert.doesNotMatch(words, /999,999/);
    assert.match(words, /Customers owe \$5,450 in all/);
    assert.equal((await sql(`SELECT COUNT(*)::int AS n FROM "AiRequest" WHERE "organizationId"=$1 AND kind='REPORT_NARRATIVE'`, [org])).rows[0].n, 2);
    log("audit fixes: a number written as a word, or one only the year would match, is thrown out too");
    const factsSent = JSON.stringify(claudeRequests.at(-1).body.messages)
      .replace(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}\b(?:,?\s+\d{4}\b)?/g, " ")
      .replace(/\b20\d\d\b/g, " ");
    const factNumbers = (factsSent.match(/\d{1,3}(?:,\d{3})+|\d+/g) ?? []).map((n) => Number(n.replace(/,/g, "")));
    // "$2.0k" is 1,950 to 2,050: before the fix only the year (2026) matched it.
    assert.ok(!factNumbers.some((n) => n >= 1950 && n <= 2050), `nothing but the year near $2.0k in the facts (${factNumbers.join(", ")})`);
    const word = [["eleven", 11], ["thirteen", 13], ["seventeen", 17], ["nineteen", 19]].find(([, n]) => !factNumbers.includes(n));
    for (const invented of [`Customers owe $5,450, and ${word[0]} new customers signed up.`, "Customers owe $5,450; expect $2.0k more next week."]) {
      await sql(`DELETE FROM "ReportNarrative" WHERE "organizationId"=$1`, [org]);
      claudeReply = { paragraphs: [invented] };
      const before = claudeRequests.length;
      await page.locator("[data-testid=report-rewrite]").click();
      for (let i = 0; claudeRequests.length === before; i += 1) {
        if (i > 100) throw new Error("Claude was not asked");
        await page.waitForTimeout(200);
      }
      await page.waitForFunction(() => !document.querySelector("[data-testid=report-rewrite]")?.disabled);
      await page.reload();
      await page.locator("[data-testid=report-narrative][data-source=RULES]").waitFor({ timeout: 20000 });
      assert.doesNotMatch(await narrativeText(page), new RegExp(`${word[0]} new customers|\\$2\\.0k`), invented);
      assert.equal((await sql(`SELECT source FROM "ReportNarrative" WHERE "organizationId"=$1 AND key LIKE 'MONEY|%'`, [org])).rows[0].source, "RULES");
    }

    log("audit fixes (UX review): the AI write-up of the Daily Rundown is told which calendar entries are done, open ones first");
    await sql(
      `INSERT INTO "CalendarEvent" (id,"organizationId",title,type,"startOn","startTime","ownerId","doneAt","updatedAt") VALUES ('ev_rpt_ai_done',$1,'Early call','Call',$2::date,'07:00',$3,now(),now())`,
      [org, today, T],
    );
    claudeReply = { paragraphs: ["The team has 3 things on the calendar today."] };
    const asksBefore = claudeRequests.length;
    await page.goto(`${AI_BASE}/dashboard`);
    for (let i = 0; claudeRequests.length === asksBefore; i += 1) {
      if (i > 100) throw new Error("Claude was not asked for the Daily Rundown");
      await page.waitForTimeout(200);
    }
    const dailyAsk = claudeRequests.at(-1).body.messages.at(-1);
    const dailyPrompt = typeof dailyAsk.content === "string" ? dailyAsk.content : dailyAsk.content.map((part) => part.text ?? "").join("");
    const dailyFacts = JSON.parse(dailyPrompt.slice(dailyPrompt.indexOf("{"), dailyPrompt.lastIndexOf("}") + 1));
    assert.equal(dailyFacts.report, "daily");
    assert.equal(dailyFacts.calendarEntries, 3);
    assert.equal(dailyFacts.calendarStillOpen, 2);
    assert.equal(dailyFacts.calendarAlreadyDone, 1);
    assert.deepEqual(
      dailyFacts.calendarToday.map((item) => [item.title, item.done]),
      [
        ["Site walk at Acme", false],
        ["Call Bob", false],
        ["Early call", true],
      ],
    );
    await page.waitForFunction(() => !document.querySelector("[data-testid=report-narrative]")?.getAttribute("aria-busy")?.includes("true"));
    await sql(`DELETE FROM "CalendarEvent" WHERE id='ev_rpt_ai_done'`);

    log("each report opens inside its time budget");
    for (const [name, ms] of Object.entries(timings)) {
      console.log(`     ${name.padEnd(9)} ${ms} ms`);
      assert.ok(ms < BUDGET_MS, `${name} took ${ms} ms`);
    }

    if (Number(process.env.LOAD || 0) > 0) {
      const rows = Number(process.env.LOAD);
      log(`at ${rows.toLocaleString("en-US")} contacts, each report still opens inside the budget`);
      // Bulk rows in this same workspace, after every exact check above.
      await sql(
        `INSERT INTO "Company" (id,"organizationId",name,industries,state,"ownerId","updatedAt")
           SELECT 'lc_' || g, $1, 'Load Co ' || g, ARRAY[(ARRAY['Plumbing','HVAC','Roofing','Electrical'])[1 + g % 4]], (ARRAY['TX','CO','FL','OH'])[1 + g % 4],
                  CASE WHEN g % 2 = 0 THEN $2 ELSE $3 END, now()
             FROM generate_series(1, $4::int) g`,
        [org, T, N, Math.max(1, Math.floor(rows / 20))],
      );
      await sql(
        `INSERT INTO "Contact" (id,"organizationId","companyId",name,title,"ownerId","createdById","createdAt","updatedAt")
           SELECT 'lt_' || g, $1, 'lc_' || (1 + g % $5::int), 'Load Person ' || g, (ARRAY['Owner','Office Manager','Foreman',NULL])[1 + g % 4],
                  CASE WHEN g % 3 = 0 THEN NULL WHEN g % 3 = 1 THEN $2 ELSE $3 END, $2, now() - interval '90 days', now()
             FROM generate_series(1, $4::int) g`,
        [org, T, N, rows, Math.max(1, Math.floor(rows / 20))],
      );
      await sql(
        `INSERT INTO "Activity" (id,"organizationId","contactId","userId",type,body,marketing,"occurredAt")
           SELECT 'la_' || g, $1, 'lt_' || (1 + (g * 7) % $4::int), CASE WHEN g % 2 = 0 THEN $2 ELSE $3 END,
                  (ARRAY['PHONE_CALL','EMAIL','TEXT','MEETING'])[1 + g % 4]::"ActivityType", 'Load', g % 5 = 0,
                  (now() AT TIME ZONE 'UTC') - (g % 400) * interval '1 day' - interval '1 hour'
             FROM generate_series(1, $5::int) g`,
        [org, T, N, rows, rows],
      );
      await sql(
        `INSERT INTO "Deal" (id,"organizationId","contactId",title,stage,"valueCents","ownerId","stageChangedAt","updatedAt")
           SELECT 'ld_' || g, $1, 'lt_' || g, 'Load deal ' || g, (ARRAY['QUOTE_SENT','CONTRACT_SENT','WON','LOST']::"DealStage"[])[1 + g % 4],
                  10000 * (1 + g % 50), CASE WHEN g % 2 = 0 THEN $2 ELSE $3 END, (now() AT TIME ZONE 'UTC') - (g % 200) * interval '1 day', now()
             FROM generate_series(1, $4::int) g`,
        [org, T, N, Math.floor(rows / 50)],
      );
      await sql(
        `INSERT INTO "Quote" (id,"organizationId","contactId","dealId",number,title,status,"publicToken","updatedAt")
           SELECT 'lq_' || g, $1, 'lt_' || g, 'ld_' || g, 100000 + g, 'Load quote', 'SENT', 'ltok_' || g, now()
             FROM generate_series(1, $2::int) g`,
        [org, Math.floor(rows / 50)],
      );
      await sql(
        `INSERT INTO "QuoteLineItem" (id,"quoteId",name,quantity,"unitPriceCents",tag)
           SELECT 'lli_' || g || '_' || k, 'lq_' || g, 'Line', 1 + k, 25000, 'LABOR'
             FROM generate_series(1, $1::int) g, generate_series(1, 3) k`,
        [Math.floor(rows / 50)],
      );
      await sql(
        `INSERT INTO "Contract" (id,"organizationId","contactId","dealId",number,title,body,status,payable,"publicToken","updatedAt")
           SELECT 'lk_' || g, $1, 'lt_' || g, 'ld_' || g, 200000 + g, 'Load', 'x', CASE WHEN g % 5 = 0 THEN 'SENT' ELSE 'SIGNED' END::"ContractStatus", false, 'lktok_' || g, now()
             FROM generate_series(1, $2::int) g`,
        [org, Math.floor(rows / 100)],
      );
      await sql(
        `INSERT INTO "ContractPayment" (id,"contractId","organizationId",label,"amountCents","dueOn")
           SELECT 'lkp_' || g || '_' || k, 'lk_' || g, $1, 'Row', 50000, (now() - (g % 150) * interval '1 day' + k * interval '30 days')::date
             FROM generate_series(1, $2::int) g, generate_series(0, 2) k`,
        [org, Math.floor(rows / 100)],
      );
      await sql(`ANALYZE`);
      const loadTimes = {};
      for (const report of ["daily", "pipeline", "activity", "closing", "money"]) {
        const first = await open(page, `${BASE}/dashboard?report=${report}`, report);
        loadTimes[report] = await open(page, `${BASE}/dashboard?report=${report}`, report);
        console.log(`     ${report.padEnd(20)} first open (writes the write-up) ${first} ms`);
        assert.ok(first < BUDGET_MS, `${report} first open took ${first} ms`);
      }
      for (const by of ["industry", "title", "state"]) loadTimes[`activity by ${by}`] = await open(page, `${BASE}/dashboard?report=activity&by=${by}&period=this-year`, "activity");
      for (const [name, ms] of Object.entries(loadTimes)) {
        console.log(`     ${name.padEnd(20)} ${ms} ms`);
        assert.ok(ms < BUDGET_MS, `${name} took ${ms} ms at ${rows} contacts`);
      }
    }

    log("audit fixes (UX review): on a phone a long Recent activity line ends in …, and Overview stays the phone's width");
    await sql(`INSERT INTO "Activity" (id,"organizationId","contactId","userId",type,body,marketing,"occurredAt") VALUES ('a_rpt_long',$1,'ct_rpt_ann',$2,'PHONE_CALL',$3,false,now())`, [
      org,
      T,
      `${"Walked the whole building with the facilities manager and ".repeat(6)}end`,
    ]);
    // isMobile as a real phone browser: a page wider than the screen widens
    // the layout instead of scrolling, and the whole page is drawn smaller.
    const truck = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, storageState: await context.storageState() });
    const thumb = await truck.newPage();
    await thumb.goto(`${BASE}/dashboard`);
    await thumb.locator("[data-testid=report][data-report=daily]").waitFor();
    const fit = await thumb.evaluate(() => {
      const line = [...document.querySelectorAll("p.truncate")].find((p) => p.textContent.startsWith("Walked the whole building"));
      return {
        inner: window.innerWidth,
        doc: document.documentElement.scrollWidth,
        card: Math.round(line.closest(".card").getBoundingClientRect().right),
        cut: line.scrollWidth > line.clientWidth,
      };
    });
    assert.equal(fit.inner, 390, `Overview lays out ${fit.inner}px wide on a 390px phone`);
    assert.ok(fit.doc <= 390, `Overview is ${fit.doc}px wide`);
    assert.ok(fit.card <= 390, `Recent activity reaches ${fit.card}px`);
    assert.ok(fit.cut, "the long line is cut with … inside its card");
    await sql(`DELETE FROM "Activity" WHERE id='a_rpt_long'`);

    log("audit fixes (UX review): the Activity chart's labels are 11px on a phone and on a wide screen, its bars at most 28px, its axis on round numbers");
    const chart = async (p) => {
      await p.goto(`${BASE}/dashboard?report=activity&period=this-month`);
      await p.locator("[data-testid=report][data-report=activity]").waitFor();
      const selector = "[data-testid=activity-daily] svg[role=img]";
      await p.locator(selector).waitFor();
      // Drawn at the box's own width once the browser has measured it.
      await p
        .waitForFunction((sel) => {
          const svg = document.querySelector(sel);
          return svg && Math.abs(svg.viewBox.baseVal.width - svg.getBoundingClientRect().width) < 1;
        }, selector, { timeout: 5000 })
        .catch(() => {});
      return p.locator(selector).evaluate((svg) => {
        const box = svg.getBoundingClientRect();
        const scale = box.width / svg.viewBox.baseVal.width;
        const texts = [...svg.querySelectorAll("text")];
        const days = texts.filter((t) => /^[A-Z][a-z]{2} \d{1,2}$/.test(t.textContent)).map((t) => t.getBoundingClientRect());
        return {
          sizes: texts.map((t) => Math.round(parseFloat(getComputedStyle(t).fontSize) * scale * 10) / 10),
          ticks: texts.filter((t) => !/^[A-Z]/.test(t.textContent)).map((t) => Number(t.textContent.replace(/[$,]/g, ""))),
          inside: days.every((r) => r.left >= box.left - 0.5 && r.right <= box.right + 0.5),
          apart: days.every((r, i) => i === 0 || r.left >= days[i - 1].right + 2),
          days: days.length,
          spans: `${Math.round(box.left)}..${Math.round(box.right)}: ${days.map((r) => `${Math.round(r.left)}-${Math.round(r.right)}`).join(" ")}`,
          bar: Math.max(0, ...[...svg.querySelectorAll("rect")].map((r) => r.getBoundingClientRect().width)),
        };
      });
    };
    const truckChart = await chart(thumb);
    const deskChart = await chart(page);
    for (const [where, c] of [["phone", truckChart], ["1440", deskChart]]) {
      assert.ok(c.sizes.length && c.sizes.every((px) => px >= 10.5 && px <= 11.5), `${where}: labels drawn at ${c.sizes.join(", ")}px`);
      assert.ok(c.bar > 0 && c.bar <= 28.5, `${where}: a bar ${c.bar}px wide`);
      assert.ok(c.days >= 1 && c.inside && c.apart, `${where}: day labels inside the chart and apart (${c.spans})`);
      const step = c.ticks[1];
      const lead = step / 10 ** Math.floor(Math.log10(step));
      assert.ok([1, 2, 2.5, 5].includes(lead), `${where}: ticks ${c.ticks.join(", ")}`);
      assert.ok(c.ticks.every((tick, i) => tick === i * step), `${where}: ticks ${c.ticks.join(", ")} evenly spaced from 0`);
      assert.ok(c.ticks.at(-1) >= 5, `${where}: the top tick covers today's 5 touches`);
    }
    await truck.close();

    log("every report fits a phone");
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await context.storageState() });
    const small = await phone.newPage();
    for (const report of ["daily", "pipeline", "activity", "closing", "money"]) {
      await small.goto(`${BASE}/dashboard?report=${report}`);
      await small.locator(`[data-testid=report][data-report=${report}]`).waitFor();
      const overflow = await small.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(overflow <= 0, `${report} scrolls sideways by ${overflow}px on a phone`);
      await shot(small, `06-phone-${report}`);
    }
    await phone.close();

    console.log(`\nAll ${step} steps passed.`);
  } finally {
    if (aiServer) {
      try {
        process.kill(-aiServer.pid, "SIGTERM");
      } catch {
        /* already gone */
      }
    }
    await browser.close();
    mail.close();
    claude.close();
    if (!process.env.KEEP) await sql(`DELETE FROM "Organization" WHERE slug LIKE $1`, [SLUG_LIKE]).catch(() => {});
    await pool.end();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
