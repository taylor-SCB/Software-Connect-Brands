import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { ProductFilterOptions, ProductListParams } from "@/lib/product-list-params";

// The database side of the Products list; what it is narrowed by lives in
// product-list-params.ts, which the browser's filter bar imports too.

// Each word has to turn up somewhere — name, part number, description or
// manufacturer — so "copper 3/4" finds "Copper pipe 3/4in" and a part
// number finds its product, in any order.
export function productSearchWhere(q: string): Prisma.ProductWhereInput[] {
  const words = q.split(" ").filter(Boolean).slice(0, 6);
  return words.map((word) => ({
    OR: [
      { name: { contains: word, mode: "insensitive" } },
      { sku: { contains: word, mode: "insensitive" } },
      { description: { contains: word, mode: "insensitive" } },
      { manufacturer: { name: { contains: word, mode: "insensitive" } } },
    ],
  }));
}

export function productWhere(organizationId: string, params: ProductListParams): Prisma.ProductWhereInput {
  const and: Prisma.ProductWhereInput[] = productSearchWhere(params.q);
  if (params.suppliers.length) and.push({ distributorId: { in: params.suppliers } });
  if (params.makers.length) and.push({ manufacturerId: { in: params.makers } });
  if (params.tags.length) and.push({ defaultTag: { in: params.tags } });
  if (params.services.length) and.push({ serviceType: { in: params.services } });
  // One of the two is a filter; both is the same as neither.
  if (params.statuses.length === 1) and.push({ active: params.statuses[0] === "active" });
  return { organizationId, ...(and.length ? { AND: and } : {}) };
}

// What the dropdowns offer: the suppliers, manufacturers and kinds of work
// the workspace's products actually carry, so a dropdown never lists a
// dead end. Whatever is ticked in the address bar is always among
// them, named, even past the cap or with its products gone, so it can be
// seen and unticked.
export async function getProductFilterOptions(organizationId: string, params: ProductListParams): Promise<ProductFilterOptions> {
  const [suppliers, makers, services] = await Promise.all([
    prisma.distributor.findMany({
      where: { organizationId, OR: [{ products: { some: {} } }, { id: { in: params.suppliers } }] },
      orderBy: { name: "asc" },
      take: 500,
      select: { id: true, name: true },
    }),
    prisma.manufacturer.findMany({
      where: { organizationId, OR: [{ products: { some: {} } }, { id: { in: params.makers } }] },
      orderBy: { name: "asc" },
      take: 1000,
      select: { id: true, name: true },
    }),
    prisma.product.findMany({
      where: { organizationId, serviceType: { not: null } },
      distinct: ["serviceType"],
      orderBy: { serviceType: "asc" },
      take: 300,
      select: { serviceType: true },
    }),
  ]);
  const missing = async <T extends { id: string }>(rows: T[], ticked: string[], load: (ids: string[]) => Promise<T[]>) => {
    const absent = ticked.filter((id) => !rows.some((row) => row.id === id));
    return absent.length ? [...rows, ...(await load(absent))] : rows;
  };
  return {
    suppliers: await missing(suppliers, params.suppliers, (ids) =>
      prisma.distributor.findMany({ where: { organizationId, id: { in: ids } }, select: { id: true, name: true } }),
    ),
    makers: await missing(makers, params.makers, (ids) =>
      prisma.manufacturer.findMany({ where: { organizationId, id: { in: ids } }, select: { id: true, name: true } }),
    ),
    services: Array.from(new Set([...services.map((row) => row.serviceType ?? ""), ...params.services])).filter(Boolean),
  };
}
