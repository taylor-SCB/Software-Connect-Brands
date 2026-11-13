import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { CONTACT_STATUSES } from "@/lib/constants";

// Planner AI (Nov 12, 2026, Taylor). Describe leads, pick Warm / Cold /
// Mix, set up to 6 dated touches (Call, Email or Text), and up to 50 people
// get every touch on the planner user's own calendar, at most 3 from one
// company. The planner only ever books for the person running it and never
// changes who owns a contact.
//
// Who can be picked, every time (the preview and again at Create):
// - not Won, Lost, Not interested or Archived;
// - nothing open on the calendar for them today or later (anyone's), so
//   nobody gets two schedules at once;
// - theirs, unowned, or another rep's only when that rep's lead has gone
//   quiet: nothing booked ahead (above) AND nothing logged in the last
//   45 days;
// - reachable by what the schedule asks: a phone for a Call or a Text, an
//   email for an Email.
// Warm = at least one logged touch (lastTouchAt), Cold = none. Warm ranks
// by the latest talk, then the latest touch; Cold by newest added.

export const PLANNER_MAX_PEOPLE = 50;
export const PLANNER_MAX_ROWS = 6;
export const PLANNER_PER_COMPANY = 3;
export const PLANNER_QUIET_DAYS = 45;
export const PLANNER_TYPES = ["PHONE_CALL", "EMAIL", "TEXT"] as const;
export type PlannerType = (typeof PLANNER_TYPES)[number];
export const PLANNER_KINDS = ["warm", "cold", "mix"] as const;
export type PlannerKind = (typeof PLANNER_KINDS)[number];

const CLOSED = ["WON", "LOST", "NOT_INTERESTED", "ARCHIVED"];
export const PLANNER_STATUSES = CONTACT_STATUSES.filter((status) => !CLOSED.includes(status));

export type PlannerCriteria = {
  titles: string[];
  industries: string[];
  companyTypes: string[];
  statuses: string[];
  states: string[];
  cities: string[];
  neverContacted: boolean;
};

export const EMPTY_CRITERIA: PlannerCriteria = { titles: [], industries: [], companyTypes: [], statuses: [], states: [], cities: [], neverContacted: false };

export type PlannerPerson = {
  id: string;
  name: string;
  title: string | null;
  company: string | null;
  companyId: string | null;
  place: string | null;
  warm: boolean;
  owner: "you" | "unowned" | "teammate";
  ownerName: string | null;
  lastTouchAt: string | null;
  createdAt: string;
};

type Row = {
  id: string;
  name: string;
  title: string | null;
  company: string | null;
  company_id: string | null;
  city: string | null;
  state: string | null;
  last_touch: Date | null;
  created_at: Date;
  owner_id: string | null;
  owner_name: string | null;
  rn: number;
};

const lower = (values: string[]) => values.map((value) => value.trim().toLowerCase()).filter(Boolean);

