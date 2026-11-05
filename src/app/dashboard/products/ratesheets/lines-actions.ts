"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { UNIT_LABELS } from "@/lib/constants";
import { readPriceListFile } from "@/lib/price-list-file";
import {
  COLUMN_ROLES,
  DEFAULT_PRICING,
  detectTabs,
  planRatesheet,
  type ColumnRole,
  type PricingOptions,
  type TabLayout,
} from "@/lib/price-list";
import { loadCatalogFor } from "@/lib/ratesheet-catalog";
import { applyRatesheetRows } from "@/lib/ratesheet-apply";
import { storeRatesheetLines } from "@/lib/ratesheet-lines";
import { repairSupplierRows, syncStarsFor } from "@/lib/product-suppliers";
import { LINES_PER_BATCH, MAX_DISCOUNT_BP, MAX_MIN_MARKUP_BP } from "@/lib/supplier-math";

// See product list (Release 3a, Nov 4, 2026). Taylor: every imported
// ratesheet is a row with "See product list", a pop-out of every product
// on the sheet with its COGS and MSRP, a COGS discount and a required
// minimum markup, ticks for what is in Products, and Cancel / Save and
// accept. Saving sends the ticks in batches (saveRatesheetLines) and then
// finishes (finishRatesheetLines), so a sheet of thousands never runs one
// request long enough to hit the hosting's time limit.

const PRODUCTS_PATH = "/dashboard/products";
const RATESHEETS_PATH = "/dashboard/products/ratesheets";
// A save left half-done by a closed tab stops blocking after this long.
const SAVING_STALE_MS = 2 * 60 * 1000;

type Sheet = {
  id: string;
  // When it was imported: which of a supplier's sheets is newer.
  importedAt: Date;
  distributorId: string;
  discountBp: number;
  minMarkupBp: number | null;
  pricing: PricingOptions;
};

async function loadSheet(organizationId: string, linkedRatesheetId: unknown): Promise<Sheet | null> {
  if (typeof linkedRatesheetId !== "string" || linkedRatesheetId.length > 60) return null;
  const sheet = await prisma.linkedRatesheet.findFirst({
    where: { id: linkedRatesheetId, organizationId, importedAt: { not: null }, distributorId: { not: null } },
    select: {
      id: true,
      importedAt: true,
      distributorId: true,
      discountBp: true,
      minMarkupBp: true,
      distributor: { select: { priceRule: true, priceRuleBasisPoints: true } },
    },
  });
  if (!sheet || !sheet.distributorId || !sheet.importedAt) return null;
  return {
    id: sheet.id,
    importedAt: sheet.importedAt,
    distributorId: sheet.distributorId,
    discountBp: sheet.discountBp,
    minMarkupBp: sheet.minMarkupBp,
    // New products are priced the way this supplier's sheets last were.
    pricing: {
      ...DEFAULT_PRICING,
      rule: sheet.distributor?.priceRule ?? DEFAULT_PRICING.rule,
      basisPoints: sheet.distributor?.priceRuleBasisPoints ?? DEFAULT_PRICING.basisPoints,
    },
  };
}

const NOT_IMPORTED = "Import this sheet first: Import prices on its row.";

/**
 * A sheet imported before its lines were kept: read the stored file once,
 * the way its supplier's sheets are read, and keep every product row.
 */
export async function prepareRatesheetLines(
  linkedRatesheetId: string,
): Promise<{ ok: true; lineCount: number } | { ok: false; error: string }> {
  const { organizationId } = await requireSession();
  const sheet = await loadSheet(organizationId, linkedRatesheetId);
  if (!sheet) return { ok: false, error: NOT_IMPORTED };
  const stored = await prisma.linkedRatesheet.findUniqueOrThrow({
    where: { id: sheet.id },
    select: {
      linesStoredAt: true,
      lineCount: true,
      fileName: true,
      data: true,
      distributor: { select: { ratesheetColumns: true } },
    },
  });
  if (stored.linesStoredAt) return { ok: true, lineCount: stored.lineCount ?? 0 };

  const read = await readPriceListFile(stored.fileName, new Uint8Array(stored.data).slice().buffer);
  if (!read.ok) return { ok: false, error: `This sheet can't be read again: ${read.error}` };
  const raw = stored.distributor?.ratesheetColumns;
  const roles = new Set<string>(COLUMN_ROLES);
  const remembered: Record<string, ColumnRole[]> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [signature, list] of Object.entries(raw as Record<string, unknown>)) {
      if (Array.isArray(list) && list.every((role) => typeof role === "string" && roles.has(role))) {
        remembered[signature] = list as ColumnRole[];
      }
    }
  }
  const tabs = detectTabs(read.sheets, remembered);
  const outline = planRatesheet({ sheets: read.sheets, tabs, catalog: [], supplierId: sheet.distributorId, pricing: sheet.pricing });
  const catalog = await loadCatalogFor(
    organizationId,
    sheet.distributorId,
    outline.rows.map((row) => row.sku ?? "").filter(Boolean),
    outline.rows.map((row) => row.name),
  );
  const plan = planRatesheet({
    sheets: read.sheets,
    tabs,
    catalog,
    supplierId: sheet.distributorId,
    pricing: sheet.pricing,
    costDiscountBp: sheet.discountBp,
  });
  // An import that ran meanwhile kept its own lines; those stand.
  const again = await prisma.linkedRatesheet.findUnique({ where: { id: sheet.id }, select: { linesStoredAt: true, lineCount: true } });
  if (again?.linesStoredAt) return { ok: true, lineCount: again.lineCount ?? 0 };
  await storeRatesheetLines(organizationId, sheet.id, plan.rows, (row) => row.match?.id ?? null);
  return { ok: true, lineCount: plan.rows.length };
}

