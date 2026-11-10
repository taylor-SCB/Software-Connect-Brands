// Deterministic formatters. The locale and time zone are always explicit —
// never the ambient environment — so the server and the browser render the
// same string (no hydration mismatch) and everyone sees the same money.
//
// Time zone comes from the organization, not the viewer: a quote sent at
// 4pm Central should read 4pm to the contractor who sent it and to the
// customer reading it in another state, the same way a paper invoice does.

export const DEFAULT_TIME_ZONE = "America/Chicago";

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

// Intl formatters are expensive to construct; reuse one per zone.
const dateCache = new Map<string, Intl.DateTimeFormat>();
const dateTimeCache = new Map<string, Intl.DateTimeFormat>();

function dateFormatter(timeZone: string) {
  let formatter = dateCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone,
    });
    dateCache.set(timeZone, formatter);
  }
  return formatter;
}

function dateTimeFormatter(timeZone: string) {
  let formatter = dateTimeCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
      timeZone,
    });
    dateTimeCache.set(timeZone, formatter);
  }
  return formatter;
}

// An unknown zone string would throw inside Intl and take down the page,
// so fall back rather than trusting stored data blindly.
function safeZone(timeZone?: string | null) {
  if (!timeZone) return DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

export function formatCents(cents: number) {
  return currency.format(cents / 100);
}

export function formatDate(date: Date | string, timeZone?: string | null) {
  return dateFormatter(safeZone(timeZone)).format(new Date(date));
}

// A calendar date with no time on it — a due date, the day a payment was
// made, a birthday. Postgres hands these back as midnight UTC, so showing
// them in a zone behind UTC would read as the day before. They are the
// same day everywhere, so they are always formatted in UTC.
export function formatDay(date: Date | string) {
  return dateFormatter("UTC").format(new Date(date));
}

export function formatDateTime(date: Date | string, timeZone?: string | null) {
  return dateTimeFormatter(safeZone(timeZone)).format(new Date(date));
}

// Accepts "1,250.50", "$1,250.50" or "1250.5" and returns whole cents.
// Anything unparseable becomes 0 rather than NaN, which would poison
// every total downstream.
export function dollarsToCents(input: FormDataEntryValue | string | null | undefined) {
  if (typeof input !== "string") return 0;
  const cleaned = input.replace(/[^0-9.-]/g, "");
  const value = Number.parseFloat(cleaned);
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100);
}

export function centsToDollarInput(cents: number) {
  return (cents / 100).toFixed(2);
}

// Zones a US service business is plausibly in, plus the common territories.
export const TIME_ZONES = [
  { value: "America/New_York", label: "Eastern (New York)" },
  { value: "America/Chicago", label: "Central (Chicago)" },
  { value: "America/Denver", label: "Mountain (Denver)" },
  { value: "America/Phoenix", label: "Arizona (no DST)" },
  { value: "America/Los_Angeles", label: "Pacific (Los Angeles)" },
  { value: "America/Anchorage", label: "Alaska (Anchorage)" },
  { value: "Pacific/Honolulu", label: "Hawaii (Honolulu)" },
  { value: "America/Puerto_Rico", label: "Atlantic (Puerto Rico)" },
  { value: "UTC", label: "UTC" },
] as const;

const dayPartsCache = new Map<string, Intl.DateTimeFormat>();

// The calendar day a moment falls on in a zone, counted in whole days
// since 1970, so two of them are always a whole number of days apart —
// a daylight-saving change in between does not make one 23 hours.
function dayNumber(date: Date, timeZone: string) {
  let formatter = dayPartsCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone });
    dayPartsCache.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return Date.UTC(get("year"), get("month") - 1, get("day")) / 86_400_000;
}

// Calendar days between a moment and now, for "last touch 3 days ago",
// counted on the workspace's own calendar (Nov 10, 2026). It used to count
// 24-hour blocks, so a call at 9pm yesterday read "Today" at 8am, beside a
// date that said yesterday's. The zone is required so every caller says
// whose calendar it means.
export function daysSince(date: Date, timeZone: string | null | undefined, now: Date = new Date()) {
  const zone = safeZone(timeZone);
  return dayNumber(now, zone) - dayNumber(date, zone);
}

// The largest amount a cents column can hold: Postgres integer. Anything
// past it used to reach the database and come back as a raw driver error
// on a blank page, so the forms that take a typed amount check it first
// and say so in words.
export const MAX_MONEY_CENTS = 2_147_483_647;

export function moneyTooBig(cents: number) {
  return !Number.isFinite(cents) || Math.abs(cents) > MAX_MONEY_CENTS;
}

// A rate as a whole percent: 0.5 -> "50%".
export function pct(rate: number) {
  return `${Math.round(rate * 100)}%`;
}
