import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { ACTIVITY_TYPES, type ActivityTypeValue } from "@/lib/constants";
import { dealValueCents, QUOTES_FOR_VALUE } from "@/lib/deals";

// Stats / Reporting (Sept 30, 2026). Everything here is counted from rows
// that already exist — Activity for the work, StatusChange for every move
// up the ladder, Deal for the money — so each number can be traced back to
// the records behind it. Nothing is stored.
//
// Counting rules, written once so every tile agrees:
// - A funnel step counts PEOPLE: distinct contacts who reached that status
//   inside the period (the contact rows of StatusChange; a deal's move
//   writes one for its contact too).
// - A step that came with a deal (quote out, contract out, won, lost) is
//   credited to the deal's rep; any other step to whoever made the move.
// - Money is DEALS: the value of deals that reached Won in the period,
//   credited to the deal's rep.
// - Conversion rates compare two counts over the same period, so a quick
//   month can read above 100% when last month's meetings complete in this
//   one. Close rate is Won / (Won + Lost).

export const FUNNEL = ["CONTACTED", "INTERESTED", "MEETING_SET", "MEETING_COMPLETED", "QUOTE_SENT", "CONTRACT_SENT", "WON"] as const;
export type FunnelStep = (typeof FUNNEL)[number];

// The hand-offs whose time Stats measures, in pipeline order.
export const VELOCITY_PAIRS = [
  ["CONTACTED", "MEETING_SET"],
  ["MEETING_SET", "MEETING_COMPLETED"],
  ["MEETING_COMPLETED", "QUOTE_SENT"],
  ["QUOTE_SENT", "CONTRACT_SENT"],
  ["CONTRACT_SENT", "WON"],
] as const;

export const PERIODS = {
  "7d": { label: "7 days", days: 7 },
  "30d": { label: "30 days", days: 30 },
  "90d": { label: "90 days", days: 90 },
  "365d": { label: "12 months", days: 365 },
} as const;
export type PeriodKey = keyof typeof PERIODS;

export type RepRow = {
  id: string;
  name: string;
  activities: Record<ActivityTypeValue, number>;
  activityTotal: number;
  steps: Record<FunnelStep | "LOST", number>;
  wonCents: number;
  closeRate: number | null;
};

export type StatsSnapshot = {
  from: Date;
  to: Date;
  totals: RepRow;
  previous: { steps: Record<FunnelStep | "LOST", number>; wonCents: number; activityTotal: number };
  reps: RepRow[];
  daily: { day: string; total: number; byType: Record<ActivityTypeValue, number> }[];
  velocity: { from: string; to: string; days: number | null; samples: number }[];
  pipelineNow: { meetingSet: number; meetingCompleted: number; quoteCents: number; quoteCount: number; contractCents: number; contractCount: number };
};

const emptySteps = () => Object.fromEntries([...FUNNEL, "LOST"].map((step) => [step, 0])) as Record<FunnelStep | "LOST", number>;
const emptyActivities = () => Object.fromEntries(ACTIVITY_TYPES.map((type) => [type, 0])) as Record<ActivityTypeValue, number>;

function blankRow(id: string, name: string): RepRow {
  return { id, name, activities: emptyActivities(), activityTotal: 0, steps: emptySteps(), wonCents: 0, closeRate: null };
}

// Funnel counts and won money for one window, per rep.
async function production(organizationId: string, from: Date, to: Date) {
  const changes = await prisma.statusChange.findMany({
    where: { organizationId, on: { gte: from, lt: to }, OR: [{ contactId: { not: null } }, { dealId: { not: null }, toStatus: "WON" }] },
    select: { contactId: true, dealId: true, toStatus: true, userId: true },
  });
  const dealIds = Array.from(new Set(changes.map((row) => row.dealId).filter((id): id is string => Boolean(id))));
  const deals = dealIds.length
    ? await prisma.deal.findMany({
        where: { organizationId, id: { in: dealIds } },
        select: { id: true, ownerId: true, valueCents: true, quotes: QUOTES_FOR_VALUE },
      })
    : [];
  const dealById = new Map(deals.map((deal) => [deal.id, deal]));
  // A move that came with a deal (quote out, contract out, won, lost)
  // belongs to the deal's rep, so a rep's Won count and Won $ agree; the
  // rest to whoever made the move.
  const credit = (row: { userId: string | null; dealId: string | null }) =>
    (row.dealId ? dealById.get(row.dealId)?.ownerId : null) ?? row.userId ?? "unassigned";

  // rep -> step -> contacts
  const people = new Map<string, Map<string, Set<string>>>();
  const won = new Map<string, number>();
  const wonDeals = new Set<string>();
  for (const row of changes) {
    const rep = credit(row);
    if (row.contactId && (FUNNEL as readonly string[]).concat("LOST").includes(row.toStatus)) {
      const steps = people.get(rep) ?? new Map<string, Set<string>>();
      const set = steps.get(row.toStatus) ?? new Set<string>();
      set.add(row.contactId);
      steps.set(row.toStatus, set);
      people.set(rep, steps);
    }
    if (row.dealId && !row.contactId && row.toStatus === "WON" && !wonDeals.has(row.dealId)) {
      wonDeals.add(row.dealId);
      const deal = dealById.get(row.dealId);
      if (deal) {
        const owner = deal.ownerId ?? rep;
        won.set(owner, (won.get(owner) ?? 0) + dealValueCents(deal));
      }
    }
  }
  return { people, won };
}