const percentSchema = (max: number) => z.number().int().min(0).max(max);

const batchSchema = z.object({
  linkedRatesheetId: z.string().min(1).max(60),
  // The discount on screen, which a supplier row made now starts with.
  discountBp: percentSchema(MAX_DISCOUNT_BP),
  tick: z.array(z.string().min(1).max(60)).max(LINES_PER_BATCH),
  untick: z.array(z.string().min(1).max(60)).max(LINES_PER_BATCH),
});

export type BatchResult =
  | {
      ok: true;
      added: number;
      attached: number;
      // Ticked lines whose product this supplier's newer sheet already
      // prices: linked to it, nothing re-priced.
      alreadyIn: number;
      removed: number;
      turnedOff: number;
      // The first 50 lines not added, with why, and how many there were.
      held: { name: string; reason: string }[];
      heldCount: number;
    }
  | { ok: false; error: string };

/**
 * One batch of ticks. A ticked line goes through the same planner as
 * Import Ratesheet — part number then name matching, the supplier's
 * pricing rule, a cost that more than doubles held back, a price at or
 * below cost re-priced — and is written the same way. An unticked line's
 * product loses this supplier; a product left with no supplier is turned
 * off, never deleted.
 */
export async function saveRatesheetLines(input: unknown): Promise<BatchResult> {
  const { organizationId } = await requireSession();
  const parsed = batchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "The list sent something the server couldn't read. Close it and try again." };
  const sheet = await loadSheet(organizationId, parsed.data.linkedRatesheetId);
  if (!sheet) return { ok: false, error: NOT_IMPORTED };
  const supplierId = sheet.distributorId;

  // One save of a sheet at a time: two tabs ticking the same new line
  // would each make the product.
  const claimed = await prisma.linkedRatesheet.updateMany({
    where: {
      id: sheet.id,
      organizationId,
      OR: [{ savingAt: null }, { savingAt: { lt: new Date(Date.now() - SAVING_STALE_MS) } }],
    },
    data: { savingAt: new Date() },
  });
  if (claimed.count !== 1) return { ok: false, error: "This sheet is being saved in another tab. Try again in a moment." };

  try {
    // Unticked: this supplier comes off the product.
    let removed = 0;
    let turnedOff = 0;
    const off = await prisma.ratesheetLine.findMany({
      where: {
        id: { in: parsed.data.untick },
        linkedRatesheetId: sheet.id,
        organizationId,
        product: { suppliers: { some: { distributorId: supplierId } } },
      },
      select: { productId: true },
    });
    const offProducts = [...new Set(off.map((line) => line.productId!))];
    if (offProducts.length > 0) {
      await repairSupplierRows(organizationId, offProducts);
      removed = (
        await prisma.productSupplier.deleteMany({
          where: { organizationId, distributorId: supplierId, productId: { in: offProducts } },
        })
      ).count;
      turnedOff = (
        await prisma.product.updateMany({
          where: { id: { in: offProducts }, organizationId, active: true, suppliers: { none: {} } },
          data: { active: false },
        })
      ).count;
      await syncStarsFor(organizationId, offProducts);
    }

    // Ticked: lines not already in Products, planned like an import.
    const on = await prisma.ratesheetLine.findMany({
      where: {
        id: { in: parsed.data.tick },
        linkedRatesheetId: sheet.id,
        organizationId,
        NOT: { product: { suppliers: { some: { distributorId: supplierId } } } },
      },
      orderBy: { position: "asc" },
      select: {
        id: true,
        name: true,
        sku: true,
        description: true,
        manufacturer: true,
        defaultTag: true,
        unitOfMeasure: true,
        costCents: true,
        listPriceCents: true,
        sellCents: true,
      },
    });
    let added = 0;
    let attached = 0;
    let alreadyIn = 0;
    const held: { name: string; reason: string }[] = [];
    if (on.length > 0) {
      // The lines as a sheet of their own, so the planner reads them
      // exactly as it reads a file: row 1 is the header, line n + 2 is
      // the nth line.
      const money = (cents: number | null) => (cents === null ? "" : (cents / 100).toFixed(2));
      const headers = ["Name", "Part #", "Description", "Cost", "MSRP", "Sell", "Manufacturer", "Unit", "Tag"];
      const roles: ColumnRole[] = ["name", "sku", "description", "cost", "list", "sell", "manufacturer", "unit", "tag"];
      const sheets = [
        {
          name: "Lines",
          rows: [
            { line: 1, cells: headers },
            ...on.map((line, index) => ({
              line: index + 2,
              cells: [
                line.name,
                line.sku ?? "",
                line.description,
                money(line.costCents),
                money(line.listPriceCents),
                money(line.sellCents),
                line.manufacturer ?? "",
                line.unitOfMeasure ? UNIT_LABELS[line.unitOfMeasure] : "",
                line.defaultTag,
              ],
            })),
          ],
        },
      ];
      const tabs: TabLayout[] = [
        { sheetIndex: 0, name: "Lines", headerIndex: 0, headers, roles, dataRows: on.length, included: true },
      ];
      const lineByKey = new Map(on.map((line, index) => [`0:${index + 2}`, line]));
      // The list prices every line at the sheet's COGS discount ("Your
      // COGS"), so a tick does too — over a discount the supplier's row on
      // that product carries from elsewhere — and the row takes it.
      const catalog = (
        await loadCatalogFor(
          organizationId,
          supplierId,
          on.map((line) => line.sku ?? "").filter(Boolean),
          on.map((line) => line.name),
        )
      ).map((item) =>
        item.suppliers
          ? {
              ...item,
              suppliers: item.suppliers.map((row) =>
                row.distributorId === supplierId ? { ...row, discountBp: parsed.data.discountBp } : row,
              ),
            }
          : item,
      );
      const plan = planRatesheet({
        sheets,
        tabs,
        catalog,
        supplierId,
        pricing: sheet.pricing,
        costDiscountBp: parsed.data.discountBp,
        selected: [...lineByKey.keys()],
      });
      // A line matched to a product whose row for this supplier was set by
      // a newer sheet of theirs (or by this one, through another line) is
      // in Products already, at newer prices: ticking it links the line
      // and changes nothing, so an older sheet never puts its prices back
      // over a newer one's. A row set by hand or by an older sheet is
      // priced from this one, as Import prices would. Import prices on the
      // older sheet re-prices on purpose.
      const matchedIds = [...new Set(plan.rows.flatMap((row) => (row.included && row.match ? [row.match.id] : [])))];
      const theirRows =
        matchedIds.length === 0
          ? []
          : await prisma.productSupplier.findMany({
              where: { organizationId, distributorId: supplierId, productId: { in: matchedIds }, linkedRatesheetId: { not: null } },
              select: { productId: true, linkedRatesheetId: true, linkedRatesheet: { select: { importedAt: true } } },
            });
      const carried = new Set(
        theirRows
          .filter(
            (row) =>
              row.linkedRatesheetId === sheet.id ||
              (row.linkedRatesheet?.importedAt != null && row.linkedRatesheet.importedAt > sheet.importedAt),
          )
          .map((row) => row.productId),
      );
      const already = plan.rows.filter((row) => row.included && row.match && carried.has(row.match.id));
      // A ticked line is still held when the cost more than doubles or
      // halves: the list shows no warning beside it, as Import Ratesheet
      // does, so a tick here is not someone saying "I checked the unit".
      const rows = plan.rows.filter(
        (row) => row.included && row.holdReason === null && !(row.match && carried.has(row.match.id)),
      );
      // The planner names a row by its place in this batch ("Lines line
      // 3"); the person knows it by name.
      const readable = (reason: string) =>
        reason.replace(/^Same product as Lines line (\d+)$/, (_, line) => `Same product as ${on[Number(line) - 2]?.name ?? "another ticked line"}`);
      for (const row of plan.rows) {
        if (rows.includes(row) || already.includes(row)) continue;
        held.push({ name: row.name, reason: readable(row.holdReason ?? "Can't be added") });
      }
      alreadyIn = already.length;
      const applied = await applyRatesheetRows({
        organizationId,
        supplierId,
        linkedRatesheetId: sheet.id,
        discountBp: parsed.data.discountBp,
        rows,
        activate: true,
      });
      added = applied.createdByKey.size;
      attached = applied.starUpdates.length + applied.secondUpdates.length;
      // Each line remembers the product it now is.
      const mapped = [...rows, ...already].flatMap((row) => {
        const line = lineByKey.get(row.key);
        const productId = applied.createdByKey.get(row.key) ?? row.match?.id ?? null;
        return line && productId ? [Prisma.sql`(${line.id}::text, ${productId}::text)`] : [];
      });
      for (let start = 0; start < mapped.length; start += 500) {
        await prisma.$executeRaw`
          UPDATE "RatesheetLine" AS l SET "productId" = v.product
            FROM (VALUES ${Prisma.join(mapped.slice(start, start + 500))}) AS v(id, product)
           WHERE l."id" = v.id AND l."organizationId" = ${organizationId}`;
      }
    }
    return { ok: true, added, attached, alreadyIn, removed, turnedOff, held: held.slice(0, 50), heldCount: held.length };
  } finally {
    await prisma.linkedRatesheet.updateMany({ where: { id: sheet.id, organizationId }, data: { savingAt: null } });
  }
}

