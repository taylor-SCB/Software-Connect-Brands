// The time windows every report reads (Nov 10, 2026). One place works out
// "this week" or "last quarter" in the workspace's own time zone, so the
// page, the write-up and the 6am email can never disagree about which days
// they mean. Pure: no database, `now` passed in, so the cron's test clock
// and the page share it.

export const PERIOD_KEYS = [
  "today",
  "yesterday",
  "this-week",
  "last-week",
  "this-month",
  "last-month",
  "this-quarter",
  "last-quarter",
  "this-year",
  "last-year",
] as const;
export type PeriodKey = (typeof PERIOD_KEYS)[number];

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  today: "Today",
  yesterday: "Yesterday",
  "this-week": "This week",
  "last-week": "Last week",
  "this-month": "This month",
  "last-month": "Last month",
  "this-quarter": "This quarter",
  "last-quarter": "Last quarter",
  "this-year": "This year",
  "last-year": "Last year",
};

// What the comparison is called in words, for the tiles and the write-up.
const COMPARE_LABELS: Record<PeriodKey, string> = {
  today: "yesterday",
  yesterday: "the day before",
  "this-week": "the same days last week",
  "last-week": "the week before",
  "this-month": "the same days last month",
  "last-month": "the month before",
  "this-quarter": "the same days last quarter",
  "last-quarter": "the quarter before",
  "this-year": "the same days last year",
  "last-year": "the year before",
};

export function isPeriodKey(value: unknown): value is PeriodKey {
  return typeof value === "string" && (PERIOD_KEYS as readonly string[]).includes(value);
}

export type Window = {
  // Instants, [from, to).
  from: Date;
  to: Date;
  // Calendar days in the zone, [fromIso, toIso) — for DATE columns such as
  // Payment.paidOn and CalendarEvent.startOn.
  fromIso: string;
  toIso: string;
};

export type PeriodRange = Window & {
  key: PeriodKey;
  label: string;
  // "Nov 9 – Nov 10, 2026"
  span: string;
  compareLabel: string;
  previous: Window;
  // Every day in the window, yyyy-mm-dd, for the day-by-day charts.
  days: string[];
  // The workspace's today, yyyy-mm-dd.
  today: string;
};

/* ------------------------------ zone helpers ------------------------------ */

const partsCache = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(timeZone: string) {
  let f = partsCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsCache.set(timeZone, f);
  }
  return f;
}

// What the zone's wall clock reads at an instant.
export function zonedParts(at: Date, timeZone: string) {
  const parts = partsFormatter(timeZone).formatToParts(at);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const year = get("year");
  const month = get("month");
  const day = get("day");
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  // 0 = Sunday … 6 = Saturday, from the calendar date itself.
  const weekday = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return { year, month, day, hour: get("hour"), minute: get("minute"), second: get("second"), iso, weekday };
}

export function localIso(at: Date, timeZone: string) {
  return zonedParts(at, timeZone).iso;
}

// The instant the zone's clock reads 00:00 on that calendar day.
export function zonedMidnight(iso: string, timeZone: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  const target = Date.UTC(y, m - 1, d);
  let guess = target;
  // Two passes settle a daylight-saving change on the day itself.
  for (let i = 0; i < 2; i += 1) {
    const p = zonedParts(new Date(guess), timeZone);
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    guess += target - shown;
  }
  return new Date(guess);
}

export function addDaysIso(iso: string, days: number) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function addMonthsIso(iso: string, months: number) {
  const [y, m] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1 + months, 1));
  return date.toISOString().slice(0, 10);
}

export function daysBetweenIso(a: string, b: string) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

const shortDay = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const shortDayYear = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
export function formatIsoDay(iso: string, withYear = false) {
  return (withYear ? shortDayYear : shortDay).format(new Date(`${iso}T12:00:00Z`));
}

/* -------------------------------- periods -------------------------------- */

// [startIso, endIso) of the calendar period the key names, around today.
function bounds(key: PeriodKey, today: string): { start: string; end: string; toDate: boolean } {
  const [y, m] = today.split("-").map(Number);
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  // Weeks start on Monday, as a contractor's week does.
  const monday = addDaysIso(today, -((weekday + 6) % 7));
  const monthStart = `${y}-${String(m).padStart(2, "0")}-01`;
  const quarterStart = `${y}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, "0")}-01`;
  const yearStart = `${y}-01-01`;
  switch (key) {
    case "today":
      return { start: today, end: addDaysIso(today, 1), toDate: true };
    case "yesterday":
      return { start: addDaysIso(today, -1), end: today, toDate: false };
    case "this-week":
      return { start: monday, end: addDaysIso(monday, 7), toDate: true };
    case "last-week":
      return { start: addDaysIso(monday, -7), end: monday, toDate: false };
    case "this-month":
      return { start: monthStart, end: addMonthsIso(monthStart, 1), toDate: true };
    case "last-month":
      return { start: addMonthsIso(monthStart, -1), end: monthStart, toDate: false };
    case "this-quarter":
      return { start: quarterStart, end: addMonthsIso(quarterStart, 3), toDate: true };
    case "last-quarter":
      return { start: addMonthsIso(quarterStart, -3), end: quarterStart, toDate: false };
    case "this-year":
      return { start: yearStart, end: `${y + 1}-01-01`, toDate: true };
    case "last-year":
      return { start: `${y - 1}-01-01`, end: yearStart, toDate: false };
  }
}

// The period before, the same shape: last week for this week, and so on.
function previousStart(key: PeriodKey, start: string) {
  if (key === "today" || key === "yesterday") return addDaysIso(start, -1);
  if (key.endsWith("week")) return addDaysIso(start, -7);
  if (key.endsWith("month")) return addMonthsIso(start, -1);
  if (key.endsWith("quarter")) return addMonthsIso(start, -3);
  return addMonthsIso(start, -12);
}

// A period that is still running ("this month") is compared like for
// like: the first N days of last month against the first N days of this
// one, up to the same time of day. A finished one against the whole one
// before it.
export function periodRange(key: PeriodKey, timeZone: string, now: Date): PeriodRange {
  const today = localIso(now, timeZone);
  const { start, end, toDate } = bounds(key, today);
  const from = zonedMidnight(start, timeZone);
  const to = toDate ? now : zonedMidnight(end, timeZone);
  const toIso = toDate ? addDaysIso(today, 1) : end;

  const prevStart = previousStart(key, start);
  const prevFrom = zonedMidnight(prevStart, timeZone);
  let previous: Window;
  if (toDate) {
    const elapsedDays = daysBetweenIso(start, toIso);
    const prevEnd = zonedMidnight(start, timeZone);
    const prevTo = new Date(Math.min(prevEnd.getTime(), prevFrom.getTime() + (now.getTime() - from.getTime())));
    const prevToIso = addDaysIso(prevStart, Math.min(elapsedDays, daysBetweenIso(prevStart, start)));
    previous = { from: prevFrom, to: prevTo, fromIso: prevStart, toIso: prevToIso };
  } else {
    previous = { from: prevFrom, to: from, fromIso: prevStart, toIso: start };
  }

  const days: string[] = [];
  for (let day = start; day < toIso; day = addDaysIso(day, 1)) days.push(day);
  const lastDay = addDaysIso(toIso, -1);
  const span = start === lastDay ? formatIsoDay(start, true) : `${formatIsoDay(start)} – ${formatIsoDay(lastDay, true)}`;

  return {
    key,
    label: PERIOD_LABELS[key],
    span,
    compareLabel: COMPARE_LABELS[key],
    from,
    to,
    fromIso: start,
    toIso,
    previous,
    days,
    today,
  };
}