export async function loadStats(
  organizationId: string,
  options: { period: PeriodKey; userIds: string[]; timeZone: string },
): Promise<StatsSnapshot> {
  const to = new Date();
  const span = PERIODS[options.period].days * 86_400_000;
  const from = new Date(to.getTime() - span);
  const previousFrom = new Date(from.getTime() - span);
  const only = options.userIds.length ? new Set(options.userIds) : null;
  const keep = (id: string) => !only || only.has(id);

  const [users, activity, daily, current, before, beforeActivity, pipelineContacts, openDeals] = await Promise.all([
    prisma.user.findMany({
      where: { organizationId },
      orderBy: [{ removedAt: { sort: "asc", nulls: "first" } }, { name: "asc" }],
      select: { id: true, name: true, removedAt: true },
    }),
    prisma.activity.groupBy({
      by: ["userId", "type"],
      where: { organizationId, occurredAt: { gte: from, lt: to }, ...(only ? { userId: { in: [...only] } } : {}) },
      _count: { _all: true },
    }),
    prisma.$queryRaw<{ day: string; type: ActivityTypeValue; n: number }[]>`
      SELECT to_char(("occurredAt" AT TIME ZONE 'UTC') AT TIME ZONE ${options.timeZone}, 'YYYY-MM-DD') AS day,
             type::text AS type, COUNT(*)::int AS n
        FROM "Activity"
       WHERE "organizationId" = ${organizationId}
         AND "occurredAt" >= ${from} AND "occurredAt" < ${to}
         ${only ? prismaIn([...only]) : emptySql()}
       GROUP BY 1, 2`,
    production(organizationId, from, to),
    production(organizationId, previousFrom, from),
    prisma.activity.count({
      where: { organizationId, occurredAt: { gte: previousFrom, lt: from }, ...(only ? { userId: { in: [...only] } } : {}) },
    }),
    prisma.contact.groupBy({
      by: ["status"],
      where: { organizationId, status: { in: ["MEETING_SET", "MEETING_COMPLETED"] } },
      _count: { _all: true },
    }),
    prisma.deal.findMany({
      where: { organizationId, stage: { in: ["QUOTE_SENT", "CONTRACT_SENT"] }, ...(only ? { ownerId: { in: [...only] } } : {}) },
      select: { stage: true, valueCents: true, quotes: QUOTES_FOR_VALUE },
    }),
  ]);

  // Per rep.
  const names = new Map(users.map((user) => [user.id, user.removedAt ? `${user.name} (removed)` : user.name]));
  const rows = new Map<string, RepRow>();
  const row = (id: string) => {
    let found = rows.get(id);
    if (!found) {
      found = blankRow(id, names.get(id) ?? "Unassigned");
      rows.set(id, found);
    }
    return found;
  };
  for (const user of users) if (!user.removedAt && keep(user.id)) row(user.id);
  for (const entry of activity) {
    const target = row(entry.userId);
    target.activities[entry.type] += entry._count._all;
    target.activityTotal += entry._count._all;
  }
  for (const [rep, steps] of current.people) {
    if (!keep(rep)) continue;
    const target = row(rep);
    for (const [step, set] of steps) target.steps[step as FunnelStep] += set.size;
  }
  for (const [rep, cents] of current.won) if (keep(rep)) row(rep).wonCents += cents;
  for (const target of rows.values()) {
    const decided = target.steps.WON + target.steps.LOST;
    target.closeRate = decided ? target.steps.WON / decided : null;
  }

  // The team line: people counted once even when two reps moved them.
  const totals = blankRow("all", "Team");
  for (const target of rows.values()) {
    for (const type of ACTIVITY_TYPES) totals.activities[type] += target.activities[type];
    totals.activityTotal += target.activityTotal;
    totals.wonCents += target.wonCents;
  }
  const unique = (people: Map<string, Map<string, Set<string>>>) => {
    const steps = emptySteps();
    const merged = new Map<string, Set<string>>();
    for (const [rep, byStep] of people) {
      if (!keep(rep)) continue;
      for (const [step, set] of byStep) {
        const all = merged.get(step) ?? new Set<string>();
        for (const id of set) all.add(id);
        merged.set(step, all);
      }
    }
    for (const [step, set] of merged) steps[step as FunnelStep] = set.size;
    return steps;
  };
  totals.steps = unique(current.people);
  const decided = totals.steps.WON + totals.steps.LOST;
  totals.closeRate = decided ? totals.steps.WON / decided : null;

  let previousWon = 0;
  for (const [rep, cents] of before.won) if (keep(rep)) previousWon += cents;

  // Day by day, every day in the window present even when nothing happened.
  const dayKeys: string[] = [];
  const dayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: options.timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  for (let at = from.getTime(); at < to.getTime(); at += 86_400_000) {
    const key = dayFormat.format(new Date(at));
    if (!dayKeys.includes(key)) dayKeys.push(key);
  }
  const lastKey = dayFormat.format(to);
  if (!dayKeys.includes(lastKey)) dayKeys.push(lastKey);
  const byDay = new Map(dayKeys.map((day) => [day, { day, total: 0, byType: emptyActivities() }]));
  for (const entry of daily) {
    const bucket = byDay.get(entry.day);
    if (!bucket) continue;
    bucket.byType[entry.type] += entry.n;
    bucket.total += entry.n;
  }

  const velocity = await loadVelocity(organizationId, from, to);

  const pipelineNow = {
    meetingSet: pipelineContacts.find((entry) => entry.status === "MEETING_SET")?._count._all ?? 0,
    meetingCompleted: pipelineContacts.find((entry) => entry.status === "MEETING_COMPLETED")?._count._all ?? 0,
    quoteCents: 0,
    quoteCount: 0,
    contractCents: 0,
    contractCount: 0,
  };
  for (const deal of openDeals) {
    if (deal.stage === "QUOTE_SENT") {
      pipelineNow.quoteCount += 1;
      pipelineNow.quoteCents += dealValueCents(deal);
    } else {
      pipelineNow.contractCount += 1;
      pipelineNow.contractCents += dealValueCents(deal);
    }
  }

  const reps = Array.from(rows.values())
    .filter((target) => target.id !== "unassigned" || target.activityTotal + Object.values(target.steps).reduce((a, b) => a + b, 0) > 0)
    .sort((a, b) => b.wonCents - a.wonCents || b.steps.MEETING_SET - a.steps.MEETING_SET || b.activityTotal - a.activityTotal);

  return {
    from,
    to,
    totals,
    previous: { steps: unique(before.people), wonCents: previousWon, activityTotal: beforeActivity },
    reps,
    daily: Array.from(byDay.values()),
    velocity,
    pipelineNow,
  };
}

