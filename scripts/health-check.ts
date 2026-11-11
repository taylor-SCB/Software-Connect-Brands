// Lead health checks (BDR redesign, Nov 11, 2026). leadHealth() in
// src/lib/health.ts against every state, every band, the reason order and
// the plan's worked examples (Kristen 100 Warm, Rachel 75, Jessica 55 "Did
// the Nov 6 meeting happen?", Raymond 50, Steven 10 Cold, Gregory 0,
// Olivia Trying amber); the meter's steps, dates and label; the company
// roll-up; DealJourney; the components' server-rendered markup; and, with
// a database, the batched loader (src/lib/health-load.ts) on a seeded
// workspace: the same worked examples through the SQL, marketing sends and
// no-shows never touches, a touch logged on two people counted once for
// their company, Do Not List left off a tile, late money from the owed
// rows, and nothing read across workspaces.
//
//   npx tsx scripts/health-check.ts            (rules + markup + database)
//   npx tsx scripts/health-check.ts --pure     (no database)
//   npx tsx scripts/health-check.ts --render   (print sample markup as JSON
//                                               for looks.cjs; no checks)
//
// The database part needs DATABASE_URL (from .env) and creates, then
// deletes, workspaces with slugs test-health-check and
// test-health-check-other. Never point it at the live database.

import "dotenv/config";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  bandOf,
  leadHealth,
  pulseCaption,
  reasonWords,
  recentPoints,
  rollUpCompany,
  talkPoints,
  zoneDay,
  shortDay,
  aheadDay,
  type HealthContext,
  type HealthInput,
  type LeadHealth,
} from "../src/lib/health";
import { dealJourney } from "../src/lib/health-journey";
import { waitingOf } from "../src/lib/meeting-rule";
import { LifecycleMeter } from "../src/components/lifecycle-meter";
import { HealthDot, HealthRing, HealthWordStatic } from "../src/components/health-marks";
import { HealthWord } from "../src/components/health-word";
import { DealJourney } from "../src/components/deal-journey";

// Tuesday Nov 10, 2026, noon in Chicago.
const NOW = new Date("2026-11-10T18:00:00Z");
const TZ = "America/Chicago";
const CTX: HealthContext = { now: NOW, timeZone: TZ, quietDays: 8, parkAfterTries: 6 };

// n calendar days before NOW, at 9am Chicago (15:00 UTC).
function ago(days: number, hourUtc = 15) {
  const at = new Date(NOW);
  at.setUTCDate(at.getUTCDate() - days);
  at.setUTCHours(hourUtc, 0, 0, 0);
  return at;
}

function input(over: Partial<HealthInput>): HealthInput {
  return {
    status: "NOT_ACTIONED",
    tries: 0,
    talks: 0,
    meetings: 0,
    firstTouchAt: null,
    lastTouchAt: null,
    firstConnectAt: null,
    lastConnectAt: null,
    statusTalkAt: null,
    triesSinceTalk: 0,
    next: null,
    overdue: null,
    lastMeeting: null,
    paperwork: [],
    owed: null,
    changes: [],
    ...over,
  };
}

let passed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (error) {
    console.error(`  FAIL ${name}`);
    throw error;
  }
}
async function checkAsync(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (error) {
    console.error(`  FAIL ${name}`);
    throw error;
  }
}

/* ------------------------------ The people ------------------------------ */

const PEOPLE = {
  kristen: input({
    status: "MEETING_SET",
    companyName: "Ironwood General Contractors",
    tries: 3,
    talks: 1,
    meetings: 0,
    firstTouchAt: ago(3),
    lastTouchAt: ago(0, 16),
    firstConnectAt: ago(0, 16),
    lastConnectAt: ago(0, 16),
    statusTalkAt: ago(0, 16),
    next: { on: "2026-11-12", time: "10:00", kind: "meeting" },
    changes: [
      { to: "CONTACTED", on: ago(3), by: "Marcus Lee", auto: true, reason: null },
      { to: "MEETING_SET", on: ago(0, 16), by: "Marcus Lee", auto: true, reason: null },
    ],
  }),
  rachel: input({
    status: "QUOTE_SENT",
    tries: 9,
    talks: 4,
    meetings: 1,
    firstTouchAt: ago(40),
    lastTouchAt: ago(4),
    firstConnectAt: ago(30),
    lastConnectAt: ago(12),
    paperwork: [{ kind: "quote", sentAt: ago(10) }],
    next: { on: "2026-11-12", time: null, kind: "follow-up" },
  }),
  jessica: input({
    status: "MEETING_SET",
    tries: 4,
    talks: 2,
    meetings: 1,
    firstTouchAt: ago(20),
    lastTouchAt: ago(4),
    firstConnectAt: ago(12),
    lastConnectAt: ago(4),
    lastMeeting: { at: ago(4), marked: false },
    changes: [
      { to: "CONTACTED", on: ago(20), by: null, auto: true, reason: null },
      { to: "INTERESTED", on: ago(12), by: "Priya Shah", auto: false, reason: null },
      { to: "MEETING_SET", on: ago(12), by: null, auto: true, reason: null },
    ],
  }),
  raymond: input({
    status: "MEETING_SET",
    tries: 5,
    talks: 2,
    firstTouchAt: ago(30),
    lastTouchAt: ago(14),
    firstConnectAt: ago(20),
    lastConnectAt: ago(14),
    next: { on: "2026-11-19", time: "10:00", kind: "meeting" },
  }),
  steven: input({
    status: "MEETING_COMPLETED",
    tries: 6,
    talks: 2,
    meetings: 1,
    firstTouchAt: ago(40),
    lastTouchAt: ago(17),
    firstConnectAt: ago(25),
    lastConnectAt: ago(17),
  }),
  gregory: input({
    status: "CONTRACT_SENT",
    tries: 7,
    talks: 3,
    meetings: 1,
    firstTouchAt: ago(50),
    lastTouchAt: ago(20),
    firstConnectAt: ago(40),
    lastConnectAt: ago(20),
    paperwork: [{ kind: "contract", sentAt: ago(18) }],
  }),
  olivia: input({ status: "CONTACTED", tries: 1, firstTouchAt: ago(29), lastTouchAt: ago(29) }),
  seth: input({ status: "NOT_ACTIONED", createdAt: ago(33) }),
  wendy: input({
    status: "WON",
    tries: 12,
    talks: 6,
    meetings: 2,
    firstTouchAt: ago(90),
    lastTouchAt: ago(15),
    firstConnectAt: ago(80),
    lastConnectAt: ago(15),
    owed: { billedCents: 675_400, receivedCents: 0, lateCents: 337_700, oldestLateOn: "2026-10-29" },
  }),
  nora: input({
    status: "NOT_INTERESTED",
    tries: 2,
    talks: 1,
    firstTouchAt: ago(9),
    lastTouchAt: ago(8),
    firstConnectAt: ago(8),
    lastConnectAt: ago(8),
    changes: [
      { to: "CONTACTED", on: ago(9), by: null, auto: true, reason: null },
      { to: "NOT_INTERESTED", on: ago(8), by: "Marcus Lee", auto: false, reason: "PRICE" },
    ],
  }),
};

