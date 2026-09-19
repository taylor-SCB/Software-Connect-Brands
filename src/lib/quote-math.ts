import { LINE_ITEM_TAGS, type LineItemTagValue } from "@/lib/constants";

export type TotalableLine = {
  quantity: number;
  unitPriceCents: number;
  tag: LineItemTagValue | string;
};

// Rounding happens once per line, then lines are summed as integers, so
// the tag totals always add up to exactly the grand total. Summing
// floats and rounding at the end is what makes quote footers off by a
// cent.
export function lineTotalCents(quantity: number, unitPriceCents: number) {
  if (!Number.isFinite(quantity) || !Number.isFinite(unitPriceCents)) return 0;
  return Math.round(quantity * unitPriceCents);
}

// What a software line comes to over its whole term, for the person
// building the quote to sanity-check the unit, the billing period and the
// term against each other. Deliberately NOT part of the quote total: the
// price typed is the price per period, and the quote totals quantity ×
// price the same way every other line does.
//
// "Pay in Full" (PER_TERM) is already the whole term, so it multiplies by
// one however many months are on it.
export function termTotalCents(
  quantity: number,
  unitPriceCents: number,
  softwareRate: string | null | undefined,
  termMonths: number | null | undefined,
): number | null {
  if (!softwareRate || !termMonths || termMonths <= 0) return null;
  if (!Number.isFinite(quantity) || !Number.isFinite(unitPriceCents)) return null;

  const periods =
    softwareRate === "PER_MONTH" ? termMonths : softwareRate === "PER_YEAR" ? termMonths / 12 : 1;

  return Math.round(quantity * unitPriceCents * periods);
}

export function computeQuoteTotals(lines: TotalableLine[]) {
  const byTag = Object.fromEntries(
    LINE_ITEM_TAGS.map((tag) => [tag, 0]),
  ) as Record<LineItemTagValue, number>;

  let totalCents = 0;

  for (const line of lines) {
    const total = lineTotalCents(line.quantity, line.unitPriceCents);
    totalCents += total;
    if (line.tag in byTag) {
      byTag[line.tag as LineItemTagValue] += total;
    }
  }

  return { totalCents, byTag };
}
