import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { ACTIVITY_LABELS, ACTIVITY_TYPES, type ActivityTypeValue } from "@/lib/constants";
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
import { addDaysIso } from "@/lib/reports/period";
import { sellingReps } from "@/lib/reports/daily";

// Activity (Nov 10, 2026). Touches — calls, texts, emails and meetings a
// person logged — by day, kind and rep (Activity.userId). Marketing sends
// are on a contact's log too but are never a touch (Taylor, Nov 10), so
// they are their own series and never in the touch counts. "Not touched"
// is the people nobody logged a touch with in the period, by who owns
// them (Contact.ownerId) or by their industry, job title or state.

export type ActivityReport = {
  kind: "activity";
  // Touches are tries (Nov 11, 2026): every call, text, email or meeting
  // logged, each save once (COALESCE(batchId, id)), never a no-show or one
  // dated ahead. Talks are the tries that connected.
  touches: number;
  previousTouches: number;
  talks: number;
  previousTalks: number;
  // "Talks counted from": when outcomes started being recorded, if the
  // period starts before it.
  talksSince: string | null;
  byType: { type: ActivityTypeValue; label: string; count: number; previous: number }[];
  marketing: number;
  previousMarketing: number;
  peopleTouched: number;
  previousPeopleTouched: number;
  companiesTouched: number;
  // People in scope (not archived), and how many nobody touched.
  people: number;
  untouched: number;
  // Each bar of the chart: a day, or a week (from its Monday) past two months.
  series: { label: string; start: string; parts: number[]; talks: number; marketing: number }[];
  bucket: "day" | "week";
  groups: { key: string; name: string; touches: number; talks: number; parts: number[]; people: number; untouched: number }[];
  headlines: Headline[];
  table: SummaryTable;
};

