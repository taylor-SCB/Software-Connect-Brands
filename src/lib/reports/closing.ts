import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  dealValueCte,
  groupName,
  groupSql,
  loadTeam,
  nameOf,
  num,
  OTHER_GROUP,
  repFilter,
  topGroups,
  type Headline,
  type ReportParams,
  type SummaryTable,
} from "@/lib/reports/common";

// Closing (Nov 10, 2026). Deals that are Won or Lost now and got there in
// the period (Deal.stageChangedAt), credited to the deal's rep. A deal won
// and then moved back out of Won is not counted as a win. Win rate is
// won ÷ (won + lost) by count; days to close run from the opportunity's
// first meeting (or the deal's creation when it never had one) to the day
// it was decided.

type Side = { count: number; valueCents: number; days: number };
const emptySide = (): Side => ({ count: 0, valueCents: 0, days: 0 });

export type ClosingReport = {
  kind: "closing";
  won: Side;
  lost: Side;
  previousWon: Side;
  previousLost: Side;
  winRate: number | null;
  previousWinRate: number | null;
  averageDealCents: number | null;
  previousAverageDealCents: number | null;
  daysToClose: number | null;
  previousDaysToClose: number | null;
  groups: { key: string; name: string; won: Side; lost: Side; winRate: number | null }[];
  biggestWins: { title: string; valueCents: number; rep: string; on: Date }[];
  headlines: Headline[];
  table: SummaryTable;
};

