import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { owedRowsSql } from "@/lib/money";
import { OVERDUE_TYPES } from "@/lib/calendar-data";
import { opportunityColumn } from "@/lib/opportunities";
import {
  leadHealth,
  nextKindOf,
  rollUpCompany,
  zoneDay,
  zoneTime,
  TALK_STATUSES,
  type CompanyHealth,
  type HealthContext,
  type HealthInput,
  type LeadHealth,
  type StatusMove,
} from "@/lib/health";

// Health for a page of rows (BDR redesign, Nov 11, 2026), batched: a page
// of contacts, companies or opportunities costs two or three grouped
// statements, never one per row. Every statement is scoped to the
// workspace. What it reads, per row:
// - touches (calls, texts, emails, meetings dated now or earlier; never a
//   marketing send or a no-show), counted once per batch with
//   COALESCE(batchId, id): tries, talks, meetings, by type, first and last
//   touch, first and last connect, who touched last, tries since the last
//   talk; the status changes (step dates, the talk stand-in, a closed
//   record's reason);
// - the soonest thing booked (an open calendar entry today or later, a
//   touch dated ahead, a meeting on their opportunity), the follow-ups
//   gone late, the latest past meeting and whether anyone marked it;
//   quotes and contracts out for an answer; signed money owed and late
//   (owedRowsSql, the rows the Owed to you tile adds up).
// The rules themselves are leadHealth() in src/lib/health.ts.

export type HealthSettings = { timeZone: string; quietDays: number; parkAfterTries: number };

export async function healthSettings(organizationId: string): Promise<HealthSettings> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { timeZone: true, quietDays: true, parkAfterTries: true },
  });
  return {
    timeZone: org?.timeZone ?? "America/Chicago",
    quietDays: org?.quietDays ?? 8,
    parkAfterTries: org?.parkAfterTries ?? 6,
  };
}

type Options = { settings?: HealthSettings; now?: Date };

function context(settings: HealthSettings, now: Date): HealthContext {
  return { now, timeZone: settings.timeZone, quietDays: settings.quietDays, parkAfterTries: settings.parkAfterTries };
}

/* ------------------------------ Shared SQL ------------------------------ */

const CONNECT = Prisma.sql`(a.outcome IN ('TALKED', 'REPLIED', 'HELD') OR (a.type = 'MEETING' AND a.outcome IS NULL))`;
const TOUCH = Prisma.sql`a.marketing = false AND a."occurredAt" <= now() AND a.outcome IS DISTINCT FROM 'NO_SHOW'`;

type TouchRow = {
  key: string;
  tries: number | null;
  talks: number | null;
  meetings: number | null;
  calls: number | null;
  texts: number | null;
  emails: number | null;
  first_touch: Date | null;
  last_touch: Date | null;
  first_connect: Date | null;
  last_connect: Date | null;
  last_by: string | null;
  last_by_name: string | null;
  status_talk: Date | null;
  changes: { to: string; on: number; by: string | null; auto: boolean; reason: string | null }[] | null;
  since: number | null;
};

