import { prisma } from "@/lib/prisma";
import { ensureIndustryOptions, type IndustryPickList } from "@/lib/industries";
import { DISTRIBUTOR_COMPANY_TYPE } from "@/lib/distributor-type";

export { DISTRIBUTOR_COMPANY_TYPE } from "@/lib/distributor-type";

const SERVICE_PROVIDER_INDUSTRY = "Service Provider";

// Distributor was added to the default pick lists after workspaces already
// existed, and seedIndustries upserts each industry with `update: {}` — so
// a new type under an existing industry reaches nobody. This tops it up
// lazily instead. The check is against the list already in memory, so in
// the normal case it costs no extra query: getIndustryPickList runs on
// every Contacts and Companies page load, which is held to a 2s budget at
// 200,000 rows.
// Returns true when it added the type, so the caller knows to re-read.
export async function ensureDistributorType(
  organizationId: string,
  pickList: IndustryPickList,
): Promise<boolean> {
  const present = pickList.some((industry) =>
    industry.types.some((type) => type.toLowerCase() === DISTRIBUTOR_COMPANY_TYPE.toLowerCase()),
  );
  if (present) return false;

  await ensureIndustryOptions(organizationId, [], {
    [SERVICE_PROVIDER_INDUSTRY]: [DISTRIBUTOR_COMPANY_TYPE],
  });
  return true;
}

// Makes sure the workspace's pick list carries the Distributor type, and
// returns the spelling it uses. Call this before tagging a company, so no
// company ever carries a type with no pick-list row behind it.
export async function ensureDistributorTypeName(organizationId: string): Promise<string> {
  const { companyTypes } = await ensureIndustryOptions(
    organizationId,
    [SERVICE_PROVIDER_INDUSTRY],
    { [SERVICE_PROVIDER_INDUSTRY]: [DISTRIBUTOR_COMPANY_TYPE] },
  );
  return companyTypes[0] ?? DISTRIBUTOR_COMPANY_TYPE;
}

// This workspace's canonical spelling of the type, since Company.companyTypes
// is matched with Prisma `has` — which compiles to Postgres `@>` and is
// byte-exact. A workspace that imported "distributor" in lower case would
// otherwise never match.
export async function distributorTypeName(organizationId: string): Promise<string> {
  const option = await prisma.companyTypeOption.findFirst({
    where: { organizationId, name: { equals: DISTRIBUTOR_COMPANY_TYPE, mode: "insensitive" } },
    select: { name: true },
  });
  return option?.name ?? DISTRIBUTOR_COMPANY_TYPE;
}

// The companies offered as a line's Supplier / Contractor. `keepIds` are
// suppliers already linked on this quote: they are fetched again and
// offered back even when they no longer carry the type or fall outside the
// cap, because a <select> whose saved value is missing from its options
// silently shows the first one and the next save writes it.
export async function loadDistributorCompanies(
  organizationId: string,
  keepIds: string[] = [],
): Promise<{ id: string; name: string; stillADistributor: boolean }[]> {
  await backfillDistributorCompanies(organizationId);
  const typeName = await distributorTypeName(organizationId);

  const listed = await prisma.company.findMany({
    where: {
      organizationId,
      companyTypes: { has: typeName },
      status: { not: "ARCHIVED" },
    },
    orderBy: [{ favorite: "desc" }, { name: "asc" }],
    take: 300,
    select: { id: true, name: true },
  });

  const listedIds = new Set(listed.map((company) => company.id));
  const missing = keepIds.filter((id) => id && !listedIds.has(id));
  const kept = missing.length
    ? await prisma.company.findMany({
        where: { id: { in: missing }, organizationId },
        select: { id: true, name: true },
      })
    : [];

  return [
    ...listed.map((company) => ({ ...company, stillADistributor: true })),
    ...kept.map((company) => ({ ...company, stillADistributor: false })),
  ];
}

