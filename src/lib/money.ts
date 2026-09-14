// Money that has actually moved. A contract's payment table says what is
// owed and when; the Payment rows under each line say what came in. Every
// "paid so far" number in the app is a sum of Payment rows, and a table
// row's paidAt (settled) is derived from them here and nowhere else.

import { Prisma } from "@/generated/prisma/client";
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

/* ------------------------- What a customer owes ------------------------- */

// What someone owes, as the list rows and the Balance card read it.
export type Balance = {
  // Everything billed on signed paperwork.
  billedCents: number;
  receivedCents: number;
  owedCents: number;
  // Rows past their due date with money still open.
  overdueCount: number;
  // yyyy-mm-dd of the next open row, if there is one.
  nextDue: string | null;
};

const EMPTY_BALANCE: Balance = {
  billedCents: 0,
  receivedCents: 0,
  owedCents: 0,
  overdueCount: 0,
  nextDue: null,
};

type BalanceRow = {
  key: string;
  billed: number | string | null;
  received: number | string | null;
  overdue: number | string | null;
  next_due: Date | null;
};

function toBalances(rows: BalanceRow[]): Map<string, Balance> {
  const balances = new Map<string, Balance>();
  for (const row of rows) {
    const billedCents = Number(row.billed ?? 0);
    const receivedCents = Number(row.received ?? 0);
    balances.set(row.key, {
      billedCents,
      receivedCents,
      owedCents: billedCents - receivedCents,
      overdueCount: Number(row.overdue ?? 0),
      nextDue: row.next_due ? row.next_due.toISOString().slice(0, 10) : null,
    });
  }
  return balances;
}

// What each of these customers still owes: their signed Money-in
// paperwork, less what has been recorded against it. A credit from a
// change order is a negative row, so it comes off the total the same way
// a payment does; only a positive row can be chased, which is why the
// overdue count and the next due date ignore credits. Money-out purchase
// orders are what we owe a supplier, so they are never in here — a
// company that is both shows "Owes you" on its row and "You owe them" on
// its page, never one netted number.
//
// One statement for the whole page of rows rather than a query each, so
// the list stays inside its budget at forty thousand companies. `by`
// picks whether the rows are companies or the homeowners who have no
// company at all.
export async function owedBy(
  organizationId: string,
  by: "company" | "contact",
  ids: string[],
  today: string,
): Promise<Map<string, Balance>> {
  if (ids.length === 0) return new Map();
  const keyColumn = by === "company" ? Prisma.sql`c."companyId"` : Prisma.sql`c."contactId"`;
  // A homeowner's contracts are the ones filed under no company at all;
  // anything with a company belongs on the company's row instead.
  const scope =
    by === "company"
      ? Prisma.sql`c."companyId" = ANY(${ids})`
      : Prisma.sql`c."companyId" IS NULL AND c."contactId" = ANY(${ids})`;

  const rows = await prisma.$queryRaw<BalanceRow[]>`
    SELECT ${keyColumn} AS key,
           SUM(cp."amountCents")::int AS billed,
           COALESCE(SUM(paid.total), 0)::int AS received,
           COUNT(*) FILTER (
             WHERE cp."paidAt" IS NULL AND cp."amountCents" > 0 AND cp."dueOn" < ${today}::date
           )::int AS overdue,
           MIN(cp."dueOn") FILTER (WHERE cp."paidAt" IS NULL AND cp."amountCents" > 0) AS next_due
      FROM "Contract" c
      JOIN "ContractPayment" cp ON cp."contractId" = c.id
      LEFT JOIN LATERAL (
             SELECT SUM(p."amountCents") AS total FROM "Payment" p WHERE p."contractPaymentId" = cp.id
           ) paid ON true
     WHERE c."organizationId" = ${organizationId}
       AND c.payable = false
       AND c.status = 'SIGNED'
       AND ${scope}
     GROUP BY 1
  `;
  return toBalances(rows);
}