// Statement one: touches and status changes. `keys` is the rows asked
// for (a column `key`, plus whatever the caller wants back), `map` pairs
// each key with the people whose touches it reads (key, contact_id).
function touchSql(organizationId: string, keys: Prisma.Sql, map: Prisma.Sql, extraSelect: Prisma.Sql = Prisma.empty) {
  return Prisma.sql`
    WITH keys AS (${keys}),
    map AS (${map}),
    acts AS (
      SELECT m.key, COALESCE(a."batchId", a.id) AS tid, MAX(a."occurredAt") AS at,
             bool_or(${CONNECT}) AS connect, MAX(a.type::text) AS type, (array_agg(a."userId"))[1] AS user_id
        FROM map m
        JOIN "Activity" a ON a."contactId" = m.contact_id
       WHERE a."organizationId" = ${organizationId} AND ${TOUCH}
       GROUP BY 1, 2
    ),
    agg AS (
      SELECT key,
             COUNT(*)::int AS tries,
             COUNT(*) FILTER (WHERE connect)::int AS talks,
             COUNT(*) FILTER (WHERE type = 'MEETING')::int AS meetings,
             COUNT(*) FILTER (WHERE type = 'PHONE_CALL')::int AS calls,
             COUNT(*) FILTER (WHERE type = 'TEXT')::int AS texts,
             COUNT(*) FILTER (WHERE type = 'EMAIL')::int AS emails,
             MIN(at) AS first_touch, MAX(at) AS last_touch,
             MIN(at) FILTER (WHERE connect) AS first_connect,
             MAX(at) FILTER (WHERE connect) AS last_connect,
             (array_agg(user_id ORDER BY at DESC))[1] AS last_by
        FROM acts
       GROUP BY key
    ),
    sc AS (
      SELECT m.key,
             MAX(s."on") FILTER (WHERE s."toStatus" IN (${Prisma.join([...TALK_STATUSES])}) AND s."on" <= now()) AS status_talk,
             json_agg(json_build_object(
               'to', s."toStatus", 'on', (extract(epoch FROM s."on") * 1000)::bigint,
               'by', u.name, 'auto', s.auto, 'reason', s.reason
             ) ORDER BY s."on", s."createdAt") AS changes
        FROM map m
        JOIN "StatusChange" s ON s."contactId" = m.contact_id AND s."organizationId" = ${organizationId}
        LEFT JOIN "User" u ON u.id = s."userId"
       GROUP BY m.key
    ),
    talk AS (
      SELECT k.key, GREATEST(agg.last_connect, sc.status_talk) AS at
        FROM keys k
        LEFT JOIN agg ON agg.key = k.key
        LEFT JOIN sc ON sc.key = k.key
    ),
    since AS (
      SELECT acts.key, COUNT(*)::int AS n
        FROM acts
        JOIN talk ON talk.key = acts.key
       WHERE talk.at IS NOT NULL AND acts.at > talk.at
       GROUP BY acts.key
    )
    SELECT k.*, agg.tries, agg.talks, agg.meetings, agg.calls, agg.texts, agg.emails,
           agg.first_touch, agg.last_touch, agg.first_connect, agg.last_connect,
           agg.last_by, lu.name AS last_by_name,
           sc.status_talk, sc.changes, since.n AS since
           ${extraSelect}
      FROM keys k
      LEFT JOIN agg ON agg.key = k.key
      LEFT JOIN sc ON sc.key = k.key
      LEFT JOIN since ON since.key = k.key
      LEFT JOIN "User" lu ON lu.id = agg.last_by`;
}

type BookRow = {
  key: string;
  next_on: Date | null;
  next_time: string | null;
  next_type: string | null;
  late_n: number | null;
  late_oldest: Date | null;
  ahead_at: Date | null;
  ahead_type: string | null;
  om_next: Date | null;
  om_next_untimed: boolean | null;
  meet_at: Date | null;
  meet_marked: boolean | null;
  meet_noshow: boolean | null;
  paper: { kind: "quote" | "contract"; at: number }[] | null;
  billed: bigint | number | string | null;
  received: bigint | number | string | null;
  late: bigint | number | string | null;
  oldest_late: Date | null;
};

