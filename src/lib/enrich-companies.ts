import { prisma } from "@/lib/prisma";
import { ensureIndustryOptions } from "@/lib/industries";
import {
  copyUpFromContacts,
  emptyEnrichCounts,
  mergeContactHints,
  pickListRequest,
  suggestTags,
  websiteDomain,
  type AutoField,
  type ContactHint,
  type EnrichCounts,
  type TagSuggestion,
} from "@/lib/enrich";
import type { Prisma } from "@/generated/prisma/client";

// The database side of company enrichment, shared by the CSV import
// (every company a batch touches) and "Fill in missing" on the Companies
// list. The rules themselves live in src/lib/enrich.ts; this file only
// loads what they need, applies what they say, and counts.

// One company's people are enough signal; past this the rest add nothing
// and a company with thousands of contacts would drag them all through
// the server for every batch. The newest come first, so the people just
// imported are always inside the cap.
const CONTACTS_PER_COMPANY = 200;

// A company with no industry and no type at all.
export const untaggedWhere: Prisma.CompanyWhereInput = { AND: [{ industries: { isEmpty: true } }, { companyTypes: { isEmpty: true } }] };

// A company there is something to fill in for: untagged, or no phone, or
// no website. The same test as needsSomething below, for the database.
export const needsFillWhere: Prisma.CompanyWhereInput = { OR: [untaggedWhere, { phone: null }, { website: null }] };

export type EnrichableCompany = {
  id: string;
  name: string;
  phone: string | null;
  website: string | null;
  industries: string[];
  companyTypes: string[];
  autoFilled: string[];
  updatedAt: Date;
  contacts: ContactHint[];
};

// Only companies with a blank to fill come back, so a re-import into a
// workspace that is already complete loads nothing — and none of its
// people. `batchRows` are the people an import just wrote, by company id:
// they are merged in ahead of what is on file, so a batch's own rows
// always count even for a company whose people outnumber the cap.
export async function loadCompaniesForEnrichment(
  organizationId: string,
  ids: string[],
  batchRows?: Map<string, ContactHint[]>,
): Promise<EnrichableCompany[]> {
  if (ids.length === 0) return [];
  const companies = await prisma.company.findMany({
    where: { organizationId, id: { in: ids }, ...needsFillWhere },
    select: {
      id: true,
      name: true,
      phone: true,
      website: true,
      industries: true,
      companyTypes: true,
      autoFilled: true,
      updatedAt: true,
      contacts: {
        select: { phone: true, email: true, title: true, website: true },
        orderBy: { createdAt: "desc" },
        take: CONTACTS_PER_COMPANY,
      },
    },
  });
  if (!batchRows) return companies;
  return companies.map((company) => ({ ...company, contacts: mergeContactHints(batchRows.get(company.id) ?? [], company.contacts) }));
}

// Takes these "auto" marks off a company on the database side, whatever
// the row holds by then. A caller that read the company a moment ago
// cannot know whether "Fill in missing" marked a field in between, so
// writing back the list it read could leave a stale mark (or wipe a fresh
// one); the database removes just the names asked for. Only rows that
// carry one of them are touched. Runs as raw SQL because Prisma can only
// replace a list whole, not take names out of it.
export function dropAutoMarks(organizationId: string, companyId: string, fields: AutoField[]) {
  const names = fields as string[];
  return prisma.$executeRaw`
    UPDATE "Company"
    SET "autoFilled" = array(SELECT f FROM unnest("autoFilled") AS f WHERE f <> ALL(${names}::text[]))
    WHERE id = ${companyId} AND "organizationId" = ${organizationId} AND "autoFilled" && ${names}::text[]`;
}

const needsTags = (c: EnrichableCompany) => c.industries.length === 0 && c.companyTypes.length === 0;
const needsSomething = (c: EnrichableCompany) => needsTags(c) || !c.phone || !c.website;

type FilledField = "tagged" | "phonesFilled" | "websitesFilled";