// The other direction: what we still owe these suppliers on purchase
// orders that are out or signed.
export async function payableBy(
  organizationId: string,
  companyIds: string[],
  today: string,
): Promise<Map<string, Balance>> {
  if (companyIds.length === 0) return new Map();
  const rows = await prisma.$queryRaw<BalanceRow[]>`
    SELECT c."companyId" AS key,
           SUM(cp."amountCents")::int AS billed,
           COALESCE(SUM(paid.total), 0)::int AS received,
           COUNT(*) FILTER (
             WHERE cp."paidAt" IS NULL AND cp."amountCents" > 0 AND cp."dueOn" < ${today}::date
           )::int AS overdue,
           MIN(cp."dueOn") FILTER (WHERE cp."paidAt" IS NULL AND cp."amountCents" > 0) AS next_due
      FROM "Contract" c
      JOIN "ContractPayment" cp ON cp."contractId" = c.id
      LEFT JOIN LATERAL (
             SELECT SUM(p."amountCents") AS total FROM "Payment" p WHERE p."contractPaymentId" = cp.id
           ) paid ON true
     WHERE c."organizationId" = ${organizationId}
       AND c.payable = true
       AND c.status IN ('SENT', 'SIGNED')
       AND c."companyId" = ANY(${companyIds})
     GROUP BY 1
  `;
  return toBalances(rows);
}

// One workspace-wide number for the dashboard tile.
export async function owedTotals(organizationId: string, today: string) {
  const rows = await prisma.$queryRaw<
    { owed: number | string | null; overdue: number | string | null; customers: number | string | null }[]
  >`
    SELECT COALESCE(SUM(cp."amountCents" - COALESCE(paid.total, 0)), 0)::int AS owed,
           COUNT(*) FILTER (
             WHERE cp."paidAt" IS NULL AND cp."amountCents" > 0 AND cp."dueOn" < ${today}::date
           )::int AS overdue,
           COUNT(DISTINCT COALESCE(c."companyId", c."contactId")) FILTER (
             WHERE cp."paidAt" IS NULL AND cp."amountCents" > 0
           )::int AS customers
      FROM "Contract" c
      JOIN "ContractPayment" cp ON cp."contractId" = c.id
      LEFT JOIN LATERAL (
             SELECT SUM(p."amountCents") AS total FROM "Payment" p WHERE p."contractPaymentId" = cp.id
           ) paid ON true
     WHERE c."organizationId" = ${organizationId}
       AND c.payable = false
       AND c.status = 'SIGNED'
  `;
  const row = rows[0];
  return {
    owedCents: Number(row?.owed ?? 0),
    overdueCount: Number(row?.overdue ?? 0),
    customerCount: Number(row?.customers ?? 0),
  };
}

export function emptyBalance(): Balance {
  return EMPTY_BALANCE;
}

/* ----------------------- The Balance card's contents ----------------------- */

// Everything the Balance card on a company or contact page shows: what
// they owe, what we owe them, and each open row. `where` picks the
// contracts that belong to the record being looked at.
export async function loadBalance(
  organizationId: string,
  target: { companyId: string } | { contactId: string },
  today: string,
) {
  const isCompany = "companyId" in target;
  const id = isCompany ? target.companyId : target.contactId;
  const [owedMap, payableMap, openRows] = await Promise.all([
    owedBy(organizationId, isCompany ? "company" : "contact", [id], today),
    isCompany ? payableBy(organizationId, [id], today) : Promise.resolve(new Map<string, Balance>()),
    prisma.contractPayment.findMany({
      where: {
        amountCents: { gt: 0 },
        paidAt: null,
        contract: {
          organizationId,
          payable: false,
          status: "SIGNED",
          ...(isCompany ? { companyId: id } : { companyId: null, contactId: id }),
        },
      },
      orderBy: [{ dueOn: "asc" }, { position: "asc" }],
      take: 25,
      select: {
        label: true,
        amountCents: true,
        dueOn: true,
        contract: { select: { id: true, number: true } },
        payments: { select: { amountCents: true } },
      },
    }),
  ]);

  return {
    owed: owedMap.get(id) ?? EMPTY_BALANCE,
    payable: payableMap.get(id) ?? EMPTY_BALANCE,
    rows: openRows.map((row) => {
      const dueOn = row.dueOn ? row.dueOn.toISOString().slice(0, 10) : null;
      return {
        contractId: row.contract.id,
        contractNumber: row.contract.number,
        label: row.label,
        amountCents: row.amountCents,
        receivedCents: paidCentsOf(row),
        dueOn,
        overdue: Boolean(dueOn && dueOn < today),
      };
    }),
  };
}