// Statement two: what is booked, what is late, the latest meeting,
// paperwork out, money owed. `oppMap` pairs each key with the
// opportunities whose meetings it reads (key, opp_id); `extraEvents` and
// `paper` add rows to the calendar and paperwork reads; `owedJoin` ties a
// signed contract (c) to its key in `keys` (k).
function bookSql(
  organizationId: string,
  today: string,
  parts: { keys: Prisma.Sql; map: Prisma.Sql; oppMap: Prisma.Sql; extraEvents?: Prisma.Sql; paper: Prisma.Sql; owedJoin: Prisma.Sql },
) {
  return Prisma.sql`
    WITH keys AS (${parts.keys}),
    map AS (${parts.map}),
    oppmap AS (${parts.oppMap}),
    ev AS (
      SELECT m.key, e.id, e.type, e."startOn", e."endOn", e."startTime"
        FROM map m
        JOIN "CalendarEvent" e ON e."contactId" = m.contact_id
       WHERE e."organizationId" = ${organizationId} AND e."doneAt" IS NULL
      UNION
      SELECT m.key, e.id, e.type, e."startOn", e."endOn", e."startTime"
        FROM map m
        JOIN "_EventAttendees" ea ON ea."B" = m.contact_id
        JOIN "CalendarEvent" e ON e.id = ea."A"
       WHERE e."organizationId" = ${organizationId} AND e."doneAt" IS NULL
      ${parts.extraEvents ?? Prisma.empty}
    ),
    ev_next AS (
      SELECT DISTINCT ON (key) key, GREATEST("startOn", ${today}::date) AS day, "startTime" AS time, type
        FROM ev
       WHERE "startOn" >= ${today}::date OR "endOn" >= ${today}::date
       ORDER BY key, GREATEST("startOn", ${today}::date), "startTime" NULLS LAST
    ),
    ev_late AS (
      SELECT key, COUNT(*)::int AS n, MIN("startOn") AS oldest
        FROM ev
       WHERE type IN (${Prisma.join(OVERDUE_TYPES)})
         AND "startOn" < ${today}::date AND ("endOn" IS NULL OR "endOn" < ${today}::date)
       GROUP BY key
    ),
    ahead AS (
      SELECT DISTINCT ON (m.key) m.key, a."occurredAt" AS at, a.type::text AS type
        FROM map m
        JOIN "Activity" a ON a."contactId" = m.contact_id
       WHERE a."organizationId" = ${organizationId} AND a.marketing = false AND a."occurredAt" > now()
       ORDER BY m.key, a."occurredAt"
    ),
    om AS (
      SELECT DISTINCT x.key, om.id, om."on", om.outcome::text AS outcome, act.outcome::text AS act_outcome,
             (oe.id IS NOT NULL AND oe."startTime" IS NULL) AS untimed
        FROM oppmap x
        JOIN "Opportunity" o ON o.id = x.opp_id AND o."organizationId" = ${organizationId}
        JOIN "OpportunityMeeting" om ON om."opportunityId" = o.id
        LEFT JOIN "Activity" act ON act.id = om."activityId"
        LEFT JOIN "CalendarEvent" oe ON oe.id = om."eventId"
    ),
    -- A meeting ahead that is already answered (held early) books nothing.
    -- A meeting booked with no time is kept at noon; it says no time.
    om_next AS (
      SELECT DISTINCT ON (key) key, "on" AS at, untimed FROM om
       WHERE "on" > now() AND outcome IS NULL AND (act_outcome IS NULL OR act_outcome NOT IN ('HELD', 'NO_SHOW'))
       ORDER BY key, "on", untimed
    ),
    lastmeet AS (
      SELECT DISTINCT ON (key) key, at, marked, noshow FROM (
        SELECT key, "on" AS at, (outcome IS NOT NULL OR COALESCE(act_outcome IN ('HELD', 'NO_SHOW'), false)) AS marked,
               COALESCE(outcome::text, act_outcome) IS NOT DISTINCT FROM 'NO_SHOW' AS noshow
          FROM om WHERE "on" <= now()
        UNION ALL
        SELECT m.key, a."occurredAt", COALESCE(a.outcome IN ('HELD', 'NO_SHOW'), false), a.outcome IS NOT DISTINCT FROM 'NO_SHOW'
          FROM map m
          JOIN "Activity" a ON a."contactId" = m.contact_id
         WHERE a."organizationId" = ${organizationId} AND a.marketing = false AND a.type = 'MEETING' AND a."occurredAt" <= now()
      ) x
      ORDER BY key, at DESC, marked DESC
    ),
    paper AS (${parts.paper}),
    paper_agg AS (
      SELECT key, json_agg(json_build_object('kind', kind, 'at', (extract(epoch FROM sent_at) * 1000)::bigint)) AS items
        FROM paper GROUP BY key
    ),
    owed AS (
      SELECT k.key,
             SUM(cp."amountCents")::bigint AS billed,
             COALESCE(SUM(paid.total), 0)::bigint AS received,
             COALESCE(SUM(GREATEST(cp."amountCents" - COALESCE(paid.total, 0), 0)) FILTER (
               WHERE cp."paidAt" IS NULL AND cp."amountCents" > 0 AND cp."dueOn" < ${today}::date
             ), 0)::bigint AS late,
             MIN(cp."dueOn") FILTER (
               WHERE cp."paidAt" IS NULL AND cp."amountCents" > 0 AND cp."dueOn" < ${today}::date
             ) AS oldest_late
      ${owedRowsSql(organizationId, parts.owedJoin)}
       GROUP BY k.key
    )
    SELECT k.key,
           ev_next.day AS next_on, ev_next.time AS next_time, ev_next.type AS next_type,
           ev_late.n AS late_n, ev_late.oldest AS late_oldest,
           ahead.at AS ahead_at, ahead.type AS ahead_type,
           om_next.at AS om_next, om_next.untimed AS om_next_untimed,
           lastmeet.at AS meet_at, lastmeet.marked AS meet_marked, lastmeet.noshow AS meet_noshow,
           paper_agg.items AS paper,
           owed.billed, owed.received, owed.late, owed.oldest_late
      FROM keys k
      LEFT JOIN ev_next ON ev_next.key = k.key
      LEFT JOIN ev_late ON ev_late.key = k.key
      LEFT JOIN ahead ON ahead.key = k.key
      LEFT JOIN om_next ON om_next.key = k.key
      LEFT JOIN lastmeet ON lastmeet.key = k.key
      LEFT JOIN paper_agg ON paper_agg.key = k.key
      LEFT JOIN owed ON owed.key = k.key`;
}

