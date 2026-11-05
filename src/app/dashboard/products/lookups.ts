import { prisma } from "@/lib/prisma";
import { getServiceTypes } from "@/lib/service-types";
import { COLUMN_ROLES, type ColumnRole } from "@/lib/price-list";
import { LINK_STATUS, loadPlatformSuppliers, stillListed } from "@/lib/platform-suppliers";
import type { RatesheetSupplier } from "./import-ratesheet";
import { getCustomUnits, getVariationGroups } from "@/lib/variations";
import type { CardGroup } from "./variations-card";
import type { FormCustomUnit } from "./product-form";

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
      // Their last imported sheet's COGS discount, which a new sheet from
      // them starts with (sheetDiscountFor).
      linkedRatesheets: {
        where: { importedAt: { not: null } },
        orderBy: { importedAt: "desc" },
        take: 1,
        select: { discountBp: true },
      },
    },
  });
  const roles = new Set<string>(COLUMN_ROLES);
  return suppliers.map(({ platformOrganization, platformOrganizationId, linkedRatesheets, ...supplier }) => {
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
      lastDiscountBp: linkedRatesheets[0]?.discountBp ?? 0,
    };
  });
}

// The product form's Variations card and Unit box (Release 3b): every live
// group and label, plus any retired one this product still has (drawn
// "(retired)" so it can be taken off on purpose), the labels it has, and
// the workspace's own units.
export async function loadVariationLookups(
  organizationId: string,
  product: { id: string; customUnitId: string | null } | null,
): Promise<{ variationGroups: CardGroup[]; savedVariationIds: string[]; customUnits: FormCustomUnit[] }> {
  const [groups, saved, units] = await Promise.all([
    getVariationGroups(organizationId, { includeArchived: true }),
    product
      ? prisma.productVariation.findMany({ where: { organizationId, productId: product.id }, select: { optionId: true } })
      : Promise.resolve([]),
    getCustomUnits(organizationId, [product?.customUnitId]),
  ]);
  const savedIds = new Set(saved.map((row) => row.optionId));
  const variationGroups: CardGroup[] = [];
  for (const group of groups) {
    // Retired labels come along too: drawn only when the product has them,
    // and known to the card so typing one says it was retired.
    const options = group.options
      .map((option) => ({
        id: option.id,
        name: option.name,
        retired: option.archived || group.archived,
        tag: option.tag,
        builtInUnit: option.builtInUnit,
        contains: option.contains,
        baseUnit: option.baseUnit,
      }));
    variationGroups.push({
      id: group.id,
      kind: group.kind,
      name: group.name,
      builtIn: group.builtIn,
      retired: group.archived,
      options,
    });
  }
  return { variationGroups, savedVariationIds: [...savedIds], customUnits: units };
}
