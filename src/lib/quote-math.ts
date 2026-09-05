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
