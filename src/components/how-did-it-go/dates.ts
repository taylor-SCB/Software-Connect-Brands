// The date and time chips the "How did it go?" and Book meeting sheets
// offer instead of a phone's date box (BDR redesign, Nov 11, 2026):
// Tomorrow · Thu · Next week · Pick, and 9 · 10 · 11 · 1 · 2 · 3 · Pick.
// Pure and browser-safe: every day is a "yyyy-mm-dd" on the workspace's
// calendar, handed in by the server, never read off the browser's clock.

export type DayChip = { key: string; label: string; sub: string; on: string };
export type TimeChip = { label: string; value: string };

const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });
const MONTH_DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const LONG = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

function at(iso: string) {
  return new Date(`${iso.slice(0, 10)}T12:00:00Z`);
}

export function plusDays(iso: string, days: number) {
  const date = at(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function weekend(iso: string) {
  const day = at(iso).getUTCDay();
  return day === 0 || day === 6;
}

// The next working day after `iso` (Saturday and Sunday skipped).
function nextWorkday(iso: string) {
  let day = plusDays(iso, 1);
  while (weekend(day)) day = plusDays(day, 1);
  return day;
}

export function weekdayShort(iso: string) {
  return WEEKDAY.format(at(iso));
}

// "Tue, Nov 17"
export function longDay(iso: string) {
  return LONG.format(at(iso));
}

// Tomorrow (or Mon after a Friday) · the working day after · a week on.
// Three different days, each with its date underneath.
export function dayChips(today: string): DayChip[] {
  const first = nextWorkday(today);
  const second = nextWorkday(first);
  let week = plusDays(today, 7);
  while (weekend(week)) week = plusDays(week, 1);
  if (week <= second) week = plusDays(second, 5);
  return [
    { key: "first", label: first === plusDays(today, 1) ? "Tomorrow" : weekdayShort(first), sub: MONTH_DAY.format(at(first)), on: first },
    { key: "second", label: weekdayShort(second), sub: MONTH_DAY.format(at(second)), on: second },
    { key: "week", label: "Next week", sub: `${weekdayShort(week)} ${MONTH_DAY.format(at(week))}`, on: week },
  ];
}

export const TIME_CHIPS: TimeChip[] = [
  { label: "9 AM", value: "09:00" },
  { label: "10 AM", value: "10:00" },
  { label: "11 AM", value: "11:00" },
  { label: "1 PM", value: "13:00" },
  { label: "2 PM", value: "14:00" },
  { label: "3 PM", value: "15:00" },
];

// "10:00" → "10:00 AM"
export function clock(value: string | null | undefined) {
  if (!value) return "";
  const [h, m] = value.split(":").map(Number);
  if (!Number.isFinite(h)) return "";
  return `${h % 12 === 0 ? 12 : h % 12}:${String(Number.isFinite(m) ? m : 0).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

// "Tue, Nov 17, 10:00 AM" or "Tue, Nov 17"
export function whenWords(on: string, time?: string | null) {
  return time ? `${longDay(on)}, ${clock(time)}` : longDay(on);
}

// The workspace's today from the browser, only as a stand-in until the
// server's answer arrives.
export function browserToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
