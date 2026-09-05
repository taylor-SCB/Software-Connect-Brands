// Deterministic formatters. These run on both the server and the client,
// so the locale and time zone are pinned — otherwise the server's output
// and the browser's output disagree and React reports a hydration
// mismatch (and money silently renders differently per visitor).

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
});

export function formatCents(cents: number) {
  return currency.format(cents / 100);
}

export function formatDate(date: Date | string) {
  return dateFormatter.format(new Date(date));
}

export function formatDateTime(date: Date | string) {
  return dateTimeFormatter.format(new Date(date));
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
