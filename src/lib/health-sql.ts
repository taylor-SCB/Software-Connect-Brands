import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { owedRowsSql } from "@/lib/money";
import { OVERDUE_TYPES } from "@/lib/calendar-data";
import { TALK_STATUSES, zoneDay } from "@/lib/health";

// The SQL twin of leadHealth() (src/lib/health.ts), for the Contacts
// list's Pulse filter and sort (BDR redesign, round 2, Nov 11, 2026; the
// plan's healthScore: "The Pulse filter / sort uses a SQL twin of the same
// rules, with a test that the two agree"). It works out only what decides
// the colour — the state, the 0-100 score of someone reached, stalled for
// someone being tried, late money on a won one — never the words.
//
// Two halves, so each can be checked on its own:
// - pulseRulesSql(): the rules, from one row of plain inputs per person.
//   scripts/health-check.ts runs every leadHealth() fixture through it and
//   checks the two agree on the state, score, band, stalled and warmth.
// - contactPulseInputs(): those inputs for every person in a workspace,
//   from the same tables and the same definitions as the health loader
//   (src/lib/health-load.ts): the stored lastTouchAt / lastConnectAt
//   (kept by the triggers with the loader's own touch and connect rules),
//   the latest move into a talk status, tries since the last talk, what is
//   booked or late, paperwork out, late money. health-check.ts checks the
//   two together against loadContactHealth() on its seeded workspace.
//
// Never stored: worked out when the list asks, like the score itself.

// The keys the Pulse filter offers, warmest first — the sort's order.
export const PULSE_KEYS = ["won", "owes", "warm", "cooling", "cold", "trying", "stalled", "new", "closed"] as const;
export type PulseKey = (typeof PULSE_KEYS)[number];
export const PULSE_LABELS: Record<PulseKey, string> = {
  won: "Won",
  owes: "Won — owes money",
  warm: "Warm",
  cooling: "Cooling",
  cold: "Cold",
  trying: "Trying",
  stalled: "Trying — stalled",
  new: "New",
  closed: "Closed",
};

// The same sets leadHealth() reads.
export const PULSE_CLOSED = ["NOT_INTERESTED", "LOST", "ARCHIVED"] as const;
export const PULSE_REACHED = ["CONNECTED", "INTERESTED", "MEETING_SET", "MEETING_COMPLETED", "QUOTE_SENT", "CONTRACT_SENT"] as const;
export type PulseState = "NEW" | "TRYING" | "REACHED" | "WON" | "CLOSED";
export const STATE_OF_PULSE: Record<PulseKey, PulseState> = {
  won: "WON",
  owes: "WON",
  warm: "REACHED",
  cooling: "REACHED",
  cold: "REACHED",
  trying: "TRYING",
  stalled: "TRYING",
  new: "NEW",
  closed: "CLOSED",
};

export type PulseClock = { now: Date; timeZone: string; quietDays: number };

