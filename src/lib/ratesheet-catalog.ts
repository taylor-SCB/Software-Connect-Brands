import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { skuKey, type CatalogItem, type CatalogSupplierRow } from "@/lib/price-list";

// The catalog as a ratesheet sees it: the products a sheet's part numbers
// or names could match, and everything a supplier already sells you, with
// every supplier on each. Shared by Import Ratesheet and See product list
// (Release 3a). Server-only, outside any "use server" file.

export type CatalogRow = {
  id: string;
  name: string;
  sku: string | null;
  costCents: number;
  unitPriceCents: number;
  listPriceCents: number | null;
  distributorId: string | null;
  distributorName: string | null;
  active: boolean;
  createdAt: Date;
  suppliers: CatalogSupplierRow[];
};

// Every supplier with a row on the product (Release 3a), their price,
// discount and MSRP. A product with a supplier but no rows yet (made by
// code from before suppliers had rows, or seeded by hand) reads as
// supplied by that one at its own cost, so nothing treats it as
// supplier-less.
const SUPPLIER_ROWS = Prisma.sql`
  CASE WHEN EXISTS (SELECT 1 FROM "ProductSupplier" x WHERE x."productId" = p."id")
       THEN (SELECT json_agg(json_build_object('distributorId', ps."distributorId", 'costCents', ps."costCents",
                                               'discountBp', ps."discountBp", 'listPriceCents', ps."listPriceCents")
                             ORDER BY ps."createdAt", ps."id")
               FROM "ProductSupplier" ps WHERE ps."productId" = p."id")
       WHEN p."distributorId" IS NOT NULL
       THEN json_build_array(json_build_object('distributorId', p."distributorId", 'costCents', p."costCents",
                                               'discountBp', 0, 'listPriceCents', p."listPriceCents"))
       ELSE '[]'::json END AS "suppliers"`;

// The keys are built the same way skuKey() and the planner's name key
// build theirs: case, spaces, dashes and underscores ignored, leading
// zeros dropped from an all-digit part number.
export function catalogKeys(skus: string[], names: string[]) {
  return {
    skuKeys: [...new Set(skus.map(skuKey).filter(Boolean))],
    nameKeys: [...new Set(names.map((name) => name.trim().toLowerCase().replace(/\s+/g, " ")).filter(Boolean))],
  };
}

// Products a sheet's part numbers or names could match.
export async function catalogByKeys(organizationId: string, skuKeys: string[], nameKeys: string[]) {
  if (skuKeys.length === 0 && nameKeys.length === 0) return [];
  return prisma.$queryRaw<CatalogRow[]>`
    SELECT p."id", p."name", p."sku", p."costCents", p."unitPriceCents", p."listPriceCents",
           p."distributorId", d."name" AS "distributorName", p."active", p."createdAt", ${SUPPLIER_ROWS}
      FROM "Product" p
      LEFT JOIN "Distributor" d ON d."id" = p."distributorId"
      CROSS JOIN LATERAL (
        SELECT regexp_replace(lower(btrim(coalesce(p."sku", ''))), '[[:space:]_-]+', '', 'g') AS k
      ) raw
     WHERE p."organizationId" = ${organizationId}
       AND (
         (p."sku" IS NOT NULL AND
           (CASE WHEN raw.k ~ '^[0-9]+$' THEN regexp_replace(raw.k, '^0+([0-9])', '\\1') ELSE raw.k END)
             = ANY(${skuKeys}::text[]))
         OR lower(regexp_replace(btrim(p."name"), '\\s+', ' ', 'g')) = ANY(${nameKeys}::text[])
       )`;
}

// Everything already bought from this supplier — starred or not — a page
// at a time (for "not on this sheet anymore" and for its own products
// winning a tie).
export async function catalogBySupplier(organizationId: string, supplierId: string, after: string | null, take: number) {
  return prisma.$queryRaw<CatalogRow[]>`
    SELECT p."id", p."name", p."sku", p."costCents", p."unitPriceCents", p."listPriceCents",
           p."distributorId", d."name" AS "distributorName", p."active", p."createdAt", ${SUPPLIER_ROWS}
      FROM "Product" p
      LEFT JOIN "Distributor" d ON d."id" = p."distributorId"
     WHERE p."organizationId" = ${organizationId}
       AND (p."distributorId" = ${supplierId}
            OR EXISTS (SELECT 1 FROM "ProductSupplier" ps WHERE ps."productId" = p."id" AND ps."distributorId" = ${supplierId}))
       AND (${after}::text IS NULL OR p."id" > ${after}::text)
     ORDER BY p."id" ASC
     LIMIT ${take}`;
}

// Oldest first, so when two products share a key the planner meets the
// same one in the preview and on the server.
export function mergeCatalog(rows: CatalogRow[]): CatalogItem[] {
  const byId = new Map<string, CatalogRow>();
  for (const row of rows) byId.set(row.id, row);
  return [...byId.values()]
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
    .map((row) => ({
      id: row.id,
      name: row.name,
      sku: row.sku,
      costCents: row.costCents,
      unitPriceCents: row.unitPriceCents,
      listPriceCents: row.listPriceCents,
      distributorId: row.distributorId,
      distributorName: row.distributorName,
      active: row.active,
      supplierIds: row.suppliers.map((supplier) => supplier.distributorId),
      suppliers: row.suppliers,
    }));
}

// The server's own read: every key on the sheet, every product of the
// supplier, no caps — it never leaves the server.
export async function loadCatalogFor(
  organizationId: string,
  supplierId: string | null,
  skus: string[],
  names: string[],
): Promise<CatalogItem[]> {
  const { skuKeys, nameKeys } = catalogKeys(skus, names);
  const rows = await catalogByKeys(organizationId, skuKeys, nameKeys);
  if (supplierId) {
    let after: string | null = null;
    for (;;) {
      const page = await catalogBySupplier(organizationId, supplierId, after, 10_000);
      rows.push(...page);
      if (page.length < 10_000) break;
      after = page[page.length - 1].id;
    }
  }
  return mergeCatalog(rows);
}