// The eligible people (rules above), filtered, ranked, at most 3 a company.
// `ids` narrows it to these people (Create re-checks the preview's picks).
async function eligible(
  organizationId: string,
  userId: string,
  input: { criteria: PlannerCriteria; kind: "warm" | "cold" | null; types: PlannerType[]; today: string; ids?: string[]; limit: number },
): Promise<Row[]> {
  const { criteria } = input;
  const quietSince = new Date(Date.now() - PLANNER_QUIET_DAYS * 86_400_000);
  const needsPhone = input.types.includes("PHONE_CALL") || input.types.includes("TEXT");
  const needsEmail = input.types.includes("EMAIL");
  const where: Prisma.Sql[] = [
    Prisma.sql`c."organizationId" = ${organizationId}`,
    Prisma.sql`c.status::text <> ALL(${CLOSED})`,
    Prisma.sql`c.id NOT IN (SELECT cid FROM busy WHERE cid IS NOT NULL)`,
    Prisma.sql`(c."ownerId" = ${userId} OR c."ownerId" IS NULL OR c."lastTouchAt" IS NULL OR c."lastTouchAt" < ${quietSince})`,
  ];
  if (input.ids) where.push(Prisma.sql`c.id = ANY(${input.ids})`);
  if (needsPhone) where.push(Prisma.sql`COALESCE(NULLIF(trim(c.mobile), ''), NULLIF(trim(c.phone), ''), NULLIF(trim(c.phone2), '')) IS NOT NULL`);
  if (needsEmail) where.push(Prisma.sql`COALESCE(NULLIF(trim(c.email), ''), NULLIF(trim(c.email2), '')) IS NOT NULL`);
  if (input.kind === "warm") where.push(Prisma.sql`c."lastTouchAt" IS NOT NULL`);
  if (input.kind === "cold" || criteria.neverContacted) where.push(Prisma.sql`c."lastTouchAt" IS NULL`);
  if (criteria.titles.length) where.push(Prisma.sql`lower(trim(c.title)) = ANY(${lower(criteria.titles)})`);
  if (criteria.statuses.length) where.push(Prisma.sql`c.status::text = ANY(${criteria.statuses})`);
  if (criteria.states.length) where.push(Prisma.sql`upper(trim(COALESCE(NULLIF(c.state, ''), co.state))) = ANY(${criteria.states.map((s) => s.trim().toUpperCase())})`);
  if (criteria.cities.length) where.push(Prisma.sql`lower(trim(COALESCE(NULLIF(c.city, ''), co.city))) = ANY(${lower(criteria.cities)})`);
  if (criteria.industries.length) where.push(Prisma.sql`EXISTS (SELECT 1 FROM unnest(co.industries) i WHERE lower(i) = ANY(${lower(criteria.industries)}))`);
  if (criteria.companyTypes.length) where.push(Prisma.sql`EXISTS (SELECT 1 FROM unnest(co."companyTypes") t WHERE lower(t) = ANY(${lower(criteria.companyTypes)}))`);
  const order =
    input.kind === "cold"
      ? Prisma.sql`c."createdAt" DESC, c.id`
      : Prisma.sql`c."lastConnectAt" DESC NULLS LAST, c."lastTouchAt" DESC NULLS LAST, c."createdAt" DESC, c.id`;
  return prisma.$queryRaw<Row[]>`
    WITH busy AS (
      SELECT e."contactId" AS cid FROM "CalendarEvent" e
       WHERE e."organizationId" = ${organizationId} AND e."doneAt" IS NULL AND e."startOn" >= ${input.today}::date AND e."contactId" IS NOT NULL
      UNION
      SELECT ea."B" FROM "CalendarEvent" e JOIN "_EventAttendees" ea ON ea."A" = e.id
       WHERE e."organizationId" = ${organizationId} AND e."doneAt" IS NULL AND e."startOn" >= ${input.today}::date
    ),
    ranked AS (
      SELECT c.id, c.name, c.title, co.name AS company, c."companyId" AS company_id,
             COALESCE(NULLIF(c.city, ''), co.city) AS city, COALESCE(NULLIF(c.state, ''), co.state) AS state,
             c."lastTouchAt" AS last_touch, c."createdAt" AS created_at, c."ownerId" AS owner_id,
             row_number() OVER (PARTITION BY COALESCE(c."companyId", c.id) ORDER BY ${order}) AS rn,
             row_number() OVER (ORDER BY ${order}) AS pos
        FROM "Contact" c
        LEFT JOIN "Company" co ON co.id = c."companyId"
       WHERE ${Prisma.join(where, " AND ")}
    )
    SELECT r.id, r.name, r.title, r.company, r.company_id, r.city, r.state, r.last_touch, r.created_at, r.owner_id,
           u.name AS owner_name, r.rn::int AS rn
      FROM ranked r
      LEFT JOIN "User" u ON u.id = r.owner_id
     WHERE r.rn <= ${PLANNER_PER_COMPANY}
     ORDER BY r.pos
     LIMIT ${input.limit}`;
}

function toPerson(row: Row, userId: string): PlannerPerson {
  return {
    id: row.id,
    name: row.name,
    title: row.title,
    company: row.company,
    companyId: row.company_id,
    place: [row.city, row.state].filter(Boolean).join(", ") || null,
    warm: Boolean(row.last_touch),
    owner: row.owner_id === userId ? "you" : row.owner_id ? "teammate" : "unowned",
    ownerName: row.owner_name,
    lastTouchAt: row.last_touch ? row.last_touch.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  };
}

