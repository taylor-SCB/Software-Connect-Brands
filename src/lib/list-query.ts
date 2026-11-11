import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { INDIVIDUAL_COMPANY_TYPE } from "@/lib/constants";
import { getIndustryPickList } from "@/lib/industries";
import { owingIds } from "@/lib/money";
import { UNASSIGNED, phoneSearchDigits, searchTerms, type ListParams, type Presence } from "@/lib/list-params";
import { getTimeZone } from "@/lib/organization";
import { zonedMoment } from "@/lib/calendar-auto";
import { NO_LEAD_LABEL } from "@/lib/lead-labels";
import { OVERDUE_TYPES } from "@/lib/calendar-data";
import { startOfWeek } from "@/lib/calendar";
import { addDays } from "@/lib/payments";
import { zoneDay, TALK_STATUSES } from "@/lib/health";
import { effectiveSort, type ListSort } from "@/lib/list-params";
import { Prisma as P } from "@/generated/prisma/client";
import { loadPulseSets, pulseClause, type PulseSets } from "@/lib/health-sql";
import { PULSE_KEYS, type PulseKey } from "@/lib/list-params";

// ---- Clean CRM data filters (Nov 10, 2026) ---------------------------
// Shared by both lists. Each returns the clauses to AND in.

const WINDOW_DAYS: Record<string, number> = { t7: 7, t30: 30, t90: 90, n7: 7, n30: 30, n90: 90 };

// A status that takes a conversation to reach (round 2): Connected and
// every step from Interested on, Not interested included. Lost and
// Archived can come from anywhere, so they say nothing either way.
const TALK_IMPLIED = ["CONNECTED", "INTERESTED", "NOT_INTERESTED", "MEETING_SET", "MEETING_COMPLETED", "QUOTE_SENT", "CONTRACT_SENT", "WON"] as const;

// A touch: a call, text, email or meeting somebody logged. Marketing
// sends are never a touch (Taylor, Nov 10, 2026). The latest one is kept
// on the row (lastTouchAt, by database triggers; a company's counts its
// people's), so these are indexed ranges rather than a search of Activity.
function touchClause(act: ListParams["act"]): object | null {
  if (!act) return null;
  if (act === "never") return { lastTouchAt: null };
  // Connected (BDR redesign, Nov 11, 2026): lastConnectAt, kept by the
  // same triggers. Not connected in N days includes never connected.
  // Round 2 (ux-gaps): a status that already means somebody talked —
  // Connected, Interested, Not interested, Meeting Set or later — counts
  // as a connect even with no talk logged (old records, a CSV import, a
  // status set by hand). Its date is the latest move into a talk status
  // (the health rules' stand-in for a talk); with no such move, and no
  // talk logged, nobody knows when it was, so it is left out of the
  // Not-connected windows rather than guessed. Read from StatusChange
  // when the list is asked; nothing is stored or back-filled.
  if (act === "nconn") {
    return {
      AND: [
        { lastConnectAt: null },
        { status: { notIn: [...TALK_IMPLIED] } },
        { statusChanges: { none: { toStatus: { in: [...TALK_STATUSES] }, on: { lte: new Date() } } } },
      ],
    };
  }
  if (act === "nc7" || act === "nc30") {
    const now = new Date();
    const since = new Date(now.getTime() - (act === "nc7" ? 7 : 30) * 86_400_000);
    return {
      AND: [
        { OR: [{ lastConnectAt: null }, { lastConnectAt: { lt: since } }] },
        { statusChanges: { none: { toStatus: { in: [...TALK_STATUSES] }, on: { gte: since, lte: now } } } },
        {
          OR: [
            { status: { notIn: [...TALK_IMPLIED] } },
            { lastConnectAt: { not: null } },
            { statusChanges: { some: { toStatus: { in: [...TALK_STATUSES] }, on: { lte: now } } } },
          ],
        },
      ],
    };
  }
  const since = new Date(Date.now() - WINDOW_DAYS[act] * 86_400_000);
  if (act.startsWith("t")) return { lastTouchAt: { gte: since } };
  return { OR: [{ lastTouchAt: null }, { lastTouchAt: { lt: since } }] };
}