const ACTIVITY_KIND: Record<string, string> = { MEETING: "meeting", PHONE_CALL: "call", TEXT: "text", EMAIL: "email" };

function iso(date: Date | null) {
  return date ? date.toISOString().slice(0, 10) : null;
}

function num(value: bigint | number | string | null | undefined) {
  return value === null || value === undefined ? 0 : Number(value);
}

// The two statements' rows for one key, as leadHealth's input (less the
// status and the changes, which differ by kind of row).
function inputFrom(
  touch: TouchRow | undefined,
  book: BookRow | undefined,
  settings: HealthSettings,
): Omit<HealthInput, "status" | "changes"> {
  const tz = settings.timeZone;
  const candidates: { on: string; time: string | null; kind: string }[] = [];
  if (book?.next_on) candidates.push({ on: iso(book.next_on)!, time: book.next_time, kind: nextKindOf(book.next_type ?? "") });
  if (book?.ahead_at)
    candidates.push({ on: zoneDay(book.ahead_at, tz), time: zoneTime(book.ahead_at, tz), kind: ACTIVITY_KIND[book.ahead_type ?? ""] ?? "touch" });
  if (book?.om_next)
    candidates.push({ on: zoneDay(book.om_next, tz), time: book.om_next_untimed ? null : zoneTime(book.om_next, tz), kind: "meeting" });
  candidates.sort((a, b) => `${a.on} ${a.time ?? "99:99"}`.localeCompare(`${b.on} ${b.time ?? "99:99"}`));

  const owedBilled = num(book?.billed);
  return {
    tries: touch?.tries ?? 0,
    talks: touch?.talks ?? 0,
    meetings: touch?.meetings ?? 0,
    byType: {
      calls: touch?.calls ?? 0,
      texts: touch?.texts ?? 0,
      emails: touch?.emails ?? 0,
      meetings: touch?.meetings ?? 0,
    },
    firstTouchAt: touch?.first_touch ?? null,
    lastTouchAt: touch?.last_touch ?? null,
    lastTouchBy: touch?.last_by ? { id: touch.last_by, name: touch.last_by_name ?? "" } : null,
    firstConnectAt: touch?.first_connect ?? null,
    lastConnectAt: touch?.last_connect ?? null,
    statusTalkAt: touch?.status_talk ?? null,
    triesSinceTalk: touch?.since ?? 0,
    next: candidates[0] ?? null,
    overdue: book?.late_n ? { count: book.late_n, oldestOn: iso(book.late_oldest)! } : null,
    lastMeeting: book?.meet_at ? { at: book.meet_at, marked: Boolean(book.meet_marked), noShow: Boolean(book.meet_noshow) } : null,
    paperwork: (book?.paper ?? []).map((paper) => ({ kind: paper.kind, sentAt: new Date(Number(paper.at)) })),
    owed:
      owedBilled > 0 || num(book?.late) > 0
        ? { billedCents: owedBilled, receivedCents: num(book?.received), lateCents: num(book?.late), oldestLateOn: iso(book?.oldest_late ?? null) }
        : null,
  };
}

