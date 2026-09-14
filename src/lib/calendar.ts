// The calendar: everything scheduled, in one place.
//
// Dates here are days, not moments. An install day is that day wherever
// you read it from, so every date is a yyyy-mm-dd string and the times
// beside it are "07:30" strings in the workspace's own clock. That is
// what keeps a 7:30am install reading 7:30am, and it takes a whole class
// of time-zone bugs off the screen people look at most.

import { addDays } from "@/lib/payments";

/* ------------------------------ Day arithmetic ------------------------------ */

// Whether a yyyy-mm-dd is a day that exists. The shape being right is
// not enough: 2026-13-01 and 2026-02-30 both match the pattern and then
// poison every calculation downstream, which turned a mistyped or
// truncated shared link into a 500 with no calendar on it.
export function isRealDay(value: string | string[] | undefined): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
  );
}

// The weekday of a yyyy-mm-dd, 0 = Sunday. Parsed as UTC so the answer
// never depends on where the server is.
export function weekdayOf(iso: string) {
  return new Date(`${iso}T12:00:00.000Z`).getUTCDay();
}

// The Sunday of the week a day falls in. Weeks start on Sunday because
// that is how the paper calendar in the truck is printed.
export function startOfWeek(iso: string) {
  return addDays(iso, -weekdayOf(iso));
}

export function startOfMonth(iso: string) {
  return `${iso.slice(0, 7)}-01`;
}

// yyyy-mm shifted by whole months, landing on the 1st.
export function shiftMonth(iso: string, months: number) {
  const [y, m] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  return target.toISOString().slice(0, 10);
}