// Average days from one step to the next, for the people who reached the
// later step inside the window. Each person's first arrival at each step
// is what counts.
async function loadVelocity(organizationId: string, from: Date, to: Date) {
  const arrived = await prisma.statusChange.findMany({
    where: { organizationId, contactId: { not: null }, on: { gte: from, lt: to }, toStatus: { in: VELOCITY_PAIRS.map((pair) => pair[1]) } },
    select: { contactId: true },
    distinct: ["contactId"],
    take: 5000,
  });
  const ids = arrived.map((row) => row.contactId!);
  const history = ids.length
    ? await prisma.statusChange.findMany({
        where: { organizationId, contactId: { in: ids } },
        orderBy: { on: "asc" },
        select: { contactId: true, toStatus: true, on: true },
      })
    : [];
  const first = new Map<string, Map<string, Date>>();
  for (const change of history) {
    const steps = first.get(change.contactId!) ?? new Map<string, Date>();
    if (!steps.has(change.toStatus)) steps.set(change.toStatus, change.on);
    first.set(change.contactId!, steps);
  }
  return VELOCITY_PAIRS.map(([start, end]) => {
    let total = 0;
    let samples = 0;
    for (const steps of first.values()) {
      const a = steps.get(start);
      const b = steps.get(end);
      if (!a || !b || b < a || b < from || b >= to) continue;
      total += (b.getTime() - a.getTime()) / 86_400_000;
      samples += 1;
    }
    return { from: start, to: end, days: samples ? total / samples : null, samples };
  });
}

// Raw-SQL helpers for the optional rep filter on the daily query.
function prismaIn(ids: string[]) {
  return Prisma.sql`AND "userId" IN (${Prisma.join(ids)})`;
}
function emptySql() {
  return Prisma.empty;
}