function movesFrom(changes: TouchRow["changes"]): StatusMove[] {
  return (changes ?? []).map((change) => ({
    to: change.to,
    on: new Date(Number(change.on)),
    by: change.by,
    auto: Boolean(change.auto),
    reason: change.reason,
  }));
}

/* -------------------------------- Contacts -------------------------------- */

type ContactKeyRow = TouchRow & { status: string; created_at: Date; company_name: string | null };

// Health for a page of contacts: two grouped statements (plus the
// workspace's settings when not passed in). Ids outside the workspace are
// left out of the map.
export async function loadContactHealth(
  organizationId: string,
  contactIds: string[],
  options: Options = {},
): Promise<Map<string, LeadHealth>> {
  const ids = Array.from(new Set(contactIds));
  const result = new Map<string, LeadHealth>();
  if (ids.length === 0) return result;
  const settings = options.settings ?? (await healthSettings(organizationId));
  const now = options.now ?? new Date();
  const today = zoneDay(now, settings.timeZone);

  const keys = Prisma.sql`
    SELECT c.id AS key, c.status::text AS status, c."createdAt" AS created_at, co.name AS company_name
      FROM "Contact" c
      LEFT JOIN "Company" co ON co.id = c."companyId"
     WHERE c."organizationId" = ${organizationId} AND c.id = ANY(${ids})`;
  const map = Prisma.sql`SELECT key, key AS contact_id FROM keys`;
  const [touchRows, bookRows] = await Promise.all([
    prisma.$queryRaw<ContactKeyRow[]>(touchSql(organizationId, keys, map)),
    prisma.$queryRaw<BookRow[]>(
      bookSql(organizationId, today, {
        keys: Prisma.sql`SELECT c.id AS key FROM "Contact" c WHERE c."organizationId" = ${organizationId} AND c.id = ANY(${ids})`,
        map,
        oppMap: Prisma.sql`
          SELECT m.key, oc."opportunityId" AS opp_id
            FROM map m
            JOIN "OpportunityContact" oc ON oc."contactId" = m.contact_id AND oc.role <> 'HIDDEN'`,
        paper: Prisma.sql`
          SELECT m.key, 'quote' AS kind, q."sentAt" AS sent_at
            FROM map m
            JOIN "Quote" q ON q."contactId" = m.contact_id
           WHERE q."organizationId" = ${organizationId} AND q.status = 'SENT' AND q."sentAt" IS NOT NULL
          UNION ALL
          SELECT m.key, 'contract' AS kind, c."sentAt" AS sent_at
            FROM map m
            JOIN "Contract" c ON c."contactId" = m.contact_id
           WHERE c."organizationId" = ${organizationId} AND c.status = 'SENT' AND c.payable = false AND c."sentAt" IS NOT NULL`,
        owedJoin: Prisma.sql`JOIN keys k ON k.key = c."contactId"`,
      }),
    ),
  ]);

  const books = new Map(bookRows.map((row) => [row.key, row]));
  const ctx = context(settings, now);
  for (const row of touchRows) {
    const input: HealthInput = {
      ...inputFrom(row, books.get(row.key), settings),
      status: row.status,
      companyName: row.company_name,
      createdAt: row.created_at,
      changes: movesFrom(row.changes),
    };
    result.set(row.key, leadHealth(input, ctx));
  }
  return result;
}

// One contact's health, for a contact page header.
export async function contactHealth(organizationId: string, contactId: string, options: Options = {}) {
  return (await loadContactHealth(organizationId, [contactId], options)).get(contactId) ?? null;
}

/* -------------------------------- Companies -------------------------------- */

// How many of a company's people are read for its warmest one: the most
// recently touched. "n of m reached" still counts everybody.
const COMPANY_PEOPLE_CAP = 100;

type CompanyRow = {
  key: string;
  status: string;
  name: string;
  created_at: Date;
  total: number | null;
  reached: number | null;
  ids: string[] | null;
  tries: number | null;
  talks: number | null;
  meetings: number | null;
  calls: number | null;
  texts: number | null;
  emails: number | null;
  first_touch: Date | null;
  last_touch: Date | null;
  first_connect: Date | null;
  last_connect: Date | null;
  last_by: string | null;
  last_by_name: string | null;
  billed: bigint | number | string | null;
  received: bigint | number | string | null;
  late: bigint | number | string | null;
  oldest_late: Date | null;
};