// Fills the blanks on these companies from what the workspace already
// has, and only the blanks: nothing a person typed is touched. Every
// write keeps the company's updatedAt, so the lists stay in the order
// the user last saw them. Returns what was filled in.
export async function enrichCompanies(organizationId: string, companies: EnrichableCompany[]): Promise<EnrichCounts> {
  const counts = emptyEnrichCounts();
  const todo = companies.filter(needsSomething);
  if (todo.length === 0) return counts;

  // First pass: what each rule suggests.
  const plans = todo.map((company) => {
    const suggestion = needsTags(company)
      ? suggestTags({
          name: company.name,
          website: company.website ?? company.contacts.find((c) => c.website)?.website ?? null,
          titles: company.contacts.map((c) => c.title),
          emails: company.contacts.map((c) => c.email),
        })
      : null;
    const copied = !company.phone || !company.website ? copyUpFromContacts(company.contacts) : { phone: null, website: null };
    return {
      company,
      suggestion,
      phone: !company.phone ? copied.phone : null,
      website: !company.website ? copied.website : null,
    };
  });

  // A website already on another company in the workspace (or wanted by
  // two companies in this batch) is not this company's; leave it blank.
  // Compared by domain, since people type websites every which way:
  // "https://www.acme.com/" on file blocks "https://acme.com" here.
  const wanted = new Map<string, number>();
  for (const plan of plans) {
    const domain = websiteDomain(plan.website);
    if (!domain) plan.website = null;
    else wanted.set(domain, (wanted.get(domain) ?? 0) + 1);
  }
  if (wanted.size > 0) {
    // One pass over the workspace's websites, each reduced to its domain
    // on the database side (the same trim as websiteDomain: no scheme, no
    // "www.", nothing past the first slash) and looked up in the batch's
    // candidates by plain equality. A pattern per candidate ("contains
    // acme.com", five hundred times) took seconds a batch at 40,000
    // companies; this takes a moment. The websiteDomain check on what
    // comes back is the same rule again, in case the two ever differ.
    const domains = Array.from(wanted.keys());
    const onFile = await prisma.$queryRaw<{ website: string }[]>`
      SELECT website FROM "Company"
      WHERE "organizationId" = ${organizationId} AND website IS NOT NULL
        AND regexp_replace(regexp_replace(lower(btrim(website)), '^(https?://)?(www\\.)?', ''), '[/?#].*$', '') = ANY(${domains}::text[])`;
    for (const row of onFile) {
      const domain = websiteDomain(row.website);
      if (domain && wanted.has(domain)) wanted.set(domain, 99);
    }
    for (const plan of plans) {
      const domain = websiteDomain(plan.website);
      if (domain && (wanted.get(domain) ?? 0) > 1) plan.website = null;
    }
  }

  // The pick lists grow once for the whole batch; the spellings that come
  // back are the workspace's own (an existing "mdu" row wins over "MDU").
  const suggestions = plans.map((p) => p.suggestion).filter((s): s is TagSuggestion => Boolean(s));
  let canonIndustry = (name: string) => name;
  let canonType = (name: string) => name;
  if (suggestions.length > 0) {
    const request = pickListRequest(suggestions);
    const canonical = await ensureIndustryOptions(organizationId, request.industries, request.typesByIndustry);
    const lower = (v: string) => v.toLowerCase();
    canonIndustry = (name) => canonical.industries.find((c) => lower(c) === lower(name)) ?? name;
    canonType = (name) => canonical.companyTypes.find((c) => lower(c) === lower(name)) ?? name;
  }

  // One write per field, each guarded by "still blank" and "unchanged
  // since it was read": a phone, website or tag a person saved between
  // the read above and this write stays theirs (and is not marked auto),
  // and a company edited in the meantime is skipped whole for the next
  // run to pick up. The count each write returns says whether it landed.
  // @updatedAt only stamps the row when no value is given; handing the
  // old one back keeps "last changed" honest — the app filling a blank
  // is not the user changing the company.
  const now = new Date();
  const writes: Prisma.PrismaPromise<{ count: number }>[] = [];
  const fields: FilledField[] = [];
  for (const plan of plans) {
    const { company } = plan;
    const stillTagless = needsTags(company) && !plan.suggestion;
    if (stillTagless || (!company.phone && !plan.phone) || (!company.website && !plan.website)) counts.stillMissing += 1;
    const asRead = { id: company.id, organizationId, updatedAt: company.updatedAt };
    const stamp = { enrichedAt: now, updatedAt: company.updatedAt };
    const mark = (add: AutoField[]) => {
      const missing = add.filter((field) => !company.autoFilled.includes(field));
      return missing.length > 0 ? { autoFilled: { push: missing } } : {};
    };
    if (plan.suggestion) {
      writes.push(
        prisma.company.updateMany({
          where: { ...asRead, ...untaggedWhere },
          data: {
            industries: [canonIndustry(plan.suggestion.industry)],
            companyTypes: [canonType(plan.suggestion.companyType)],
            ...mark(["industries", "companyTypes"]),
            ...stamp,
          },
        }),
      );
      fields.push("tagged");
    }
    if (plan.phone) {
      writes.push(prisma.company.updateMany({ where: { ...asRead, phone: null }, data: { phone: plan.phone, ...mark(["phone"]), ...stamp } }));
      fields.push("phonesFilled");
    }
    if (plan.website) {
      writes.push(prisma.company.updateMany({ where: { ...asRead, website: null }, data: { website: plan.website, ...mark(["website"]), ...stamp } }));
      fields.push("websitesFilled");
    }
  }
  if (writes.length > 0) {
    const results = await prisma.$transaction(writes);
    results.forEach((result, i) => {
      counts[fields[i]] += result.count;
    });
  }
  return counts;
}
