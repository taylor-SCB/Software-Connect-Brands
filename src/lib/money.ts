// Money that has actually moved. A contract's payment table says what is
// owed and when; the Payment rows under each line say what came in. Every
// "paid so far" number in the app is a sum of Payment rows, and a table
// row's paidAt (settled) is derived from them here and nowhere else.

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { formatCents } from "@/lib/format";

// One recorded payment as the screens show it.
export type PaymentView = {
  id: string;
  amountCents: number;
  // yyyy-mm-dd
  paidOn: string;
  method: string | null;
  reference: string | null;
  note: string | null;
};

// What has been received against a payment-table row.
export function paidCentsOf(row: { payments: { amountCents: number }[] }): number {
  return row.payments.reduce((sum, payment) => sum + payment.amountCents, 0);
}

// Whether a row is settled: its payments cover its amount. A $0 row with
// nothing recorded on it is not "paid", just empty.
export function isSettled(amountCents: number, receivedCents: number): boolean {
  return receivedCents > 0 && receivedCents >= amountCents;
}

// yyyy-mm-dd → the Date to store for "signed on that day": noon in the
// workspace's zone, so it prints as that day whichever zone reads it.
export function zonedNoon(isoDate: string, timeZone: string): Date {
  const [y, m, d] = isoDate.split("-").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, 12));
  // What the zone's clock says at that UTC instant tells us the offset.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(guess);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const local = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return new Date(guess.getTime() - (local - guess.getTime()));
}

// The only writer of ContractPayment.paidAt. Sums the row's payments and
// stamps the row settled (now, kept if it already was) or open (null).
export async function settleRow(tx: Prisma.TransactionClient, contractPaymentId: string) {
  const row = await tx.contractPayment.findUnique({
    where: { id: contractPaymentId },
    select: { amountCents: true, paidAt: true, payments: { select: { amountCents: true } } },
  });
  if (!row) return null;
  const receivedCents = paidCentsOf(row);
  const settled = isSettled(row.amountCents, receivedCents);
  const paidAt = settled ? (row.paidAt ?? new Date()) : null;
  if ((paidAt?.getTime() ?? null) !== (row.paidAt?.getTime() ?? null)) {
    await tx.contractPayment.update({ where: { id: contractPaymentId }, data: { paidAt } });
  }
  return { amountCents: row.amountCents, receivedCents, settled };
}

// What deleting a record would throw away or leave dangling: money still
// owed on signed Money-in contracts, and payments already recorded. Both
// are reasons to archive instead. `where` picks the contracts the record
// would take with it (or that are addressed to it).
export async function moneyHold(organizationId: string, where: Prisma.ContractWhereInput) {
  const contracts = await prisma.contract.findMany({
    where: { organizationId, ...where },
    select: {
      status: true,
      payable: true,
      payments: {
        select: { amountCents: true, payments: { select: { amountCents: true } } },
      },
    },
  });
  let owedCents = 0;
  let paymentCount = 0;
  for (const contract of contracts) {
    for (const row of contract.payments) {
      paymentCount += row.payments.length;
      if (contract.status === "SIGNED" && !contract.payable && row.amountCents > 0) {
        owedCents += Math.max(0, row.amountCents - paidCentsOf(row));
      }
    }
  }
  return { owedCents, paymentCount };
}

// "Dana Ruiz has $4,200.00 still owed and 2 payments recorded — archive
// this contact instead of deleting." Null when nothing stands in the way.
export function moneyHoldMessage(
  name: string,
  hold: { owedCents: number; paymentCount: number },
  archiveAs: string | null,
): string | null {
  const parts: string[] = [];
  if (hold.owedCents > 0) parts.push(`${formatCents(hold.owedCents)} still owed`);
  if (hold.paymentCount > 0) {
    parts.push(`${hold.paymentCount} ${hold.paymentCount === 1 ? "payment" : "payments"} recorded`);
  }
  if (parts.length === 0) return null;
  const tail = archiveAs ? ` — archive this ${archiveAs} instead of deleting.` : " — remove the payments first.";
  return `${name} has ${parts.join(" and ")}${tail}`;
}