export function daysInMonth(iso: string) {
  const [y, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// The six-week grid a month is drawn on: always 42 days, starting on the
// Sunday on or before the 1st, so the grid never changes height between
// months and nothing jumps as you page through.
export function monthGrid(monthIso: string) {
  const first = startOfWeek(startOfMonth(monthIso));
  return Array.from({ length: 42 }, (_, index) => addDays(first, index));
}

export function weekDays(iso: string) {
  const first = startOfWeek(iso);
  return Array.from({ length: 7 }, (_, index) => addDays(first, index));
}

// Every day an event covers, inclusive. A three-day install shows on all
// three. Capped so a fat-fingered end date cannot spin the page.
export const MAX_EVENT_DAYS = 60;

export function eventDays(event: { startOn: string; endOn: string | null }) {
  if (!event.endOn || event.endOn <= event.startOn) return [event.startOn];
  const days = [event.startOn];
  let cursor = event.startOn;
  while (cursor < event.endOn && days.length < MAX_EVENT_DAYS) {
    cursor = addDays(cursor, 1);
    days.push(cursor);
  }
  return days;
}

// How many days of work an event is, which is what the job's schedule
// counts up.
export function eventDayCount(event: { startOn: string; endOn: string | null }) {
  return eventDays(event).length;
}

/* -------------------------------- Formatting -------------------------------- */

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function monthTitle(monthIso: string) {
  const [y, m] = monthIso.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

// "Sep 14" / "Sep 14 – 16" / "Sep 30 – Oct 2".
export function dayRangeTitle(startIso: string, endIso: string) {
  const short = (iso: string) => {
    const [, m, d] = iso.split("-").map(Number);
    return `${MONTH_NAMES[m - 1].slice(0, 3)} ${d}`;
  };
  if (startIso === endIso) return short(startIso);
  return `${short(startIso)} – ${short(endIso)}`;
}

export function dayOfMonth(iso: string) {
  return Number(iso.slice(8, 10));
}

export function isSameMonth(iso: string, monthIso: string) {
  return iso.slice(0, 7) === monthIso.slice(0, 7);
}

// "7:30am", "4pm". Minutes are dropped when they are zero, the way
// anybody writes a start time down.
export function formatTime(value: string | null | undefined) {
  if (!value) return null;
  const [h, m] = value.split(":").map(Number);
  if (!Number.isFinite(h)) return null;
  const suffix = h < 12 ? "am" : "pm";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hour}:${String(m).padStart(2, "0")}${suffix}` : `${hour}${suffix}`;
}

// "7:30am – 4pm", "from 7:30am", "until 4pm", or nothing at all for a day
// with no clock on it.
export function formatTimeRange(startTime: string | null, endTime: string | null) {
  const start = formatTime(startTime);
  const end = formatTime(endTime);
  if (start && end) return `${start} – ${end}`;
  if (start) return `from ${start}`;
  if (end) return `until ${end}`;
  return null;
}

// "HH:MM" out of whatever a time input gave us, or null. Anything else is
// dropped rather than stored, so a bad value can never reach the screen.
export function cleanTime(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// Sorts a list that spans days: by day first, then by the clock within
// it. A 7am day next month must never sort above a 9am day tomorrow.
export function byDayThenTime(
  a: { startOn: string; startTime: string | null; title: string },
  b: { startOn: string; startTime: string | null; title: string },
) {
  return a.startOn.localeCompare(b.startOn) || byTimeThenTitle(a, b);
}

// Sorts the events of ONE day the way you read them: timed ones first in
// clock order, then the all-day ones, then alphabetically so the order is
// stable between renders. Use byDayThenTime for anything spanning days.
export function byTimeThenTitle(
  a: { startTime: string | null; title: string },
  b: { startTime: string | null; title: string },
) {
  if (a.startTime && b.startTime) return a.startTime.localeCompare(b.startTime) || a.title.localeCompare(b.title);
  if (a.startTime) return -1;
  if (b.startTime) return 1;
  return a.title.localeCompare(b.title);
}

/* --------------------------------- Colours --------------------------------- */

// A hue per event type, so a month reads at a glance. Types beyond the
// list get one from the same palette by name, so a workspace's own type
// is still a consistent colour rather than grey.
const TYPE_COLORS: Record<string, string> = {
  Install: "#34d399",
  "Site walk": "#60a5fa",
  "Project meeting": "#a78bfa",
  "Service call": "#fbbf24",
  Delivery: "#f472b6",
  Inspection: "#22d3ee",
  "Punch list": "#fb923c",
  Other: "#94a3b8",
};
const PALETTE = ["#34d399", "#60a5fa", "#a78bfa", "#fbbf24", "#f472b6", "#22d3ee", "#fb923c", "#94a3b8"];

export function colorForType(type: string) {
  const known = TYPE_COLORS[type];
  if (known) return known;
  let hash = 0;
  for (let index = 0; index < type.length; index += 1) hash = (hash * 31 + type.charCodeAt(index)) % 997;
  return PALETTE[hash % PALETTE.length];
}

/* -------------------------------- Overlaps -------------------------------- */

export type OverlapNote = { crewId: string; crewName: string; day: string; count: number };

// A crew in two places on one day. It is a note, not a refusal: sending
// half a crew to a service call in the morning is normal, and the app
// has no business deciding it is wrong. Two events with times that do not
// touch are not flagged — 7am to noon and 1pm to 5pm is just a day.
export function crewOverlaps(
  events: {
    crewId: string | null;
    crew: { name: string } | null;
    startOn: string;
    endOn: string | null;
    startTime: string | null;
    endTime: string | null;
  }[],
): OverlapNote[] {
  const byCrewDay = new Map<string, typeof events>();
  for (const event of events) {
    if (!event.crewId) continue;
    for (const day of eventDays(event)) {
      const key = `${event.crewId}|${day}`;
      byCrewDay.set(key, [...(byCrewDay.get(key) ?? []), event]);
    }
  }

  const notes: OverlapNote[] = [];
  for (const [key, sameDay] of byCrewDay) {
    if (sameDay.length < 2) continue;
    if (!anyClash(sameDay)) continue;
    const [crewId, day] = key.split("|");
    notes.push({ crewId, day, crewName: sameDay[0].crew?.name ?? "That crew", count: sameDay.length });
  }
  return notes.sort((a, b) => a.day.localeCompare(b.day) || a.crewName.localeCompare(b.crewName));
}

// Do any two of a day's events actually collide? An event with no times
// on it is treated as taking the whole day, which is what it means.
function anyClash(events: { startTime: string | null; endTime: string | null }[]) {
  const spans = events.map((event) => ({
    from: event.startTime ?? "00:00",
    to: event.endTime ?? (event.startTime ? "23:59" : "23:59"),
  }));
  for (let i = 0; i < spans.length; i += 1) {
    for (let j = i + 1; j < spans.length; j += 1) {
      if (spans[i].from < spans[j].to && spans[j].from < spans[i].to) return true;
    }
  }
  return false;
}