const H = Object.fromEntries(Object.entries(PEOPLE).map(([key, value]) => [key, leadHealth(value, CTX)])) as Record<
  keyof typeof PEOPLE,
  LeadHealth
>;

function pure() {
  console.log("rules");

  check("the plan's worked examples: scores, bands and reasons", () => {
    assert.equal(H.kristen.score, 100);
    assert.equal(H.kristen.word, "Warm");
    assert.equal(H.kristen.reason, "Talked today · meeting Thu 10:00 AM");
    assert.equal(H.kristen.breakdown, "Recent 40 · Talk 30 · Next step 30 = 100");

    assert.equal(H.rachel.score, 75);
    assert.equal(H.rachel.word, "Warm");
    assert.equal(H.rachel.breakdown, "Recent 25 · Talk 20 · Next step 30 = 75");
    assert.equal(H.rachel.reason, "Talked 12 days ago · follow-up Thu");

    assert.equal(H.jessica.score, 55);
    assert.equal(H.jessica.word, "Cooling");
    assert.equal(H.jessica.reason, "Did the Nov 6 meeting happen?");
    assert.equal(H.jessica.breakdown, "Recent 25 · Talk 30 · Next step 0 = 55");

    assert.equal(H.raymond.score, 50);
    assert.equal(H.raymond.word, "Cooling");
    assert.equal(H.raymond.reason, "Talked 14 days ago · meeting Nov 19, 10:00 AM");

    assert.equal(H.steven.score, 10);
    assert.equal(H.steven.word, "Cold");
    assert.equal(H.steven.reason, "Quiet 17 days · nothing booked");

    assert.equal(H.gregory.score, 0);
    assert.equal(H.gregory.word, "Cold");
    assert.equal(H.gregory.reason, "Contract out 18 days, not signed");
    assert.equal(H.gregory.breakdown, "Recent 0 · Talk 10 · Next step 0 − Drag 15 = 0");

    assert.equal(H.olivia.state, "TRYING");
    assert.equal(H.olivia.score, null, "never a number for someone never reached");
    assert.equal(H.olivia.breakdown, null);
    assert.equal(H.olivia.tone, "warn", "stalled: amber");
    assert.equal(H.olivia.stalled, true);
    assert.equal(H.olivia.reason, "1 try, 29 days ago — try again");
  });

  check("every state: its word, mark and colour", () => {
    const expect: [LeadHealth, string, string, string, string][] = [
      [H.seth, "NEW", "New", "○", "none"],
      [H.olivia, "TRYING", "Trying", "○", "warn"],
      [H.kristen, "REACHED", "Warm", "●", "good"],
      [H.jessica, "REACHED", "Cooling", "◐", "warn"],
      [H.steven, "REACHED", "Cold", "▲", "risk"],
      [H.wendy, "WON", "Won", "✓", "risk"],
      [H.nora, "CLOSED", "Closed", "×", "none"],
    ];
    for (const [health, state, word, mark, tone] of expect) {
      assert.equal(health.state, state, word);
      assert.equal(health.word, word);
      assert.equal(health.mark, mark, word);
      assert.equal(health.tone, tone, word);
    }
    assert.equal(H.seth.reason, "Not tried yet");
    assert.equal(H.seth.caption, "New lead · added Oct 8");
    assert.equal(H.seth.meter.step, -1);
    assert.equal(H.seth.label, "Stage: not touched yet. Health: New. Not tried yet");
  });

  check("bands: 70+ Warm, 40-69 Cooling, under 40 Cold", () => {
    assert.equal(bandOf(100), "WARM");
    assert.equal(bandOf(70), "WARM");
    assert.equal(bandOf(69), "COOLING");
    assert.equal(bandOf(40), "COOLING");
    assert.equal(bandOf(39), "COLD");
    assert.equal(bandOf(0), "COLD");
  });

  check("Recent touch: 0-2 days 40, up to Q/2 25, up to Q 10, past Q 0 (the day Gone quiet fires)", () => {
    assert.deepEqual(
      [0, 1, 2, 3, 4, 5, 8, 9, 30].map((d) => recentPoints(d, 8)),
      [40, 40, 40, 25, 25, 10, 10, 0, 0],
    );
    assert.equal(recentPoints(null, 8), 0);
    assert.deepEqual([4, 6, 7, 14, 15].map((d) => recentPoints(d, 14)), [25, 25, 25, 10, 0], "Q follows the setting");
  });

  check("Last talk: within Q 30, within 2Q 20, longer 10; minus 10 after 5+ tries since; never below 0", () => {
    assert.deepEqual([0, 8, 9, 16, 17].map((d) => talkPoints(d, 8, 0)), [30, 30, 20, 20, 10]);
    assert.equal(talkPoints(3, 8, 4), 30);
    assert.equal(talkPoints(3, 8, 5), 20);
    assert.equal(talkPoints(30, 8, 9), 0);
  });

  check("Next step: booked 30, booked but something late 15, nothing 0; paperwork sent within Q counts", () => {
    const base = { status: "MEETING_COMPLETED", tries: 2, talks: 1, firstTouchAt: ago(1), lastTouchAt: ago(1), firstConnectAt: ago(1), lastConnectAt: ago(1) };
    const booked = leadHealth(input({ ...base, next: { on: "2026-11-11", time: null, kind: "call" } }), CTX);
    assert.equal(booked.parts?.next, 30);
    const late = leadHealth(input({ ...base, next: { on: "2026-11-11", time: null, kind: "call" }, overdue: { count: 1, oldestOn: "2026-11-06" } }), CTX);
    assert.equal(late.parts?.next, 15);
    assert.equal(late.reason, "Follow-up 4 days late");
    const onlyLate = leadHealth(input({ ...base, overdue: { count: 2, oldestOn: "2026-11-09" } }), CTX);
    assert.equal(onlyLate.parts?.next, 0);
    assert.equal(onlyLate.reason, "Follow-up 1 day late");
    const quote = leadHealth(input({ ...base, paperwork: [{ kind: "quote", sentAt: ago(3) }] }), CTX);
    assert.equal(quote.parts?.next, 30);
    assert.equal(quote.reason, "Talked yesterday · quote out 3 days");
    const oldQuote = leadHealth(input({ ...base, paperwork: [{ kind: "quote", sentAt: ago(12) }] }), CTX);
    assert.equal(oldQuote.parts?.next, 0, "a quote out longer than Q is not a next step");
    assert.equal(oldQuote.parts?.drag, 0, "touched since it went: no drag");
  });

  check("Drag: paperwork out more than Q days with no touch since takes 15; the reason names it", () => {
    const quote = leadHealth(
      input({ status: "QUOTE_SENT", tries: 3, talks: 1, firstTouchAt: ago(20), lastTouchAt: ago(13), lastConnectAt: ago(13), paperwork: [{ kind: "quote", sentAt: ago(12) }] }),
      CTX,
    );
    assert.equal(quote.parts?.drag, 15);
    assert.equal(quote.reason, "Quote out 12 days, no answer");
    assert.equal(quote.score, 5, "0 + 20 + 0 - 15");
  });

  check("the reason order: owes, late, meeting, paperwork, quiet, tries, talked", () => {
    const all = input({
      status: "MEETING_SET",
      tries: 9,
      talks: 1,
      lastTouchAt: ago(10),
      lastConnectAt: ago(10),
      triesSinceTalk: 6,
      lastMeeting: { at: ago(4), marked: false },
      overdue: { count: 1, oldestOn: "2026-11-07" },
      paperwork: [{ kind: "contract", sentAt: ago(9) }],
      owed: { billedCents: 1000_00, receivedCents: 0, lateCents: 500_00, oldestLateOn: "2026-11-01" },
    });
    assert.equal(leadHealth(all, CTX).reason, "Owes $500 · 9 days late");
    assert.equal(leadHealth({ ...all, owed: null }, CTX).reason, "Follow-up 3 days late");
    assert.equal(leadHealth({ ...all, owed: null, overdue: null }, CTX).reason, "Did the Nov 6 meeting happen?");
    assert.equal(leadHealth({ ...all, owed: null, overdue: null, lastMeeting: null }, CTX).reason, "Contract out 9 days, not signed");
    assert.equal(leadHealth({ ...all, owed: null, overdue: null, lastMeeting: null, paperwork: [] }, CTX).reason, "Quiet 10 days · nothing booked");
    const touched = { ...all, owed: null, overdue: null, lastMeeting: null, paperwork: [], lastTouchAt: ago(1) };
    assert.equal(leadHealth(touched, CTX).reason, "6 tries since you last talked");
    assert.equal(leadHealth({ ...touched, triesSinceTalk: 1 }, CTX).reason, "Talked 10 days ago");
  });

  check("a marked meeting, or one still to come, doesn't ask whether it happened", () => {
    assert.notEqual(leadHealth({ ...PEOPLE.jessica, lastMeeting: { at: ago(4), marked: true } }, CTX).reasonKey, "meeting");
    assert.notEqual(
      leadHealth({ ...PEOPLE.jessica, next: { on: "2026-11-13", time: "09:00", kind: "meeting" } }, CTX).reasonKey,
      "meeting",
    );
    assert.notEqual(leadHealth({ ...PEOPLE.jessica, status: "MEETING_COMPLETED" }, CTX).reasonKey, "meeting");
  });

  check("Trying: grey while moving, amber when stalled, never red, never a number; parks after the try limit", () => {
    const moving = leadHealth(
      input({ status: "CONTACTED", tries: 3, firstTouchAt: ago(6), lastTouchAt: ago(2), next: { on: "2026-11-12", time: null, kind: "call" } }),
      CTX,
    );
    assert.equal(moving.tone, "none");
    assert.equal(moving.reason, "Tried 3× · next try Thu");
    assert.equal(moving.caption, "3 tries · no talks yet · last touch 2d");
    assert.equal(moving.miniCaption, "3 tries · 2d");
    const last = leadHealth(input({ status: "CONTACTED", tries: 2, lastTouchAt: ago(2) }), CTX);
    assert.equal(last.reason, "Tried 2× · last Sun");
    const stalled = leadHealth(input({ status: "CONTACTED", tries: 2, lastTouchAt: ago(18) }), CTX);
    assert.equal(stalled.tone, "warn");
    assert.equal(stalled.reason, "2 tries, last one 18 days ago — try again");
    const lateTry = leadHealth(input({ status: "CONTACTED", tries: 1, lastTouchAt: ago(3), overdue: { count: 1, oldestOn: "2026-11-07" } }), CTX);
    assert.equal(lateTry.tone, "warn", "a late follow-up stalls it");
    assert.equal(lateTry.reason, "Follow-up 3 days late");
    const parked = leadHealth(input({ status: "CONTACTED", tries: 6, lastTouchAt: ago(1), companyName: "Ridgeline" }), CTX);
    assert.equal(parked.park, true);
    assert.equal(parked.reason, "6 tries, never reached — try a text or someone else at Ridgeline");
    const parkedAlready = leadHealth(
      input({ status: "CONTACTED", tries: 6, lastTouchAt: ago(1), next: { on: "2026-12-11", time: null, kind: "call" } }),
      CTX,
    );
    assert.equal(parkedAlready.park, false, "parked (a try booked 30 days out): the offer doesn't come back");
    assert.equal(parkedAlready.reasonKey, "trying");
    assert.equal(leadHealth(input({ status: "CONTACTED", tries: 5, lastTouchAt: ago(1) }), CTX).park, false);
    assert.equal(leadHealth(input({ status: "CONTACTED", tries: 3, lastTouchAt: ago(1) }), { ...CTX, parkAfterTries: 3 }).park, true, "the workspace's own limit");
    for (const days of [0, 5, 9, 40, 400]) {
      const health = leadHealth(input({ status: "CONTACTED", tries: 9, lastTouchAt: ago(days), overdue: { count: 3, oldestOn: "2026-01-01" } }), CTX);
      assert.notEqual(health.tone, "risk");
      assert.equal(health.score, null);
    }
    assert.notEqual(leadHealth(input({ status: "NOT_ACTIONED", overdue: { count: 1, oldestOn: "2026-10-01" } }), CTX).tone, "risk", "a new lead is never red");
  });

  check("Reached: a stored connect, or Connected / Interested / Meeting Set and on, even with no talk logged", () => {
    for (const status of ["CONNECTED", "INTERESTED", "MEETING_SET", "MEETING_COMPLETED", "QUOTE_SENT", "CONTRACT_SENT"]) {
      assert.equal(leadHealth(input({ status }), CTX).state, "REACHED", status);
    }
    const talked = leadHealth(input({ status: "CONTACTED", tries: 2, talks: 1, lastTouchAt: ago(1), lastConnectAt: ago(1), firstConnectAt: ago(1) }), CTX);
    assert.equal(talked.state, "REACHED");
    assert.equal(talked.meter.step, 1, "the meter fills Connected from the stored connect");
    const byStatus = leadHealth(input({ status: "INTERESTED", statusTalkAt: ago(3) }), CTX);
    assert.equal(byStatus.parts?.talk, 30, "the move into Interested stands in for the talk");
    assert.equal(byStatus.meter.interested, true);
    assert.equal(byStatus.label, "Stage: Connected · Interested, 2 of 7. Health: Cold. Quiet · nothing booked");
    const later = leadHealth(
      input({ status: "MEETING_SET", tries: 3, talks: 1, lastTouchAt: ago(1), lastConnectAt: ago(20), statusTalkAt: ago(2) }),
      CTX,
    );
    assert.equal(later.parts?.talk, 30, "the later of the two");
  });

  check("Won: green check, red with late money from the owed rows; Collected $X of $Y", () => {
    assert.equal(H.wendy.reason, "Owes $3,377 · 12 days late");
    assert.equal(H.wendy.owes?.cents, 337_700);
    assert.equal(H.wendy.owes?.daysLate, 12);
    assert.equal(H.wendy.collected, "Collected $0 of $6,754");
    assert.equal(H.wendy.meter.won, true);
    assert.ok(H.wendy.meter.steps.every((step) => step.state === "done"), "all seven fill, none left breathing");
    const paid = leadHealth({ ...PEOPLE.wendy, owed: { billedCents: 675_400, receivedCents: 675_400, lateCents: 0, oldestLateOn: null } }, CTX);
    assert.equal(paid.tone, "good");
    assert.equal(paid.reason, "Won · paid in full");
    assert.equal(paid.meter.action, null);
    const open = leadHealth({ ...PEOPLE.wendy, owed: { billedCents: 675_400, receivedCents: 0, lateCents: 0, oldestLateOn: null } }, CTX);
    assert.equal(open.tone, "good");
    assert.equal(open.reason, "Won · $6,754 still to collect");
    assert.equal(open.meter.action?.label, "Send deposit invoice");
  });

  check("Closed: grey ×, the reason, the meter stopped where it was", () => {
    assert.equal(H.nora.reason, "Not interested · Price");
    assert.equal(H.nora.meter.closed?.at, 1);
    assert.equal(H.nora.meter.closed?.reason, "Price");
    // StatusChange.reason holds the key the data side stores (PRICE …);
    // older free text shows as written.
    assert.equal(reasonWords("HAS_VENDOR"), "Has a vendor");
    assert.equal(reasonWords("Moved out of state"), "Moved out of state");
    assert.deepEqual(
      H.nora.meter.steps.map((step) => step.state),
      ["closed", "closed", "todo", "todo", "todo", "todo", "todo"],
    );
    const lost = leadHealth(
      input({
        status: "LOST",
        changes: [
          { to: "MEETING_SET", on: ago(30), by: null, auto: true, reason: null },
          { to: "QUOTE_SENT", on: ago(20), by: null, auto: true, reason: null },
          { to: "LOST", on: ago(2), by: "Marcus Lee", auto: false, reason: "TIMING" },
        ],
      }),
      CTX,
    );
    assert.equal(lost.word, "Closed");
    assert.equal(lost.meter.closed?.at, 4);
    assert.equal(lost.reason, "Lost · Timing");
    assert.equal(lost.label, "Stage: Lost, after Quote Sent. Health: Closed. Lost · Timing");
    assert.equal(leadHealth(input({ status: "ARCHIVED" }), CTX).reason, "Archived");
  });

  check("the meter: steps, the next one, dates once per day, the one action by stage", () => {
    const meter = H.jessica.meter;
    assert.deepEqual(
      meter.steps.map((step) => step.state),
      ["done", "done", "current", "next", "todo", "todo", "todo"],
    );
    assert.deepEqual(
      meter.steps.map((step) => step.date),
      ["Oct 21", "Oct 29", null, null, null, null, null],
      "Meeting Set moved the same day as Connected, so no second date",
    );
    assert.equal(meter.steps[1].by, "Priya Shah");
    assert.equal(meter.current, "Meeting Set");
    assert.equal(meter.nextStep, "Meeting Completed");
    assert.equal(meter.action?.label, "Mark held");
    assert.equal(H.jessica.label, "Stage: Meeting Set, 3 of 7. Health: Cooling. Did the Nov 6 meeting happen?");
    assert.equal(H.kristen.meter.action?.label, "Meeting Thu 10:00 AM");
    assert.equal(H.olivia.meter.action?.label, "Call");
    assert.equal(H.steven.meter.action?.label, "Start a quote");
    assert.equal(H.rachel.meter.action?.label, "Customer said yes");
    assert.equal(H.gregory.meter.action?.label, "Copy signing link");
    assert.equal(leadHealth(input({ status: "INTERESTED" }), CTX).meter.action?.label, "Book meeting");
    assert.ok(H.gregory.meter.steps.slice(4).every((step) => step.readOnly), "Quote, Contract and Won move with the paperwork");
    assert.equal(H.gregory.meter.steps[6].hint, "Moves when the contract is signed");
  });

  check("Meeting Set: Mark held only for a meeting nobody answered; after a no-show Reschedule, after a held one Book meeting", () => {
    const at = (lastMeeting: HealthInput["lastMeeting"]) => leadHealth(input({ status: "MEETING_SET", lastMeeting }), CTX).meter.action;
    assert.deepEqual(at({ at: ago(2), marked: false }), { key: "mark-held", label: "Mark held" });
    assert.deepEqual(at({ at: ago(2), marked: true, noShow: true }), { key: "book", label: "Reschedule" });
    assert.deepEqual(at({ at: ago(2), marked: true, noShow: false }), { key: "book", label: "Book meeting" });
    // No meeting known at all (a status set by hand): every screen opens
    // How did it go? on Meeting for it.
    assert.deepEqual(at(null), { key: "mark-held", label: "Mark held" });
  });

  check("the waiting-meeting rule: due only with nothing ahead and only on a Meeting Set tile; toAnswer never none while one exists", () => {
    const now = NOW.getTime();
    const fact = (item: string, daysAgo: number, outcome: "HELD" | "NO_SHOW" | null, meetingSet = true) => ({
      item,
      at: now - daysAgo * 86400000,
      outcome,
      meetingSet,
    });
    let w = waitingOf([fact("mon", 2, null), fact("tue", -1, null)], now);
    assert.deepEqual([w.due, w.ahead, w.missed, w.toAnswer], [null, "tue", null, "mon"], "booked ahead: nothing asked, but Held answers the one that happened");
    w = waitingOf([fact("mon", 2, null)], now);
    assert.deepEqual([w.due, w.toAnswer], ["mon", "mon"]);
    w = waitingOf([fact("ns", 2, "NO_SHOW")], now);
    assert.deepEqual([w.due, w.missed, w.toAnswer], [null, "ns", "ns"], "the latest is a no-show: Reschedule, and Held says it did happen");
    w = waitingOf([fact("old", 5, null), fact("ns", 2, "NO_SHOW")], now);
    assert.deepEqual([w.due, w.missed, w.toAnswer], [null, "ns", "old"], "nothing asked, but a tap answers the one nobody answered");
    w = waitingOf([{ ...fact("lost", 2, null, false), open: false }], now);
    assert.deepEqual([w.due, w.toAnswer], [null, null], "a Lost tile's meetings are history");
    w = waitingOf([fact("done", 2, null, false)], now);
    assert.deepEqual([w.due, w.last, w.toAnswer], [null, null, "done"], "a tile past Meeting Set asks nothing, but its meeting is still the one Held answers");
    w = waitingOf([fact("tick", 3, null)], now);
    assert.equal(w.due, "tick", "a calendar tick answers nothing");
  });

  check("the Pulse caption names who touched last when it isn't the rep", () => {
    const touched = leadHealth({ ...PEOPLE.jessica, lastTouchBy: { id: "u2", name: "Priya Shah" } }, CTX);
    assert.equal(pulseCaption(touched, "u1"), "4 tries · 2 talks · 4d · Priya");
    assert.equal(pulseCaption(touched, "u2"), "4 tries · 2 talks · 4d");
    assert.equal(pulseCaption(H.jessica, "u1"), "4 tries · 2 talks · 4d");
  });

  check("captions: counts that are zero draw nothing", () => {
    assert.equal(H.jessica.caption, "4 tries · 2 talks · 1 meeting · last touch 4d");
    assert.equal(H.jessica.miniCaption, "4 tries · 2 talks · 4d");
    assert.equal(H.kristen.caption, "3 tries · 1 talk · last touch today");
    assert.equal(H.olivia.caption, "1 try · no talks yet · last touch 29d");
  });

  check("calendar days in the workspace's zone: 11pm yesterday is yesterday", () => {
    const late = new Date("2026-11-10T04:30:00Z"); // 10:30pm Nov 9 in Chicago
    const health = leadHealth(input({ status: "CONTACTED", tries: 1, lastTouchAt: late, firstTouchAt: late }), CTX);
    assert.equal(health.counts.lastTouchDays, 1);
    assert.equal(zoneDay(late, TZ), "2026-11-09");
  });

  check("a company wears its warmest person's health, its furthest person's meter, and n of m reached", () => {
    const own = leadHealth(input({ status: "CONTACTED", tries: 12, talks: 3, meetings: 1, lastTouchAt: ago(0, 16) }), CTX);
    const company = rollUpCompany(
      own,
      [
        { id: "olivia", health: H.olivia },
        { id: "jessica", health: H.jessica },
        { id: "gregory", health: H.gregory },
      ],
      { reached: 2, people: 7 },
    );
    assert.equal(company.warmestId, "jessica");
    assert.equal(company.word, "Cooling");
    assert.equal(company.reachedText, "2 of 7 reached");
    assert.equal(company.meter.step, 5, "Gregory got furthest");
    assert.equal(company.caption, "12 tries · 3 talks · 1 meeting · last touch today");
    assert.ok(company.label.startsWith("Stage: Contract Sent, 6 of 7. Health: Cooling."));
    const owing = rollUpCompany(
      leadHealth(input({ status: "WON", owed: { billedCents: 100_00, receivedCents: 0, lateCents: 100_00, oldestLateOn: "2026-11-01" } }), CTX),
      [{ id: "wendy", health: leadHealth({ ...PEOPLE.wendy, owed: null }, CTX) }],
      { reached: 1, people: 1 },
    );
    assert.equal(owing.tone, "risk", "a Won company owing late money turns red");
    assert.equal(owing.reason, "Owes $100 · 9 days late");
    const empty = rollUpCompany(H.seth, [], { reached: 0, people: 0 });
    assert.equal(empty.word, "New");
    assert.equal(empty.reachedText, "0 of 0 reached");
  });

  check("DealJourney: Meeting · Quote · Contract · Signed · Deposit with one Next", () => {
    const journey = dealJourney(
      { meetingAt: ago(9), quoteSentAt: ago(2), contractSentAt: null, signedAt: null, depositPaidAt: null, quoteAccepted: true },
      TZ,
    );
    assert.equal(journey.current, 2);
    assert.deepEqual(
      journey.steps.map((step) => step.state),
      ["done", "done", "current", "todo", "todo"],
    );
    assert.equal(journey.next?.label, "Make contract");
    assert.equal(journey.summary, "Step 3 of 5 · Quote yes, sent Nov 8");
    const sent = dealJourney({ meetingAt: ago(9), quoteSentAt: ago(2), contractSentAt: ago(0), signedAt: null, depositPaidAt: null }, TZ);
    assert.equal(sent.next?.label, "Copy signing link");
    assert.equal(sent.summary, "Step 4 of 5 · Contract sent Nov 10");
    assert.equal(dealJourney({ meetingAt: ago(3), quoteSentAt: null, contractSentAt: null, signedAt: null, depositPaidAt: null }, TZ).next?.label, "Start a quote");
    assert.equal(dealJourney({ meetingAt: ago(3), quoteSentAt: null, contractSentAt: null, signedAt: null, depositPaidAt: null, quoteDraft: true }, TZ).next?.label, "Send quote");
    assert.equal(dealJourney({ meetingAt: ago(3), quoteSentAt: ago(2), contractSentAt: null, signedAt: null, depositPaidAt: null }, TZ).next?.label, "Customer said yes");
    assert.equal(dealJourney({ meetingAt: ago(3), quoteSentAt: ago(2), contractSentAt: null, signedAt: null, depositPaidAt: null, contractDraft: true }, TZ).next?.label, "Send for signature");
    const signed = dealJourney({ meetingAt: ago(9), quoteSentAt: ago(8), contractSentAt: ago(7), signedAt: ago(1), depositPaidAt: null }, TZ);
    assert.equal(signed.next?.label, "Send deposit invoice");
    const paid = dealJourney({ meetingAt: ago(9), quoteSentAt: ago(8), contractSentAt: ago(7), signedAt: ago(1), depositPaidAt: ago(0) }, TZ);
    assert.equal(paid.next, null);
    assert.equal(paid.summary, "Step 5 of 5 · Deposit paid");
  });
}

