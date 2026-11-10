import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { owedRowsSql } from "@/lib/money";
import {
  groupName,
  groupSql,
  loadTeam,
  num,
  OTHER_GROUP,
  repFilter,
  topGroups,
  type Headline,
  type ReportParams,
  type SummaryTable,
} from "@/lib/reports/common";
import { daysBetweenIso } from "@/lib/reports/period";

// Money Owed (Nov 10, 2026). "Owed" is exactly what the Owed to you tile,
// the Owes you lines and the Owes money filter mean (owedRowsSql in
// src/lib/money.ts): signed Money-in paperwork less the payments recorded
// against it, a credit netting off. Aged by how late each open row is
// against its due date; credits come off the total, never off a bucket.
// A contract's rep is its deal's rep; paperwork with no deal is
// Unassigned. Collected is money recorded in the period on Money-in
// paperwork, by the day it was paid.

export const OWED_BUCKETS = [
  { key: "not-due", label: "Not due yet" },
  { key: "0-30", label: "0–30 days late" },
  { key: "31-60", label: "31–60 days late" },
  { key: "61-90", label: "61–90 days late" },
  { key: "90+", label: "Over 90 days late" },
] as const;

export type MoneyReport = {
  kind: "money";
  owedCents: number;
  overdueCents: number;
  customers: number;
  creditCents: number;
  buckets: { key: string; label: string; cents: number; rows: number }[];
  debtors: { id: string; name: string; href: string; owedCents: number; overdueCents: number; oldestDue: string | null; daysLate: number }[];
  unsigned: { count: number; valueCents: number; oldest: { id: string; number: number; title: string; customer: string; sentAt: Date | null; days: number; valueCents: number }[] };
  collectedCents: number;
  previousCollectedCents: number;
  collectedCount: number;
  groups: { key: string; name: string; owedCents: number; overdueCents: number }[];
  headlines: Headline[];
  table: SummaryTable;
};