const REACHED_PEOPLE = ["CONNECTED", "INTERESTED", "NOT_INTERESTED", "MEETING_SET", "MEETING_COMPLETED", "QUOTE_SENT", "CONTRACT_SENT", "WON"];

// Health for a page of companies. One statement for the companies
// themselves (their people counted, "n of m reached", company-wide touches
// counted once per batch including calls to the main line, money owed),
// then their people's health in the contacts' two statements. A company
// wears its warmest person's health (rollUpCompany).
export async function loadCompanyHealth(
  organizationId: string,
  companyIds: string[],
  options: Options = {},
): Promise<Map<string, CompanyHealth>> {
  const ids = Array.from(new Set(companyIds));
  const result = new Map<string, CompanyHealth>();
  if (ids.length === 0) return result;
  const settings = options.settings ?? (await healthSettings(organizationId));
  const now = options.now ?? new Date();
  const today = zoneDay(now, settings.timeZone);

  const rows = await prisma.$queryRaw<CompanyRow[]>`
    WITH keys AS (
      SELECT co.id AS key, co.status::text AS status, co.name, co."createdAt" AS created_at
        FROM "Company" co
       WHERE co."organizationId" = ${organizationId} AND co.id = ANY(${ids})
    ),
    people AS (
      SELECT k.key, ct.id, ct.status::text AS status, ct."lastTouchAt" AS last_touch
        FROM keys k
        JOIN "Contact" ct ON ct."companyId" = k.key AND ct."organizationId" = ${organizationId}
    ),
    people_agg AS (
      SELECT p.key, COUNT(*)::int AS total,
             COUNT(*) FILTER (
               WHERE p.status IN (${Prisma.join(REACHED_PEOPLE)})
                  OR EXISTS (
                    SELECT 1 FROM "Activity" a
                     WHERE a."contactId" = p.id AND a."organizationId" = ${organizationId} AND ${TOUCH} AND ${CONNECT}
                  )
             )::int AS reached,
             (array_agg(p.id ORDER BY p.last_touch DESC NULLS LAST, p.id))[1:${Prisma.raw(String(COMPANY_PEOPLE_CAP))}] AS ids
        FROM people p
       GROUP BY p.key
    ),
    raw AS (
      SELECT k.key, COALESCE(a."batchId", a.id) AS tid, a."occurredAt" AS at, ${CONNECT} AS connect, a.type::text AS type, a."userId" AS user_id
        FROM keys k
        JOIN "Activity" a ON a."companyId" = k.key
       WHERE a."organizationId" = ${organizationId} AND ${TOUCH}
      UNION ALL
      SELECT p.key, COALESCE(a."batchId", a.id), a."occurredAt", ${CONNECT}, a.type::text, a."userId"
        FROM people p
        JOIN "Activity" a ON a."contactId" = p.id
       WHERE a."organizationId" = ${organizationId} AND ${TOUCH}
    ),
    acts AS (
      SELECT key, tid, MAX(at) AS at, bool_or(connect) AS connect, MAX(type) AS type, (array_agg(user_id))[1] AS user_id
        FROM raw GROUP BY key, tid
    ),
    agg AS (
      SELECT key,
             COUNT(*)::int AS tries,
             COUNT(*) FILTER (WHERE connect)::int AS talks,
             COUNT(*) FILTER (WHERE type = 'MEETING')::int AS meetings,
             COUNT(*) FILTER (WHERE type = 'PHONE_CALL')::int AS calls,
             COUNT(*) FILTER (WHERE type = 'TEXT')::int AS texts,
             COUNT(*) FILTER (WHERE type = 'EMAIL')::int AS emails,
             MIN(at) AS first_touch, MAX(at) AS last_touch,
             MIN(at) FILTER (WHERE connect) AS first_connect,
             MAX(at) FILTER (WHERE connect) AS last_connect,
             (array_agg(user_id ORDER BY at DESC))[1] AS last_by
        FROM acts GROUP BY key
    ),
    owed AS (
      SELECT k.key,
             SUM(cp."amountCents")::bigint AS billed,
             COALESCE(SUM(paid.total), 0)::bigint AS received,
             COALESCE(SUM(GREATEST(cp."amountCents" - COALESCE(paid.total, 0), 0)) FILTER (
               WHERE cp."paidAt" IS NULL AND cp."amountCents" > 0 AND cp."dueOn" < ${today}::date
             ), 0)::bigint AS late,
             MIN(cp."dueOn") FILTER (
               WHERE cp."paidAt" IS NULL AND cp."amountCents" > 0 AND cp."dueOn" < ${today}::date
             ) AS oldest_late
      ${owedRowsSql(organizationId, Prisma.sql`JOIN keys k ON k.key = c."companyId"`)}
       GROUP BY k.key
    )
    SELECT k.*, pa.total, pa.reached, pa.ids,
           agg.tries, agg.talks, agg.meetings, agg.calls, agg.texts, agg.emails,
           agg.first_touch, agg.last_touch, agg.first_connect, agg.last_connect,
           agg.last_by, lu.name AS last_by_name,
           owed.billed, owed.received, owed.late, owed.oldest_late
      FROM keys k
      LEFT JOIN people_agg pa ON pa.key = k.key
      LEFT JOIN agg ON agg.key = k.key
      LEFT JOIN "User" lu ON lu.id = agg.last_by
      LEFT JOIN owed ON owed.key = k.key`;

  const peopleIds = rows.flatMap((row) => row.ids ?? []);
  const people = await loadContactHealth(organizationId, peopleIds, { settings, now });
  const ctx = context(settings, now);
  for (const row of rows) {
    const billed = num(row.billed);
    const late = num(row.late);
    const own = leadHealth(
      {
        status: row.status,
        companyName: row.name,
        createdAt: row.created_at,
        tries: row.tries ?? 0,
        talks: row.talks ?? 0,
        meetings: row.meetings ?? 0,
        byType: { calls: row.calls ?? 0, texts: row.texts ?? 0, emails: row.emails ?? 0, meetings: row.meetings ?? 0 },
        firstTouchAt: row.first_touch,
        lastTouchAt: row.last_touch,
        lastTouchBy: row.last_by ? { id: row.last_by, name: row.last_by_name ?? "" } : null,
        firstConnectAt: row.first_connect,
        lastConnectAt: row.last_connect,
        statusTalkAt: null,
        triesSinceTalk: 0,
        next: null,
        overdue: null,
        lastMeeting: null,
        paperwork: [],
        owed:
          billed > 0 || late > 0
            ? { billedCents: billed, receivedCents: num(row.received), lateCents: late, oldestLateOn: iso(row.oldest_late) }
            : null,
        changes: [],
      },
      ctx,
    );
    const list = (row.ids ?? []).flatMap((id) => {
      const health = people.get(id);
      return health ? [{ id, health }] : [];
    });
    result.set(row.key, rollUpCompany(own, list, { reached: row.reached ?? 0, people: row.total ?? 0 }));
  }
  return result;
}

