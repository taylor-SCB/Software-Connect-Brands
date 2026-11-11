import { shortDay, type LeadHealth } from "@/lib/health";

// "Up next" on My day (BDR redesign, Nov 11, 2026): one ranked list with
// no group headings, every row saying in plain words why it is there.
// Pure (no database, browser-safe): the page loads candidates and their
// health in batches (src/app/dashboard/my-day/load.ts), this puts them in
// order. The order is the plan's (bdrFlow step 2):
//   (a) meeting  "Met Nov 6 — how did it go?"   Meeting Set, the date has
//                passed and nobody marked it Held or No-show. Oldest first.
//   (b) late     "Follow-up 4 days late"         Most days late first.
//   (c) today    "Call due today · 10:00 AM"     By time; no time last.
//   (d) talked   "Talked 6 days ago — ask for the meeting"  Connected or
//                Interested with nothing booked. Longest ago first.
//   (e) new      "New lead"                      Mine, never touched.
//                Newest first.
//   (f) trying   "3 tries, never reached"        Oldest try first. From
//                the workspace's try limit on, the row offers "Try again in
//                30 days" (park).
// Anything with a next step booked on a later day drops off until then
// ("Try again Thu" after a No answer takes the row away until Thursday).
// Won, closed, and anyone at Meeting Completed or later are not on it.

export const UP_NEXT_ORDER = ["meeting", "late", "today", "talked", "new", "trying"] as const;
export type UpNextCategory = (typeof UP_NEXT_ORDER)[number];

// How many rows show before "Show all n".
export const UP_NEXT_SHOWN = 8;

export type UpNextCandidate = {
  id: string;
  health: Pick<LeadHealth, "state" | "reasonKey" | "reason" | "park" | "counts" | "meter">;
  // The oldest open follow-up whose day has gone by, in whole days late
  // (0 or null: nothing late).
  lateDays: number | null;
  // An open call, text, email, meeting or follow-up on today's date, with
  // its "HH:MM" and kind ("call", "follow-up").
  dueToday: { time: string | null; kind: string } | null;
  // Something open on a later day (a calendar entry, a touch dated ahead,
  // a meeting on their opportunity).
  bookedAhead: boolean;
  // The last talk, reply or held meeting, in whole days ago (null: none on
  // record, e.g. moved to Interested before outcomes existed).
  lastTalkDays: number | null;
  // The oldest past meeting still open on the calendar (nobody ticked it,
  // marked it Held or No-show), yyyy-mm-dd. Meetings are not counted in
  // lateDays.
  meetingOn: string | null;
  // Milliseconds, for the order inside a group.
  lastTouchAt: number | null;
  createdAt: number;
};

export type UpNextRow = {
  id: string;
  category: UpNextCategory;
  reason: string;
  // Offer "Try again in 30 days".
  park: boolean;
};

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

