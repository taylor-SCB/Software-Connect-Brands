import type { Headline } from "@/lib/reports/common";

// How a report's numbers are printed, on the page, in the email and in the
// written summary alike. Money is whole dollars: a report is read at a
// glance, and the cents are on the paperwork itself.

const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0, minimumFractionDigits: 0 });
const count = new Intl.NumberFormat("en-US");

// Tries and talks (Nov 11, 2026): every touch is a try; the part that
// didn't connect is grey, the talks are the fixed health "good" colour
// (the same in every workspace, like the health marks). Passed as `colors`
// to the report and Stats charts; their four series colours stay the
// default everywhere else. Kept here, out of the "use client" chart files,
// so server pages can hand it over.
export const TRY_TALK_COLORS = ["var(--health-none)", "var(--health-good)"] as const;
export const TRY_TALK_SERIES = ["Attempts", "Talks"];

export function money(cents: number) {
  return dollars.format(Math.round(cents / 100));
}

export function percent(rate: number) {
  return `${Math.round(rate * 100)}%`;
}

export function days(value: number) {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded} ${rounded === 1 ? "day" : "days"}`;
}

export function formatValue(value: number, format: Headline["format"] | "text"): string {
  if (format === "money") return money(value);
  if (format === "percent") return percent(value);
  if (format === "days") return days(value);
  if (format === "count") return count.format(value);
  return String(value);
}

export function plural(n: number, one: string, many = `${one}s`) {
  return `${count.format(n)} ${n === 1 ? one : many}`;
}

// "▲ 20% vs last week", "▼ $300", or "same as last week".
// A tile's number: "—" when there's nothing to measure.
export function headlineValue(headline: Headline) {
  return headline.empty ? "—" : formatValue(headline.value, headline.format);
}

// How far a number moved, as "▲ 20%", "▼ 3 pts" or, from nothing,
// "▲ up from 0" / "▲ up from $0". One rule for every screen (UX review,
// Nov 10, 2026): a percent change from 0 can't be worked out, so a rise
// from nothing is never "100%" (Stats said so) and the tile adds no
// "vs 0" after it (the reports said "from 0 vs 0"). `fromZero` tells the
// caller to leave its "vs …" off. Only for now !== before.
export function changeSize(now: number, before: number, format: Headline["format"]): { text: string; fromZero: boolean } {
  const arrow = now > before ? "▲" : "▼";
  if (format === "percent") return { text: `${arrow} ${Math.abs(Math.round((now - before) * 100))} pts`, fromZero: false };
  if (before === 0) return { text: `${arrow} ${now > before ? "up" : "down"} from ${formatValue(0, format)}`, fromZero: true };
  return { text: `${arrow} ${Math.abs(Math.round(((now - before) / before) * 100))}%`, fromZero: false };
}

export function changeText(headline: Headline): { text: string; tone: "good" | "bad" | "flat"; fromZero: boolean } | null {
  if (headline.empty || headline.previous === undefined || headline.previous === null) return null;
  const now = headline.value;
  const before = headline.previous;
  if (now === before) return { text: "same as before", tone: "flat", fromZero: false };
  const up = now > before;
  const good = headline.goodWhenUp === false ? !up : up;
  return { ...changeSize(now, before, headline.format), tone: good ? "good" : "bad" };
}
