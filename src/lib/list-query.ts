import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { INDIVIDUAL_COMPANY_TYPE } from "@/lib/constants";
import { getIndustryPickList } from "@/lib/industries";
import { owingIds } from "@/lib/money";
import { UNASSIGNED, phoneSearchDigits, searchTerms, type ListParams, type Presence } from "@/lib/list-params";
import { getTimeZone } from "@/lib/organization";
import { zonedMoment } from "@/lib/calendar-auto";
import { NO_LEAD_LABEL } from "@/lib/lead-labels";

// ---- Clean CRM data filters (Nov 10, 2026) ---------------------------
// Shared by both lists. Each returns the clauses to AND in.

const WINDOW_DAYS = { t7: 7, t30: 30, t90: 90, n7: 7, n30: 30, n90: 90 } as const;

// A touch: a call, text, email or meeting somebody logged. Marketing
// sends are never a touch (Taylor, Nov 10, 2026). The latest one is kept
// on the row (lastTouchAt, by database triggers; a company's counts its
// people's), so these are indexed ranges rather than a search of Activity.
function touchClause(act: ListParams["act"]): { lastTouchAt: { gte: Date } | { lt: Date } | null } | { OR: object[] } | null {
  if (!act) return null;
  if (act === "never") return { lastTouchAt: null };
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
