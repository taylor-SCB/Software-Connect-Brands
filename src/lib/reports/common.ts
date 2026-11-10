import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { PeriodKey, PeriodRange } from "@/lib/reports/period";

// Shared pieces of the five reports on Overview (Nov 10, 2026): what the
// address bar holds, the "Break down by" dimensions as SQL, a deal's value
// worked out in SQL, and the teammates' names. Every report aggregates in
// the database — nothing here loads a row per contact — so a report opens
// in the same time at 200 contacts or 200,000.

export const REPORT_KEYS = ["daily", "pipeline", "activity", "closing", "money"] as const;
export type ReportKey = (typeof REPORT_KEYS)[number];

export const REPORT_LABELS: Record<ReportKey, string> = {
  daily: "Daily Rundown",
  pipeline: "Pipeline",
  activity: "Activity",
  closing: "Closing",
  money: "Money Owed",
};

// The value ReportSubscription.report stores, and back.
export const REPORT_CODES: Record<ReportKey, string> = {
  daily: "DAILY",
  pipeline: "PIPELINE",
  activity: "ACTIVITY",
  closing: "CLOSING",
  money: "MONEY",
};
export function reportFromCode(code: string): ReportKey | null {
  const found = (Object.keys(REPORT_CODES) as ReportKey[]).find((key) => REPORT_CODES[key] === code);
  return found ?? null;
}
export function isReportKey(value: unknown): value is ReportKey {
  return typeof value === "string" && (REPORT_KEYS as readonly string[]).includes(value);
}

export const BREAKDOWN_KEYS = ["rep", "industry", "title", "state", "label"] as const;
export type BreakdownKey = (typeof BREAKDOWN_KEYS)[number];
export const BREAKDOWN_LABELS: Record<BreakdownKey, string> = {
  rep: "Rep",
  industry: "Industry",
  title: "Job title",
  state: "State",
  label: "Lead label",
};
export function isBreakdownKey(value: unknown): value is BreakdownKey {
  return typeof value === "string" && (BREAKDOWN_KEYS as readonly string[]).includes(value);
}

// Which breakdowns each report offers. A lead label belongs to an
// opportunity, so the reports about people's touches and money owed don't
// offer it.
export const REPORT_BREAKDOWNS: Record<ReportKey, readonly BreakdownKey[]> = {
  daily: [],
  pipeline: ["rep", "label", "industry", "state"],
  activity: ["rep", "industry", "title", "state"],
  closing: ["rep", "industry", "title", "state", "label"],
  money: ["rep", "industry", "state"],
};

export const DEFAULT_PERIOD: Record<ReportKey, PeriodKey> = {
  daily: "today",
  pipeline: "this-month",
  activity: "this-week",
  closing: "this-month",
  money: "this-month",
};

export type ReportParams = {
  organizationId: string;
  timeZone: string;
  now: Date;
  range: PeriodRange;
  // A teammate's id, or null for the whole team.
  repId: string | null;
  by: BreakdownKey;
};

// One row of a "Break down by" table. `key` is the group's raw value (a
// user id for Rep), `name` what is printed.
export type GroupRow = { key: string; name: string };

export type Teammate = { id: string; name: string; removed: boolean };

export async function loadTeam(organizationId: string): Promise<Teammate[]> {
  const users = await prisma.user.findMany({
    where: { organizationId },
    orderBy: [{ removedAt: { sort: "asc", nulls: "first" } }, { name: "asc" }],
    select: { id: true, name: true, removedAt: true },
  });
  return users.map((user) => ({ id: user.id, name: user.name, removed: Boolean(user.removedAt) }));
}

export function nameOf(team: Teammate[], id: string | null) {
  if (!id || id === UNASSIGNED) return "Unassigned";
  const user = team.find((member) => member.id === id);
  if (!user) return "Unassigned";
  return user.removed ? `${user.name} (removed)` : user.name;
}

export const UNASSIGNED = "__unassigned";

