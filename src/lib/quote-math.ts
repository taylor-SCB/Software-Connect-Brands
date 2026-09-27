import { LINE_ITEM_TAGS, type LineItemTagValue } from "@/lib/constants";

export type TotalableLine = {
  quantity: number;
  unitPriceCents: number;
  tag: LineItemTagValue | string;
  // Money off this line, already in cents. Absent on the older callers
  // that never carried one; treated as nothing off.
  discountCents?: number | null;
};

// Rounding happens once per line, then lines are summed as integers, so
// the tag totals always add up to exactly the grand total. Summing
// floats and rounding at the end is what makes quote footers off by a
// cent.
//
// A line's total is quantity × price, less its own discount. Every
// screen, document and budget reads it through here, so a discount can
// never show on the quote and go missing on the contract.
export function lineTotalCents(quantity: number, unitPriceCents: number, discountCents = 0) {
  if (!Number.isFinite(quantity) || !Number.isFinite(unitPriceCents)) return 0;
  return lineGrossCents(quantity, unitPriceCents) - (Number.isFinite(discountCents) ? Math.round(discountCents) : 0);
}

// The line before its discount comes off.
export function lineGrossCents(quantity: number, unitPriceCents: number) {
  if (!Number.isFinite(quantity) || !Number.isFinite(unitPriceCents)) return 0;
  return Math.round(quantity * unitPriceCents);
}

// The same for a stored row, which carries its discount on itself.
export function lineNetCents(line: { quantity: number; unitPriceCents: number; discountCents?: number | null }) {
  return lineTotalCents(line.quantity, line.unitPriceCents, line.discountCents ?? 0);
}

// What a typed discount is worth against an amount. Typed as a percent
// (10 = 10%) or as a fixed number of cents; the percent is kept alongside
// so a later change to what it applies to re-prices it rather than
// freezing the old figure. Never more than the amount itself, and never
// negative: a discount that is bigger than the line is a mistake, and
// clamping it is kinder than printing a negative total.
export function resolveDiscount(
  input: { percent: number | null; cents: number },
  baseCents: number,
): { discountCents: number; discountPercent: number | null } {
  const cap = Math.max(0, baseCents);
  if (input.percent !== null && Number.isFinite(input.percent)) {
    const percent = Math.min(Math.max(input.percent, 0), 100);
    return { discountCents: Math.min(cap, Math.round((cap * percent) / 100)), discountPercent: percent };
  }
  const cents = Number.isFinite(input.cents) ? Math.round(input.cents) : 0;
  return { discountCents: Math.min(cap, Math.max(0, cents)), discountPercent: null };
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

// A discount on the whole quote, as stored on the quote: the cents it
// was last worked out to, and the percent it was typed as when it was.
export type QuoteDiscount = {
  discountCents?: number | null;
  discountPercent?: number | null;
};

// What the whole-quote discount is worth against the lines' net
// subtotal. Typed as a percent, it is re-priced from the percent here so
// a stored figure can never disagree with the percent shown beside it;
// typed as dollars, it is what was typed, capped at the subtotal so a
// quote whose lines have since shrunk never prints a negative total (and
// is worth the full amount again once the lines grow back).
export function quoteDiscountCents(quote: QuoteDiscount | null | undefined, subtotalCents: number): number {
  if (!quote) return 0;
  const percent = quote.discountPercent;
  if (percent !== null && percent !== undefined && Number.isFinite(percent)) {
    return resolveDiscount({ percent, cents: 0 }, subtotalCents).discountCents;
  }
  return resolveDiscount({ percent: null, cents: quote.discountCents ?? 0 }, subtotalCents).discountCents;
}

// The lines added up, net of each line's own discount, less the discount
// on the whole quote when one is passed. `grossCents` is what the lines
// came to before any discount, `subtotalCents` what they come to after
// their own discounts and before the quote's, and `discountCents` the
// whole amount taken off, so a footer can print Subtotal / Discount /
// Total from any of them and the figures always tie.
//
// `byTag` is net of the line discounts only: a discount on the whole
// quote belongs to no one tag, so the tags add up to the subtotal.
export function computeQuoteTotals(lines: TotalableLine[], quote?: QuoteDiscount | null) {
  const byTag = Object.fromEntries(
    LINE_ITEM_TAGS.map((tag) => [tag, 0]),
  ) as Record<LineItemTagValue, number>;

  let subtotalCents = 0;
  let grossCents = 0;

  for (const line of lines) {
    const total = lineTotalCents(line.quantity, line.unitPriceCents, line.discountCents ?? 0);
    subtotalCents += total;
    grossCents += lineGrossCents(line.quantity, line.unitPriceCents);
    if (line.tag in byTag) {
      byTag[line.tag as LineItemTagValue] += total;
    }
  }

  const quoteDiscount = quoteDiscountCents(quote, subtotalCents);
  const totalCents = subtotalCents - quoteDiscount;

  return {
    totalCents,
    byTag,
    grossCents,
    subtotalCents,
    lineDiscountCents: grossCents - subtotalCents,
    quoteDiscountCents: quoteDiscount,
    discountCents: grossCents - totalCents,
  };
}
