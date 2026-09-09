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

// Whole days between a moment and now, for "last touch 3 days ago".
export function daysSince(date: Date) {
  return Math.floor((Date.now() - date.getTime()) / 86_400_000);
}