export async function loadMoney(params: ReportParams): Promise<MoneyReport> {
  const { organizationId, repId, by, range } = params;
  const today = range.today;
  const rep = Prisma.sql`d."ownerId"`;
  const group = groupSql(by, { rep, contact: "ct" });
  // The open part of a row and how late it is, in the zone's days.
  const open = Prisma.sql`GREATEST(cp."amountCents" - COALESCE(paid.total, 0), 0)`;
  const late = Prisma.sql`(${today}::date - cp."dueOn")`;

  const [bucketRows, groupRows, debtorRows, customerRows, unsignedRows, unsignedList, collected, members] = await Promise.all([
    prisma.$queryRaw<{ bucket: number; cents: bigint; rows: number; net: bigint }[]>`
      SELECT CASE
               WHEN cp."amountCents" <= 0 THEN -1
               WHEN cp."dueOn" IS NULL OR cp."dueOn" >= ${today}::date THEN 0
               WHEN ${late} <= 30 THEN 1
               WHEN ${late} <= 60 THEN 2
               WHEN ${late} <= 90 THEN 3
               ELSE 4
             END AS bucket,
             SUM(CASE WHEN cp."amountCents" > 0 THEN ${open} ELSE 0 END)::bigint AS cents,
             COUNT(*) FILTER (WHERE cp."amountCents" > 0 AND ${open} > 0)::int AS rows,
             SUM(cp."amountCents" - COALESCE(paid.total, 0))::bigint AS net
        ${owedRowsSql(organizationId, Prisma.sql`LEFT JOIN "Deal" d ON d.id = c."dealId"`)}
        ${repFilter(rep, repId)}
       GROUP BY 1`,
    prisma.$queryRaw<{ grp: string; net: bigint; overdue: bigint }[]>`
      SELECT ${group} AS grp,
             SUM(cp."amountCents" - COALESCE(paid.total, 0))::bigint AS net,
             SUM(CASE WHEN cp."amountCents" > 0 AND cp."dueOn" < ${today}::date THEN ${open} ELSE 0 END)::bigint AS overdue
        ${owedRowsSql(
          organizationId,
          Prisma.sql`LEFT JOIN "Deal" d ON d.id = c."dealId"
                     LEFT JOIN "Contact" ct ON ct.id = c."contactId"
                     LEFT JOIN "Company" co ON co.id = COALESCE(c."companyId", ct."companyId")`,
        )}
        ${repFilter(rep, repId)}
       GROUP BY 1
      HAVING SUM(cp."amountCents" - COALESCE(paid.total, 0)) <> 0`,
    // A customer is the company the paperwork is filed under, or the
    // homeowner when it has none — as the Owes you lines group it.
    prisma.$queryRaw<{ id: string; is_company: boolean; name: string; net: bigint; overdue: bigint; oldest: Date | null }[]>`
      SELECT COALESCE(c."companyId", c."contactId") AS id,
             (c."companyId" IS NOT NULL) AS is_company,
             MIN(COALESCE(co.name, ct.name)) AS name,
             SUM(cp."amountCents" - COALESCE(paid.total, 0))::bigint AS net,
             SUM(CASE WHEN cp."amountCents" > 0 AND cp."dueOn" < ${today}::date THEN ${open} ELSE 0 END)::bigint AS overdue,
             MIN(cp."dueOn") FILTER (WHERE cp."amountCents" > 0 AND ${open} > 0) AS oldest
        ${owedRowsSql(
          organizationId,
          Prisma.sql`LEFT JOIN "Deal" d ON d.id = c."dealId"
                     LEFT JOIN "Company" co ON co.id = c."companyId"
                     LEFT JOIN "Contact" ct ON ct.id = c."contactId"`,
        )}
        ${repFilter(rep, repId)}
       GROUP BY 1, 2
      HAVING SUM(cp."amountCents" - COALESCE(paid.total, 0)) > 0
       ORDER BY net DESC, name ASC
       LIMIT 10`,
    prisma.$queryRaw<{ n: number }[]>`
      SELECT COUNT(*)::int AS n FROM (
        SELECT COALESCE(c."companyId", c."contactId")
          ${owedRowsSql(organizationId, Prisma.sql`LEFT JOIN "Deal" d ON d.id = c."dealId"`)}
          ${repFilter(rep, repId)}
         GROUP BY 1
        HAVING SUM(cp."amountCents" - COALESCE(paid.total, 0)) > 0
      ) owing`,
    prisma.$queryRaw<{ n: number; value: bigint }[]>`
      WITH sent AS (
        SELECT c.id, c."discountCents" FROM "Contract" c LEFT JOIN "Deal" d ON d.id = c."dealId"
         WHERE c."organizationId" = ${organizationId} AND c.payable = false AND c.status = 'SENT'
           ${repFilter(rep, repId)}
      )
      SELECT COUNT(*)::int AS n, COALESCE(SUM(${contractValue()}), 0)::bigint AS value FROM sent s`,
    prisma.$queryRaw<{ id: string; number: number; title: string; customer: string; sent_at: Date | null; value: bigint }[]>`
      WITH sent AS (
        SELECT c.id, c.number, c.title, c."sentAt", c."createdAt", c."discountCents", COALESCE(co.name, ct.name) AS customer
          FROM "Contract" c
          LEFT JOIN "Deal" d ON d.id = c."dealId"
          LEFT JOIN "Company" co ON co.id = c."companyId"
          LEFT JOIN "Contact" ct ON ct.id = c."contactId"
         WHERE c."organizationId" = ${organizationId} AND c.payable = false AND c.status = 'SENT'
           ${repFilter(rep, repId)}
      )
      SELECT s.id, s.number, s.title, s.customer, COALESCE(s."sentAt", s."createdAt") AS sent_at, (${contractValue()})::bigint AS value
        FROM sent s
       ORDER BY COALESCE(s."sentAt", s."createdAt") ASC
       LIMIT 5`,
    prisma.$queryRaw<{ cur: bigint; prev: bigint; n: number }[]>`
      SELECT COALESCE(SUM(p."amountCents") FILTER (WHERE p."paidOn" >= ${range.fromIso}::date AND p."paidOn" < ${range.toIso}::date), 0)::bigint AS cur,
             COALESCE(SUM(p."amountCents") FILTER (WHERE p."paidOn" >= ${range.previous.fromIso}::date AND p."paidOn" < ${range.previous.toIso}::date), 0)::bigint AS prev,
             COUNT(*) FILTER (WHERE p."paidOn" >= ${range.fromIso}::date AND p."paidOn" < ${range.toIso}::date)::int AS n
        FROM "Payment" p
        JOIN "ContractPayment" cp ON cp.id = p."contractPaymentId"
        JOIN "Contract" c ON c.id = cp."contractId"
        LEFT JOIN "Deal" d ON d.id = c."dealId"
       WHERE p."organizationId" = ${organizationId} AND c.payable = false
         AND p."paidOn" >= ${range.previous.fromIso}::date AND p."paidOn" < ${range.toIso}::date
         ${repFilter(rep, repId)}`,
    loadTeam(organizationId),
  ]);

  const owedCents = bucketRows.reduce((sum, row) => sum + num(row.net), 0);
  const buckets = OWED_BUCKETS.map((bucket, index) => {
    const row = bucketRows.find((entry) => entry.bucket === index);
    return { key: bucket.key, label: bucket.label, cents: num(row?.cents), rows: row?.rows ?? 0 };
  });
  const aged = buckets.reduce((sum, bucket) => sum + bucket.cents, 0);
  const overdueCents = buckets.slice(1).reduce((sum, bucket) => sum + bucket.cents, 0);

  const debtors = debtorRows.map((row) => {
    const oldestDue = row.oldest ? row.oldest.toISOString().slice(0, 10) : null;
    return {
      id: row.id,
      name: row.name,
      href: row.is_company ? `/dashboard/companies/${row.id}` : `/dashboard/contacts/${row.id}`,
      owedCents: num(row.net),
      overdueCents: num(row.overdue),
      oldestDue,
      daysLate: oldestDue && oldestDue < today ? daysBetweenIso(oldestDue, today) : 0,
    };
  });

  const groups = topGroups(
    groupRows.map((row) => ({ key: row.grp, name: groupName(by, row.grp, members), owedCents: num(row.net), overdueCents: num(row.overdue) })),
    (row) => row.owedCents,
    (into, row) => {
      into.owedCents += row.owedCents;
      into.overdueCents += row.overdueCents;
    },
    () => ({ key: OTHER_GROUP, name: "Everything else", owedCents: 0, overdueCents: 0 }),
  );

  const unsigned = {
    count: unsignedRows[0]?.n ?? 0,
    valueCents: num(unsignedRows[0]?.value),
    oldest: unsignedList.map((row) => ({
      id: row.id,
      number: row.number,
      title: row.title,
      customer: row.customer,
      sentAt: row.sent_at,
      days: row.sent_at ? Math.max(0, Math.floor((params.now.getTime() - row.sent_at.getTime()) / 86_400_000)) : 0,
      valueCents: num(row.value),
    })),
  };
  const collectedCents = num(collected[0]?.cur);
  const previousCollectedCents = num(collected[0]?.prev);
  const late90 = buckets[4].cents;
  const customers = customerRows[0]?.n ?? 0;

  const headlines: Headline[] = [
    { id: "owed", label: "Total owed", value: owedCents, format: "money", goodWhenUp: false, hint: `${customers} ${customers === 1 ? "customer" : "customers"}` },
    { id: "overdue", label: "Past due", value: overdueCents, format: "money", goodWhenUp: false, hint: "Due date gone by" },
    { id: "late-90", label: "Over 90 days late", value: late90, format: "money", goodWhenUp: false },
    { id: "collected", label: "Collected", value: collectedCents, previous: previousCollectedCents, format: "money", hint: `${collected[0]?.n ?? 0} payments` },
    { id: "unsigned", label: "Waiting on a signature", value: unsigned.valueCents, format: "money", hint: `${unsigned.count} ${unsigned.count === 1 ? "contract" : "contracts"} sent` },
  ];

  const table: SummaryTable = {
    title: "Who owes the most",
    columns: [
      { label: "Customer", format: "text" },
      { label: "Owed", format: "money" },
      { label: "Past due", format: "money" },
      { label: "Oldest due", format: "text" },
    ],
    rows: debtors.map((row) => [row.name, row.owedCents, row.overdueCents, row.oldestDue ?? "—"]),
  };

  return {
    kind: "money",
    owedCents,
    overdueCents,
    customers,
    creditCents: owedCents - aged,
    buckets,
    debtors,
    unsigned,
    collectedCents,
    previousCollectedCents,
    collectedCount: collected[0]?.n ?? 0,
    groups,
    headlines,
    table,
  };
}

// A sent contract's value: its own rows less its discount, or its payment
// table when it was made the classic way with no rows (contractTotalCents
// in src/lib/contracts.ts, in SQL). `s` carries id and discountCents.
function contractValue() {
  return Prisma.sql`CASE
      WHEN EXISTS (SELECT 1 FROM "ContractLineItem" li WHERE li."contractId" = s.id)
        THEN (SELECT SUM(FLOOR(li.quantity * li."unitPriceCents" + 0.5) - li."discountCents") FROM "ContractLineItem" li WHERE li."contractId" = s.id) - s."discountCents"
      ELSE COALESCE((SELECT SUM(cp."amountCents") FROM "ContractPayment" cp WHERE cp."contractId" = s.id), 0)
    END`;
}
