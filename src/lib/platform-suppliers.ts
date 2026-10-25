import { prisma } from "@/lib/prisma";
import { SUPPLIER_ACCOUNT_TYPES, platformSupplierLabel, type PlatformSupplier } from "@/lib/account-types";
import { bridgeDistributor, linkDistributorCompany } from "@/lib/distributors";

// Suppliers on the platform (Release 2, Oct 25, 2026): approved
// Distributor, Hardware / OEM and Software Provider accounts, listed in
// every supplier picker of every other workspace as "On Software Connect
// Brands" (Taylor: automatically, by name, city and state; a Business /
// Vendor is never listed). Picking one links the workspace's own supplier
// record — the Distributor and its Company — to that account
// (Distributor.platformOrganizationId). Nothing else of theirs is shared.

// The most a picker lists. A native <select> past a few hundred rows is
// no longer a pick list; a searched box is the fix when the platform has
// that many suppliers.
export const PLATFORM_SUPPLIER_CAP = 200;

// Who is listed, from where a given workspace stands: never itself.
function listedFor(organizationId: string) {
  return {
    status: "ACTIVE" as const,
    accountType: { in: [...SUPPLIER_ACCOUNT_TYPES] },
    id: { not: organizationId },
  };
}

export { stillListed } from "@/lib/account-types";

// Selected beside a supplier record to work out stillListed.
export const LINK_STATUS = { platformOrganization: { select: { status: true, accountType: true } } } as const;

// Only the four fields the picker shows ever leave the server.
const PUBLIC_FIELDS = { id: true, name: true, city: true, state: true, accountType: true } as const;

/** The platform suppliers this workspace has not linked yet, by name. */
export async function loadPlatformSuppliers(organizationId: string): Promise<PlatformSupplier[]> {
  return prisma.organization.findMany({
    where: { ...listedFor(organizationId), platformSupplierLinks: { none: { organizationId } } },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: PLATFORM_SUPPLIER_CAP,
    select: PUBLIC_FIELDS,
  });
}

/** One platform supplier as the picker would show it, or null if it isn't listed. */
export async function findPlatformSupplier(
  organizationId: string,
  platformOrganizationId: string,
): Promise<PlatformSupplier | null> {
  if (!platformOrganizationId) return null;
  // AND, not a spread: an `id` key beside listedFor's would replace its
  // "not this workspace", and a supplier could pick itself.
  return prisma.organization.findFirst({
    where: { AND: [listedFor(organizationId), { id: platformOrganizationId }] },
    select: PUBLIC_FIELDS,
  });
}

// A name as every supplier comparison reads it: trimmed, runs of spaces
// as one. An account's own name can carry two spaces (Branding only
// trims); the screen and linkDistributorCompany both squeeze them.
export const squeeze = (name: string) => name.trim().replace(/\s+/g, " ");

export const NOT_LISTED = "That company isn't listed on Software Connect Brands any more. Pick another supplier.";

type Linked = { ok: true; distributorId: string; companyId: string; name: string } | { ok: false; error: string };

/**
 * This workspace's supplier for a platform account, made or found and
 * linked. The id comes off a form, so the account is checked again here:
 * listed, a supplier type, approved, and not this workspace.
 *
 *  1. Already linked here: that supplier, bridged to its Company if it
 *     somehow isn't.
 *  2. Otherwise the supplier of that name (linkDistributorCompany: the
 *     same case-insensitive name match every other "+ Add new" uses, so
 *     a supplier typed in before the account joined is linked, not
 *     doubled), claimed for the account.
 *  3. When that one is already linked to a different account of the same
 *     name, a separate supplier named with the account's city and state.
 */
export async function linkPlatformSupplier(organizationId: string, platformOrganizationId: string): Promise<Linked> {
  const platform = await findPlatformSupplier(organizationId, platformOrganizationId);
  if (!platform) return { ok: false, error: NOT_LISTED };

  const existing = await linkedSupplier(organizationId, platform.id);
  if (existing) return existing;

  const place = [platform.city, platform.state].filter(Boolean).join(", ");
  const base = squeeze(platform.name);
  const names = [base, place ? `${base} (${place})` : null, `${base} (2)`].filter(
    (name): name is string => Boolean(name),
  );
  for (const name of names) {
    // A supplier of this name already linked to a different account (two
    // accounts can share a name) is that account's: skip it before
    // linkDistributorCompany touches its company.
    const sameName = await prisma.$queryRaw<{ platformOrganizationId: string | null }[]>`
      SELECT "platformOrganizationId" FROM "Distributor"
       WHERE "organizationId" = ${organizationId}
         AND lower(regexp_replace(btrim("name"), '\\s+', ' ', 'g')) = lower(${name})
       ORDER BY "createdAt" ASC LIMIT 1`;
    if (sameName[0]?.platformOrganizationId && sameName[0].platformOrganizationId !== platform.id) continue;
    const pair = await linkDistributorCompany(organizationId, name);
    if (!pair) continue;
    try {
      const claimed = await prisma.distributor.updateMany({
        where: { id: pair.distributorId, organizationId, platformOrganizationId: null },
        data: { platformOrganizationId: platform.id, platformLinkedAs: platformSupplierLabel(platform), platformLinkedAt: new Date() },
      });
      if (claimed.count === 1) return { ok: true, ...pair };
    } catch (error) {
      // Another request linked a different supplier to this account a
      // moment ago (one per account per workspace): use that one.
      if ((error as { code?: string })?.code !== "P2002") throw error;
      const raced = await linkedSupplier(organizationId, platform.id);
      if (raced) return raced;
      throw error;
    }
    // Claimed already. By this account (a double click): use it. By
    // another account with this name: try the next name.
    const raced = await linkedSupplier(organizationId, platform.id);
    if (raced) return raced;
  }
  return { ok: false, error: `Couldn't link ${platform.name}. Add them by hand with + Add new instead.` };
}

async function linkedSupplier(organizationId: string, platformOrganizationId: string): Promise<Linked | null> {
  const row = await prisma.distributor.findUnique({
    where: { organizationId_platformOrganizationId: { organizationId, platformOrganizationId } },
    select: { id: true, name: true, companyId: true },
  });
  if (!row) return null;
  if (row.companyId) return { ok: true, distributorId: row.id, companyId: row.companyId, name: row.name };
  // Linked but its company is gone (deleted, or merged away): give this
  // record a company of its own, never another supplier's pair.
  const companyId = await bridgeDistributor(organizationId, row.id);
  if (!companyId) return { ok: false, error: `Couldn't link ${row.name}. Try again.` };
  return { ok: true, distributorId: row.id, companyId, name: row.name };
}
