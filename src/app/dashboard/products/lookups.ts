import { prisma } from "@/lib/prisma";
import { getServiceTypes } from "@/lib/service-types";
import { COLUMN_ROLES, type ColumnRole } from "@/lib/price-list";
import { LINK_STATUS, loadPlatformSuppliers, stillListed } from "@/lib/platform-suppliers";
import type { RatesheetSupplier } from "./import-ratesheet";

// The pick lists on the product form, scoped to the workspace, plus the
// suppliers on Software Connect Brands it can pick from. Both pages that
// render the form need the same shape, so it lives here.
export async function loadProductLookups(organizationId: string) {
  const [manufacturers, distributorRows, serviceTypes, platformSuppliers] = await Promise.all([
    prisma.manufacturer.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.distributor.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        platformOrganizationId: true,
        ...LINK_STATUS,
        contacts: {
          orderBy: { name: "asc" },
          select: { id: true, name: true, email: true, phone: true },
        },
      },
    }),
    getServiceTypes(organizationId),
    loadPlatformSuppliers(organizationId),
  ]);
  const distributors = distributorRows.map(({ platformOrganization, platformOrganizationId, ...row }) => ({
    ...row,
    linked: platformOrganizationId !== null,
    onPlatform: stillListed(platformOrganization),
  }));
  return { manufacturers, distributors, serviceTypes, platformSuppliers };
}

// "Who sent it?" on Import Ratesheet: every supplier with its people, and
// how its last sheet was read and priced. The remembered columns are
// checked here, since they come back from a JSON column.
export async function loadRatesheetSuppliers(organizationId: string): Promise<RatesheetSupplier[]> {
  const suppliers = await prisma.distributor.findMany({
    where: { organizationId },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      platformOrganizationId: true,
      ...LINK_STATUS,
      priceRule: true,
      priceRuleBasisPoints: true,
      ratesheetColumns: true,
      contacts: {
        orderBy: { name: "asc" },
        select: { id: true, name: true, email: true, phone: true },
      },
    },
  });
  const roles = new Set<string>(COLUMN_ROLES);
  return suppliers.map(({ platformOrganization, platformOrganizationId, ...supplier }) => {
    const raw = supplier.ratesheetColumns;
    let columns: Record<string, ColumnRole[]> | null = null;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      columns = {};
      for (const [signature, list] of Object.entries(raw as Record<string, unknown>)) {
        if (Array.isArray(list) && list.every((role) => typeof role === "string" && roles.has(role))) {
          columns[signature] = list as ColumnRole[];
        }
      }
    }
    return {
      ...supplier,
      linked: platformOrganizationId !== null,
      onPlatform: stillListed(platformOrganization),
      ratesheetColumns: columns,
    };
  });
}
