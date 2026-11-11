// Up next checks (BDR redesign, Nov 11, 2026). rankUpNext() in
// src/lib/up-next.ts against a fixture of every group: the plan's order
// (meetings to close out, late, due today, talked with no meeting, new,
// still trying), the order inside each group, the reason words, rows that
// drop off (booked ahead, won, closed, past Meeting Set), the park offer,
// and the greeting, ring and connect-rate helpers. The health of each
// fixture comes from leadHealth() itself, so the two can't drift apart.
//
//   npx tsx scripts/up-next-check.ts

import assert from "node:assert/strict";
import { leadHealth, type HealthContext, type HealthInput } from "../src/lib/health";
import { connectRate, greeting, rankUpNext, ringFill, upNextCategory, type UpNextCandidate } from "../src/lib/up-next";

const NOW = new Date("2026-11-11T16:00:00Z");
const CTX: HealthContext = { now: NOW, timeZone: "America/Chicago", quietDays: 8, parkAfterTries: 6 };
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

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

function row(id: string, over: Partial<HealthInput>, extra: Partial<UpNextCandidate> = {}): UpNextCandidate {
  const health = leadHealth(input(over), CTX);
  return {
    id,
    health,
    lateDays: over.overdue ? 3 : null,
    dueToday: null,
    bookedAhead: false,
    lastTalkDays: null,
    meetingOn: null,
    lastTouchAt: over.lastTouchAt ? over.lastTouchAt.getTime() : null,
    createdAt: NOW.getTime() - 30 * 86_400_000,
    ...extra,
  };
}

const rows: UpNextCandidate[] = [
  // (f) still trying: the oldest last try first; one past the limit.
  row("trying-new", { status: "CONTACTED", tries: 2, lastTouchAt: day(2), firstTouchAt: day(3) }),
  row("trying-old", { status: "CONTACTED", tries: 3, lastTouchAt: day(5), firstTouchAt: day(9) }),
  row("trying-park", { status: "CONTACTED", tries: 7, lastTouchAt: day(4), firstTouchAt: day(20) }),
  // (e) new: the newer lead first.
  row("new-old", {}, { createdAt: NOW.getTime() - 9 * 86_400_000 }),
  row("new-fresh", {}, { createdAt: NOW.getTime() - 1 * 86_400_000 }),
  // (d) talked, nothing booked: the longer ago first.
  row("talked-2", { status: "CONNECTED", tries: 2, talks: 1, lastTouchAt: day(2), lastConnectAt: day(2) }, { lastTalkDays: 2 }),
  row("talked-6", { status: "INTERESTED", tries: 3, talks: 1, lastTouchAt: day(6), lastConnectAt: day(6) }, { lastTalkDays: 6 }),
  // (c) due today: by time, no time last.
  row("today-late-morning", { status: "CONTACTED", tries: 1, lastTouchAt: day(3) }, { dueToday: { time: "11:00", kind: "call" } }),
  row("today-untimed", { status: "CONTACTED", tries: 1, lastTouchAt: day(3) }, { dueToday: { time: null, kind: "follow-up" } }),
  row("today-early", { status: "CONTACTED", tries: 1, lastTouchAt: day(3) }, { dueToday: { time: "09:30", kind: "call" } }),
  // (b) late: most days late first.
  row("late-4", { status: "CONTACTED", tries: 1, lastTouchAt: day(6), overdue: { count: 1, oldestOn: "2026-11-07" } }, { lateDays: 4 }),
  row("late-1", { status: "CONTACTED", tries: 1, lastTouchAt: day(6), overdue: { count: 1, oldestOn: "2026-11-10" } }, { lateDays: 1 }),
  // (a) a meeting to close out.
  row(
    "meeting",
    { status: "MEETING_SET", tries: 3, talks: 1, lastTouchAt: day(5), lastConnectAt: day(5), lastMeeting: { at: day(5), marked: false } },
    { meetingOn: "2026-11-06" },
  ),
  // Drop off: booked ahead, won, closed, past Meeting Set.
  row("booked-ahead", { status: "CONTACTED", tries: 1, lastTouchAt: day(1) }, { bookedAhead: true }),
  row("won", { status: "WON", tries: 4, talks: 2, lastTouchAt: day(3), lastConnectAt: day(3) }),
  row("closed", { status: "NOT_INTERESTED", tries: 2, talks: 1, lastTouchAt: day(3), lastConnectAt: day(3) }),
  row("completed", { status: "MEETING_COMPLETED", tries: 4, talks: 2, lastTouchAt: day(3), lastConnectAt: day(3) }),
];