function ago(days: number) {
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

// "10:00" → "10:00 AM".
function time12(value: string | null) {
  if (!value) return null;
  const [h, m] = value.split(":").map(Number);
  if (!Number.isFinite(h)) return null;
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(Number.isFinite(m) ? m : 0).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

const STEP_MEETING_SET = 2;

// Which group a candidate falls in, or null when it doesn't belong on Up
// next today.
export function upNextCategory(row: UpNextCandidate): UpNextCategory | null {
  const { health } = row;
  if (health.state === "WON" || health.state === "CLOSED") return null;
  // A meeting whose day has gone by with its calendar entry still open, or
  // one health says nobody marked. (Health puts "late" first when the
  // open entry counts as overdue; here the meeting wins, in its own words.)
  if (row.meetingOn || health.reasonKey === "meeting") return "meeting";
  if ((row.lateDays ?? 0) > 0) return "late";
  if (row.dueToday) return "today";
  if (row.bookedAhead) return null;
  if (health.state === "REACHED") return health.meter.step < STEP_MEETING_SET ? "talked" : null;
  if (health.state === "NEW") return "new";
  if (health.state === "TRYING") return "trying";
  return null;
}

// The meeting's day out of health's "Did the Nov 6 meeting happen?" when
// the loader didn't pass it.
function meetingDay(row: UpNextCandidate) {
  if (row.meetingOn) return shortDay(row.meetingOn);
  const match = /the (.+) meeting happen/.exec(row.health.reason);
  return match ? match[1] : null;
}

export function upNextReason(row: UpNextCandidate, category: UpNextCategory): string {
  switch (category) {
    case "meeting": {
      const day = meetingDay(row);
      return day ? `Met ${day} — how did it go?` : "Meeting has passed — how did it go?";
    }
    case "late":
      return `Follow-up ${plural(Math.max(1, row.lateDays ?? 1), "day", "days")} late`;
    case "today": {
      const kind = row.dueToday?.kind && row.dueToday.kind !== "touch" ? row.dueToday.kind : "follow-up";
      const time = time12(row.dueToday?.time ?? null);
      return `${kind.charAt(0).toUpperCase()}${kind.slice(1)} due today${time ? ` · ${time}` : ""}`;
    }
    case "talked":
      return row.lastTalkDays === null ? "Talked — ask for the meeting" : `Talked ${ago(row.lastTalkDays)} — ask for the meeting`;
    case "new":
      return "New lead";
    case "trying": {
      const tries = row.health.counts.tries;
      if (tries === 0) return "Not reached yet";
      return `${plural(tries, "try", "tries")}, never reached`;
    }
  }
}

// Inside a group: the order the plan names, then by name-independent id
// so the list never shuffles between loads.
function within(category: UpNextCategory, a: UpNextCandidate, b: UpNextCandidate): number {
  switch (category) {
    case "meeting":
      return (a.meetingOn ?? "").localeCompare(b.meetingOn ?? "") || (a.lastTouchAt ?? 0) - (b.lastTouchAt ?? 0);
    case "late":
      return (b.lateDays ?? 0) - (a.lateDays ?? 0);
    case "today":
      return (a.dueToday?.time ?? "99:99").localeCompare(b.dueToday?.time ?? "99:99");
    case "talked":
      return (b.lastTalkDays ?? Number.MAX_SAFE_INTEGER) - (a.lastTalkDays ?? Number.MAX_SAFE_INTEGER);
    case "new":
      return b.createdAt - a.createdAt;
    case "trying":
      return (a.lastTouchAt ?? 0) - (b.lastTouchAt ?? 0);
  }
}

// The whole list, in order, each row with its reason.
export function rankUpNext(rows: UpNextCandidate[]): UpNextRow[] {
  const placed = rows
    .map((row) => ({ row, category: upNextCategory(row) }))
    .filter((entry): entry is { row: UpNextCandidate; category: UpNextCategory } => entry.category !== null);
  placed.sort((a, b) => {
    const group = UP_NEXT_ORDER.indexOf(a.category) - UP_NEXT_ORDER.indexOf(b.category);
    if (group !== 0) return group;
    return within(a.category, a.row, b.row) || a.row.id.localeCompare(b.row.id);
  });
  return placed.map(({ row, category }) => ({
    id: row.id,
    category,
    reason: upNextReason(row, category),
    park: category === "trying" && row.health.park,
  }));
}

// "Morning, Marcus · 2 follow-ups late · 9 to call · Redbud quiet 17 days".
// Parts that are zero draw nothing.
export function greeting(input: {
  hour: number;
  firstName: string;
  late: number;
  toCall: number;
  quiet: { name: string; days: number } | null;
}) {
  const hello = input.hour < 12 ? "Morning" : input.hour < 17 ? "Afternoon" : "Evening";
  const parts = [`${hello}, ${input.firstName}`];
  if (input.late > 0) parts.push(`${plural(input.late, "follow-up", "follow-ups")} late`);
  if (input.toCall > 0) parts.push(`${input.toCall} to call`);
  if (input.quiet) parts.push(`${input.quiet.name} quiet ${plural(input.quiet.days, "day", "days")}`);
  if (parts.length === 1) parts.push("nothing waiting");
  return parts.join(" · ");
}

// A week ring: toward the owner's goal when one is set, otherwise against
// the same days last week. `fill` is 0..1.
export function ringFill(value: number, goal: number | null, lastWeek: number) {
  if (goal && goal > 0) return { fill: Math.min(1, value / goal), caption: `of ${goal}`, goal: true };
  const base = Math.max(lastWeek, 1);
  const diff = value - lastWeek;
  const caption = lastWeek === 0 && value === 0 ? "same as last week" : diff === 0 ? "same as last week" : `${diff > 0 ? "+" : "−"}${Math.abs(diff)} vs last week`;
  return { fill: Math.min(1, value / base), caption, goal: false };
}

// Tries ÷ talks as a whole percent, or null with no tries.
export function connectRate(tries: number, talks: number) {
  if (tries <= 0) return null;
  return Math.round((Math.min(talks, tries) / tries) * 100);
}
