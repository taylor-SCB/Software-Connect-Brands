// The money on a product's supplier rows (Release 3a, Nov 4, 2026). Pure,
// so the product form, the Products list, the quote editor, Import
// Ratesheet's preview and the server all work it out the same way.

// The biggest COGS discount and minimum margin a row can carry: 95%, the
// same ceiling the import's margin rule has (MAX_MARGIN_BP in price-list.ts).
export const MAX_DISCOUNT_BP = 9500;
export const MAX_MIN_MARGIN_BP = 9500;
// The biggest "required minimum markup" on a sheet: 1,000%, as the
// import's markup rule allows.
export const MAX_MIN_MARKUP_BP = 100_000;
// Lines See product list sends per save request: small enough that each
// request ends well inside the hosting's time limit.
export const LINES_PER_BATCH = 500;

/** Your COGS from a supplier: their price less your discount, to the cent. */
export function effectiveCostCents(costCents: number, discountBp: number): number {
  const discount = Math.min(Math.max(discountBp, 0), MAX_DISCOUNT_BP);
  return Math.round((costCents * (10000 - discount)) / 10000);
}

/**
 * The lowest price that keeps the minimum margin on a cost: cost ÷ (1 −
 * margin), rounded up so the margin is never a cent short. Null when
 * there is no minimum, or no cost to keep it on.
 */
export function minimumPriceCents(costCents: number, minMarginBp: number | null | undefined): number | null {
  if (minMarginBp === null || minMarginBp === undefined || minMarginBp <= 0 || costCents <= 0) return null;
  const margin = Math.min(minMarginBp, MAX_MIN_MARGIN_BP);
  return Math.ceil((costCents * 10000) / (10000 - margin));
}

/** The lowest price a markup allows on a cost: cost × (1 + markup), rounded up. */
export function minimumMarkupPriceCents(costCents: number, minMarkupBp: number | null | undefined): number | null {
  if (minMarkupBp === null || minMarkupBp === undefined || minMarkupBp <= 0 || costCents <= 0) return null;
  return Math.ceil((costCents * (10000 + Math.min(minMarkupBp, MAX_MIN_MARKUP_BP))) / 10000);
}

export type SupplierRowMoney = {
  costCents: number;
  discountBp: number;
  minMarginBp: number | null;
};

/** COGS, minimum price and the dollars of margin in it, for one supplier row. */
export function supplierMoney(row: SupplierRowMoney) {
  const cogsCents = effectiveCostCents(row.costCents, row.discountBp);
  const minPriceCents = minimumPriceCents(cogsCents, row.minMarginBp);
  return {
    cogsCents,
    minPriceCents,
    minMarginCents: minPriceCents === null ? null : minPriceCents - cogsCents,
  };
}

/**
 * The lowest price the starred supplier's minimum margin allows, or null.
 * The flag on the Products list and the quote's lines (Taylor, Nov 4,
 * 2026: under the minimum is allowed, and shown in red).
 */
export function starredMinimumCents(rows: (SupplierRowMoney & { preferredFor?: string | null })[]): number | null {
  const star = rows.find((row) => row.preferredFor !== null && row.preferredFor !== undefined) ?? null;
  return star ? supplierMoney(star).minPriceCents : null;
}

// The select that reads it: the starred row only.
export const STARRED_MINIMUM_SELECT = {
  where: { preferredFor: { not: null } },
  take: 1,
  select: { costCents: true, discountBp: true, minMarginBp: true, preferredFor: true },
} as const;
