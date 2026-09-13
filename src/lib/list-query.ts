import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { INDIVIDUAL_COMPANY_TYPE } from "@/lib/constants";
import { getIndustryPickList } from "@/lib/industries";
import type { ListParams } from "@/lib/list-params";

// The database side of the Contacts and Companies lists: the where-clauses
// the address-bar filters become, and the choices the dropdowns offer.
// The pure parsing and link-building lives in list-params.ts so the
// client-side filter bar can share it.

const insensitive = "insensitive" as const;

export function companyWhere(organizationId: string, p: ListParams): Prisma.CompanyWhereInput {
  const and: Prisma.CompanyWhereInput[] = [{ organizationId }];
  if (p.q) {
    and.push({
      OR: [
        { name: { contains: p.q, mode: insensitive } },
        { city: { contains: p.q, mode: insensitive } },
        { state: { contains: p.q, mode: insensitive } },
        { email: { contains: p.q, mode: insensitive } },
        { phone: { contains: p.q } },
      ],
    });
  }
  if (p.states.length) and.push({ state: { in: p.states, mode: insensitive } });
  if (p.industries.length) and.push({ industries: { hasSome: p.industries } });
  if (p.types.length) and.push({ companyTypes: { hasSome: p.types.filter((t) => t !== INDIVIDUAL_COMPANY_TYPE) } });
  if (p.companies.length) and.push({ id: { in: p.companies } });
  if (p.fav) and.push({ favorite: true });
  if (p.deals) and.push({ contacts: { some: { deals: { some: {} } } } });
  // Needs attention: nothing known about it beyond a name, or no industry.
  if (p.attn) and.push({ OR: [{ industries: { isEmpty: true } }, { AND: [{ phone: null }, { email: null }] }] });
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
    where: { organizationId, name: { contains: q, mode: insensitive } },
    select: { id: true },
    take: COMPANY_MATCH_CAP,
  });
  return rows.map((row) => row.id);
}

export function contactWhere(organizationId: string, p: ListParams, companyIds: string[] = []): Prisma.ContactWhereInput {
  const and: Prisma.ContactWhereInput[] = [{ organizationId }];
  if (p.q) {
    and.push({
      OR: [
        { name: { contains: p.q, mode: insensitive } },
        { email: { contains: p.q, mode: insensitive } },
        { phone: { contains: p.q } },
        { city: { contains: p.q, mode: insensitive } },
        ...(companyIds.length ? [{ companyId: { in: companyIds } }] : []),
      ],
    });
  }
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
  if (p.fav) and.push({ favorite: true });
  if (p.deals) and.push({ deals: { some: {} } });
  // Needs attention: no way to reach them, or a company nobody has tagged.
  if (p.attn) {
    and.push({
      OR: [{ AND: [{ email: null }, { phone: null }] }, { company: { industries: { isEmpty: true } } }],
    });
  }
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
    getIndustryPickList(organizationId),
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
