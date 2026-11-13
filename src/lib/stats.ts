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
//   or a later one inside the period (the contact rows of StatusChange; a
//   deal's move writes one for its contact too). See rollUpReached.
// - A step that came with a deal (quote out, contract out, won, lost) is
//   credited to the deal's rep; any other step to whoever made the move.
// - Money is DEALS: the value of deals that reached Won in the period,
//   credited to the deal's rep.
// - Funnel and conversion rates compare two of those counts, so they
//   never read above 100%. Close rate is Won / (Won + Lost).

// Connected (Nov 11, 2026) sits between Attempted (CONTACTED) and
// Interested; Interested is a side step a person may skip.
export const FUNNEL = ["CONTACTED", "CONNECTED", "INTERESTED", "MEETING_SET", "MEETING_COMPLETED", "QUOTE_SENT", "CONTRACT_SENT", "WON"] as const;
export type FunnelStep = (typeof FUNNEL)[number];

// The hand-offs whose time Stats measures, in pipeline order.
export const VELOCITY_PAIRS = [
  ["CONTACTED", "CONNECTED"],
  ["CONNECTED", "MEETING_SET"],
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
  // Touches by kind, each save counted once (COALESCE(batchId, id)): a
  // call logged on three people is one call (Nov 11, 2026).
  activities: Record<ActivityTypeValue, number>;
  // Every touch is a try; a talk is a try that connected (Talked, They
  // replied, Held, or a meeting with no outcome recorded that has
  // happened — the same rule as isConnect and the triggers). A no-show
  // is neither.
  activityTotal: number;
  tries: number;
  talks: number;
  connectRate: number | null;
  // OpportunityMeeting rows, credited to whoever booked them
  // (bookedById; decision 13), falling back to who logged the meeting and
  // then the opportunity's rep for meetings booked before Nov 11, 2026.
  // booked: made in the period. due: dated in the period and come due.
  // held: of those due, the ones that were held. showRate = held ÷ due.
  booked: number;
  due: number;
  held: number;
  showRate: number | null;
  steps: Record<FunnelStep | "LOST", number>;
  wonCents: number;
  closeRate: number | null;
};

export type StatsSnapshot = {
  from: Date;
  to: Date;
  totals: RepRow;
  previous: {
    steps: Record<FunnelStep | "LOST", number>;
    wonCents: number;
    activityTotal: number;
    tries: number;
    talks: number;
    connectRate: number | null;
    booked: number;
    due: number;
    held: number;
    showRate: number | null;
  };
  reps: RepRow[];
  // total = tries; talks is the part of them that connected.
  daily: { day: string; total: number; talks: number; byType: Record<ActivityTypeValue, number> }[];
  // "Talks counted from": the day outcomes started being recorded, when
  // the period starts before it (null otherwise).
  talksSince: Date | null;
  velocity: { from: string; to: string; days: number | null; samples: number }[];
  pipelineNow: { meetingSet: number; meetingCompleted: number; quoteCents: number; quoteCount: number; contractCents: number; contractCount: number };
};

const emptySteps = () => Object.fromEntries([...FUNNEL, "LOST"].map((step) => [step, 0])) as Record<FunnelStep | "LOST", number>;
const emptyActivities = () => Object.fromEntries(ACTIVITY_TYPES.map((type) => [type, 0])) as Record<ActivityTypeValue, number>;

function blankRow(id: string, name: string): RepRow {
  return {
    id,
    name,
    activities: emptyActivities(),
    activityTotal: 0,
    tries: 0,
    talks: 0,
    connectRate: null,
    booked: 0,
    due: 0,
    held: 0,
    showRate: null,
    steps: emptySteps(),
    wonCents: 0,
    closeRate: null,
  };
}

const ratio = (a: number, b: number) => (b ? a / b : null);

// The same two rules health-load.ts uses: what is a touch, and which
// touches connected.
const TOUCH = Prisma.sql`a.marketing = false AND a."occurredAt" <= now() AND a.outcome IS DISTINCT FROM 'NO_SHOW'`;
const CONNECT = Prisma.sql`(a.outcome IN ('TALKED', 'REPLIED', 'HELD') OR (a.type = 'MEETING' AND a.outcome IS NULL))`;

type TouchRow = { user_id: string; day: string; type: ActivityTypeValue; tries: number; talks: number };