export async function loadActivity(params: ReportParams): Promise<ActivityReport> {
  const { organizationId, repId, by, range, timeZone } = params;
  const touchGroup = groupSql(by, { rep: Prisma.sql`a."userId"` });
  const peopleGroup = groupSql(by, { rep: Prisma.sql`c."ownerId"` });
  const inWindow = Prisma.sql`a."occurredAt" >= ${range.from} AND a."occurredAt" < ${range.to}`;
  const inPrevious = Prisma.sql`a."occurredAt" >= ${range.previous.from} AND a."occurredAt" < ${range.previous.to}`;
  // A touch has happened and isn't a no-show (the health rule); a talk is
  // one that connected (isConnect). Each save counts once.
  const happened = Prisma.sql`a."occurredAt" <= now() AND a.outcome IS DISTINCT FROM 'NO_SHOW'`;
  const connect = Prisma.sql`(a.outcome IN ('TALKED', 'REPLIED', 'HELD') OR (a.type = 'MEETING' AND a.outcome IS NULL))`;
  const tid = Prisma.sql`COALESCE(a."batchId", a.id)`;

  const [totals, daily, touchGroups, reached, peopleGroups, members, org] = await Promise.all([
    // Marketing sends are counted as rows (one email each); touches by save.
    prisma.$queryRaw<
      { type: string; marketing: boolean; cur: number; prev: number; cur_talks: number; prev_talks: number }[]
    >`
      SELECT a.type::text AS type, a.marketing,
             CASE WHEN a.marketing THEN COUNT(*) FILTER (WHERE ${inWindow}) ELSE COUNT(DISTINCT ${tid}) FILTER (WHERE ${inWindow}) END::int AS cur,
             CASE WHEN a.marketing THEN COUNT(*) FILTER (WHERE ${inPrevious}) ELSE COUNT(DISTINCT ${tid}) FILTER (WHERE ${inPrevious}) END::int AS prev,
             COUNT(DISTINCT ${tid}) FILTER (WHERE ${inWindow} AND NOT a.marketing AND ${connect})::int AS cur_talks,
             COUNT(DISTINCT ${tid}) FILTER (WHERE ${inPrevious} AND NOT a.marketing AND ${connect})::int AS prev_talks
        FROM "Activity" a
       WHERE a."organizationId" = ${organizationId}
         AND a."occurredAt" >= ${range.previous.from} AND a."occurredAt" < ${range.to}
         AND (a.marketing OR ${happened})
         ${repFilter(Prisma.sql`a."userId"`, repId)}
       GROUP BY 1, 2`,
    prisma.$queryRaw<{ day: string; type: string; marketing: boolean; n: number; talks: number }[]>`
      SELECT to_char((a."occurredAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}, 'YYYY-MM-DD') AS day,
             a.type::text AS type, a.marketing,
             (CASE WHEN a.marketing THEN COUNT(*) ELSE COUNT(DISTINCT ${tid}) END)::int AS n,
             COUNT(DISTINCT ${tid}) FILTER (WHERE NOT a.marketing AND ${connect})::int AS talks
        FROM "Activity" a
       WHERE a."organizationId" = ${organizationId} AND ${inWindow}
         AND (a.marketing OR ${happened})
         ${repFilter(Prisma.sql`a."userId"`, repId)}
       GROUP BY 1, 2, 3`,
    // Touches per group, each save once in each group it reaches.
    prisma.$queryRaw<{ grp: string; type: string; n: number; talks: number }[]>`
      SELECT ${touchGroup} AS grp, a.type::text AS type, COUNT(DISTINCT ${tid})::int AS n,
             COUNT(DISTINCT ${tid}) FILTER (WHERE ${connect})::int AS talks
        FROM "Activity" a
        LEFT JOIN "Contact" c ON c.id = a."contactId"
        LEFT JOIN "Company" co ON co.id = COALESCE(c."companyId", a."companyId")
       WHERE a."organizationId" = ${organizationId} AND a.marketing = false AND ${inWindow} AND ${happened}
         ${repFilter(Prisma.sql`a."userId"`, repId)}
       GROUP BY 1, 2`,
    // The distinct people and companies reached.
    prisma.$queryRaw<{ people: number; companies: number; prev_people: number }[]>`
      SELECT COUNT(DISTINCT a."contactId") FILTER (WHERE ${inWindow})::int AS people,
             COUNT(DISTINCT COALESCE(c."companyId", a."companyId")) FILTER (WHERE ${inWindow})::int AS companies,
             COUNT(DISTINCT a."contactId") FILTER (WHERE ${inPrevious})::int AS prev_people
        FROM "Activity" a
        LEFT JOIN "Contact" c ON c.id = a."contactId"
       WHERE a."organizationId" = ${organizationId} AND a.marketing = false AND ${happened}
         AND a."occurredAt" >= ${range.previous.from} AND a."occurredAt" < ${range.to}
         ${repFilter(Prisma.sql`a."userId"`, repId)}`,
    // Everyone in scope, and whether anybody touched them in the period.
    prisma.$queryRaw<{ grp: string; people: number; untouched: number }[]>`
      WITH touched AS (
        SELECT DISTINCT a."contactId" AS id
          FROM "Activity" a
         WHERE a."organizationId" = ${organizationId} AND a.marketing = false
           AND a."contactId" IS NOT NULL AND ${inWindow} AND ${happened}
      )
      SELECT ${peopleGroup} AS grp, COUNT(*)::int AS people, COUNT(*) FILTER (WHERE t.id IS NULL)::int AS untouched
        FROM "Contact" c
        LEFT JOIN "Company" co ON co.id = c."companyId"
        LEFT JOIN touched t ON t.id = c.id
       WHERE c."organizationId" = ${organizationId} AND c.status <> 'ARCHIVED'
         ${repFilter(Prisma.sql`c."ownerId"`, repId)}
       GROUP BY 1`,
    loadTeam(organizationId),
    prisma.organization.findUnique({ where: { id: organizationId }, select: { outcomesSince: true } }),
  ]);

  const typeIndex = (type: string) => ACTIVITY_TYPES.indexOf(type as ActivityTypeValue);
  const byType = ACTIVITY_TYPES.map((type) => {
    const rows = totals.filter((row) => row.type === type && !row.marketing);
    return {
      type,
      label: ACTIVITY_LABELS[type],
      count: rows.reduce((sum, row) => sum + row.cur, 0),
      previous: rows.reduce((sum, row) => sum + row.prev, 0),
    };
  });
  const touches = byType.reduce((sum, row) => sum + row.count, 0);
  const previousTouches = byType.reduce((sum, row) => sum + row.previous, 0);
  const touchRows = totals.filter((row) => !row.marketing);
  const talks = touchRows.reduce((sum, row) => sum + row.cur_talks, 0);
  const previousTalks = touchRows.reduce((sum, row) => sum + row.prev_talks, 0);
  const since = org?.outcomesSince ?? null;
  const talksSince = since && range.from < since ? since.toISOString() : null;
  const marketing = totals.filter((row) => row.marketing).reduce((sum, row) => sum + row.cur, 0);
  const previousMarketing = totals.filter((row) => row.marketing).reduce((sum, row) => sum + row.prev, 0);

  // Day by day, or week by week past two months, every bucket present.
  const bucket: "day" | "week" = range.days.length > 62 ? "week" : "day";
  const keyFor = (day: string) => {
    if (bucket === "day") return day;
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
    return addDaysIso(day, -((weekday + 6) % 7));
  };
  const series = new Map<string, { label: string; start: string; parts: number[]; talks: number; marketing: number }>();
  for (const day of range.days) {
    const key = keyFor(day);
    if (!series.has(key)) series.set(key, { label: key, start: key, parts: ACTIVITY_TYPES.map(() => 0), talks: 0, marketing: 0 });
  }
  for (const row of daily) {
    const target = series.get(keyFor(row.day));
    if (!target) continue;
    if (row.marketing) target.marketing += row.n;
    else if (typeIndex(row.type) >= 0) {
      target.parts[typeIndex(row.type)] += row.n;
      target.talks += row.talks;
    }
  }

  const overall = reached[0];
  type G = ActivityReport["groups"][number];
  const groupMap = new Map<string, G>();
  const ensure = (key: string) => {
    let found = groupMap.get(key);
    if (!found) {
      found = { key, name: groupName(by, key, members), touches: 0, talks: 0, parts: ACTIVITY_TYPES.map(() => 0), people: 0, untouched: 0 };
      groupMap.set(key, found);
    }
    return found;
  };
  for (const row of touchGroups) {
    const target = ensure(row.grp);
    target.touches += row.n;
    target.talks += row.talks;
    if (typeIndex(row.type) >= 0) target.parts[typeIndex(row.type)] += row.n;
  }
  for (const row of peopleGroups) {
    const target = ensure(row.grp);
    target.people += row.people;
    target.untouched += row.untouched;
  }
  // On the Rep breakdown, every active teammate has a row even at zero.
  // Only teammates who sell (they own records or logged lately): an owner
  // with no book gets no zero row and is never "the fewest" (Round 2).
  if (by === "rep") {
    const selling = new Set((await sellingReps(organizationId, params.now)).map((row) => row.id));
    for (const member of members) if (!member.removed && selling.has(member.id) && (!repId || member.id === repId)) ensure(member.id);
    if (repId) ensure(repId);
  }
  const groups = topGroups(
    [...groupMap.values()],
    (row) => row.touches * 1_000_000 + row.untouched,
    (into, row) => {
      into.touches += row.touches;
      into.talks += row.talks;
      into.people += row.people;
      into.untouched += row.untouched;
      row.parts.forEach((value, index) => (into.parts[index] += value));
    },
    () => ({ key: OTHER_GROUP, name: "Everything else", touches: 0, talks: 0, parts: ACTIVITY_TYPES.map(() => 0), people: 0, untouched: 0 }),
  );

  const people = peopleGroups.reduce((sum, row) => sum + row.people, 0);
  const untouched = peopleGroups.reduce((sum, row) => sum + row.untouched, 0);
  const peopleTouched = num(overall?.people);
  const previousPeopleTouched = num(overall?.prev_people);
  const type = (key: ActivityTypeValue) => byType.find((row) => row.type === key)!;

  const headlines: Headline[] = [
    { id: "touches", label: "Tries", value: touches, previous: previousTouches, format: "count", hint: "Calls, texts, emails, meetings" },
    { id: "talks", label: "Talks", value: talks, previous: previousTalks, format: "count", hint: "Talked, replied or held" },
    {
      id: "connect-rate",
      label: "Connect rate",
      value: touches ? talks / touches : 0,
      previous: previousTouches ? previousTalks / previousTouches : undefined,
      format: "percent",
      empty: touches === 0,
      hint: "Talks ÷ tries",
    },
    { id: "people", label: "People reached", value: peopleTouched, previous: previousPeopleTouched, format: "count" },
    { id: "calls", label: "Calls", value: type("PHONE_CALL").count, previous: type("PHONE_CALL").previous, format: "count" },
    { id: "meetings", label: "Meetings", value: type("MEETING").count, previous: type("MEETING").previous, format: "count" },
    { id: "marketing", label: "Marketing emails", value: marketing, previous: previousMarketing, format: "count", hint: "Not counted as touches" },
    { id: "untouched", label: "Not touched", value: untouched, format: "count", goodWhenUp: false, hint: `of ${people.toLocaleString("en-US")} people` },
  ];

  const table: SummaryTable = {
    title: by === "rep" ? "By rep" : "Breakdown",
    columns: [
      { label: by === "rep" ? "Rep" : "Group", format: "text" },
      { label: "Tries", format: "count" },
      { label: "Talks", format: "count" },
      ...ACTIVITY_TYPES.map((key) => ({ label: ACTIVITY_LABELS[key], format: "count" as const })),
      { label: "Not touched", format: "count" },
    ],
    rows: groups.map((row) => [row.name, row.touches, row.talks, ...row.parts, row.untouched]),
  };

  return {
    kind: "activity",
    touches,
    previousTouches,
    talks,
    previousTalks,
    talksSince,
    byType,
    marketing,
    previousMarketing,
    peopleTouched,
    previousPeopleTouched,
    companiesTouched: num(overall?.companies),
    people,
    untouched,
    series: [...series.values()],
    bucket,
    groups,
    headlines,
    table,
  };
}