/* ------------------------------ The markup ------------------------------ */

function samples() {
  const journey = dealJourney(
    { meetingAt: ago(9), quoteSentAt: ago(2), contractSentAt: ago(0), signedAt: null, depositPaidAt: null },
    TZ,
  );
  const people: [string, LeadHealth][] = [
    ["Kristen Vaughn", H.kristen],
    ["Jessica Moreno", H.jessica],
    ["Steven Park", H.steven],
    ["Olivia Wolfe", H.olivia],
    ["Seth Tucker", H.seth],
    ["Wendy Ames", H.wendy],
    ["Nora Pike", H.nora],
  ];
  return {
    people: people.map(([name, health]) => ({
      name,
      word: health.word,
      tone: health.tone,
      header: renderToStaticMarkup(
        h(
          "div",
          { className: "flex items-center gap-3" },
          h(HealthRing, { health, children: h("span", { className: "flex h-12 w-12 items-center justify-center bg-[var(--brand)] font-bold text-white" }, name[0]) }),
          h("p", { className: "text-heading font-semibold" }, name),
          h(HealthWord, { health }),
        ) as never,
      ) + renderToStaticMarkup(h(LifecycleMeter, { health, size: "header" })),
      mini: renderToStaticMarkup(
        h("div", { className: "flex items-center gap-3" }, h(HealthDot, { health }), h("span", null, name), h(LifecycleMeter, { health, size: "mini" })),
      ),
    })),
    journey: renderToStaticMarkup(h(DealJourney, { journey, next: h("button", { className: "btn btn-primary", type: "button" }, journey.next?.label) })),
  };
}

