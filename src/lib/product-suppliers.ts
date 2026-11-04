import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { MAX_DISCOUNT_BP, effectiveCostCents } from "@/lib/supplier-math";

// A product's suppliers (Release 3a, Nov 4, 2026). The starred row is the
// one whose cost the product carries (Taylor's pick: a preferred supplier,
// moved by hand), so Product.distributorId, costCents and listPriceCents
// are kept as a mirror of it. Every reader that predates suppliers —
// quotes, contract cost capture, Order materials, the margin column —
// goes on reading the product and gets the starred supplier's numbers.

type Db = typeof prisma | Prisma.TransactionClient;

/**
 * Copy the starred row onto the product. A product whose rows have lost
 * their star (the starred one was removed) stars its oldest remaining row
 * first. A product with no rows left keeps the cost it had and loses its
 * supplier.
 */
export async function syncProductFromStar(db: Db, organizationId: string, productId: string): Promise<void> {
  let star = await db.productSupplier.findFirst({
    where: { productId, organizationId, preferredFor: productId },
    select: { distributorId: true, costCents: true, discountBp: true, listPriceCents: true },
  });
  if (!star) {
    const oldest = await db.productSupplier.findFirst({
      where: { productId, organizationId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    if (oldest) {
      try {
        await db.productSupplier.update({ where: { id: oldest.id }, data: { preferredFor: productId } });
      } catch (error) {
        // Starred by another request a moment ago; read whichever won.
        if ((error as { code?: string })?.code !== "P2002") throw error;
      }
      star = await db.productSupplier.findFirst({
        where: { productId, organizationId, preferredFor: productId },
        select: { distributorId: true, costCents: true, discountBp: true, listPriceCents: true },
      });
    }
  }
  if (!star) {
    await db.product.updateMany({ where: { id: productId, organizationId }, data: { distributorId: null } });
    return;
  }
  await db.product.updateMany({
    where: { id: productId, organizationId },
    data: {
      distributorId: star.distributorId,
      costCents: effectiveCostCents(star.costCents, star.discountBp),
      listPriceCents: star.listPriceCents,
    },
  });
}

/** Move the star to one supplier row of a product. */
export async function starSupplier(db: Db, organizationId: string, productId: string, distributorId: string): Promise<void> {
  // Cleared first: the star is unique, so it can't be on two rows even for
  // the moment between the two writes.
  await db.productSupplier.updateMany({
    where: { productId, organizationId, preferredFor: productId, distributorId: { not: distributorId } },
    data: { preferredFor: null },
  });
  await db.productSupplier.updateMany({
    where: { productId, organizationId, distributorId },
    data: { preferredFor: productId },
  });
}

const SYNC_CHUNK = 1000;

/**
 * The batch form of syncProductFromStar, for See product list's hundreds or
 * thousands of products at once: a product whose rows lost their star gets
 * its oldest row starred, every product with a star carries its cost, and
 * one with no rows left loses its supplier. Statements per chunk, never one
 * long transaction.
 */
export async function syncStarsFor(organizationId: string, productIds: string[]): Promise<void> {
  const ids = [...new Set(productIds)];
  for (let start = 0; start < ids.length; start += SYNC_CHUNK) {
    const chunk = ids.slice(start, start + SYNC_CHUNK);
    await prisma.$executeRaw`
      UPDATE "ProductSupplier" SET "preferredFor" = "productId"
       WHERE "id" IN (
         SELECT DISTINCT ON (r."productId") r."id"
           FROM "ProductSupplier" r
          WHERE r."productId" = ANY(${chunk}::text[])
            AND r."organizationId" = ${organizationId}
            AND NOT EXISTS (SELECT 1 FROM "ProductSupplier" s WHERE s."preferredFor" = r."productId")
          ORDER BY r."productId", r."createdAt", r."id")`;
    await prisma.$executeRaw`
      UPDATE "Product" AS p
         SET "distributorId" = ps."distributorId",
             "costCents" = ROUND(ps."costCents" * (10000 - LEAST(GREATEST(ps."discountBp", 0), ${MAX_DISCOUNT_BP})) / 10000.0),
             "listPriceCents" = ps."listPriceCents",
             "updatedAt" = now()
        FROM "ProductSupplier" ps
       WHERE ps."preferredFor" = p."id"
         AND p."id" = ANY(${chunk}::text[])
         AND p."organizationId" = ${organizationId}`;
    await prisma.$executeRaw`
      UPDATE "Product" AS p SET "distributorId" = NULL, "updatedAt" = now()
       WHERE p."id" = ANY(${chunk}::text[])
         AND p."organizationId" = ${organizationId}
         AND p."distributorId" IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM "ProductSupplier" ps WHERE ps."productId" = p."id")`;
  }
}

/**
 * A product that names a supplier but has no row for them gets one: their
 * price is the product's COGS, no discount, its MSRP, starred when the
 * product has no star. Products made before suppliers had rows — during
 * the deploy, or seeded by hand — would otherwise lose that supplier the
 * first time a sync ran over them. Run before anything that adds or
 * removes rows, never after a removal (the product still names the
 * supplier just taken off until it is synced).
 */
export async function repairSupplierRows(organizationId: string, productIds: string[]): Promise<void> {
  const ids = [...new Set(productIds)];
  for (let start = 0; start < ids.length; start += SYNC_CHUNK) {
    const chunk = ids.slice(start, start + SYNC_CHUNK);
    await prisma.$executeRaw`
      INSERT INTO "ProductSupplier" ("id", "organizationId", "productId", "distributorId", "costCents", "discountBp",
                                     "listPriceCents", "preferredFor", "createdAt", "updatedAt")
      SELECT 'ps_' || md5(p."id" || ':' || p."distributorId"), p."organizationId", p."id", p."distributorId",
             p."costCents", 0, p."listPriceCents",
             CASE WHEN EXISTS (SELECT 1 FROM "ProductSupplier" s WHERE s."preferredFor" = p."id") THEN NULL ELSE p."id" END,
             p."createdAt", now()
        FROM "Product" p
        JOIN "Distributor" d ON d."id" = p."distributorId" AND d."organizationId" = p."organizationId"
       WHERE p."id" = ANY(${chunk}::text[])
         AND p."organizationId" = ${organizationId}
         AND NOT EXISTS (SELECT 1 FROM "ProductSupplier" x WHERE x."productId" = p."id" AND x."distributorId" = p."distributorId")
      ON CONFLICT DO NOTHING`;
  }
}
