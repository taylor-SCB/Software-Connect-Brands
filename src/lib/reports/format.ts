import type { Headline } from "@/lib/reports/common";

// How a report's numbers are printed, on the page, in the email and in the
// written summary alike. Money is whole dollars: a report is read at a
// glance, and the cents are on the paperwork itself.

const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0, minimumFractionDigits: 0 });
const count = new Intl.NumberFormat("en-US");

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
export function changeText(headline: Headline): { text: string; tone: "good" | "bad" | "flat" } | null {
  if (headline.previous === undefined || headline.previous === null) return null;
  const now = headline.value;
  const before = headline.previous;
  if (now === before) return { text: "same as before", tone: "flat" };
  const up = now > before;
  const good = headline.goodWhenUp === false ? !up : up;
  let size: string;
  if (headline.format === "percent") size = `${Math.abs(Math.round((now - before) * 100))} pts`;
  else if (before === 0) size = `from ${formatValue(0, headline.format)}`;
  else size = `${Math.abs(Math.round(((now - before) / before) * 100))}%`;
  return { text: `${up ? "▲" : "▼"} ${size}`, tone: good ? "good" : "bad" };
}
