import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  dealValueCte,
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
import { money, percent, plural } from "@/lib/reports/format";

// Pipeline (Nov 10, 2026). What is open right now, stage by stage, as the
// board shows it — opportunities in Meeting Set and Meeting Completed, deals
// in Quote Sent and Contract Sent (opportunityColumn in
// src/lib/opportunities.ts) — how long it has sat there, and what moved in
// the period: StatusChange rows, people for the meeting steps (as Stats
// counts them) and deals for the paperwork steps.

export const PIPELINE_STAGES = ["MEETING_SET", "MEETING_COMPLETED", "QUOTE_SENT", "CONTRACT_SENT"] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];
export const PIPELINE_STAGE_LABELS: Record<PipelineStage, string> = {
  MEETING_SET: "Meeting Set",
  MEETING_COMPLETED: "Meeting Completed",
  QUOTE_SENT: "Quote Sent",
  CONTRACT_SENT: "Contract Sent",
};

export const AGE_BUCKETS = [
  { key: "0-7", label: "Under a week", max: 7 },
  { key: "8-30", label: "8–30 days", max: 30 },
  { key: "31-60", label: "31–60 days", max: 60 },
  { key: "61-90", label: "61–90 days", max: 90 },
  { key: "90+", label: "Over 90 days", max: Infinity },
] as const;

export const MOVE_STEPS = ["MEETING_SET", "MEETING_COMPLETED", "QUOTE_SENT", "CONTRACT_SENT", "WON", "LOST"] as const;
export type MoveStep = (typeof MOVE_STEPS)[number];
export const MOVE_LABELS: Record<MoveStep, string> = {
  MEETING_SET: "Meetings set",
  MEETING_COMPLETED: "Meetings held",
  QUOTE_SENT: "Quotes sent",
  CONTRACT_SENT: "Contracts sent",
  WON: "Won",
  LOST: "Lost",
};

export type PipelineReport = {
  kind: "pipeline";
  stages: { stage: PipelineStage; label: string; count: number; valueCents: number; avgAgeDays: number | null }[];
  openCount: number;
  openValueCents: number;
  aging: { key: string; label: string; count: number; valueCents: number }[];
  // Oldest open items, for "what needs attention".
  stuck: { stage: PipelineStage; title: string; days: number; valueCents: number; href: string }[];
  moves: { step: MoveStep; label: string; count: number; previous: number; valueCents: number }[];
  conversions: { from: string; to: string; rate: number | null; previousRate: number | null }[];
  newOpportunities: { count: number; previous: number };
  groups: {
    key: string;
    name: string;
    count: number;
    valueCents: number;
    meetings: number;
    quoteCents: number;
    contractCents: number;
  }[];
  headlines: Headline[];
  table: SummaryTable;
};

