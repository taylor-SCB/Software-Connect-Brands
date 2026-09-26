import type { Prisma } from "@/generated/prisma/client";
import { computeSchedule, dateToIso } from "@/lib/payments";
import { computeQuoteTotals } from "@/lib/quote-math";

// The quote's payment rows are priced against its lines, so anything that
// changes a line has to re-price them in the same transaction. Without
// this the stored amounts stay frozen while the total moves, and the
// customer's copy prints a total and a schedule that disagree — the
// sender never sees it, because their own table recomputes live.
//
// Shared by the quote editor's save and the Contract Coordinator's inline
// price edits, so both re-price the same way.
export async function repriceQuotePayments(tx: Prisma.TransactionClient, quoteId: string) {
  const payments = await tx.quotePayment.findMany({
    where: { quoteId },
    orderBy: { position: "asc" },
    select: { id: true, label: true, kind: true, percent: true, amountCents: true, dueOn: true, terms: true },
  });
  if (payments.length === 0) return;

  const lines = await tx.quoteLineItem.findMany({
    where: { quoteId },
    select: { quantity: true, unitPriceCents: true, discountCents: true, tag: true },
  });
  const totalCents = computeQuoteTotals(lines).totalCents;
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
    totalCents,
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