export async function companyHealth(organizationId: string, companyId: string, options: Options = {}) {
  return (await loadCompanyHealth(organizationId, [companyId], options)).get(companyId) ?? null;
}

/* ------------------------------ Opportunities ------------------------------ */

type OppKeyRow = TouchRow & {
  opp_stage: string;
  deal_id: string | null;
  deal_stage: string | null;
  created_at: Date;
  completed_at: Date | null;
  deal_changes: { to: string; on: number; by: string | null; auto: boolean; reason: string | null }[] | null;
};

// Health for a page of Pipeline tiles. A tile reads its listed people
// (never Do Not List) as one: their touches counted once per batch, their
// calendar, the opportunity's own meetings and its deal's calendar
// entries; the paperwork is the deal's, and so is the money. The meter
// follows the tile's column; its dates are the opportunity's own (made,
// completed) and its deal's status changes.
export async function loadOpportunityHealth(
  organizationId: string,
  opportunityIds: string[],
  options: Options = {},
): Promise<Map<string, LeadHealth>> {
  const ids = Array.from(new Set(opportunityIds));
  const result = new Map<string, LeadHealth>();
  if (ids.length === 0) return result;
  const settings = options.settings ?? (await healthSettings(organizationId));
  const now = options.now ?? new Date();
  const today = zoneDay(now, settings.timeZone);

  const keys = Prisma.sql`
    SELECT o.id AS key, o.stage::text AS opp_stage, o."dealId" AS deal_id, d.stage::text AS deal_stage,
           o."createdAt" AS created_at, o."completedAt" AS completed_at
      FROM "Opportunity" o
      LEFT JOIN "Deal" d ON d.id = o."dealId"
     WHERE o."organizationId" = ${organizationId} AND o.id = ANY(${ids})`;
  const map = Prisma.sql`
    SELECT oc."opportunityId" AS key, oc."contactId" AS contact_id
      FROM "OpportunityContact" oc
      JOIN keys k ON k.key = oc."opportunityId"
     WHERE oc.role <> 'HIDDEN'`;
  const dealChanges = Prisma.sql`,
    (SELECT json_agg(json_build_object(
              'to', s."toStatus", 'on', (extract(epoch FROM s."on") * 1000)::bigint,
              'by', u.name, 'auto', s.auto, 'reason', s.reason
            ) ORDER BY s."on", s."createdAt")
       FROM "StatusChange" s
       LEFT JOIN "User" u ON u.id = s."userId"
      WHERE s."dealId" = k.deal_id AND s."organizationId" = ${organizationId}) AS deal_changes`;

  const [touchRows, bookRows] = await Promise.all([
    prisma.$queryRaw<OppKeyRow[]>(touchSql(organizationId, keys, map, dealChanges)),
    prisma.$queryRaw<BookRow[]>(
      bookSql(organizationId, today, {
        keys,
        map,
        oppMap: Prisma.sql`SELECT key, key AS opp_id FROM keys`,
        extraEvents: Prisma.sql`
          UNION
          SELECT k.key, e.id, e.type, e."startOn", e."endOn", e."startTime"
            FROM keys k
            JOIN "CalendarEvent" e ON e."dealId" = k.deal_id
           WHERE e."organizationId" = ${organizationId} AND e."doneAt" IS NULL`,
        paper: Prisma.sql`
          SELECT k.key, 'quote' AS kind, q."sentAt" AS sent_at
            FROM keys k
            JOIN "Quote" q ON q."dealId" = k.deal_id
           WHERE q."organizationId" = ${organizationId} AND q.status = 'SENT' AND q."sentAt" IS NOT NULL
          UNION ALL
          SELECT k.key, 'contract' AS kind, c."sentAt" AS sent_at
            FROM keys k
            JOIN "Contract" c ON c."dealId" = k.deal_id
           WHERE c."organizationId" = ${organizationId} AND c.status = 'SENT' AND c.payable = false AND c."sentAt" IS NOT NULL`,
        owedJoin: Prisma.sql`JOIN keys k ON k.deal_id = c."dealId"`,
      }),
    ),
  ]);

  const books = new Map(bookRows.map((row) => [row.key, row]));
  const ctx = context(settings, now);
  for (const row of touchRows) {
    const column = opportunityColumn({ stage: row.opp_stage, deal: row.deal_stage ? { stage: row.deal_stage } : null });
    // The tile's own history: made at Meeting Set, completed, then what
    // its deal went through. The people's own ladder moves still stand in
    // for a talk (statusTalkAt), but never date the tile's steps.
    const changes: StatusMove[] = [
      { to: "MEETING_SET", on: row.created_at, by: null, auto: true, reason: null },
      ...(row.completed_at ? [{ to: "MEETING_COMPLETED", on: row.completed_at, by: null, auto: true, reason: null }] : []),
      ...movesFrom(row.deal_changes).filter((change) => ["QUOTE_SENT", "CONTRACT_SENT", "WON", "LOST", "ARCHIVED"].includes(change.to)),
    ];
    const input: HealthInput = {
      ...inputFrom(row, books.get(row.key), settings),
      status: column,
      changes,
    };
    result.set(row.key, leadHealth(input, ctx));
  }
  return result;
}

export async function opportunityHealth(organizationId: string, opportunityId: string, options: Options = {}) {
  return (await loadOpportunityHealth(organizationId, [opportunityId], options)).get(opportunityId) ?? null;
}