const ranked = rankUpNext(rows);
assert.deepEqual(
  ranked.map((r) => r.id),
  [
    "meeting",
    "late-4",
    "late-1",
    "today-early",
    "today-late-morning",
    "today-untimed",
    "talked-6",
    "talked-2",
    "new-fresh",
    "new-old",
    "trying-old",
    "trying-park",
    "trying-new",
  ],
  "the plan's order, and the order inside each group",
);
console.log("ok  order: meeting, late, today, talked, new, trying");

const reason = (id: string) => ranked.find((r) => r.id === id)?.reason;
assert.equal(reason("meeting"), "Met Nov 6 — how did it go?");
assert.equal(reason("late-4"), "Follow-up 4 days late");
assert.equal(reason("late-1"), "Follow-up 1 day late");
assert.equal(reason("today-early"), "Call due today · 9:30 AM");
assert.equal(reason("today-untimed"), "Follow-up due today");
assert.equal(reason("talked-6"), "Talked 6 days ago — ask for the meeting");
assert.equal(reason("talked-2"), "Talked 2 days ago — ask for the meeting");
assert.equal(reason("new-fresh"), "New lead");
assert.equal(reason("trying-old"), "3 tries, never reached");
console.log("ok  reasons in plain words");

assert.equal(ranked.find((r) => r.id === "trying-park")?.park, true, "7 tries with nothing booked offers Try again in 30 days");
assert.equal(ranked.find((r) => r.id === "trying-old")?.park, false);
console.log("ok  park from the try limit on");

for (const gone of ["booked-ahead", "won", "closed", "completed"]) {
  assert.equal(ranked.some((r) => r.id === gone), false, `${gone} is not on Up next`);
}
console.log("ok  booked ahead, won, closed and past Meeting Set drop off");

// A meeting that was marked held is no longer a meeting to close out.
const marked = row("marked", {
  status: "MEETING_SET",
  tries: 3,
  talks: 2,
  lastTouchAt: day(5),
  lastConnectAt: day(5),
  lastMeeting: { at: day(5), marked: true },
});
assert.notEqual(upNextCategory(marked), "meeting");
// The day comes from health's reason when the loader didn't pass one.
const fromReason = row("from-reason", {
  status: "MEETING_SET",
  tries: 3,
  talks: 1,
  lastTouchAt: day(5),
  lastConnectAt: day(5),
  lastMeeting: { at: day(5), marked: false },
});
assert.match(rankUpNext([fromReason])[0].reason, /^Met Nov \d+ — how did it go\?$/);
console.log("ok  a marked meeting leaves the group; the day is read from health");

assert.equal(
  greeting({ hour: 8, firstName: "Marcus", late: 2, toCall: 9, quiet: { name: "Redbud", days: 17 } }),
  "Morning, Marcus · 2 follow-ups late · 9 to call · Redbud quiet 17 days",
);
assert.equal(greeting({ hour: 14, firstName: "Priya", late: 1, toCall: 0, quiet: null }), "Afternoon, Priya · 1 follow-up late");
assert.equal(greeting({ hour: 19, firstName: "Sam", late: 0, toCall: 0, quiet: null }), "Evening, Sam · nothing waiting");
console.log("ok  greeting");

assert.deepEqual(ringFill(23, 40, 0), { fill: 23 / 40, caption: "of 40", goal: true });
assert.deepEqual(ringFill(50, 40, 0), { fill: 1, caption: "of 40", goal: true });
assert.deepEqual(ringFill(6, null, 4), { fill: 1, caption: "+2 vs last week", goal: false });
assert.deepEqual(ringFill(2, null, 4), { fill: 0.5, caption: "−2 vs last week", goal: false });
assert.deepEqual(ringFill(0, null, 0), { fill: 0, caption: "same as last week", goal: false });
assert.equal(connectRate(0, 0), null);
assert.equal(connectRate(23, 6), 26);
assert.equal(connectRate(3, 5), 100);
console.log("ok  rings and connect rate");

console.log("\nup-next-check: all passed");