const finishSchema = z.object({
  linkedRatesheetId: z.string().min(1).max(60),
  discountBp: percentSchema(MAX_DISCOUNT_BP),
  minMarkupBp: percentSchema(MAX_MIN_MARKUP_BP).nullable(),
});

/**
 * The sheet-wide part of Save and accept, after the ticks: the COGS
 * discount, when it changed, goes on every supplier row this sheet set (a
 * row a newer sheet set keeps that sheet's); the required minimum markup
 * raises any product this sheet prices — its starred supplier's row set by
 * this sheet — that sells under it. Nothing else's price moves.
 */
export async function finishRatesheetLines(
  input: unknown,
): Promise<{ ok: true; discounted: number; repriced: { name: string; fromCents: number; toCents: number }[]; repricedCount: number } | { ok: false; error: string }> {
  const { organizationId } = await requireSession();
  const parsed = finishSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the discount and the minimum markup: whole percentages, the discount under 95%." };
  const sheet = await loadSheet(organizationId, parsed.data.linkedRatesheetId);
  if (!sheet) return { ok: false, error: NOT_IMPORTED };
  const { discountBp, minMarkupBp } = parsed.data;

  await prisma.linkedRatesheet.updateMany({
    where: { id: sheet.id, organizationId },
    data: { discountBp, minMarkupBp },
  });

  let discounted = 0;
  if (discountBp !== sheet.discountBp) {
    // Products changed outside 3a since this sheet set them are brought in
    // line first, or the sync below would copy the stale rows back.
    const setByThisSheet = await prisma.productSupplier.findMany({
      where: { organizationId, linkedRatesheetId: sheet.id, distributorId: sheet.distributorId },
      select: { productId: true },
    });
    await repairSupplierRows(organizationId, setByThisSheet.map((row) => row.productId));
    const touched = await prisma.$queryRaw<{ productId: string }[]>`
      UPDATE "ProductSupplier" SET "discountBp" = ${discountBp}, "updatedAt" = now()
       WHERE "linkedRatesheetId" = ${sheet.id} AND "distributorId" = ${sheet.distributorId} AND "organizationId" = ${organizationId}
      RETURNING "productId"`;
    discounted = touched.length;
    await syncStarsFor(organizationId, touched.map((row) => row.productId));
  }

  let repriced: { name: string; fromCents: number; toCents: number }[] = [];
  if (minMarkupBp !== null && minMarkupBp > 0) {
    repriced = await prisma.$queryRaw<{ name: string; fromCents: number; toCents: number }[]>`
      WITH target AS (
        SELECT p."id", p."unitPriceCents" AS "fromCents",
               -- In numeric, capped at the largest price a product holds:
               -- int times int overflows from about $1,700 at 25%.
               LEAST(CEIL(p."costCents"::numeric * (10000 + ${minMarkupBp}) / 10000), 2147483647)::int AS "toCents"
          FROM "Product" p
          JOIN "ProductSupplier" ps ON ps."preferredFor" = p."id"
         WHERE p."organizationId" = ${organizationId}
           AND ps."distributorId" = ${sheet.distributorId}
           AND ps."linkedRatesheetId" = ${sheet.id}
           AND p."costCents" > 0
      )
      UPDATE "Product" AS p SET "unitPriceCents" = t."toCents", "updatedAt" = now()
        FROM target t
       WHERE p."id" = t."id" AND t."fromCents" < t."toCents"
      RETURNING p."name", t."fromCents", t."toCents"`;
  }

  revalidatePath(PRODUCTS_PATH);
  revalidatePath(RATESHEETS_PATH);
  return {
    ok: true,
    discounted,
    repriced: repriced.slice(0, 20),
    repricedCount: repriced.length,
  };
}