// The preview: up to 50, at most 3 a company. Mix takes Warm and Cold in
// turn (half and half) and tops up from whichever side has more.
export async function planPeople(
  organizationId: string,
  userId: string,
  input: { criteria: PlannerCriteria; kind: PlannerKind; types: PlannerType[]; today: string },
): Promise<PlannerPerson[]> {
  if (input.kind !== "mix") {
    const rows = await eligible(organizationId, userId, { ...input, kind: input.kind, limit: PLANNER_MAX_PEOPLE });
    return rows.map((row) => toPerson(row, userId));
  }
  const [warm, cold] = await Promise.all([
    eligible(organizationId, userId, { ...input, kind: "warm", limit: PLANNER_MAX_PEOPLE }),
    eligible(organizationId, userId, { ...input, kind: "cold", limit: PLANNER_MAX_PEOPLE }),
  ]);
  const picked: Row[] = [];
  const perCompany = new Map<string, number>();
  const take = (row: Row) => {
    const key = row.company_id ?? row.id;
    const n = perCompany.get(key) ?? 0;
    if (n >= PLANNER_PER_COMPANY) return false;
    perCompany.set(key, n + 1);
    picked.push(row);
    return true;
  };
  let w = 0;
  let c = 0;
  while (picked.length < PLANNER_MAX_PEOPLE && (w < warm.length || c < cold.length)) {
    const warmTurn = picked.filter((row) => row.last_touch).length <= picked.filter((row) => !row.last_touch).length;
    if ((warmTurn && w < warm.length) || c >= cold.length) take(warm[w++]);
    else take(cold[c++]);
  }
  return picked.map((row) => toPerson(row, userId));
}

// Create's re-check: which of these people the rules still allow, with
// their names and companies for the entries.
export async function stillEligible(
  organizationId: string,
  userId: string,
  input: { ids: string[]; types: PlannerType[]; today: string },
) {
  const rows = await eligible(organizationId, userId, {
    criteria: EMPTY_CRITERIA,
    kind: null,
    types: input.types,
    today: input.today,
    ids: input.ids,
    limit: PLANNER_MAX_PEOPLE * 4,
  });
  // The cap applies to what is created too, in the preview's order.
  const order = new Map(input.ids.map((id, index) => [id, index]));
  const perCompany = new Map<string, number>();
  return rows
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
    .filter((row) => {
      const key = row.company_id ?? row.id;
      const n = perCompany.get(key) ?? 0;
      if (n >= PLANNER_PER_COMPANY) return false;
      perCompany.set(key, n + 1);
      return true;
    })
    .slice(0, PLANNER_MAX_PEOPLE)
    .map((row) => ({ id: row.id, name: row.name, companyId: row.company_id }));
}

