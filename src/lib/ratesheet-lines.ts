import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { PlanRow } from "@/lib/price-list";

// Every product row of an imported sheet (Release 3a), kept whether or
// not it was imported, so "See product list" shows the whole sheet and can
// add more later. Server-only: not in a "use server" file, where every
// export would be callable from a browser.

const CHUNK = 1000;

/**
 * Keep these plan rows as the sheet's lines. `productFor` names the product
 * a row is (the one it matched or was made into), whether or not it is in
 * Products — that is worked out from the supplier's rows when the list is
 * read. Lines are upserted on their row key, so a line keeps its id across
 * re-imports and a list already open on screen still points at the right
 * rows; rows no longer on the sheet go. Batches, never one transaction: a
 * transaction gets five seconds and 25,000 rows take longer than that on
 * the live database.
 */
export async function storeRatesheetLines(
  organizationId: string,
  linkedRatesheetId: string,
  rows: PlanRow[],
  productFor: (row: PlanRow) => string | null,
): Promise<void> {
  for (let start = 0; start < rows.length; start += CHUNK) {
    const values = rows.slice(start, start + CHUNK).map(
      (row, offset) => Prisma.sql`(${`rl_${randomUUID()}`}, ${row.key}, ${start + offset}::int, ${row.name}, ${row.sku}::text,
        ${row.description}, ${row.manufacturer}::text, ${row.defaultTag}::"LineItemTag", ${row.unitOfMeasure}::"UnitOfMeasure",
        ${row.costCents}::int, ${row.listCents}::int, ${row.fileSellCents !== null && row.fileSellCents > 0 ? row.fileSellCents : null}::int,
        ${productFor(row)}::text)`,
    );
    await prisma.$executeRaw`
      INSERT INTO "RatesheetLine" ("id", "rowKey", "position", "name", "sku", "description", "manufacturer", "defaultTag",
                                   "unitOfMeasure", "costCents", "listPriceCents", "sellCents", "productId",
                                   "organizationId", "linkedRatesheetId")
      SELECT v.*, ${organizationId}, ${linkedRatesheetId}
        FROM (VALUES ${Prisma.join(values)}) AS v
      ON CONFLICT ("linkedRatesheetId", "rowKey") DO UPDATE
         SET "position" = EXCLUDED."position", "name" = EXCLUDED."name", "sku" = EXCLUDED."sku",
             "description" = EXCLUDED."description", "manufacturer" = EXCLUDED."manufacturer",
             "defaultTag" = EXCLUDED."defaultTag", "unitOfMeasure" = EXCLUDED."unitOfMeasure",
             "costCents" = EXCLUDED."costCents", "listPriceCents" = EXCLUDED."listPriceCents",
             "sellCents" = EXCLUDED."sellCents", "productId" = COALESCE(EXCLUDED."productId", "RatesheetLine"."productId")`;
  }
  const keys = rows.map((row) => row.key);
  await prisma.$executeRaw`
    DELETE FROM "RatesheetLine"
     WHERE "linkedRatesheetId" = ${linkedRatesheetId} AND "organizationId" = ${organizationId}
       AND NOT ("rowKey" = ANY(${keys}::text[]))`;
  await prisma.linkedRatesheet.updateMany({
    where: { id: linkedRatesheetId, organizationId },
    data: { lineCount: rows.length, linesStoredAt: new Date() },
  });
}

/**
 * The COGS discount a sheet is priced with: its own once it has one,
 * otherwise this supplier's from their last sheet — a standing discount
 * shouldn't vanish, and push every cost and price up, each quarter.
 */
export async function sheetDiscountFor(
  organizationId: string,
  own: number | null,
  supplierId: string | null,
): Promise<number> {
  if (own !== null) return own;
  if (!supplierId) return 0;
  const last = await prisma.linkedRatesheet.findFirst({
    where: { organizationId, distributorId: supplierId, importedAt: { not: null } },
    orderBy: { importedAt: "desc" },
    select: { discountBp: true },
  });
  return last?.discountBp ?? 0;
}
