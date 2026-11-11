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

// Activity (Nov 10, 2026). Touches — calls, texts, emails and meetings a
// person logged — by day, kind and rep (Activity.userId). Marketing sends
// are on a contact's log too but are never a touch (Taylor, Nov 10), so
// they are their own series and never in the touch counts. "Not touched"
// is the people nobody logged a touch with in the period, by who owns
// them (Contact.ownerId) or by their industry, job title or state.

export type ActivityReport = {
  kind: "activity";
  touches: number;
  previousTouches: number;
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
  series: { label: string; start: string; parts: number[]; marketing: number }[];
  bucket: "day" | "week";
  groups: { key: string; name: string; touches: number; parts: number[]; people: number; untouched: number }[];
  headlines: Headline[];
  table: SummaryTable;
};

export async function loadActivity(params: ReportParams): Promise<ActivityReport> {
  const { organizationId, repId, by, range, timeZone } = params;
  const touchGroup = groupSql(by, { rep: Prisma.sql`a."userId"` });
  const peopleGroup = groupSql(by, { rep: Prisma.sql`c."ownerId"` });
  const inWindow = Prisma.sql`a."occurredAt" >= ${range.from} AND a."occurredAt" < ${range.to}`;
  const inPrevious = Prisma.sql`a."occurredAt" >= ${range.previous.from} AND a."occurredAt" < ${range.previous.to}`;

  const [totals, daily, touchGroups, reached, peopleGroups, members] = await Promise.all([
    prisma.$queryRaw<
      { type: string; marketing: boolean; cur: number; prev: number }[]
    >`
      SELECT a.type::text AS type, a.marketing,
             COUNT(*) FILTER (WHERE ${inWindow})::int AS cur,
             COUNT(*) FILTER (WHERE ${inPrevious})::int AS prev
        FROM "Activity" a
       WHERE a."organizationId" = ${organizationId}
         AND a."occurredAt" >= ${range.previous.from} AND a."occurredAt" < ${range.to}
         ${repFilter(Prisma.sql`a."userId"`, repId)}
       GROUP BY 1, 2`,
    prisma.$queryRaw<{ day: string; type: string; marketing: boolean; n: number }[]>`
      SELECT to_char((a."occurredAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}, 'YYYY-MM-DD') AS day,
             a.type::text AS type, a.marketing, COUNT(*)::int AS n
        FROM "Activity" a
       WHERE a."organizationId" = ${organizationId} AND ${inWindow}
         ${repFilter(Prisma.sql`a."userId"`, repId)}
       GROUP BY 1, 2, 3`,
    // Touches per group.
    prisma.$queryRaw<{ grp: string; type: string; n: number }[]>`
      SELECT ${touchGroup} AS grp, a.type::text AS type, COUNT(*)::int AS n
        FROM "Activity" a
        LEFT JOIN "Contact" c ON c.id = a."contactId"
        LEFT JOIN "Company" co ON co.id = COALESCE(c."companyId", a."companyId")
       WHERE a."organizationId" = ${organizationId} AND a.marketing = false AND ${inWindow}
         ${repFilter(Prisma.sql`a."userId"`, repId)}
       GROUP BY 1, 2`,
    // The distinct people and companies reached.
    prisma.$queryRaw<{ people: number; companies: number; prev_people: number }[]>`
      SELECT COUNT(DISTINCT a."contactId") FILTER (WHERE ${inWindow})::int AS people,
             COUNT(DISTINCT COALESCE(c."companyId", a."companyId")) FILTER (WHERE ${inWindow})::int AS companies,
             COUNT(DISTINCT a."contactId") FILTER (WHERE ${inPrevious})::int AS prev_people
        FROM "Activity" a
        LEFT JOIN "Contact" c ON c.id = a."contactId"
       WHERE a."organizationId" = ${organizationId} AND a.marketing = false
         AND a."occurredAt" >= ${range.previous.from} AND a."occurredAt" < ${range.to}
         ${repFilter(Prisma.sql`a."userId"`, repId)}`,
    // Everyone in scope, and whether anybody touched them in the period.
    prisma.$queryRaw<{ grp: string; people: number; untouched: number }[]>`
      WITH touched AS (
        SELECT DISTINCT a."contactId" AS id
          FROM "Activity" a
         WHERE a."organizationId" = ${organizationId} AND a.marketing = false
           AND a."contactId" IS NOT NULL AND ${inWindow}
      )
      SELECT ${peopleGroup} AS grp, COUNT(*)::int AS people, COUNT(*) FILTER (WHERE t.id IS NULL)::int AS untouched
        FROM "Contact" c
        LEFT JOIN "Company" co ON co.id = c."companyId"
        LEFT JOIN touched t ON t.id = c.id
       WHERE c."organizationId" = ${organizationId} AND c.status <> 'ARCHIVED'
         ${repFilter(Prisma.sql`c."ownerId"`, repId)}
       GROUP BY 1`,
    loadTeam(organizationId),
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
  const marketing = totals.filter((row) => row.marketing).reduce((sum, row) => sum + row.cur, 0);
  const previousMarketing = totals.filter((row) => row.marketing).reduce((sum, row) => sum + row.prev, 0);

  // Day by day, or week by week past two months, every bucket present.
  const bucket: "day" | "week" = range.days.length > 62 ? "week" : "day";
  const keyFor = (day: string) => {
    if (bucket === "day") return day;
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
    return addDaysIso(day, -((weekday + 6) % 7));
  };
  const series = new Map<string, { label: string; start: string; parts: number[]; marketing: number }>();
  for (const day of range.days) {
    const key = keyFor(day);
    if (!series.has(key)) series.set(key, { label: key, start: key, parts: ACTIVITY_TYPES.map(() => 0), marketing: 0 });
  }
  for (const row of daily) {
    const target = series.get(keyFor(row.day));
    if (!target) continue;
    if (row.marketing) target.marketing += row.n;
    else if (typeIndex(row.type) >= 0) target.parts[typeIndex(row.type)] += row.n;
  }

  const overall = reached[0];
  type G = ActivityReport["groups"][number];
  const groupMap = new Map<string, G>();
  const ensure = (key: string) => {
    let found = groupMap.get(key);
    if (!found) {
      found = { key, name: groupName(by, key, members), touches: 0, parts: ACTIVITY_TYPES.map(() => 0), people: 0, untouched: 0 };
      groupMap.set(key, found);
    }
    return found;
  };
  for (const row of touchGroups) {
    const target = ensure(row.grp);
    target.touches += row.n;
    if (typeIndex(row.type) >= 0) target.parts[typeIndex(row.type)] += row.n;
  }
  for (const row of peopleGroups) {
    const target = ensure(row.grp);
    target.people += row.people;
    target.untouched += row.untouched;
  }
  // On the Rep breakdown, every active teammate has a row even at zero.
  if (by === "rep") for (const member of members) if (!member.removed && (!repId || member.id === repId)) ensure(member.id);
  const groups = topGroups(
    [...groupMap.values()],
    (row) => row.touches * 1_000_000 + row.untouched,
    (into, row) => {
      into.touches += row.touches;
      into.people += row.people;
      into.untouched += row.untouched;
      row.parts.forEach((value, index) => (into.parts[index] += value));
    },
    () => ({ key: OTHER_GROUP, name: "Everything else", touches: 0, parts: ACTIVITY_TYPES.map(() => 0), people: 0, untouched: 0 }),
  );

  const people = peopleGroups.reduce((sum, row) => sum + row.people, 0);
  const untouched = peopleGroups.reduce((sum, row) => sum + row.untouched, 0);
  const peopleTouched = num(overall?.people);
  const previousPeopleTouched = num(overall?.prev_people);
  const type = (key: ActivityTypeValue) => byType.find((row) => row.type === key)!;

  const headlines: Headline[] = [
    { id: "touches", label: "Touches", value: touches, previous: previousTouches, format: "count", hint: "Calls, texts, emails, meetings" },
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
      { label: "Touches", format: "count" },
      ...ACTIVITY_TYPES.map((key) => ({ label: ACTIVITY_LABELS[key], format: "count" as const })),
      { label: "Not touched", format: "count" },
    ],
    rows: groups.map((row) => [row.name, row.touches, ...row.parts, row.untouched]),
  };

  return {
    kind: "activity",
    touches,
    previousTouches,
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
