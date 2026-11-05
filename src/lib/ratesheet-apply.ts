import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { PlanRow } from "@/lib/price-list";
import { repairSupplierRows, syncStarsFor } from "@/lib/product-suppliers";
import { MAX_DISCOUNT_BP } from "@/lib/supplier-math";

// Writing a planned ratesheet into the catalog: Import Ratesheet's ticked
// rows, and the lines ticked later in See product list (Release 3a). One
// path for both, so a product comes in the same way whichever screen
// brought it. Server-only, outside any "use server" file. No transaction:
// a sheet is thousands of rows, and Prisma gives a transaction five
// seconds against a database a few milliseconds away.

// Rows per write.
const CHUNK = 250;

export type AppliedRows = {
  // The product each new row became, by row key.
  createdByKey: Map<string, string>;
  // Matched rows whose cost this sheet now carries (this supplier is, or
  // becomes, their starred one).
  starUpdates: PlanRow[];
  // Matched rows starred to another supplier: this one is added beside.
  secondUpdates: PlanRow[];
};

export async function applyRatesheetRows(input: {
  organizationId: string;
  supplierId: string;
  linkedRatesheetId: string;
  // The COGS discount a new supplier row starts with; a row already there
  // keeps its own.
  discountBp: number;
  // Only the rows to write (included).
  rows: PlanRow[];
  // See product list turns a product back on when its line is ticked.
  activate?: boolean;
}): Promise<AppliedRows> {
  const { organizationId, supplierId, linkedRatesheetId, discountBp, rows } = input;

  // A product with a supplier but no row for them (made before suppliers
  // had rows) gets its row first, so a second supplier added below never
  // takes a star that was already someone's.
  await repairSupplierRows(
    organizationId,
    rows.flatMap((row) => (row.match ? [row.match.id] : [])),
  );

  // Manufacturers named on the sheet that this workspace doesn't have yet.
  const manufacturerNames = [...new Set(rows.map((row) => row.manufacturer).filter((name): name is string => !!name))];
  const manufacturerIds = new Map<string, string>();
  if (manufacturerNames.length > 0) {
    await prisma.manufacturer.createMany({
      data: manufacturerNames.map((name) => ({ organizationId, name })),
      skipDuplicates: true,
    });
    const found = await prisma.manufacturer.findMany({
      where: { organizationId, name: { in: manufacturerNames } },
      select: { id: true, name: true },
    });
    for (const manufacturer of found) manufacturerIds.set(manufacturer.name, manufacturer.id);
  }
  const manufacturerFor = (row: PlanRow) => (row.manufacturer ? (manufacturerIds.get(row.manufacturer) ?? null) : null);

  const creates = rows.filter((row) => !row.match && row.newPriceCents !== null);
  const updates = rows.filter((row) => row.match);
  const createdByKey = new Map<string, string>();
  for (let start = 0; start < creates.length; start += CHUNK) {
    const chunk = creates.slice(start, start + CHUNK);
    const made = await prisma.product.createManyAndReturn({
      data: chunk.map((row) => ({
        organizationId,
        name: row.name,
        description: row.description,
        sku: row.sku,
        costCents: row.newCostCents,
        unitPriceCents: row.newPriceCents!,
        listPriceCents: row.listCents,
        defaultTag: row.defaultTag,
        unitOfMeasure: row.unitOfMeasure,
        manufacturerId: manufacturerFor(row),
        distributorId: supplierId,
        active: true,
      })),
      select: { id: true },
    });
    // createManyAndReturn hands rows back in the order they were given.
    made.forEach((product, position) => createdByKey.set(chunk[position].key, product.id));
  }

  // A product already in the catalog keeps its own name, description,
  // tag and unit — those are what the customer reads on a quote. When
  // this supplier is its starred one (or it has none yet), the sheet
  // moves its cost, MSRP and (by the rule chosen) its sell price, and
  // fills a missing part number or manufacturer. When another supplier is
  // starred, the product is left alone and this one is added beside.
  const starUpdates = updates.filter((row) => !row.secondSupplier);
  const secondUpdates = updates.filter((row) => row.secondSupplier);
  for (let start = 0; start < starUpdates.length; start += CHUNK) {
    const values = starUpdates.slice(start, start + CHUNK).map(
      (row) =>
        Prisma.sql`(${row.match!.id}::text, ${row.newCostCents}::int, ${row.newPriceCents ?? row.oldPriceCents ?? 0}::int, ${row.listCents}::int, ${row.sku}::text, ${manufacturerFor(row)}::text)`,
    );
    await prisma.$executeRaw`
      UPDATE "Product" AS p
         SET "costCents" = v.cost,
             "unitPriceCents" = v.price,
             "listPriceCents" = COALESCE(v.list, p."listPriceCents"),
             "sku" = COALESCE(p."sku", v.sku),
             "manufacturerId" = COALESCE(p."manufacturerId", v.mfr),
             "updatedAt" = now()
        FROM (VALUES ${Prisma.join(values)}) AS v(id, cost, price, list, sku, mfr)
       WHERE p."id" = v.id AND p."organizationId" = ${organizationId}`;
  }

  // This supplier's row on every product written: their price (before
  // your discount) and their MSRP; a cost or MSRP the sheet didn't give
  // ("Call", blank) leaves the row's. A row already there keeps its
  // discount; a new one starts with the sheet's. Rows go in unstarred and
  // are starred after, only where the product has no star: a bulk write
  // never takes someone else's star.
  const entries = [
    ...creates.map((row) => ({ row, productId: createdByKey.get(row.key) ?? null, star: true })),
    ...starUpdates.map((row) => ({ row, productId: row.match!.id, star: true })),
    ...secondUpdates.map((row) => ({ row, productId: row.match!.id, star: false })),
  ].filter((entry): entry is { row: PlanRow; productId: string; star: boolean } => entry.productId !== null);
  for (let start = 0; start < entries.length; start += CHUNK) {
    const chunk = entries.slice(start, start + CHUNK);
    const values = chunk.map(
      ({ row, productId, star }) =>
        Prisma.sql`(${`ps_${randomUUID()}`}::text, ${productId}::text, ${row.costCents}::int, ${row.listCents}::int, ${star}::boolean, ${row.costDiscountBp ?? discountBp}::int)`,
    );
    // The row takes the discount the plan priced it with — its own when it
    // had one; the sheet's when the row is new, or was only just written
    // by the repair above (after the plan read the catalog) — so the COGS
    // saved is the COGS the preview showed. Not when the sheet gave no
    // price: the row keeps what it had.
    await prisma.$executeRaw`
      UPDATE "ProductSupplier" AS ps
         SET "costCents" = COALESCE(v.cost, ps."costCents"),
             "discountBp" = CASE WHEN v.cost IS NULL THEN ps."discountBp" ELSE v.disc END,
             "listPriceCents" = COALESCE(v.list, ps."listPriceCents"),
             "linkedRatesheetId" = ${linkedRatesheetId},
             "updatedAt" = now()
        FROM (VALUES ${Prisma.join(values)}) AS v(id, product, cost, list, star, disc)
       WHERE ps."productId" = v.product AND ps."distributorId" = ${supplierId} AND ps."organizationId" = ${organizationId}`;
    // A new row on a product this supplier becomes the star of (one that
    // had no supplier) carries the product's own numbers where the sheet
    // gave none — "Call" or no MSRP column — as the product UPDATE above
    // kept them: the row is copied onto the product below, and a $0 or
    // blank there would wipe its COGS and MSRP. Their price is then the
    // product's COGS worked back through the discount, so the discount
    // stays the supplier's for the next sheet and the COGS stays put.
    await prisma.$executeRaw`
      INSERT INTO "ProductSupplier" ("id", "organizationId", "productId", "distributorId", "costCents", "discountBp",
                                     "listPriceCents", "linkedRatesheetId", "createdAt", "updatedAt")
      SELECT v.id, ${organizationId}, v.product, ${supplierId},
             CASE WHEN v.cost IS NOT NULL THEN v.cost
                  WHEN v.star THEN LEAST(ROUND(p."costCents"::numeric * 10000 / (10000 - LEAST(GREATEST(v.disc, 0), ${MAX_DISCOUNT_BP}))), 2147483647)::int
                  ELSE 0 END,
             v.disc,
             CASE WHEN v.star THEN COALESCE(v.list, p."listPriceCents") ELSE v.list END,
             ${linkedRatesheetId}, now(), now()
        FROM (VALUES ${Prisma.join(values)}) AS v(id, product, cost, list, star, disc)
        JOIN "Product" p ON p."id" = v.product AND p."organizationId" = ${organizationId}
      ON CONFLICT ("productId", "distributorId") DO NOTHING`;
    const starred = chunk.filter((entry) => entry.star).map((entry) => entry.productId);
    if (starred.length > 0) {
      await prisma.$executeRaw`
        UPDATE "ProductSupplier" AS ps SET "preferredFor" = ps."productId", "updatedAt" = now()
         WHERE ps."productId" = ANY(${starred}::text[])
           AND ps."distributorId" = ${supplierId}
           AND ps."organizationId" = ${organizationId}
           AND NOT EXISTS (SELECT 1 FROM "ProductSupplier" s WHERE s."preferredFor" = ps."productId")`;
    }
  }

  const touched = entries.map((entry) => entry.productId);
  if (input.activate && touched.length > 0) {
    for (let start = 0; start < touched.length; start += 2000) {
      await prisma.product.updateMany({
        where: { id: { in: touched.slice(start, start + 2000) }, organizationId, active: false },
        data: { active: true },
      });
    }
  }

  // The product carries its starred row's numbers, whatever happened
  // above: the rows are the truth, the product is the mirror.
  await syncStarsFor(organizationId, touched);

  return { createdByKey, starUpdates, secondUpdates };
}