function markup() {
  console.log("markup");
  check("header meter: role=img with the full label, seven steps, the next one outlined, names and dates", () => {
    const html = renderToStaticMarkup(h(LifecycleMeter, { health: H.jessica, size: "header" }));
    assert.match(html, /role="img" aria-label="Stage: Meeting Set, 3 of 7\. Health: Cooling\. Did the Nov 6 meeting happen\?"/);
    assert.equal((html.match(/class="lm-seg"/g) ?? []).length, 7);
    assert.match(html, /class="lm-seg" data-state="next" data-step="3"/);
    assert.match(html, /class="lm-seg" data-state="current" data-step="2"/);
    assert.match(html, /data-health="warn"/);
    assert.match(html, /Oct 21/);
    assert.match(html, /Meeting Set<\/b> → next: Meeting Completed/);
    assert.match(html, /data-testid="lifecycle-reason">Did the Nov 6 meeting happen\?/);
    assert.match(html, /4 tries · 2 talks · 1 meeting · last touch 4d/);
    assert.doesNotMatch(html, /55/, "no number on the meter itself");
  });
  check("mini meter: a button with the label on its picture, the dot, the counts", () => {
    const html = renderToStaticMarkup(h(LifecycleMeter, { health: H.olivia, size: "mini" }));
    assert.match(html, /^<button type="button" class="lm lm-mini"/);
    assert.match(html, /role="img" aria-label="Stage: Attempted, 1 of 7\. Health: Trying\. 1 try, 29 days ago — try again"/);
    assert.match(html, /class="health-dot" data-health="warn" data-hollow=""/);
    assert.match(html, /1 try · 29d/);
    const still = renderToStaticMarkup(h(LifecycleMeter, { health: H.olivia, size: "mini", interactive: false }));
    assert.match(still, /^<span class="lm lm-mini"/, "inside a link it is not a button");
  });
  check("Won fills all seven with a check; Closed shows × and the reason", () => {
    const won = renderToStaticMarkup(h(LifecycleMeter, { health: H.wendy, size: "header" }));
    assert.equal((won.match(/data-state="done"/g) ?? []).length, 14, "seven bars and seven names, all filled");
    assert.match(won, /✓/);
    assert.match(won, /Collected \$0 of \$6,754/);
    const closed = renderToStaticMarkup(h(LifecycleMeter, { health: H.nora, size: "header" }));
    assert.match(closed, /data-testid="lifecycle-reason"><span class="lm-closed-mark" aria-hidden="true">× <\/span>Not interested · Price/);
    const bare = renderToStaticMarkup(h(LifecycleMeter, { health: H.nora, size: "header", showReason: false }));
    assert.match(bare, /data-testid="lifecycle-closed">.*×.*Not Interested · Price/, "without the reason line, the meter still says why");
  });
  check("the word chip: mark + word, the number only in its breakdown", () => {
    const html = renderToStaticMarkup(h(HealthWord, { health: H.jessica }));
    assert.match(html, /<button[^>]*class="health-word"[^>]*data-health="warn"/);
    assert.match(html, /◐<\/span>Cooling<\/button>/);
    assert.doesNotMatch(html, /55/);
    assert.match(renderToStaticMarkup(h(HealthWordStatic, { health: H.kristen })), /●<\/span>Warm/);
  });
  check("ring and dot: health colour, outline for New and Trying", () => {
    assert.match(renderToStaticMarkup(h(HealthRing, { health: H.seth, children: h("span", null, "S") })), /data-health="none" data-hollow=""/);
    assert.match(renderToStaticMarkup(h(HealthRing, { health: H.kristen, children: h("span", null, "K") })), /data-health="good" data-testid/);
    assert.match(renderToStaticMarkup(h(HealthDot, { health: H.steven })), /data-health="risk"[^>]*aria-hidden="true"/);
  });
  check("DealJourney markup: five steps, the phone summary, the Next slot", () => {
    const html = samples().journey;
    assert.match(html, /role="img" aria-label="Deal progress: Meeting done/);
    assert.equal((html.match(/class="dj-step"/g) ?? []).length, 5);
    assert.match(html, /Step 4 of 5 · Contract sent Nov 10/);
    assert.match(html, /Copy signing link/);
  });
}

/* ------------------------------- The SQL ------------------------------- */

async function database() {
  console.log("database (batched loader)");
  const { prisma } = await import("../src/lib/prisma");
  const { loadContactHealth, loadCompanyHealth, loadOpportunityHealth } = await import("../src/lib/health-load");
  const { zonedNoon } = await import("../src/lib/money");

  await prisma.organization.deleteMany({ where: { slug: { in: ["test-health-check", "test-health-check-other"] } } });
  const org = await prisma.organization.create({ data: { name: "Test Health Check", slug: "test-health-check", quietDays: 8 } });
  const other = await prisma.organization.create({ data: { name: "Test Health Other", slug: "test-health-check-other" } });
  const tz = org.timeZone;
  try {
    const user = await prisma.user.create({
      data: { name: "Hana Rep", email: "test-health-check@example.com", passwordHash: "x", organizationId: org.id },
    });
    const now = new Date();
    const today = zoneDay(now, tz);
    const isoShift = (days: number) => {
      const at = new Date(`${today}T12:00:00Z`);
      at.setUTCDate(at.getUTCDate() + days);
      return at.toISOString().slice(0, 10);
    };
    // Noon on the workspace's calendar n days ago; "now" for today, so it
    // is never dated ahead.
    const day = (days: number) => (days === 0 ? new Date(now.getTime() - 60_000) : zonedNoon(isoShift(-days), tz));
    const dateOnly = (iso: string) => new Date(`${iso}T00:00:00Z`);
    const O = org.id;

    const ridgeline = await prisma.company.create({ data: { organizationId: O, name: "Ridgeline Property Group" } });
    const contact = (name: string, status: string, companyId: string | null = null, organizationId = O) =>
      prisma.contact.create({ data: { organizationId, name, status: status as never, companyId } });
    const kristen = await contact("Kristen Vaughn", "MEETING_SET");
    const jessica = await contact("Jessica Moreno", "MEETING_SET", ridgeline.id);
    const owen = await contact("Owen Ridge", "CONTACTED", ridgeline.id);
    const gregory = await contact("Gregory Shaw", "CONTRACT_SENT");
    const olivia = await contact("Olivia Wolfe", "CONTACTED");
    const seth = await contact("Seth Tucker", "NOT_ACTIONED");
    const wendy = await contact("Wendy Ames", "WON");
    const larry = await contact("Larry Late", "CONTACTED");
    const hal = await contact("Hidden Hal", "CONTACTED");
    const stranger = await contact("Someone Else", "CONTACTED", null, other.id);

    type Act = { contactId: string | null; companyId?: string | null; type: string; outcome?: string | null; at: Date; marketing?: boolean; batchId?: string };
    const acts: Act[] = [
      // Kristen: two tries, then talked today and booked; a marketing send
      // and a no-show that must count for nothing.
      { contactId: kristen.id, type: "PHONE_CALL", outcome: "NO_ANSWER", at: day(3) },
      { contactId: kristen.id, type: "PHONE_CALL", outcome: "VOICEMAIL", at: day(2) },
      { contactId: kristen.id, type: "PHONE_CALL", outcome: "TALKED", at: day(0) },
      { contactId: kristen.id, type: "EMAIL", at: day(0), marketing: true },
      { contactId: kristen.id, type: "MEETING", outcome: "NO_SHOW", at: day(1) },
      // Jessica: talked 10 days ago, a voicemail logged on her and Owen
      // together, then a meeting 4 days ago nobody marked.
      { contactId: jessica.id, type: "PHONE_CALL", outcome: "TALKED", at: day(10) },
      { contactId: jessica.id, type: "PHONE_CALL", outcome: "VOICEMAIL", at: day(6), batchId: "hc-batch-1" },
      { contactId: owen.id, type: "PHONE_CALL", outcome: "VOICEMAIL", at: day(6), batchId: "hc-batch-1" },
      { contactId: jessica.id, type: "MEETING", outcome: null, at: day(4) },
      // A call to Ridgeline's main line: no person on it.
      { contactId: null, companyId: ridgeline.id, type: "PHONE_CALL", outcome: "GATEKEEPER", at: day(0) },
      // Gregory: met 20 days ago; his contract went out 18 days ago.
      { contactId: gregory.id, type: "MEETING", outcome: "HELD", at: day(20) },
      // Olivia: one no answer, 29 days ago.
      { contactId: olivia.id, type: "PHONE_CALL", outcome: "NO_ANSWER", at: day(29) },
      // Wendy signed; Larry was tried 2 days ago; Hal talked yesterday but
      // is Do Not List on Kristen's tile.
      { contactId: wendy.id, type: "MEETING", outcome: "HELD", at: day(15) },
      { contactId: larry.id, type: "PHONE_CALL", outcome: "NO_ANSWER", at: day(2) },
      { contactId: hal.id, type: "PHONE_CALL", outcome: "TALKED", at: day(1) },
    ];
    const created: Record<string, string> = {};
    for (const [index, act] of acts.entries()) {
      const row = await prisma.activity.create({
        data: {
          organizationId: O,
          contactId: act.contactId,
          companyId: act.companyId ?? null,
          userId: user.id,
          type: act.type as never,
          body: act.outcome ?? act.type,
          outcome: (act.outcome ?? null) as never,
          marketing: act.marketing ?? false,
          batchId: act.batchId ?? null,
          occurredAt: act.at,
        },
      });
      created[index] = row.id;
    }
    await prisma.activity.create({
      data: { organizationId: other.id, contactId: stranger.id, userId: user.id, type: "PHONE_CALL", body: "x", outcome: "TALKED", occurredAt: day(1) },
    });
    await prisma.statusChange.createMany({
      data: [
        { organizationId: O, contactId: kristen.id, toStatus: "CONTACTED", on: day(3), auto: true },
        { organizationId: O, contactId: kristen.id, toStatus: "MEETING_SET", on: day(0), auto: true },
        { organizationId: O, contactId: jessica.id, toStatus: "MEETING_SET", on: day(10), auto: true, userId: user.id },
      ],
    });

    // Kristen's meeting in two days at 10:00, on the calendar and on her
    // tile; Larry's call three days ago never ticked (he's an attendee,
    // not the entry's contact).
    await prisma.calendarEvent.create({
      data: { organizationId: O, title: "Meeting · Kristen Vaughn", type: "Meeting", startOn: dateOnly(isoShift(2)), startTime: "10:00", contactId: kristen.id },
    });
    await prisma.calendarEvent.create({
      data: { organizationId: O, title: "Call · Larry", type: "Call", startOn: dateOnly(isoShift(-3)), attendees: { connect: [{ id: larry.id }] } },
    });
    const kristenOpp = await prisma.opportunity.create({
      data: {
        organizationId: O,
        title: "Kristen Vaughn",
        contacts: { create: [{ contactId: kristen.id, role: "PRIMARY" }, { contactId: hal.id, role: "HIDDEN" }] },
        meetings: { create: [{ on: zonedNoon(isoShift(2), tz), bookedById: user.id }] },
      },
    });
    const jessicaOpp = await prisma.opportunity.create({
      data: {
        organizationId: O,
        title: "Ridgeline",
        contacts: { create: [{ contactId: jessica.id, role: "PRIMARY" }] },
        meetings: { create: [{ on: day(4), activityId: created[8] }] },
      },
    });

    // Gregory's deal and contract (out 18 days); Wendy's signed contract
    // with $3,377 due 12 days ago and $3,377 due next month.
    const gregDeal = await prisma.deal.create({ data: { organizationId: O, contactId: gregory.id, title: "Lone Oak", stage: "CONTRACT_SENT" } });
    const gregOpp = await prisma.opportunity.create({
      data: { organizationId: O, title: "Lone Oak", stage: "MEETING_COMPLETED", dealId: gregDeal.id, contacts: { create: [{ contactId: gregory.id, role: "PRIMARY" }] } },
    });
    await prisma.contract.create({
      data: { organizationId: O, contactId: gregory.id, dealId: gregDeal.id, number: 1000, title: "Lone Oak", body: "x", publicToken: `hc-${org.id}-1`, status: "SENT", sentAt: day(18) },
    });
    await prisma.contract.create({
      data: {
        organizationId: O,
        contactId: wendy.id,
        number: 1001,
        title: "Wendy",
        body: "x",
        publicToken: `hc-${org.id}-2`,
        status: "SIGNED",
        sentAt: day(30),
        signedAt: day(20),
        payments: {
          create: [
            { organizationId: O, label: "Deposit", amountCents: 337_700, dueOn: dateOnly(isoShift(-12)), position: 0 },
            { organizationId: O, label: "Balance", amountCents: 337_700, dueOn: dateOnly(isoShift(30)), position: 1 },
          ],
        },
      },
    });

    let statements = 0;
    const raw = prisma.$queryRaw.bind(prisma);
    try {
      (prisma as unknown as { $queryRaw: typeof raw }).$queryRaw = ((...args: Parameters<typeof raw>) => {
        statements += 1;
        return raw(...args);
      }) as typeof raw;
    } catch {
      statements = -1;
    }

    const ids = [kristen, jessica, owen, gregory, olivia, seth, wendy, larry, hal, stranger].map((c) => c.id);
    const t0 = Date.now();
    const people = await loadContactHealth(O, ids);
    const took = Date.now() - t0;
    const countedStatements = statements;

    await checkAsync("a page of contacts in two grouped statements, scoped to the workspace", async () => {
      assert.equal(countedStatements, 2, "touches + bookings (settings by primary key outside $queryRaw)");
      assert.ok(took < 2000, `took ${took}ms`);
      assert.equal(people.has(stranger.id), false, "another workspace's contact is never read");
      assert.equal(people.size, 9);
    });

    await checkAsync("Kristen through the SQL: 100 Warm; the marketing send and the no-show count for nothing", async () => {
      const k = people.get(kristen.id)!;
      assert.equal(k.counts.tries, 3);
      assert.equal(k.counts.talks, 1);
      assert.equal(k.counts.meetings, 0, "a no-show is not a meeting");
      assert.equal(k.score, 100);
      assert.equal(k.reason, `Talked today · meeting ${aheadDay(isoShift(2), today)} 10:00 AM`);
      assert.equal(k.counts.lastTouchBy?.name, "Hana Rep");
    });

    await checkAsync("Jessica through the SQL: 55 Cooling, \"Did the ... meeting happen?\"", async () => {
      const j = people.get(jessica.id)!;
      assert.equal(j.counts.tries, 3);
      assert.equal(j.counts.talks, 2);
      assert.equal(j.score, 55);
      assert.equal(j.reason, `Did the ${shortDay(isoShift(-4))} meeting happen?`);
    });

    await checkAsync("Gregory, Olivia, Seth, Wendy, Larry through the SQL", async () => {
      const g = people.get(gregory.id)!;
      assert.equal(g.score, 0);
      assert.equal(g.reason, "Contract out 18 days, not signed");
      const o = people.get(olivia.id)!;
      assert.equal(o.state, "TRYING");
      assert.equal(o.tone, "warn");
      assert.equal(o.reason, "1 try, 29 days ago — try again");
      assert.equal(people.get(seth.id)!.state, "NEW");
      const w = people.get(wendy.id)!;
      assert.equal(w.tone, "risk");
      assert.equal(w.reason, "Owes $3,377 · 12 days late");
      assert.equal(w.collected, "Collected $0 of $6,754");
      const l = people.get(larry.id)!;
      assert.equal(l.reason, "Follow-up 3 days late", "an attendee's late call is theirs");
      assert.equal(l.tone, "warn");
    });

    await checkAsync("Ridgeline: Jessica's health, a touch logged on two people counted once, the main line counted, 1 of 2 reached", async () => {
      statements = 0;
      const companies = await loadCompanyHealth(O, [ridgeline.id]);
      const r = companies.get(ridgeline.id)!;
      assert.equal(r.word, "Cooling");
      assert.equal(r.warmestId, jessica.id);
      assert.equal(r.reachedText, "1 of 2 reached");
      assert.equal(r.counts.tries, 4, "talk + shared voicemail once + meeting + front desk");
      assert.equal(r.counts.talks, 2);
      assert.equal(r.caption, "4 tries · 2 talks · 1 meeting · last touch today");
      assert.ok(statements >= 1 && statements <= 3, `${statements} statements`);
    });

    await checkAsync("tiles: Do Not List left out, the opportunity's own meetings, the deal's paperwork", async () => {
      statements = 0;
      const tiles = await loadOpportunityHealth(O, [kristenOpp.id, jessicaOpp.id, gregOpp.id]);
      assert.equal(statements, 2);
      const k = tiles.get(kristenOpp.id)!;
      assert.equal(k.counts.tries, 3, "Hal is Do Not List");
      assert.equal(k.score, 100);
      assert.equal(k.meter.step, 2);
      const j = tiles.get(jessicaOpp.id)!;
      assert.equal(j.reasonKey, "meeting");
      const g = tiles.get(gregOpp.id)!;
      assert.equal(g.meter.step, 5, "the deal's column");
      assert.equal(g.reason, "Contract out 18 days, not signed");
      assert.equal(g.parts?.drag, 15);
      const none = await loadOpportunityHealth(other.id, [kristenOpp.id]);
      assert.equal(none.size, 0, "not across workspaces");
    });
  } finally {
    await prisma.organization.deleteMany({ where: { slug: { in: ["test-health-check", "test-health-check-other"] } } });
    await prisma.$disconnect();
  }
}

async function main() {
  if (process.argv.includes("--render")) {
    process.stdout.write(JSON.stringify(samples()));
    return;
  }
  pure();
  markup();
  if (!process.argv.includes("--pure")) await database();
  console.log(`\nPASS — ${passed} checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