// Tries and talks in a window, by who logged them, day and kind. One save
// fanned out over several people (batchId) is one try, and a talk when any
// line of it connected.
export async function loadTouches(organizationId: string, from: Date, to: Date, timeZone: string, userIds: string[] | null) {
  return prisma.$queryRaw<TouchRow[]>`
    WITH t AS (
      SELECT COALESCE(a."batchId", a.id) AS tid, MIN(a."userId") AS user_id, MIN(a."occurredAt") AS at,
             MIN(a.type::text) AS type, bool_or(${CONNECT}) AS connect
        FROM "Activity" a
       WHERE a."organizationId" = ${organizationId}
         AND ${TOUCH}
         AND a."occurredAt" >= ${from} AND a."occurredAt" < ${to}
         ${userIds ? Prisma.sql`AND a."userId" IN (${Prisma.join(userIds)})` : Prisma.empty}
       GROUP BY 1
    )
    SELECT user_id, to_char((at AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}, 'YYYY-MM-DD') AS day, type,
           COUNT(*)::int AS tries, COUNT(*) FILTER (WHERE connect)::int AS talks
      FROM t
     GROUP BY 1, 2, 3`;
}

type MeetingRow = { user_id: string | null; booked: number; due: number; held: number };

// Meetings booked, come due and held in a window, by who gets the credit.
// Held: marked Held (on the meeting or its logged line); not marked, with a
// meeting line logged that has happened (the isConnect rule); or dated
// before outcomes were recorded ("old meetings count as held").
export async function loadMeetingCredit(organizationId: string, from: Date, to: Date, outcomesSince: Date | null) {
  const since = outcomesSince ?? new Date(0);
  // Audit (Nov 11, 2026): a meeting is booked when it was first put down —
  // the earliest of the row, the meeting line it came from, and the day it
  // was for — not when its row was written. The Pipeline writes rows for
  // old meetings when it opens (reconcileOpportunities), which counted
  // them as booked that day. And one meeting is counted once however many
  // tiles carry it (the line, or the save it was part of).
  return prisma.$queryRaw<MeetingRow[]>`
    WITH rows AS (
      SELECT DISTINCT ON (COALESCE(a."batchId", a.id, om.id))
             COALESCE(om."bookedById", a."userId", o."ownerId") AS user_id,
             LEAST(om."createdAt", COALESCE(a."createdAt", om."createdAt"), om."on") AS booked_at,
             om."on",
             (om.outcome = 'HELD'
               OR (om.outcome IS NULL AND (
                    a.outcome = 'HELD'
                    OR (a.id IS NOT NULL AND a.outcome IS NULL AND a.type = 'MEETING' AND a."occurredAt" <= now())
                    OR (a.outcome IS NULL AND om."on" < ${since})))) AS held
        FROM "OpportunityMeeting" om
        JOIN "Opportunity" o ON o.id = om."opportunityId" AND o."organizationId" = ${organizationId}
        LEFT JOIN "Activity" a ON a.id = om."activityId" AND a."organizationId" = ${organizationId}
       WHERE om."createdAt" >= ${from} OR (om."on" >= ${from} AND om."on" < ${to})
       ORDER BY COALESCE(a."batchId", a.id, om.id), om."bookedById" IS NULL, om."createdAt"
    ), m AS (
      SELECT user_id,
             (booked_at >= ${from} AND booked_at < ${to}) AS booked,
             ("on" >= ${from} AND "on" < ${to} AND "on" <= now()) AS due,
             held
        FROM rows
    )
    SELECT user_id, COUNT(*) FILTER (WHERE booked)::int AS booked, COUNT(*) FILTER (WHERE due)::int AS due,
           COUNT(*) FILTER (WHERE due AND held)::int AS held
      FROM m
     GROUP BY 1`;
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
  for (const steps of people.values()) rollUpReached(steps);
  return { people, won };
}

// "Reached a step" means got to it or past it (audit, Nov 11, 2026): a
// person booked straight from a first call reached Attempted and Connected
// on the way to Meeting Set even though no move into those two was ever
// written in the period. So each ladder step counts the people moved into
// it or any later step, which keeps every funnel step at or under the one
// before and every step rate at or under 100% (it read "120% from
// Attempted" when it counted only moves into each step). Interested is a
// side step: it implies Attempted and Connected, but nothing later implies
// it. Lost is a side exit and implies nothing.
const LADDER = FUNNEL.filter((step) => step !== "INTERESTED");
function rollUpReached(steps: Map<string, Set<string>>) {
  const later = new Set<string>();
  for (let index = LADDER.length - 1; index >= 0; index -= 1) {
    const step = LADDER[index];
    for (const id of steps.get(step) ?? []) later.add(id);
    if (step === "CONNECTED") for (const id of steps.get("INTERESTED") ?? []) later.add(id);
    if (later.size) steps.set(step, new Set(later));
  }
}