// The values a filter can take in this workspace, for the chip pickers and
// for the AI (which may only pick from these).
export async function plannerChoices(organizationId: string) {
  const [titles, industries, types, states, cities] = await Promise.all([
    prisma.$queryRaw<{ v: string }[]>`
      SELECT min(trim(title)) AS v FROM "Contact"
       WHERE "organizationId" = ${organizationId} AND NULLIF(trim(title), '') IS NOT NULL
       GROUP BY lower(trim(title)) ORDER BY count(*) DESC LIMIT 300`,
    prisma.$queryRaw<{ v: string }[]>`
      SELECT min(i) AS v FROM "Company", unnest(industries) i
       WHERE "organizationId" = ${organizationId} GROUP BY lower(i) ORDER BY count(*) DESC LIMIT 200`,
    prisma.$queryRaw<{ v: string }[]>`
      SELECT min(t) AS v FROM "Company", unnest("companyTypes") t
       WHERE "organizationId" = ${organizationId} GROUP BY lower(t) ORDER BY count(*) DESC LIMIT 200`,
    prisma.$queryRaw<{ v: string }[]>`
      SELECT upper(trim(s)) AS v FROM (
        SELECT state AS s FROM "Contact" WHERE "organizationId" = ${organizationId}
        UNION ALL SELECT state FROM "Company" WHERE "organizationId" = ${organizationId}
      ) x WHERE NULLIF(trim(s), '') IS NOT NULL GROUP BY 1 ORDER BY count(*) DESC LIMIT 80`,
    prisma.$queryRaw<{ v: string }[]>`
      SELECT min(trim(c)) AS v FROM (
        SELECT city AS c FROM "Contact" WHERE "organizationId" = ${organizationId}
        UNION ALL SELECT city FROM "Company" WHERE "organizationId" = ${organizationId}
      ) x WHERE NULLIF(trim(c), '') IS NOT NULL GROUP BY lower(trim(c)) ORDER BY count(*) DESC LIMIT 400`,
  ]);
  const list = (rows: { v: string }[]) => rows.map((row) => row.v).filter(Boolean);
  return {
    titles: list(titles),
    industries: list(industries),
    companyTypes: list(types),
    states: list(states),
    cities: list(cities),
    statuses: [...PLANNER_STATUSES] as string[],
  };
}

export type PlannerChoices = Awaited<ReturnType<typeof plannerChoices>>;

// Keep only values that exist (ignoring case), spelled as the workspace has
// them. Anything the AI (or an address) made up is dropped.
export function onlyKnown(values: unknown, allowed: string[], max = 40): string[] {
  if (!Array.isArray(values)) return [];
  const byLower = new Map(allowed.map((value) => [value.toLowerCase(), value]));
  const out: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const hit = byLower.get(value.trim().toLowerCase());
    if (hit && !out.includes(hit)) out.push(hit);
    if (out.length >= max) break;
  }
  return out;
}

export function cleanCriteria(raw: unknown, choices: PlannerChoices): PlannerCriteria {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    titles: onlyKnown(value.titles, choices.titles),
    industries: onlyKnown(value.industries, choices.industries),
    companyTypes: onlyKnown(value.companyTypes, choices.companyTypes),
    statuses: onlyKnown(value.statuses, choices.statuses),
    states: onlyKnown(value.states, choices.states),
    cities: onlyKnown(value.cities, choices.cities),
    neverContacted: value.neverContacted === true,
  };
}

// The Planned tab: this person's open planner entries, overdue first, by
// day. Only ones they made with the planner (batchId "plan:…") that are
// still on their own calendar.
export const PLANNED_CAP = 300;
export async function loadPlanned(organizationId: string, userId: string) {
  const rows = await prisma.calendarEvent.findMany({
    where: { organizationId, ownerId: userId, doneAt: null, batchId: { startsWith: "plan:" } },
    orderBy: [{ startOn: "asc" }, { startTime: { sort: "asc", nulls: "last" } }, { title: "asc" }, { id: "asc" }],
    take: PLANNED_CAP + 1,
    select: {
      id: true,
      title: true,
      type: true,
      notes: true,
      startOn: true,
      startTime: true,
      ownerId: true,
      createdById: true,
      createdBy: { select: { name: true } },
      contactId: true,
      contact: { select: { name: true, phone: true, mobile: true, email: true, company: { select: { name: true } } } },
      companyId: true,
    },
  });
  return {
    more: rows.length > PLANNED_CAP,
    entries: rows.slice(0, PLANNED_CAP).map((row) => ({
      id: row.id,
      title: row.title,
      type: row.type,
      notes: row.notes,
      startOn: row.startOn.toISOString().slice(0, 10),
      startTime: row.startTime,
      contactId: row.contactId,
      contactName: row.contact?.name ?? null,
      company: row.contact?.company?.name ?? null,
      companyId: row.companyId,
      phone: row.contact?.mobile || row.contact?.phone || null,
      email: row.contact?.email ?? null,
      delegatedBy: row.ownerId === userId && row.createdById && row.createdById !== userId ? (row.createdBy?.name ?? "a teammate") : null,
    })),
  };
}

export type PlannedEntry = Awaited<ReturnType<typeof loadPlanned>>["entries"][number];
