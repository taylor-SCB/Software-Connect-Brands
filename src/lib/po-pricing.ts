// What a purchase order row made on the Contract Coordinator asks the
// supplier for (Taylor, Nov 12, 2026): the catalog cost, the way Order
// materials does, never the customer's price, and without the quote line's
// discount, which was given to the customer, not by the supplier. A row
// with no cost on file (a typed line, or a product nobody priced) keeps the
// quote's price; the card says so. Pure, so the Coordinator's card, its
// price check and Create all read the same numbers.
export type PoSourceLine = {
  unitPriceCents: number;
  discountCents: number;
  discountPercent: number | null;
  product: { costCents: number } | null;
};

export type PoPrice = {
  unitPriceCents: number;
  discountCents: number;
  discountPercent: number | null;
  // Whether the row is at the catalog cost (false: the quote's price).
  atCost: boolean;
};

export function purchaseOrderPrice(line: PoSourceLine): PoPrice {
  const cost = line.product?.costCents ?? 0;
  if (cost > 0) return { unitPriceCents: cost, discountCents: 0, discountPercent: null, atCost: true };
  return {
    unitPriceCents: line.unitPriceCents,
    discountCents: line.discountCents,
    discountPercent: line.discountPercent,
    atCost: false,
  };
}