export async function loadClosing(params: ReportParams): Promise<ClosingReport> {
  const { organizationId, repId, by, range } = params;
  const group = groupSql(by, { rep: Prisma.sql`i.rep`, opportunity: "i" });
  const closed = Prisma.sql`
    closed AS (
      SELECT d.id, d.title, d.stage::text AS stage, d."ownerId" AS rep, d."stageChangedAt" AS decided,
             COALESCE(o."createdAt", d."createdAt") AS started, d."contactId" AS contact_id, o."leadLabel",
             (d."stageChangedAt" >= ${range.from}) AS cur
        FROM "Deal" d
        LEFT JOIN "Opportunity" o ON o."dealId" = d.id
       WHERE d."organizationId" = ${organizationId}
         AND d.stage IN ('WON', 'LOST')
         AND d."stageChangedAt" >= ${range.previous.from} AND d."stageChangedAt" < ${range.to}
         AND (d."stageChangedAt" >= ${range.from} OR d."stageChangedAt" < ${range.previous.to})
         ${repFilter(Prisma.sql`d."ownerId"`, repId)}
    )`;

  const [rows, wins, members] = await Promise.all([
    prisma.$queryRaw<{ grp: string; stage: string; cur: boolean; n: number; value: bigint; days: number }[]>`
      WITH ${closed}, ${dealValueCte(Prisma.sql`SELECT id FROM closed`)}
      SELECT ${group} AS grp, i.stage, i.cur, COUNT(*)::int AS n,
             COALESCE(SUM(dv.value), 0)::bigint AS value,
             COALESCE(SUM(GREATEST(0, EXTRACT(EPOCH FROM (i.decided - i.started)) / 86400)), 0)::float8 AS days
        FROM closed i
        LEFT JOIN dv ON dv.id = i.id
        LEFT JOIN "Contact" c ON c.id = i.contact_id
        LEFT JOIN "Company" co ON co.id = c."companyId"
       GROUP BY 1, 2, 3`,
    prisma.$queryRaw<{ title: string; value: bigint; rep: string | null; decided: Date }[]>`
      WITH ${closed}, ${dealValueCte(Prisma.sql`SELECT id FROM closed WHERE cur AND stage = 'WON'`)}
      SELECT i.title, dv.value, i.rep, i.decided
        FROM closed i JOIN dv ON dv.id = i.id
       ORDER BY dv.value DESC, i.decided DESC
       LIMIT 5`,
    loadTeam(organizationId),
  ]);

  const won = emptySide();
  const lost = emptySide();
  const previousWon = emptySide();
  const previousLost = emptySide();
  type G = ClosingReport["groups"][number];
  const groupMap = new Map<string, G>();
  for (const row of rows) {
    const side = row.stage === "WON" ? (row.cur ? won : previousWon) : row.cur ? lost : previousLost;
    side.count += row.n;
    side.valueCents += num(row.value);
    side.days += row.days;
    if (!row.cur) continue;
    const target = groupMap.get(row.grp) ?? { key: row.grp, name: groupName(by, row.grp, members), won: emptySide(), lost: emptySide(), winRate: null };
    const into = row.stage === "WON" ? target.won : target.lost;
    into.count += row.n;
    into.valueCents += num(row.value);
    into.days += row.days;
    groupMap.set(row.grp, target);
  }
  const rate = (w: Side, l: Side) => (w.count + l.count ? w.count / (w.count + l.count) : null);
  if (by === "rep") {
    for (const member of members) {
      if (member.removed || (repId && member.id !== repId) || groupMap.has(member.id)) continue;
      groupMap.set(member.id, { key: member.id, name: member.name, won: emptySide(), lost: emptySide(), winRate: null });
    }
  }
  const groups = topGroups(
    [...groupMap.values()],
    (row) => row.won.valueCents * 100 + row.won.count + row.lost.count,
    (into, row) => {
      for (const side of ["won", "lost"] as const) {
        into[side].count += row[side].count;
        into[side].valueCents += row[side].valueCents;
        into[side].days += row[side].days;
      }
    },
    () => ({ key: OTHER_GROUP, name: "Everything else", won: emptySide(), lost: emptySide(), winRate: null }),
  ).map((row) => ({ ...row, winRate: rate(row.won, row.lost) }));

  const winRate = rate(won, lost);
  const previousWinRate = rate(previousWon, previousLost);
  const averageDealCents = won.count ? won.valueCents / won.count : null;
  const previousAverageDealCents = previousWon.count ? previousWon.valueCents / previousWon.count : null;
  const daysToClose = won.count ? won.days / won.count : null;
  const previousDaysToClose = previousWon.count ? previousWon.days / previousWon.count : null;

  const headlines: Headline[] = [
    { id: "won-value", label: "Won", value: won.valueCents, previous: previousWon.valueCents, format: "money", hint: `${won.count} ${won.count === 1 ? "deal" : "deals"}` },
    { id: "won-count", label: "Deals won", value: won.count, previous: previousWon.count, format: "count" },
    { id: "win-rate", label: "Win rate", value: winRate ?? 0, previous: previousWinRate, format: "percent", hint: winRate === null ? "Nothing decided yet" : "Won ÷ (won + lost)" },
    { id: "avg-deal", label: "Average deal", value: Math.round(averageDealCents ?? 0), previous: previousAverageDealCents === null ? null : Math.round(previousAverageDealCents), format: "money" },
    { id: "days-to-close", label: "Days to close", value: daysToClose === null ? 0 : Math.round(daysToClose * 10) / 10, previous: previousDaysToClose === null ? null : Math.round(previousDaysToClose * 10) / 10, format: "days", goodWhenUp: false, hint: "First meeting to signed" },
    { id: "lost-value", label: "Lost", value: lost.valueCents, previous: previousLost.valueCents, format: "money", goodWhenUp: false, hint: `${lost.count} ${lost.count === 1 ? "deal" : "deals"}` },
  ];

  const table: SummaryTable = {
    title: by === "rep" ? "By rep" : "Breakdown",
    columns: [
      { label: by === "rep" ? "Rep" : "Group", format: "text" },
      { label: "Won", format: "count" },
      { label: "Won $", format: "money" },
      { label: "Lost", format: "count" },
      { label: "Lost $", format: "money" },
      { label: "Win rate", format: "text" },
    ],
    rows: groups.map((row) => [
      row.name,
      row.won.count,
      row.won.valueCents,
      row.lost.count,
      row.lost.valueCents,
      row.winRate === null ? "—" : `${Math.round(row.winRate * 100)}%`,
    ]),
  };

  return {
    kind: "closing",
    won,
    lost,
    previousWon,
    previousLost,
    winRate,
    previousWinRate,
    averageDealCents,
    previousAverageDealCents,
    daysToClose,
    previousDaysToClose,
    groups,
    biggestWins: wins.map((row) => ({ title: row.title, valueCents: num(row.value), rep: nameOf(members, row.rep), on: row.decided })),
    headlines,
    table,
  };
}