// Distributors added from the Products page before this existed have no
// Company behind them, which would leave every supplier a workspace
// already had missing from the quote's picker. Give each one its company
// the first time the picker is opened. In steady state the lookup finds
// nothing and writes nothing; distributors are typed by hand, so even the
// first run is a handful of rows.
export async function backfillDistributorCompanies(organizationId: string): Promise<void> {
  const unlinked = await prisma.distributor.findMany({
    where: { organizationId, companyId: null },
    orderBy: { createdAt: "asc" },
    take: 200,
    select: { name: true },
  });
  for (const distributor of unlinked) {
    await linkDistributorCompany(organizationId, distributor.name);
  }
}

// Creates or finds the Company for a supplier and links the matching
// Distributor record to it, so the Products page and the quote's supplier
// picker are always looking at the same business. Without both halves,
// "Acme Supply" becomes two records that never meet.
export async function linkDistributorCompany(
  organizationId: string,
  rawName: string,
): Promise<{ companyId: string; distributorId: string; name: string } | null> {
  const name = rawName.trim().replace(/\s+/g, " ").slice(0, 160);
  if (!name) return null;

  // Do this first so the company is never tagged with a type the pick list
  // does not carry — an orphan type renders under "Other" and would be
  // invisible to the supplier picker.
  const typeName = await ensureDistributorTypeName(organizationId);

  // lower() rather than Prisma's insensitive equals, which compiles to
  // ILIKE and would read % and _ in a company name as wildcards.
  const matches = await prisma.$queryRaw<
    { id: string; name: string; companyTypes: string[]; industries: string[] }[]
  >`
    SELECT "id", "name", "companyTypes", "industries" FROM "Company"
     WHERE "organizationId" = ${organizationId}
       AND lower("name") = lower(${name})
     ORDER BY "createdAt" ASC
     LIMIT 1`;
  const existing = matches[0] ?? null;

  let companyId: string;
  let companyName: string;
  if (existing) {
    // A name that is already on the books is not a dead end: add the type
    // to what it already is. "That name is taken" inside a table cell is.
    const alreadyTyped = existing.companyTypes.some(
      (type) => type.toLowerCase() === typeName.toLowerCase(),
    );
    if (!alreadyTyped) {
      await prisma.company.update({
        where: { id: existing.id },
        data: {
          companyTypes: [...existing.companyTypes, typeName],
          industries: existing.industries.some((i) => i.toLowerCase() === SERVICE_PROVIDER_INDUSTRY.toLowerCase())
            ? existing.industries
            : [...existing.industries, SERVICE_PROVIDER_INDUSTRY],
        },
      });
    }
    companyId = existing.id;
    companyName = existing.name;
  } else {
    const created = await prisma.company.create({
      data: {
        organizationId,
        name,
        industries: [SERVICE_PROVIDER_INDUSTRY],
        companyTypes: [typeName],
      },
      select: { id: true, name: true },
    });
    companyId = created.id;
    companyName = created.name;
  }

  // Now the Distributor half. Three cases, in this order, so the pair is
  // always bridged and a second record is never made for one business:
  //
  //  1. The company is already claimed by a distributor — that IS the
  //     bridge, whatever it is called. Reuse it.
  //  2. A distributor of this name exists (matched without case, because
  //     orderFromSupplier leaves each row its own spelling) — point it at
  //     the company.
  //  3. Neither — create the pair.
  //
  // Distributor.companyId is unique, so case 1 has to come first; and the
  // name lookup has to be the same case-insensitive one the create would
  // collide on, or an upsert keyed on the exact name makes a duplicate and
  // then throws on the unique companyId.
  const claimed = await prisma.distributor.findUnique({
    where: { companyId },
    select: { id: true },
  });

  let distributorId: string;
  if (claimed) {
    distributorId = claimed.id;
  } else {
    const byName = await prisma.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Distributor"
       WHERE "organizationId" = ${organizationId}
         AND lower("name") = lower(${companyName})
       ORDER BY "createdAt" ASC
       LIMIT 1`;
    if (byName.length > 0) {
      distributorId = byName[0].id;
      await prisma.distributor.update({ where: { id: distributorId }, data: { companyId } });
    } else {
      const created = await prisma.distributor.create({
        data: { organizationId, name: companyName, companyId },
        select: { id: true },
      });
      distributorId = created.id;
    }
  }
  const distributor = { id: distributorId };

  return { companyId, distributorId: distributor.id, name: companyName };
}