// The SQL that names a group for a breakdown. `c` is the contact, `co` the
// company (the contact's main one), `o` the opportunity (for the lead
// label), and `rep` an expression for whoever the report credits. An
// industry is the company's first one, so the groups add up to the whole;
// job titles are matched without case or stray spaces.
export function groupSql(
  by: BreakdownKey,
  refs: { rep: Prisma.Sql; contact?: string; company?: string; opportunity?: string },
): Prisma.Sql {
  const c = Prisma.raw(refs.contact ?? "c");
  const co = Prisma.raw(refs.company ?? "co");
  switch (by) {
    case "rep":
      return Prisma.sql`COALESCE(${refs.rep}, ${UNASSIGNED})`;
    case "industry":
      return Prisma.sql`COALESCE(NULLIF(${co}.industries[1], ''), 'No industry')`;
    case "title":
      return Prisma.sql`COALESCE(NULLIF(initcap(lower(btrim(${c}.title))), ''), 'No job title')`;
    case "state":
      return Prisma.sql`COALESCE(NULLIF(upper(btrim(COALESCE(NULLIF(btrim(${c}.state), ''), ${co}.state))), ''), 'No state')`;
    case "label":
      return refs.opportunity
        ? Prisma.sql`COALESCE(NULLIF(${Prisma.raw(refs.opportunity)}."leadLabel", ''), 'N/A')`
        : Prisma.sql`'N/A'`;
  }
}

// What every deal in `dealIds` is worth, exactly as dealValueCents() in
// src/lib/deals.ts works it out, but in SQL: the primary quote (accepted,
// else the newest not declined, else the newest), its lines rounded one
// at a time less their own discounts, less the whole-quote discount
// (re-priced from its percent when it has one, never more than the
// subtotal); the typed estimate when the deal has no quote. Returns a CTE
// named `dv(id, value)`. reports.cjs checks it against seeded quotes with
// both kinds of discount.
export function dealValueCte(dealIds: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    dv_quotes AS (
      SELECT q.id, q."dealId", q.status, q."updatedAt", q."discountCents", q."discountPercent",
             COALESCE((SELECT SUM(FLOOR(li.quantity * li."unitPriceCents" + 0.5) - li."discountCents")
                         FROM "QuoteLineItem" li WHERE li."quoteId" = q.id), 0)::float8 AS sub
        FROM "Quote" q
       WHERE q."dealId" IN (${dealIds})
    ), dv_pick AS (
      SELECT DISTINCT ON ("dealId") "dealId", sub,
             CASE
               WHEN "discountPercent" IS NOT NULL
                 THEN LEAST(GREATEST(sub, 0), FLOOR(GREATEST(sub, 0) * LEAST(GREATEST("discountPercent", 0), 100) / 100 + 0.5))
               ELSE LEAST(GREATEST(sub, 0), GREATEST(0, "discountCents"))
             END AS disc
        FROM dv_quotes
       ORDER BY "dealId", (status = 'ACCEPTED') DESC, (status <> 'DECLINED') DESC, "updatedAt" DESC
    ), dv AS (
      SELECT d.id, COALESCE((p.sub - p.disc)::bigint, d."valueCents"::bigint) AS value
        FROM "Deal" d
        LEFT JOIN dv_pick p ON p."dealId" = d.id
       WHERE d.id IN (${dealIds})
    )`;
}

// Turns raw group rows into at most `limit` rows plus "Everything else",
// so a breakdown by job title over 200,000 people stays a short table.
export function topGroups<T extends { key: string }>(
  rows: T[],
  sortValue: (row: T) => number,
  merge: (into: T, row: T) => void,
  makeOther: () => T,
  limit = 10,
): T[] {
  const sorted = [...rows].sort((a, b) => sortValue(b) - sortValue(a) || a.key.localeCompare(b.key));
  if (sorted.length <= limit + 1) return sorted;
  const head = sorted.slice(0, limit);
  const other = makeOther();
  for (const row of sorted.slice(limit)) merge(other, row);
  return [...head, other];
}

export const OTHER_GROUP = "__other";

export function groupName(by: BreakdownKey, key: string, team: Teammate[]) {
  if (key === OTHER_GROUP) return "Everything else";
  if (by === "rep") return nameOf(team, key);
  return key;
}

// SQL for "this rep only" on a column, or nothing for the whole team.
export function repFilter(column: Prisma.Sql, repId: string | null) {
  return repId ? Prisma.sql`AND ${column} = ${repId}` : Prisma.empty;
}

export const num = (value: number | string | bigint | null | undefined) => Number(value ?? 0);

// The change from one number to another as a share of the first, or null
// when there was nothing before to compare with.
export function change(now: number, before: number): number | null {
  if (!before) return null;
  return (now - before) / before;
}

// A headline number as the page tiles, the email and the write-up read it.
export type Headline = {
  id: string;
  label: string;
  value: number;
  format: "money" | "count" | "percent" | "days";
  // The same number for the period before, when it has one.
  previous?: number | null;
  // Up is good (money in) or bad (money owed, overdue)?
  goodWhenUp?: boolean;
  hint?: string;
};

// A small table for the email and the bottom of the page.
export type SummaryTable = {
  title: string;
  columns: { label: string; format: Headline["format"] | "text" }[];
  rows: (string | number)[][];
};