export async function loadPipeline(params: ReportParams): Promise<PipelineReport> {
  const { organizationId, repId, by, range, now } = params;
  const group = groupSql(by, { rep: Prisma.sql`i.rep`, opportunity: "i" });

  const openItems = Prisma.sql`
    open_opps AS (
      SELECT o.id AS opp_id, o.stage::text AS stage, o."ownerId" AS rep, o."leadLabel", o."dealId" AS deal_id,
             o.title, COALESCE(o."completedAt", o."createdAt") AS since,
             (SELECT oc."contactId" FROM "OpportunityContact" oc WHERE oc."opportunityId" = o.id
               ORDER BY (oc.role = 'PRIMARY') DESC, oc."createdAt" LIMIT 1) AS contact_id
        FROM "Opportunity" o
        LEFT JOIN "Deal" d ON d.id = o."dealId"
       WHERE o."organizationId" = ${organizationId}
         AND o.stage IN ('MEETING_SET', 'MEETING_COMPLETED')
         AND (d.id IS NULL OR d.stage IN ('LEAD', 'CONTACTED'))
    ), open_deals AS (
      SELECT o.id AS opp_id, d.stage::text AS stage, d."ownerId" AS rep, o."leadLabel", d.id AS deal_id,
             d.title, d."stageChangedAt" AS since, d."contactId" AS contact_id
        FROM "Deal" d
        LEFT JOIN "Opportunity" o ON o."dealId" = d.id
       WHERE d."organizationId" = ${organizationId}
         AND d.stage IN ('QUOTE_SENT', 'CONTRACT_SENT')
    ), items AS (
      SELECT * FROM open_opps UNION ALL SELECT * FROM open_deals
    )`;

  const team = loadTeam(organizationId);

  const [grouped, stuckRows, moveRows, newRows] = await Promise.all([
    prisma.$queryRaw<{ stage: string; grp: string; age: number; n: number; value: bigint; age_days: number }[]>`
      WITH ${openItems}, ${dealValueCte(Prisma.sql`SELECT deal_id FROM items WHERE deal_id IS NOT NULL`)}
      SELECT i.stage,
             ${group} AS grp,
             CASE
               WHEN ${now}::timestamp - i.since <= interval '7 days' THEN 0
               WHEN ${now}::timestamp - i.since <= interval '30 days' THEN 1
               WHEN ${now}::timestamp - i.since <= interval '60 days' THEN 2
               WHEN ${now}::timestamp - i.since <= interval '90 days' THEN 3
               ELSE 4
             END AS age,
             COUNT(*)::int AS n,
             COALESCE(SUM(dv.value), 0)::bigint AS value,
             COALESCE(SUM(GREATEST(0, EXTRACT(EPOCH FROM (${now}::timestamp - i.since)) / 86400)), 0)::float8 AS age_days
        FROM items i
        LEFT JOIN dv ON dv.id = i.deal_id
        LEFT JOIN "Contact" c ON c.id = i.contact_id
        LEFT JOIN "Company" co ON co.id = c."companyId"
       WHERE true ${repFilter(Prisma.sql`i.rep`, repId)}
       GROUP BY 1, 2, 3`,
    prisma.$queryRaw<{ stage: string; title: string; since: Date; opp_id: string | null; deal_id: string | null; value: bigint }[]>`
      WITH ${openItems}, ${dealValueCte(Prisma.sql`SELECT deal_id FROM items WHERE deal_id IS NOT NULL`)}
      SELECT i.stage, i.title, i.since, i.opp_id, i.deal_id, COALESCE(dv.value, 0)::bigint AS value
        FROM items i
        LEFT JOIN dv ON dv.id = i.deal_id
       WHERE true ${repFilter(Prisma.sql`i.rep`, repId)}
       ORDER BY i.since ASC
       LIMIT 5`,
    // What moved: people reaching a meeting step (credited to whoever moved
    // them, as on Stats), deals reaching a paperwork step (the deal's rep).
    prisma.$queryRaw<{ step: string; cur: number; prev: number; value: bigint }[]>`
      WITH moves AS (
        SELECT s."toStatus" AS step, s."on", 'p:' || s."contactId" AS thing, s."userId" AS rep, NULL::text AS deal_id
          FROM "StatusChange" s
         WHERE s."organizationId" = ${organizationId}
           AND s."contactId" IS NOT NULL
           AND s."toStatus" IN ('MEETING_SET', 'MEETING_COMPLETED')
           AND s."on" >= ${range.previous.from} AND s."on" < ${range.to}
        UNION ALL
        SELECT s."toStatus", s."on", 'd:' || s."dealId", d."ownerId", s."dealId"
          FROM "StatusChange" s
          JOIN "Deal" d ON d.id = s."dealId"
         WHERE s."organizationId" = ${organizationId}
           AND s."contactId" IS NULL AND s."companyId" IS NULL AND s."dealId" IS NOT NULL
           AND s."toStatus" IN ('QUOTE_SENT', 'CONTRACT_SENT', 'WON', 'LOST')
           AND s."on" >= ${range.previous.from} AND s."on" < ${range.to}
      ), cur AS (
        SELECT DISTINCT step, thing, deal_id FROM moves
         WHERE "on" >= ${range.from} AND "on" < ${range.to} ${repFilter(Prisma.sql`rep`, repId)}
      ), prev AS (
        SELECT DISTINCT step, thing FROM moves
         WHERE "on" >= ${range.previous.from} AND "on" < ${range.previous.to} ${repFilter(Prisma.sql`rep`, repId)}
      ), ${dealValueCte(Prisma.sql`SELECT deal_id FROM cur WHERE deal_id IS NOT NULL`)}
      SELECT s.step,
             (SELECT COUNT(*) FROM cur WHERE cur.step = s.step)::int AS cur,
             (SELECT COUNT(*) FROM prev WHERE prev.step = s.step)::int AS prev,
             (SELECT COALESCE(SUM(dv.value), 0) FROM cur JOIN dv ON dv.id = cur.deal_id WHERE cur.step = s.step)::bigint AS value
        FROM unnest(ARRAY['MEETING_SET', 'MEETING_COMPLETED', 'QUOTE_SENT', 'CONTRACT_SENT', 'WON', 'LOST']) AS s(step)`,
    prisma.$queryRaw<{ cur: number; prev: number }[]>`
      SELECT COUNT(*) FILTER (WHERE o."createdAt" >= ${range.from} AND o."createdAt" < ${range.to})::int AS cur,
             COUNT(*) FILTER (WHERE o."createdAt" >= ${range.previous.from} AND o."createdAt" < ${range.previous.to})::int AS prev
        FROM "Opportunity" o
       WHERE o."organizationId" = ${organizationId}
         AND o."createdAt" >= ${range.previous.from} AND o."createdAt" < ${range.to}
         ${repFilter(Prisma.sql`o."ownerId"`, repId)}`,
  ]);
  const members = await team;

  // Stages and aging, from the one grouped read.
  const stages = PIPELINE_STAGES.map((stage) => {
    const rows = grouped.filter((row) => row.stage === stage);
    const count = rows.reduce((sum, row) => sum + row.n, 0);
    const ageDays = rows.reduce((sum, row) => sum + row.age_days, 0);
    return {
      stage,
      label: PIPELINE_STAGE_LABELS[stage],
      count,
      valueCents: rows.reduce((sum, row) => sum + num(row.value), 0),
      avgAgeDays: count ? ageDays / count : null,
    };
  });
  const aging = AGE_BUCKETS.map((bucket, index) => {
    const rows = grouped.filter((row) => row.age === index);
    return {
      key: bucket.key,
      label: bucket.label,
      count: rows.reduce((sum, row) => sum + row.n, 0),
      valueCents: rows.reduce((sum, row) => sum + num(row.value), 0),
    };
  });

  type G = PipelineReport["groups"][number];
  const byGroup = new Map<string, G>();
  for (const row of grouped) {
    const target =
      byGroup.get(row.grp) ??
      ({ key: row.grp, name: groupName(by, row.grp, members), count: 0, valueCents: 0, meetings: 0, quoteCents: 0, contractCents: 0 } as G);
    target.count += row.n;
    target.valueCents += num(row.value);
    if (row.stage === "MEETING_SET" || row.stage === "MEETING_COMPLETED") target.meetings += row.n;
    if (row.stage === "QUOTE_SENT") target.quoteCents += num(row.value);
    if (row.stage === "CONTRACT_SENT") target.contractCents += num(row.value);
    byGroup.set(row.grp, target);
  }
  const groups = topGroups(
    [...byGroup.values()],
    (row) => row.valueCents * 1000 + row.count,
    (into, row) => {
      into.count += row.count;
      into.valueCents += row.valueCents;
      into.meetings += row.meetings;
      into.quoteCents += row.quoteCents;
      into.contractCents += row.contractCents;
    },
    () => ({ key: OTHER_GROUP, name: "Everything else", count: 0, valueCents: 0, meetings: 0, quoteCents: 0, contractCents: 0 }),
  );

  const moves = MOVE_STEPS.map((step) => {
    const row = moveRows.find((entry) => entry.step === step);
    return { step, label: MOVE_LABELS[step], count: row?.cur ?? 0, previous: row?.prev ?? 0, valueCents: num(row?.value) };
  });
  const move = (step: MoveStep) => moves.find((entry) => entry.step === step)!;
  const rate = (a: number, b: number) => (b ? a / b : null);
  const conversions = [
    { from: "Meeting set", to: "Meeting held", a: "MEETING_COMPLETED", b: "MEETING_SET" },
    { from: "Meeting held", to: "Quote sent", a: "QUOTE_SENT", b: "MEETING_COMPLETED" },
    { from: "Quote sent", to: "Contract sent", a: "CONTRACT_SENT", b: "QUOTE_SENT" },
  ].map((pair) => ({
    from: pair.from,
    to: pair.to,
    rate: rate(move(pair.a as MoveStep).count, move(pair.b as MoveStep).count),
    previousRate: rate(move(pair.a as MoveStep).previous, move(pair.b as MoveStep).previous),
  }));
  const won = move("WON");
  const lost = move("LOST");
  conversions.push({
    from: "Decided",
    to: "Won",
    rate: rate(won.count, won.count + lost.count),
    previousRate: rate(won.previous, won.previous + lost.previous),
  });

  const openCount = stages.reduce((sum, stage) => sum + stage.count, 0);
  const openValueCents = stages.reduce((sum, stage) => sum + stage.valueCents, 0);
  const newOpportunities = { count: newRows[0]?.cur ?? 0, previous: newRows[0]?.prev ?? 0 };
  const stage = (key: PipelineStage) => stages.find((entry) => entry.stage === key)!;

  const stuck = stuckRows.map((row) => ({
    stage: row.stage as PipelineStage,
    title: row.title,
    days: Math.max(0, Math.floor((now.getTime() - row.since.getTime()) / 86_400_000)),
    valueCents: num(row.value),
    // Its tile's panel on the board; a deal with no opportunity (the board
    // gives every deal one on its next open) is found by name.
    href: row.opp_id ? `/dashboard/deals?open=${encodeURIComponent(row.opp_id)}` : `/dashboard/deals?q=${encodeURIComponent(row.title.slice(0, 80))}`,
  }));

  const headlines: Headline[] = [
    { id: "open-value", label: "Open pipeline", value: openValueCents, format: "money", hint: `${plural(openCount, "open item")} right now` },
    { id: "quotes-out", label: "Quotes out", value: stage("QUOTE_SENT").valueCents, format: "money", hint: plural(stage("QUOTE_SENT").count, "deal") },
    { id: "contracts-out", label: "Contracts out", value: stage("CONTRACT_SENT").valueCents, format: "money", hint: plural(stage("CONTRACT_SENT").count, "deal") },
    { id: "meetings", label: "In meetings", value: stage("MEETING_SET").count + stage("MEETING_COMPLETED").count, format: "count", hint: "Meeting Set and Completed" },
    { id: "new", label: "New opportunities", value: newOpportunities.count, previous: newOpportunities.previous, format: "count" },
    { id: "won", label: "Deals won", value: won.count, previous: won.previous, format: "count", hint: money(won.valueCents) },
  ];

  const table: SummaryTable = {
    title: "Open right now, by stage",
    columns: [
      { label: "Stage", format: "text" },
      { label: "Count", format: "count" },
      { label: "Value", format: "money" },
      { label: "Avg. days in stage", format: "text" },
    ],
    rows: stages.map((entry) => [
      entry.label,
      entry.count,
      entry.valueCents,
      entry.avgAgeDays === null ? "—" : String(Math.round(entry.avgAgeDays)),
    ]),
  };

  return {
    kind: "pipeline",
    stages,
    openCount,
    openValueCents,
    aging,
    stuck,
    moves,
    conversions,
    newOpportunities,
    groups,
    headlines,
    table,
  };
}

// Words for the rate a conversion carries, for the write-up.
export function conversionWords(rate: number | null) {
  return rate === null ? "no comparison yet" : percent(rate);
}
