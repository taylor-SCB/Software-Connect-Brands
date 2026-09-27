import type { Prisma } from "@/generated/prisma/client";
import { computeSchedule, dateToIso } from "@/lib/payments";
import { computeQuoteTotals, resolveDiscount } from "@/lib/quote-math";

const LINE_SELECT = { quantity: true, unitPriceCents: true, discountCents: true, tag: true } as const;

// Takes the row lock on the quote for the rest of the transaction. Every
// transaction that moves the quote's money — saving its lines, pricing a
// row inline, typing its discount — takes this first, so two arriving
// together run one after the other and the later one prices against what
// the earlier one stored. Without it a row edit and a discount edit fired
// from the same screen each read the other's stale state, and the last
// writer wins with the wrong figure.
export async function lockQuote(tx: Prisma.TransactionClient, quoteId: string) {
  await tx.$queryRaw`SELECT id FROM "Quote" WHERE id = ${quoteId} FOR UPDATE`;
}

// Writes a typed discount on the whole quote. A percent is worked out here
// against the lines as they stand (never taken from the browser as a
// finished number) and stored with the percent, so a later change to the
// lines re-prices it. Dollars are stored as typed, never capped here: the
// total caps them on the way out (`quoteDiscountCents`), so a quote whose
// lines dip under the figure prints $0 and is worth the full discount
// again once they grow back — capping at write time would lose it for
// good. Shared by the quote editor's save and the Contract Coordinator's
// footer box so both store the same figure. The payment rows are not
// touched here; the caller re-prices them with `repriceQuotePayments` in
// the same transaction, after every change to the quote's money is in.
export async function applyQuoteDiscount(
  tx: Prisma.TransactionClient,
  quoteId: string,
  input: { percent: number | null; cents: number },
): Promise<{ discountCents: number; discountPercent: number | null }> {
  await lockQuote(tx, quoteId);
  if (input.percent === null) {
    const discountCents = Number.isFinite(input.cents) ? Math.max(0, Math.round(input.cents)) : 0;
    await tx.quote.update({ where: { id: quoteId }, data: { discountCents, discountPercent: null } });
    return { discountCents, discountPercent: null };
  }
  const lines = await tx.quoteLineItem.findMany({ where: { quoteId }, select: LINE_SELECT });
  const discount = resolveDiscount(input, computeQuoteTotals(lines).subtotalCents);
  await tx.quote.update({ where: { id: quoteId }, data: discount });
  return discount;
}

// The quote's payment rows are priced against its lines, so anything that
// changes a line has to re-price them in the same transaction. Without
// this the stored amounts stay frozen while the total moves, and the
// customer's copy prints a total and a schedule that disagree — the
// sender never sees it, because their own table recomputes live.
//
// The discount on the whole quote is re-priced first, for the same
// reason: typed as a percent, it is worth a different number of dollars
// once a line changes, and the stored figure is what a raw read sees.
//
// Shared by the quote editor's save and the Contract Coordinator's inline
// price edits, so both re-price the same way.
export async function repriceQuotePayments(tx: Prisma.TransactionClient, quoteId: string) {
  await lockQuote(tx, quoteId);
  const quote = await tx.quote.findUnique({
    where: { id: quoteId },
    select: {
      discountCents: true,
      discountPercent: true,
      lineItems: { select: LINE_SELECT },
    },
  });
  if (!quote) return;

  const totals = computeQuoteTotals(quote.lineItems, quote);
  // Only a percent is re-priced; dollars stay as typed (see above). The
  // write is guarded on the percent still being there, so a discount that
  // was switched to dollars in between is never overwritten with a
  // percent-derived figure.
  if (quote.discountPercent !== null && totals.quoteDiscountCents !== quote.discountCents) {
    await tx.quote.updateMany({
      where: { id: quoteId, discountPercent: { not: null } },
      data: { discountCents: totals.quoteDiscountCents },
    });
  }

  const payments = await tx.quotePayment.findMany({
    where: { quoteId },
    orderBy: { position: "asc" },
    select: { id: true, label: true, kind: true, percent: true, amountCents: true, dueOn: true, terms: true },
  });
  if (payments.length === 0) return;

  const repriced = computeSchedule(
    payments.map((row) => ({
      label: row.label,
      kind: row.kind,
      percent: row.percent,
      // A fixed amount is a number the sender typed; it stays put.
      fixedCents: row.kind === "FIXED" ? row.amountCents : null,
      dueOn: dateToIso(row.dueOn),
      terms: row.terms,
    })),
    totals.totalCents,
  );
  for (const [index, row] of repriced.rows.entries()) {
    const stored = payments[index];
    // Never below zero: a fixed deposit bigger than the lines now come to
    // would make the balance row negative, and that would print on the
    // customer's copy. The quote page shows the table as "over" so the
    // sender can put it right.
    const amountCents = Math.max(0, row.amountCents);
    if (!stored || stored.amountCents === amountCents) continue;
    await tx.quotePayment.update({ where: { id: stored.id }, data: { amountCents } });
  }
}