export async function loadStats(
  organizationId: string,
  // `range` is a custom From–To picked on Stats (Nov 13, 2026): it
  // replaces the period, and is compared with the same length before it.
  options: { period: PeriodKey; userIds: string[]; timeZone: string; range?: { from: Date; to: Date } },
): Promise<StatsSnapshot> {
  const to = options.range?.to ?? new Date();
  const span = options.range ? Math.max(0, options.range.to.getTime() - options.range.from.getTime()) : PERIODS[options.period].days * 86_400_000;
  const from = new Date(to.getTime() - span);
  const previousFrom = new Date(from.getTime() - span);
  const only = options.userIds.length ? new Set(options.userIds) : null;
  const keep = (id: string) => !only || only.has(id);

  const onlyIds = only ? [...only] : null;
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { outcomesSince: true } });
  const outcomesSince = org?.outcomesSince ?? null;

  const [users, touches, current, before, beforeTouches, meetings, beforeMeetings, pipelineContacts, openDeals] = await Promise.all([
    prisma.user.findMany({
      where: { organizationId },
      orderBy: [{ removedAt: { sort: "asc", nulls: "first" } }, { name: "asc" }],
      select: { id: true, name: true, removedAt: true },
    }),
    // Marketing sends are not touches (Nov 10, 2026).
    loadTouches(organizationId, from, to, options.timeZone, onlyIds),
    production(organizationId, from, to),
    production(organizationId, previousFrom, from),
    loadTouches(organizationId, previousFrom, from, options.timeZone, onlyIds),
    loadMeetingCredit(organizationId, from, to, outcomesSince),
    loadMeetingCredit(organizationId, previousFrom, from, outcomesSince),
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
  for (const entry of touches) {
    const target = row(entry.user_id);
    target.activities[entry.type] += entry.tries;
    target.activityTotal += entry.tries;
    target.tries += entry.tries;
    target.talks += entry.talks;
  }
  for (const entry of meetings) {
    const rep = entry.user_id ?? "unassigned";
    if (!keep(rep)) continue;
    const target = row(rep);
    target.booked += entry.booked;
    target.due += entry.due;
    target.held += entry.held;
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
    target.connectRate = ratio(target.talks, target.tries);
    target.showRate = ratio(target.held, target.due);
  }

  // The team line: people counted once even when two reps moved them.
  const totals = blankRow("all", "Team");
  for (const target of rows.values()) {
    for (const type of ACTIVITY_TYPES) totals.activities[type] += target.activities[type];
    totals.activityTotal += target.activityTotal;
    totals.tries += target.tries;
    totals.talks += target.talks;
    totals.booked += target.booked;
    totals.due += target.due;
    totals.held += target.held;
    totals.wonCents += target.wonCents;
  }
  totals.connectRate = ratio(totals.talks, totals.tries);
  totals.showRate = ratio(totals.held, totals.due);
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
  // A custom range ends at midnight after its To (audit fix, Nov 13, 2026):
  // that midnight is the next day, so the last day is read a moment before.
  const lastKey = dayFormat.format(options.range ? new Date(Math.max(from.getTime(), to.getTime() - 1)) : to);
  if (!dayKeys.includes(lastKey)) dayKeys.push(lastKey);
  const byDay = new Map(dayKeys.map((day) => [day, { day, total: 0, talks: 0, byType: emptyActivities() }]));
  for (const entry of touches) {
    const bucket = byDay.get(entry.day);
    if (!bucket) continue;
    bucket.byType[entry.type] += entry.tries;
    bucket.total += entry.tries;
    bucket.talks += entry.talks;
  }

  let previousTries = 0;
  let previousTalks = 0;
  for (const entry of beforeTouches) {
    previousTries += entry.tries;
    previousTalks += entry.talks;
  }
  const previousMeetings = { booked: 0, due: 0, held: 0 };
  for (const entry of beforeMeetings) {
    if (!keep(entry.user_id ?? "unassigned")) continue;
    previousMeetings.booked += entry.booked;
    previousMeetings.due += entry.due;
    previousMeetings.held += entry.held;
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
    .filter((target) => target.id !== "unassigned" || target.activityTotal + target.booked + target.due + Object.values(target.steps).reduce((a, b) => a + b, 0) > 0)
    .sort((a, b) => b.wonCents - a.wonCents || b.steps.MEETING_SET - a.steps.MEETING_SET || b.activityTotal - a.activityTotal);

  return {
    from,
    to,
    totals,
    previous: {
      steps: unique(before.people),
      wonCents: previousWon,
      activityTotal: previousTries,
      tries: previousTries,
      talks: previousTalks,
      connectRate: ratio(previousTalks, previousTries),
      ...previousMeetings,
      showRate: ratio(previousMeetings.held, previousMeetings.due),
    },
    reps,
    daily: Array.from(byDay.values()),
    talksSince: outcomesSince && from < outcomesSince ? outcomesSince : null,
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