// The clock's moment as the columns hold one: a UTC timestamp.
function nowSql(clock: PulseClock) {
  return Prisma.sql`(${clock.now.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
}

// The rules. `source` is a SELECT giving one row per person with:
//   key text, status text, tries int, talks int,
//   last_touch timestamptz, last_connect timestamptz, status_talk timestamptz,
//   since int (tries after the later of the two talks),
//   next_on date (the soonest thing booked, the workspace's day; null for none),
//   late_n int (follow-ups gone late), paper jsonb (an array of sent-at
//   timestamps of quotes and contracts out), owes_late boolean.
// Gives key, state, pulse, score (reached only), stalled, warmth (the
// same number as warmth() in health.ts).
export function pulseRulesSql(source: Prisma.Sql, clock: PulseClock): Prisma.Sql {
  // A whole number of days, written into the statement as a number.
  const q = Prisma.raw(String(Math.max(1, Math.round(clock.quietDays || 8))));
  const now = nowSql(clock);
  const tz = clock.timeZone;
  // A calendar day in the workspace's zone, as daysSince() counts them.
  // Every date column is a timestamp without a zone holding UTC.
  const day = (at: Prisma.Sql) => Prisma.sql`((${at}) AT TIME ZONE 'UTC' AT TIME ZONE ${tz})::date`;
  const today = day(now);
  // daysAgo(): null for no date, never below 0.
  const ago = (at: Prisma.Sql) => Prisma.sql`CASE WHEN ${at} IS NULL THEN NULL ELSE GREATEST(0, ${today} - ${day(at)}) END`;
  return Prisma.sql`
    SELECT i.key, s.state,
           CASE s.state
             WHEN 'WON' THEN CASE WHEN COALESCE(i.owes_late, false) THEN 'owes' ELSE 'won' END
             WHEN 'CLOSED' THEN 'closed'
             WHEN 'NEW' THEN 'new'
             WHEN 'TRYING' THEN CASE WHEN f.stalled THEN 'stalled' ELSE 'trying' END
             ELSE CASE WHEN sc.score >= 70 THEN 'warm' WHEN sc.score >= 40 THEN 'cooling' ELSE 'cold' END
           END AS pulse,
           CASE WHEN s.state = 'REACHED' THEN sc.score END AS score,
           (s.state = 'TRYING' AND f.stalled) AS stalled,
           CASE s.state
             WHEN 'WON' THEN 400
             WHEN 'REACHED' THEN 200 + sc.score
             WHEN 'TRYING' THEN CASE WHEN f.stalled THEN 110 ELSE 120 END
             WHEN 'NEW' THEN 100
             ELSE 0
           END AS warmth
      FROM (${source}) i
      CROSS JOIN LATERAL (
        SELECT ${ago(Prisma.sql`i.last_touch`)} AS lt,
               ${ago(Prisma.sql`GREATEST(i.last_connect, CASE WHEN i.status_talk <= ${now} THEN i.status_talk END)`)} AS ltalk,
               COALESCE(i.late_n, 0) > 0 AS late,
               (i.next_on IS NOT NULL AND i.next_on >= ${today}) AS has_next,
               COALESCE((SELECT bool_or(${ago(Prisma.sql`p.v::timestamp`)} <= ${q})
                           FROM jsonb_array_elements_text(COALESCE(i.paper, '[]'::jsonb)) p(v)), false) AS paper_recent,
               COALESCE((SELECT bool_or(${ago(Prisma.sql`p.v::timestamp`)} > ${q}
                                        AND (i.last_touch IS NULL OR i.last_touch < p.v::timestamp))
                           FROM jsonb_array_elements_text(COALESCE(i.paper, '[]'::jsonb)) p(v)), false) AS paper_drag
      ) d
      CROSS JOIN LATERAL (SELECT (d.has_next OR d.paper_recent) AS booked) b
      CROSS JOIN LATERAL (
        SELECT CASE
                 WHEN i.status = 'WON' THEN 'WON'
                 WHEN i.status IN (${Prisma.join([...PULSE_CLOSED])}) THEN 'CLOSED'
                 WHEN i.last_connect IS NOT NULL OR COALESCE(i.talks, 0) > 0 OR i.status IN (${Prisma.join([...PULSE_REACHED])}) THEN 'REACHED'
                 WHEN i.last_touch IS NULL AND COALESCE(i.tries, 0) = 0 AND i.status = 'NOT_ACTIONED' THEN 'NEW'
                 ELSE 'TRYING'
               END AS state
      ) s
      CROSS JOIN LATERAL (
        SELECT (d.late OR (NOT b.booked AND d.lt IS NOT NULL AND d.lt > ${q})) AS stalled
      ) f
      CROSS JOIN LATERAL (
        SELECT LEAST(100, GREATEST(0,
                 (CASE WHEN d.lt IS NULL THEN 0 WHEN d.lt <= 2 THEN 40 WHEN d.lt <= ${q} / 2.0 THEN 25 WHEN d.lt <= ${q} THEN 10 ELSE 0 END)
               + GREATEST(0, (CASE WHEN d.ltalk IS NULL THEN 10 WHEN d.ltalk <= ${q} THEN 30 WHEN d.ltalk <= ${q} * 2 THEN 20 ELSE 10 END)
                             - CASE WHEN COALESCE(i.since, 0) >= 5 THEN 10 ELSE 0 END)
               + CASE WHEN b.booked THEN CASE WHEN d.late THEN 15 ELSE 30 END ELSE 0 END
               - CASE WHEN d.paper_drag THEN 15 ELSE 0 END))::int AS score
      ) sc`;
}

// The inputs for the workspace's people, optionally only one rep's
// (`owner`: an id, or null for nobody's). Every statement is scoped to
// the workspace and grouped; nothing is read per person.
export function contactPulseInputs(organizationId: string, clock: PulseClock, owner?: string | null): Prisma.Sql {
  const now = nowSql(clock);
  const today = zoneDay(clock.now, clock.timeZone);
  const ownerClause =
    owner === undefined ? Prisma.empty : owner === null ? Prisma.sql`AND c."ownerId" IS NULL` : Prisma.sql`AND c."ownerId" = ${owner}`;
  // A touch and a connect, as the loader and the triggers read them.
  const touch = Prisma.sql`a.marketing = false AND a."occurredAt" <= ${now} AND a.outcome IS DISTINCT FROM 'NO_SHOW'`;
  return Prisma.sql`
    WITH people AS (
      SELECT c.id, c.status::text AS status, c."lastTouchAt" AS last_touch, c."lastConnectAt" AS last_connect
        FROM "Contact" c
       WHERE c."organizationId" = ${organizationId} ${ownerClause}
    ),
    st AS (
      SELECT s."contactId" AS id, MAX(s."on") AS at
        FROM "StatusChange" s
       WHERE s."organizationId" = ${organizationId} AND s."contactId" IS NOT NULL
         AND s."toStatus" IN (${Prisma.join([...TALK_STATUSES])}) AND s."on" <= ${now}
       GROUP BY 1
    ),
    talk AS (
      SELECT p.id, GREATEST(p.last_connect, st.at) AS at
        FROM people p JOIN st ON st.id = p.id
      UNION ALL
      SELECT p.id, p.last_connect FROM people p
       WHERE p.last_connect IS NOT NULL AND NOT EXISTS (SELECT 1 FROM st WHERE st.id = p.id)
    ),
    since AS (
      SELECT t.id, COUNT(DISTINCT COALESCE(a."batchId", a.id))::int AS n
        FROM talk t
        JOIN "Activity" a ON a."contactId" = t.id AND a."organizationId" = ${organizationId}
       WHERE ${touch} AND a."occurredAt" > t.at
       GROUP BY 1
    ),
    -- Booked today or later: an open calendar entry (theirs or one they
    -- attend), a touch dated ahead, or a meeting ahead on their
    -- opportunity nobody has answered yet (the loader's om_next).
    booked AS (
      SELECT e."contactId" AS id FROM "CalendarEvent" e
       WHERE e."organizationId" = ${organizationId} AND e."doneAt" IS NULL AND e."contactId" IS NOT NULL
         AND (e."startOn" >= ${today}::date OR e."endOn" >= ${today}::date)
      UNION
      SELECT ea."B" FROM "_EventAttendees" ea JOIN "CalendarEvent" e ON e.id = ea."A"
       WHERE e."organizationId" = ${organizationId} AND e."doneAt" IS NULL
         AND (e."startOn" >= ${today}::date OR e."endOn" >= ${today}::date)
      UNION
      SELECT a."contactId" FROM "Activity" a
       WHERE a."organizationId" = ${organizationId} AND a.marketing = false AND a."occurredAt" > ${now} AND a."contactId" IS NOT NULL
      UNION
      SELECT oc."contactId" FROM "OpportunityMeeting" om
        JOIN "Opportunity" o ON o.id = om."opportunityId"
        JOIN "OpportunityContact" oc ON oc."opportunityId" = o.id AND oc.role <> 'HIDDEN'
        LEFT JOIN "Activity" act ON act.id = om."activityId"
       WHERE o."organizationId" = ${organizationId} AND om."on" > ${now} AND om.outcome IS NULL
         AND (act.outcome IS NULL OR act.outcome::text NOT IN ('HELD', 'NO_SHOW'))
    ),
    late AS (
      SELECT id, COUNT(*)::int AS n FROM (
        SELECT e."contactId" AS id FROM "CalendarEvent" e
         WHERE e."organizationId" = ${organizationId} AND e."doneAt" IS NULL AND e."contactId" IS NOT NULL
           AND e.type IN (${Prisma.join(OVERDUE_TYPES)})
           AND e."startOn" < ${today}::date AND (e."endOn" IS NULL OR e."endOn" < ${today}::date)
        UNION
        SELECT ea."B" FROM "_EventAttendees" ea JOIN "CalendarEvent" e ON e.id = ea."A"
         WHERE e."organizationId" = ${organizationId} AND e."doneAt" IS NULL
           AND e.type IN (${Prisma.join(OVERDUE_TYPES)})
           AND e."startOn" < ${today}::date AND (e."endOn" IS NULL OR e."endOn" < ${today}::date)
      ) x GROUP BY id
    ),
    paper AS (
      SELECT id, jsonb_agg(sent_at) AS items FROM (
        SELECT q."contactId" AS id, q."sentAt" AS sent_at FROM "Quote" q
         WHERE q."organizationId" = ${organizationId} AND q.status = 'SENT' AND q."sentAt" IS NOT NULL AND q."contactId" IS NOT NULL
        UNION ALL
        SELECT k."contactId", k."sentAt" FROM "Contract" k
         WHERE k."organizationId" = ${organizationId} AND k.status = 'SENT' AND k.payable = false AND k."sentAt" IS NOT NULL AND k."contactId" IS NOT NULL
      ) x GROUP BY id
    ),
    won AS (SELECT p.id AS key FROM people p WHERE p.status = 'WON'),
    owes AS (
      SELECT k.key
      ${owedRowsSql(organizationId, Prisma.sql`JOIN won k ON k.key = c."contactId"`)}
         AND cp."paidAt" IS NULL AND cp."amountCents" > 0 AND cp."dueOn" < ${today}::date
         AND cp."amountCents" - COALESCE(paid.total, 0) > 0
       GROUP BY k.key
    )
    SELECT p.id AS key, p.status, 0 AS tries, 0 AS talks, p.last_touch, p.last_connect, st.at AS status_talk,
           since.n AS since,
           CASE WHEN booked.id IS NOT NULL THEN ${today}::date END AS next_on,
           late.n AS late_n, paper.items AS paper, (owes.key IS NOT NULL) AS owes_late
      FROM people p
      LEFT JOIN st ON st.id = p.id
      LEFT JOIN since ON since.id = p.id
      LEFT JOIN (SELECT DISTINCT id FROM booked) booked ON booked.id = p.id
      LEFT JOIN late ON late.id = p.id
      LEFT JOIN paper ON paper.id = p.id
      LEFT JOIN owes ON owes.key = p.id`;
}

// ---- The list's side --------------------------------------------------

// What the Contacts list needs to filter and order by Pulse. The state is
// a where-clause on stored columns (status, lastTouchAt, lastConnectAt);
// inside a state the pulses are told apart by ids: for each state the
// twin returns every person whose pulse isn't that state's biggest one,
// so the biggest is "the state, less those". A list of ids never passes
// PULSE_ID_CAP (Postgres takes about 32,000 values in one statement);
// past it the smaller pulses narrow a little less, as the presets' lists do.
export const PULSE_ID_CAP = 20_000;

export type PulseSets = {
  // Per state: its biggest pulse, and the ids of each of the others.
  big: Partial<Record<PulseState, PulseKey>>;
  ids: Partial<Record<PulseKey, string[]>>;
  capped: boolean;
};

export async function loadPulseSets(organizationId: string, clock: PulseClock, owner?: string | null): Promise<PulseSets> {
  const rows = await prisma.$queryRaw<{ id: string | null; state: string; pulse: string; n: number | null }[]>(Prisma.sql`
    WITH tw AS MATERIALIZED (${pulseRulesSql(contactPulseInputs(organizationId, clock, owner), clock)}),
    counts AS (SELECT state, pulse, COUNT(*)::int AS n FROM tw WHERE state IN ('WON', 'REACHED', 'TRYING') GROUP BY 1, 2),
    big AS (SELECT DISTINCT ON (state) state, pulse FROM counts ORDER BY state, n DESC, pulse)
    SELECT NULL AS id, state, pulse, NULL::int AS n FROM big
    UNION ALL
    (SELECT tw.key, tw.state, tw.pulse, NULL FROM tw JOIN big ON big.state = tw.state
      WHERE tw.pulse <> big.pulse ORDER BY tw.warmth DESC, tw.key LIMIT ${PULSE_ID_CAP + 1})`);
  const sets: PulseSets = { big: {}, ids: {}, capped: false };
  let count = 0;
  for (const row of rows) {
    if (row.id === null) {
      sets.big[row.state as PulseState] = row.pulse as PulseKey;
      continue;
    }
    count += 1;
    if (count > PULSE_ID_CAP) {
      sets.capped = true;
      break;
    }
    (sets.ids[row.pulse as PulseKey] ??= []).push(row.id);
  }
  return sets;
}

// The stored-column clause for a state (what leadHealth()'s step 1 reads).
export function pulseStateClause(state: PulseState): object {
  const notClosed = { status: { notIn: ["WON", ...PULSE_CLOSED] } };
  switch (state) {
    case "WON":
      return { status: "WON" };
    case "CLOSED":
      return { status: { in: [...PULSE_CLOSED] } };
    case "REACHED":
      return { AND: [notClosed, { OR: [{ lastConnectAt: { not: null } }, { status: { in: [...PULSE_REACHED] } }] }] };
    case "NEW":
      return { status: "NOT_ACTIONED", lastTouchAt: null, lastConnectAt: null };
    case "TRYING":
      return {
        AND: [
          { status: { notIn: ["WON", ...PULSE_CLOSED, ...PULSE_REACHED] } },
          { lastConnectAt: null },
          { NOT: { status: "NOT_ACTIONED", lastTouchAt: null } },
        ],
      };
  }
}

// The where-clause for one pulse.
export function pulseClause(key: PulseKey, sets: PulseSets): object {
  const state = STATE_OF_PULSE[key];
  const base = pulseStateClause(state);
  if (state === "NEW" || state === "CLOSED") return base;
  const big = sets.big[state];
  if (big === undefined) return { AND: [base, { id: { in: [] as string[] } }] };
  if (key !== big) return { AND: [base, { id: { in: sets.ids[key] ?? [] } }] };
  const others = PULSE_KEYS.filter((other) => other !== key && STATE_OF_PULSE[other] === state).flatMap((other) => sets.ids[other] ?? []);
  return others.length ? { AND: [base, { id: { notIn: others } }] } : base;
}
