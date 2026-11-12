import { prisma } from "@/lib/prisma";
import { STARRED_MINIMUM_SELECT, starredMinimumCents } from "@/lib/supplier-math";
import { lineLabelsFor } from "@/lib/line-labels";
import type { LineItemTagValue } from "@/lib/constants";
import type { EditorProduct } from "@/app/dashboard/quotes/[id]/line-items-editor";

// Drafted quote lines as the editor takes them (Nov 10, 2026; shared with
// Release C's site walk, Nov 12, 2026). A catalog line carries the
// product at the catalog's own price; a typed line has no price and is
// marked "Price needed" in the editor. Callers check every productId
// against the candidates they offered before it gets here.

export type DraftedLine =
  | { kind: "catalog"; product: EditorProduct; quantity: number; note: string }
  | { kind: "typed"; name: string; description: string; quantity: number; tag: LineItemTagValue; note: string };

export type PickedLine = { productId: string | null; name?: string; quantity: number; tag?: LineItemTagValue; note: string };

export async function buildDraftedLines(organizationId: string, picked: PickedLine[]): Promise<DraftedLine[]> {
  const productIds = [...new Set(picked.flatMap((line) => (line.productId ? [line.productId] : [])))];
  const [products, labels] = await Promise.all([
    prisma.product.findMany({
      where: { organizationId, id: { in: productIds } },
      select: {
        id: true,
        name: true,
        description: true,
        unitPriceCents: true,
        defaultTag: true,
        serviceType: true,
        unitOfMeasure: true,
        softwareRate: true,
        softwareTerm: true,
        customUnitId: true,
        customUnit: { select: { name: true } },
        suppliers: STARRED_MINIMUM_SELECT,
      },
    }),
    lineLabelsFor(organizationId, productIds),
  ]);
  const byId = new Map(products.map((row) => [row.id, row]));
  const lines: DraftedLine[] = picked.flatMap((line): DraftedLine[] => {
    if (!line.productId) {
      return [{ kind: "typed", name: line.name!, description: "", quantity: line.quantity, tag: line.tag!, note: line.note }];
    }
    const row = byId.get(line.productId);
    if (!row) return [];
    const ownUnit = row.unitOfMeasure ? null : row.customUnitId;
    return [
      {
        kind: "catalog",
        quantity: line.quantity,
        note: line.note,
        product: {
          id: row.id,
          name: row.name,
          description: row.description,
          unitPriceCents: row.unitPriceCents,
          defaultTag: row.defaultTag,
          serviceType: row.serviceType,
          unitOfMeasure: row.unitOfMeasure,
          softwareRate: row.softwareRate,
          softwareTerm: row.softwareTerm,
          minPriceCents: starredMinimumCents(row.suppliers),
          customUnitId: ownUnit,
          customUnitName: ownUnit ? (row.customUnit?.name ?? null) : null,
          labels: labels[row.id] ?? null,
        },
      },
    ];
  });
  return lines;
}