// A touch logged ahead of its day (a follow-up ticked Done early) is left
// off the row until its time comes (audit fix, Nov 10, 2026); this puts
// the ones that have come due on, just before an Activity filter reads it.
async function touchesDue(organizationId: string) {
  await prisma.$executeRaw`SELECT crm_touch_due(${organizationId})`;
}

function present(field: "mobile" | "email" | "phone", value: Presence) {
  if (value === "yes") return { AND: [{ [field]: { not: null } }, { NOT: { [field]: "" } }] };
  return { OR: [{ [field]: null }, { [field]: "" }] };
}

function repClause(ids: string[]) {
  const people = ids.filter((id) => id !== UNASSIGNED);
  const or: { ownerId: { in: string[] } | null }[] = [];
  if (people.length) or.push({ ownerId: { in: people } });
  if (ids.includes(UNASSIGNED)) or.push({ ownerId: null });
  return { OR: or };
}

async function addedClause(p: ListParams) {
  if (!p.from && !p.to) return null;
  const timeZone = await getTimeZone();
  const createdAt: { gte?: Date; lt?: Date } = {};
  if (p.from) createdAt.gte = zonedMoment(p.from, "00:00", timeZone);
  if (p.to) {
    const next = new Date(Date.parse(`${p.to}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    createdAt.lt = zonedMoment(next, "00:00", timeZone);
  }
  return { createdAt };
}

function opportunityLabel(labels: string[]): Prisma.OpportunityContactWhereInput {
  const named = labels.filter((label) => label !== NO_LEAD_LABEL);
  const or: Prisma.OpportunityWhereInput[] = [];
  if (named.length) or.push({ leadLabel: { in: named } });
  if (labels.includes(NO_LEAD_LABEL)) or.push({ leadLabel: null });
  // Do Not List is off the opportunity as far as anyone reading it goes.
  return { role: { not: "HIDDEN" }, opportunity: { OR: or } };
}

// The database side of the Contacts and Companies lists: the where-clauses
// the address-bar filters become, and the choices the dropdowns offer.
// The pure parsing and link-building lives in list-params.ts so the
// client-side filter bar can share it.

const insensitive = "insensitive" as const;

// ---- The search box (UX review, Nov 10, 2026) --------------------------
// Every word of the search has to be found somewhere on the row (searchTerms
// in list-params.ts): "alan delta" is Alan at Delta Door, "howard denise" is
// Denise Howard, "property manager" finds the job title. On contacts each
// word is an OR over columns that each have a trigram index (title's and
// the phone digits' came with this), so Postgres answers it with a
// BitmapOr per word and a BitmapAnd across them, never a scan of every
// contact.

// LIKE's own characters, matched as typed. Prisma's `contains` passes them
// through, so "r%a" would be a wildcard and a trailing backslash an error.
function likeText(term: string) {
  return term.replace(/[\\%_]/g, "\\$&");
}

// A phone number is compared digits-only against every number on the row,
// because phones are stored however they were typed or imported. Only a
// search that is a phone number gets here (phoneSearchDigits: seven digits
// or more, nothing but digits and phone marks). The expressions are the
// ones the trigram indexes of migration 20261110231500_list_search_phone
// are built on, character for character, so the match is an index scan
// at any size. The ids are capped at 1,000 a word, like the company-name
// matches below; seven digits or more is a number, not a crowd.
export async function contactIdsByPhone(organizationId: string, digits: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Contact"
    WHERE "organizationId" = ${organizationId}
      AND regexp_replace(coalesce("phone", '') || '|' || coalesce("phone2", '') || '|' || coalesce("mobile", ''), '[^0-9|]', '', 'g') LIKE ${`%${digits}%`}
    LIMIT 1000`;
  return rows.map((row) => row.id);
}
async function companyIdsByPhone(organizationId: string, digits: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Company"
    WHERE "organizationId" = ${organizationId}
      AND regexp_replace(coalesce("phone", ''), '[^0-9]', '', 'g') LIKE ${`%${digits}%`}
    LIMIT 1000`;
  return rows.map((row) => row.id);
}

async function contactSearch(organizationId: string, q: string, companyIds?: string[]): Promise<Prisma.ContactWhereInput[]> {
  const terms = searchTerms(q);
  return Promise.all(
    terms.map(async (term): Promise<Prisma.ContactWhereInput> => {
      const text = likeText(term);
      const digits = phoneSearchDigits(term);
      const [companies, phones] = await Promise.all([
        companyIds && terms.length === 1 && term === q ? companyIds : companyIdsMatching(organizationId, term),
        digits ? contactIdsByPhone(organizationId, digits) : [],
      ]);
      return {
        OR: [
          { name: { contains: text, mode: insensitive } },
          { email: { contains: text, mode: insensitive } },
          { phone: { contains: text } },
          { email2: { contains: text, mode: insensitive } },
          { phone2: { contains: text } },
          { mobile: { contains: text } },
          { city: { contains: text, mode: insensitive } },
          { title: { contains: text, mode: insensitive } },
          ...(companies.length ? [{ companyId: { in: companies } }] : []),
          ...(phones.length ? [{ id: { in: phones } }] : []),
        ],
      };
    }),
  );
}

async function companySearch(organizationId: string, q: string): Promise<Prisma.CompanyWhereInput[]> {
  const terms = searchTerms(q);
  return Promise.all(
    terms.map(async (term): Promise<Prisma.CompanyWhereInput> => {
      const text = likeText(term);
      const digits = phoneSearchDigits(term);
      const phones = digits ? await companyIdsByPhone(organizationId, digits) : [];
      return {
        OR: [
          { name: { contains: text, mode: insensitive } },
          { city: { contains: text, mode: insensitive } },
          { state: { contains: text, mode: insensitive } },
          { email: { contains: text, mode: insensitive } },
          { phone: { contains: text } },
          ...(phones.length ? [{ id: { in: phones } }] : []),
        ],
      };
    }),
  );
}

// "Owes money" is the net of the rows less the payments against them, so
// it cannot be a where-clause — see owingIds in src/lib/money.ts, which
// is the same arithmetic the "Owes you" line prints. Both list builders
// are async for that reason.

export async function companyWhere(organizationId: string, p: ListParams): Promise<Prisma.CompanyWhereInput> {
  const and: Prisma.CompanyWhereInput[] = [{ organizationId }];
  if (p.q) and.push(...(await companySearch(organizationId, p.q)));
  if (p.states.length) and.push({ state: { in: p.states, mode: insensitive } });
  if (p.industries.length) and.push({ industries: { hasSome: p.industries } });
  if (p.types.length) and.push({ companyTypes: { hasSome: p.types.filter((t) => t !== INDIVIDUAL_COMPANY_TYPE) } });
  if (p.companies.length) and.push({ id: { in: p.companies } });
  if (p.statuses.length) and.push({ status: { in: p.statuses } });
  if (p.fav) and.push({ favorite: true });
  if (p.interested) and.push({ status: "INTERESTED" });
  if (p.deals) and.push({ contacts: { some: { deals: { some: {} } } } });
  // Needs attention: nothing known about it beyond a name, or no industry.
  if (p.attn) and.push({ OR: [{ industries: { isEmpty: true } }, { AND: [{ phone: null }, { email: null }] }] });
  // Auto-filled: something on it was filled in by the app and not yet confirmed.
  if (p.auto) and.push({ autoFilled: { isEmpty: false } });
  // Owes money: a signed Money-in contract with a row nobody has covered
  // yet. Purchase orders are money going the other way and never count.
  // The net figure, so the filter and the "Owes you" line beside each
  // name can never disagree.
  if (p.owed) and.push({ id: { in: await owingIds(organizationId, "company") } });
  const touch = touchClause(p.act);
  if (touch) {
    await touchesDue(organizationId);
    and.push(touch as Prisma.CompanyWhereInput);
  }
  if (p.reps.length) and.push(repClause(p.reps));
  if (p.addedBy.length) and.push({ createdById: { in: p.addedBy } });
  const added = await addedClause(p);
  if (added) and.push(added);
  if (p.email) and.push(present("email", p.email));
  if (p.phone) and.push(present("phone", p.phone));
  if (p.labels.length) and.push({ contacts: { some: { opportunities: { some: opportunityLabel(p.labels) } } } });
  const scope = scopeClause(p);
  if (scope) and.push(scope);
  and.push(...((await companyPresetClauses(organizationId, p)) as Prisma.CompanyWhereInput[]));
  return { AND: and };
}

// The search box on contacts also matches the company's name. Companies
// are looked up first (their own trigram index, capped) so the contact
// query stays a plain OR over indexed columns instead of a join that
// forces a scan of every contact.
const COMPANY_MATCH_CAP = 500;
export async function companyIdsMatching(organizationId: string, q: string): Promise<string[]> {
  if (!q) return [];
  const rows = await prisma.company.findMany({
    where: { organizationId, name: { contains: likeText(q), mode: insensitive } },
    select: { id: true },
    take: COMPANY_MATCH_CAP,
  });
  return rows.map((row) => row.id);
}

// companyIds: the company-name matches for the whole search, when the
// caller has already looked them up; a search of several words looks
// them up word by word.
export async function contactWhere(
  organizationId: string,
  p: ListParams,
  companyIds?: string[],
): Promise<Prisma.ContactWhereInput> {
  const and: Prisma.ContactWhereInput[] = [{ organizationId }];
  if (p.q) and.push(...(await contactSearch(organizationId, p.q, companyIds)));
  // A contact's own state, or their company's when theirs is blank.
  if (p.states.length) {
    and.push({
      OR: [
        { state: { in: p.states, mode: insensitive } },
        { state: null, company: { state: { in: p.states, mode: insensitive } } },
      ],
    });
  }
  if (p.industries.length) and.push({ company: { industries: { hasSome: p.industries } } });
  if (p.types.length) {
    const named = p.types.filter((t) => t !== INDIVIDUAL_COMPANY_TYPE);
    const or: Prisma.ContactWhereInput[] = [];
    if (named.length) or.push({ company: { companyTypes: { hasSome: named } } });
    // "Individual / Personal" is the people with no company at all.
    if (p.types.includes(INDIVIDUAL_COMPANY_TYPE)) or.push({ companyId: null });
    and.push({ OR: or });
  }
  if (p.companies.length) and.push({ companyId: { in: p.companies } });
  if (p.statuses.length) and.push({ status: { in: p.statuses } });
  if (p.fav) and.push({ favorite: true });
  if (p.interested) and.push({ status: "INTERESTED" });
  if (p.deals) and.push({ deals: { some: {} } });
  // Needs attention: no way to reach them, or a company nobody has tagged.
  if (p.attn) {
    and.push({
      OR: [
        { AND: [{ email: null }, { phone: null }, { email2: null }, { phone2: null }, { mobile: null }] },
        { company: { industries: { isEmpty: true } } },
      ],
    });
  }
  // Owes money: only a homeowner's own paperwork lands on their row —
  // paperwork with a company on it is counted on the company's row
  // instead. That is decided by the contract, not by whatever company
  // the contact happens to be at today, which is why this goes through
  // owingIds rather than a clause about the contact.
  if (p.owed) and.push({ id: { in: await owingIds(organizationId, "contact") } });
  const touch = touchClause(p.act);
  if (touch) {
    await touchesDue(organizationId);
    and.push(touch as Prisma.ContactWhereInput);
  }
  if (p.titles.length) and.push({ title: { in: p.titles, mode: insensitive } });
  if (p.reps.length) and.push(repClause(p.reps));
  if (p.addedBy.length) and.push({ createdById: { in: p.addedBy } });
  const added = await addedClause(p);
  if (added) and.push(added);
  if (p.mobile) and.push(present("mobile", p.mobile));
  if (p.email) and.push(present("email", p.email));
  if (p.labels.length) and.push({ opportunities: { some: opportunityLabel(p.labels) } });
  if (p.pulses.length) {
    const sets = await pulseSetsFor(organizationId, p);
    and.push({ OR: p.pulses.map((key) => pulseClause(key, sets) as Prisma.ContactWhereInput) });
  }
  const scope = scopeClause(p);
  if (scope) and.push(scope);
  and.push(...((await contactPresetClauses(organizationId, p)) as Prisma.ContactWhereInput[]));
  return { AND: and };
}

export type FilterOptions = {
  states: string[];
  industries: { name: string; types: string[] }[];
};

// The choices each dropdown offers: every state anyone in the workspace
// is in (contacts and companies together) and the workspace's pick lists.
export async function getFilterOptions(organizationId: string): Promise<FilterOptions> {
  // groupBy is a real GROUP BY in SQL; Prisma's `distinct` would pull every
  // row into memory first, which at 200,000 contacts is the whole table on
  // every page view.
  const [contactStates, companyStates, industries] = await Promise.all([
    prisma.contact.groupBy({ by: ["state"], where: { organizationId, state: { not: null } } }),
    prisma.company.groupBy({ by: ["state"], where: { organizationId, state: { not: null } } }),
    // Retired values too: records keep them, so they can still be found.
    getIndustryPickList(organizationId, { includeRetired: true }),
  ]);
  const states = Array.from(
    new Set([...contactStates, ...companyStates].map((row) => row.state!.trim()).filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b));
  return { states, industries };
}

// Names for the company ids in the Company filter, so the chips can read
// "Acme" instead of an id.
export async function namesForCompanies(organizationId: string, ids: string[]) {
  if (ids.length === 0) return [];
  return prisma.company.findMany({
    where: { organizationId, id: { in: ids } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

// ---- BDR redesign: scope, presets and order (Nov 11, 2026) -------------

// Mine is the signed-in person's records (p.me, filled by the page and by
// bulk Assign from the session, never from the address bar); Unowned is
// nobody's. A Mine with nobody signed in matches nothing rather than
// everything.
function scopeClause(p: ListParams): object | null {
  if (p.scope === "mine") return { ownerId: p.me || "__nobody__" };
  if (p.scope === "unowned") return { ownerId: null };
  return null;
}

// Where someone is on the ladder for each preset.
const CALL_STATUSES = ["NOT_ACTIONED", "CONTACTED", "CONNECTED", "INTERESTED"] as const;
const TALKED_STATUSES = ["CONNECTED", "INTERESTED"] as const;
const CLOSED_STATUSES = ["NOT_INTERESTED", "LOST", "ARCHIVED"] as const;
// A preset's id lists stop here; past it the list says nothing wrong, it
// just narrows a little less (a workspace with more than 10,000 people
// booked ahead is far past the customers this is for).
const ID_CAP = 10_000;

async function workspaceClock(organizationId: string) {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { timeZone: true, quietDays: true } });
  const timeZone = org?.timeZone ?? "America/Chicago";
  return { timeZone, quietDays: org?.quietDays ?? 8, today: zoneDay(new Date(), timeZone) };
}

// People with something booked today or later: an open calendar entry
// (theirs or one they attend), a touch dated ahead, or a meeting ahead on
// an opportunity they are listed on. The same rule as the health loader's
// "next" (src/lib/health-load.ts).
async function bookedAheadContactIds(organizationId: string, today: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>(P.sql`
    SELECT DISTINCT id FROM (
      SELECT e."contactId" AS id FROM "CalendarEvent" e
       WHERE e."organizationId" = ${organizationId} AND e."doneAt" IS NULL AND e."contactId" IS NOT NULL
         AND (e."startOn" >= ${today}::date OR e."endOn" >= ${today}::date)
      UNION
      SELECT ea."B" FROM "_EventAttendees" ea JOIN "CalendarEvent" e ON e.id = ea."A"
       WHERE e."organizationId" = ${organizationId} AND e."doneAt" IS NULL
         AND (e."startOn" >= ${today}::date OR e."endOn" >= ${today}::date)
      UNION
      SELECT a."contactId" FROM "Activity" a
       WHERE a."organizationId" = ${organizationId} AND a.marketing = false AND a."occurredAt" > now() AND a."contactId" IS NOT NULL
      UNION
      SELECT oc."contactId" FROM "OpportunityMeeting" om
        JOIN "Opportunity" o ON o.id = om."opportunityId"
        JOIN "OpportunityContact" oc ON oc."opportunityId" = o.id
       WHERE o."organizationId" = ${organizationId} AND om."on" > now() AND oc.role <> 'HIDDEN'
    ) x WHERE id IS NOT NULL LIMIT ${ID_CAP}`);
  return rows.map((row) => row.id);
}

async function bookedAheadCompanyIds(organizationId: string, today: string): Promise<string[]> {
  const people = await bookedAheadContactIds(organizationId, today);
  const rows = await prisma.$queryRaw<{ id: string }[]>(P.sql`
    SELECT DISTINCT id FROM (
      SELECT e."companyId" AS id FROM "CalendarEvent" e
       WHERE e."organizationId" = ${organizationId} AND e."doneAt" IS NULL AND e."companyId" IS NOT NULL
         AND (e."startOn" >= ${today}::date OR e."endOn" >= ${today}::date)
      UNION
      SELECT c."companyId" FROM "Contact" c
       WHERE c."organizationId" = ${organizationId} AND c.id = ANY(${people}) AND c."companyId" IS NOT NULL
    ) x WHERE id IS NOT NULL LIMIT ${ID_CAP}`);
  return rows.map((row) => row.id);
}

// Follow-ups gone late (the health loader's ev_late rule), oldest first:
// what My call list puts at the top.
async function lateContactIds(organizationId: string, today: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>(P.sql`
    SELECT id FROM (
      SELECT e."contactId" AS id, e."startOn" FROM "CalendarEvent" e
       WHERE e."organizationId" = ${organizationId} AND e."doneAt" IS NULL AND e."contactId" IS NOT NULL
         AND e.type IN (${P.join(OVERDUE_TYPES)})
         AND e."startOn" < ${today}::date AND (e."endOn" IS NULL OR e."endOn" < ${today}::date)
      UNION ALL
      SELECT ea."B", e."startOn" FROM "_EventAttendees" ea JOIN "CalendarEvent" e ON e.id = ea."A"
       WHERE e."organizationId" = ${organizationId} AND e."doneAt" IS NULL
         AND e.type IN (${P.join(OVERDUE_TYPES)})
         AND e."startOn" < ${today}::date AND (e."endOn" IS NULL OR e."endOn" < ${today}::date)
    ) x GROUP BY id ORDER BY MIN("startOn"), id LIMIT ${ID_CAP}`);
  return rows.map((row) => row.id);
}

async function lateCompanyIds(organizationId: string, today: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>(P.sql`
    SELECT id FROM (
      SELECT COALESCE(e."companyId", c."companyId") AS id, e."startOn" FROM "CalendarEvent" e
        LEFT JOIN "Contact" c ON c.id = e."contactId"
       WHERE e."organizationId" = ${organizationId} AND e."doneAt" IS NULL
         AND (e."companyId" IS NOT NULL OR c."companyId" IS NOT NULL)
         AND e.type IN (${P.join(OVERDUE_TYPES)})
         AND e."startOn" < ${today}::date AND (e."endOn" IS NULL OR e."endOn" < ${today}::date)
    ) x GROUP BY id ORDER BY MIN("startOn"), id LIMIT ${ID_CAP}`);
  return rows.map((row) => row.id);
}

// Meetings this week (Sunday to Saturday, as the calendar prints it, in
// the workspace's clock): a Meeting on the calendar, a meeting on an
// opportunity they are listed on, or a meeting logged; soonest first.
async function meetingWeekContactIds(organizationId: string, today: string, timeZone: string): Promise<string[]> {
  const first = startOfWeek(today);
  const last = addDays(first, 6);
  const after = addDays(first, 7);
  const rows = await prisma.$queryRaw<{ id: string }[]>(P.sql`
    SELECT id FROM (
      SELECT e."contactId" AS id, to_char(e."startOn", 'YYYY-MM-DD') || ' ' || COALESCE(e."startTime", '99:99') AS at
        FROM "CalendarEvent" e
       WHERE e."organizationId" = ${organizationId} AND e.type = 'Meeting' AND e."contactId" IS NOT NULL
         AND e."startOn" BETWEEN ${first}::date AND ${last}::date
      UNION ALL
      SELECT ea."B", to_char(e."startOn", 'YYYY-MM-DD') || ' ' || COALESCE(e."startTime", '99:99')
        FROM "_EventAttendees" ea JOIN "CalendarEvent" e ON e.id = ea."A"
       WHERE e."organizationId" = ${organizationId} AND e.type = 'Meeting'
         AND e."startOn" BETWEEN ${first}::date AND ${last}::date
      UNION ALL
      SELECT oc."contactId", to_char(om."on" AT TIME ZONE ${timeZone}, 'YYYY-MM-DD HH24:MI')
        FROM "OpportunityMeeting" om
        JOIN "Opportunity" o ON o.id = om."opportunityId"
        JOIN "OpportunityContact" oc ON oc."opportunityId" = o.id
       WHERE o."organizationId" = ${organizationId} AND oc.role <> 'HIDDEN'
         AND (om."on" AT TIME ZONE ${timeZone})::date BETWEEN ${first}::date AND ${last}::date
      UNION ALL
      SELECT a."contactId", to_char(a."occurredAt" AT TIME ZONE ${timeZone}, 'YYYY-MM-DD HH24:MI')
        FROM "Activity" a
       WHERE a."organizationId" = ${organizationId} AND a.marketing = false AND a.type = 'MEETING' AND a."contactId" IS NOT NULL
         AND a."occurredAt" >= (${first}::date::timestamp AT TIME ZONE ${timeZone})
         AND a."occurredAt" < (${after}::date::timestamp AT TIME ZONE ${timeZone})
    ) x WHERE id IS NOT NULL GROUP BY id ORDER BY MIN(at), id LIMIT ${ID_CAP}`);
  return rows.map((row) => row.id);
}

// ---- Pulse (round 2, Nov 11, 2026) -------------------------------------
// The Contacts list's Pulse filter and Warmest first, from the SQL twin of
// the health rules (src/lib/health-sql.ts), worked out once per view and
// shared by the filter, the count and the page. Mine and Unowned only
// work it out for their own people.
const pulseCache = new WeakMap<ListParams, Promise<PulseSets>>();
function pulseSetsFor(organizationId: string, p: ListParams): Promise<PulseSets> {
  let sets = pulseCache.get(p);
  if (!sets) {
    sets = (async () => {
      await touchesDue(organizationId);
      const clock = await workspaceClock(organizationId);
      const owner = p.scope === "mine" ? p.me || "__nobody__" : p.scope === "unowned" ? null : undefined;
      return loadPulseSets(organizationId, { now: new Date(), timeZone: clock.timeZone, quietDays: clock.quietDays }, owner);
    })();
    pulseCache.set(p, sets);
  }
  return sets;
}

// Warmest first: Won, then Warm, Cooling and Cold, Trying, stalled, New,
// Closed (warmth() in health.ts); inside each, the most recently touched
// first. Each pulse is a where-clause, so a page is a count per pulse and
// one or two plain reads.
async function pulsePageIds(model: IdModel & { count(args: { where: object }): Promise<number> }, organizationId: string, where: object, p: ListParams, window: { skip: number }) {
  const sets = await pulseSetsFor(organizationId, p);
  const keys: readonly PulseKey[] = p.pulses.length ? PULSE_KEYS.filter((key) => p.pulses.includes(key)) : PULSE_KEYS;
  const tiers = keys.map((key) => ({ AND: [where, pulseClause(key, sets)] }));
  const counts = await Promise.all(tiers.map((tier) => model.count({ where: tier })));
  const out: string[] = [];
  let skip = window.skip;
  for (let index = 0; index < tiers.length && out.length < p.per; index += 1) {
    if (skip >= counts[index]) {
      skip -= counts[index];
      continue;
    }
    const rows = await model.findMany({
      where: tiers[index],
      orderBy: [{ lastTouchAt: { sort: "desc", nulls: "last" } }, { id: "asc" }],
      skip,
      take: p.per - out.length,
      select: { id: true },
    });
    out.push(...rows.map((row) => row.id));
    skip = 0;
  }
  return out;
}

// The ordered ids a preset reads in, when its order isn't a column
// (Meetings this week). Cached per request by the caller.
const presetOrder = new WeakMap<ListParams, string[]>();

async function contactPresetClauses(organizationId: string, p: ListParams): Promise<object[]> {
  if (!p.preset) return [];
  const clock = await workspaceClock(organizationId);
  switch (p.preset) {
    case "call":
      return [{ status: { in: [...CALL_STATUSES] } }, { id: { notIn: await bookedAheadContactIds(organizationId, clock.today) } }];
    case "never":
      await touchesDue(organizationId);
      return [{ lastTouchAt: null }];
    case "talked":
      return [{ status: { in: [...TALKED_STATUSES] } }, { id: { notIn: await bookedAheadContactIds(organizationId, clock.today) } }];
    case "week": {
      const ids = await meetingWeekContactIds(organizationId, clock.today, clock.timeZone);
      presetOrder.set(p, ids);
      return [{ id: { in: ids } }];
    }
    default:
      return [];
  }
}

async function companyPresetClauses(organizationId: string, p: ListParams): Promise<object[]> {
  if (!p.preset) return [];
  const clock = await workspaceClock(organizationId);
  switch (p.preset) {
    case "accounts":
      return [{ ownerId: p.me || "__nobody__" }, { status: { notIn: [...CLOSED_STATUSES] } }];
    case "quiet": {
      await touchesDue(organizationId);
      const since = new Date(Date.now() - clock.quietDays * 86_400_000);
      return [{ lastTouchAt: { lt: since } }, { status: { notIn: [...CLOSED_STATUSES] } }];
    }
    case "talked":
      return [{ status: { in: [...TALKED_STATUSES] } }, { id: { notIn: await bookedAheadCompanyIds(organizationId, clock.today) } }];
    case "never":
      await touchesDue(organizationId);
      return [{ lastTouchAt: null }];
    default:
      return [];
  }
}

// The order for a plain sort. A tie always falls back to the id, so a page
// never repeats or skips a row.
export function orderFor(sort: ListSort | "meeting"): object[] {
  switch (sort) {
    // Contacts only, through pulsePageIds; anywhere else it reads as added.
    case "touch":
      return [{ lastTouchAt: { sort: "asc", nulls: "first" } }, { id: "asc" }];
    case "recent":
      return [{ lastTouchAt: { sort: "desc", nulls: "last" } }, { id: "asc" }];
    case "name":
      return [{ name: "asc" }, { id: "asc" }];
    case "edited":
      return [{ updatedAt: "desc" }, { id: "asc" }];
    default:
      return [{ createdAt: "desc" }, { id: "asc" }];
  }
}

type IdModel = {
  findMany(args: { where: object; orderBy?: object[]; skip?: number; take?: number; select: { id: true } }): Promise<{ id: string }[]>;
};

// The ids of one page of a list, in the list's order. Most orders are a
// column; two are not:
// - Oldest touch first puts follow-ups gone late at the top (oldest late
//   first), then never touched, then the oldest touch — My call list's
//   order. The late ones are a short list read first; the rest page on
//   after them.
// - Meetings this week reads in the meetings' own order.
export async function pageIds(
  kind: "contacts" | "companies",
  organizationId: string,
  where: object,
  p: ListParams,
  window: { skip: number },
): Promise<string[]> {
  const model = (kind === "contacts" ? prisma.contact : prisma.company) as unknown as IdModel;
  const sort = effectiveSort(p);
  const take = p.per;
  if (sort === "pulse" && kind === "contacts") {
    return pulsePageIds(model as IdModel & { count(args: { where: object }): Promise<number> }, organizationId, where, p, window);
  }
  if (sort === "meeting") {
    const order = presetOrder.get(p) ?? [];
    const matching = new Set((await model.findMany({ where: { AND: [where, { id: { in: order } }] }, select: { id: true } })).map((row) => row.id));
    return order.filter((id) => matching.has(id)).slice(window.skip, window.skip + take);
  }
  if (sort === "touch" || sort === "recent") await touchesDue(organizationId);
  if (sort !== "touch") {
    return (await model.findMany({ where, orderBy: orderFor(sort), skip: window.skip, take, select: { id: true } })).map((row) => row.id);
  }
  const clock = await workspaceClock(organizationId);
  const late = kind === "contacts" ? await lateContactIds(organizationId, clock.today) : await lateCompanyIds(organizationId, clock.today);
  const lateMatching = late.length
    ? new Set((await model.findMany({ where: { AND: [where, { id: { in: late } }] }, select: { id: true } })).map((row) => row.id))
    : new Set<string>();
  const first = late.filter((id) => lateMatching.has(id));
  const head = first.slice(window.skip, window.skip + take);
  if (head.length === take) return head;
  const rest = await model.findMany({
    where: first.length ? { AND: [where, { id: { notIn: first } }] } : where,
    orderBy: orderFor("touch"),
    skip: Math.max(0, window.skip - first.length),
    take: take - head.length,
    select: { id: true },
  });
  return [...head, ...rest.map((row) => row.id)];
}
