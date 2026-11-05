import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { cleanSearch } from "@/lib/list-params";
import { MAX_ROWS_READ } from "@/lib/price-list";

// See product list (Release 3a): one page of an imported sheet's lines,
// or every matching line's id for "Select all matching". A line is in
// Products when the product it is carries this sheet's supplier — read
// from the supplier rows, not stored, so it can never disagree with the
// product page.
//
//   ?q=prox card      every word matched against name, part #, maker, description
//   ?filter=in|out    in Products / not in Products (default all)
//   ?skip=50&take=50  a page (take up to 100)
//   ?ids=1            every matching line's id, up to a sheet's 25,000

export type SheetLine = {
  id: string;
  name: string;
  sku: string | null;
  manufacturer: string | null;
  // As on the sheet.
  costCents: number | null;
  listPriceCents: number | null;
  inProducts: boolean;
  // When in Products: the product, and whether this supplier's row is
  // its starred one, and whether this sheet set that row's price.
  product: {
    id: string;
    name: string;
    unitPriceCents: number;
    costCents: number;
    active: boolean;
    starred: boolean;
    discountBp: number;
    fromThisSheet: boolean;
  } | null;
};

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { organizationId } = await requireSession();
  const sheet = await prisma.linkedRatesheet.findFirst({
    where: { id, organizationId },
    select: { id: true, distributorId: true },
  });
  if (!sheet || !sheet.distributorId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const supplierId = sheet.distributorId;

  const url = new URL(request.url);
  const q = cleanSearch(url.searchParams.get("q") ?? "").slice(0, 80);
  const filter = url.searchParams.get("filter");
  const take = Math.min(100, Math.max(1, Number(url.searchParams.get("take")) || 50));
  const skip = Math.min(MAX_ROWS_READ, Math.max(0, Math.floor(Number(url.searchParams.get("skip")) || 0)));

  const words = q.split(" ").filter(Boolean).slice(0, 6);
  const searched: Prisma.RatesheetLineWhereInput = {
    linkedRatesheetId: sheet.id,
    organizationId,
    AND: words.map((word) => ({
      OR: [
        { name: { contains: word, mode: "insensitive" } },
        { sku: { contains: word, mode: "insensitive" } },
        { manufacturer: { contains: word, mode: "insensitive" } },
        { description: { contains: word, mode: "insensitive" } },
      ],
    })),
  };
  const inProducts: Prisma.RatesheetLineWhereInput = {
    product: { suppliers: { some: { distributorId: supplierId } } },
  };
  const where: Prisma.RatesheetLineWhereInput =
    filter === "in" ? { ...searched, ...inProducts } : filter === "out" ? { ...searched, NOT: inProducts } : searched;
  const headers = { "Cache-Control": "private, no-store" };

  if (url.searchParams.get("ids") === "1") {
    const ids = await prisma.ratesheetLine.findMany({
      where,
      orderBy: { position: "asc" },
      take: MAX_ROWS_READ,
      select: { id: true },
    });
    return NextResponse.json({ ids: ids.map((line) => line.id) }, { headers });
  }

  const [all, inCount, total, lines] = await Promise.all([
    prisma.ratesheetLine.count({ where: searched }),
    prisma.ratesheetLine.count({ where: { ...searched, ...inProducts } }),
    prisma.ratesheetLine.count({ where }),
    prisma.ratesheetLine.findMany({
      where,
      orderBy: { position: "asc" },
      skip,
      take,
      select: {
        id: true,
        name: true,
        sku: true,
        manufacturer: true,
        costCents: true,
        listPriceCents: true,
        product: {
          select: {
            id: true,
            name: true,
            unitPriceCents: true,
            costCents: true,
            active: true,
            suppliers: {
              where: { distributorId: supplierId },
              select: { preferredFor: true, discountBp: true, linkedRatesheetId: true },
            },
          },
        },
      },
    }),
  ]);

  const rows: SheetLine[] = lines.map((line) => {
    const own = line.product?.suppliers[0] ?? null;
    return {
      id: line.id,
      name: line.name,
      sku: line.sku,
      manufacturer: line.manufacturer,
      costCents: line.costCents,
      listPriceCents: line.listPriceCents,
      inProducts: own !== null,
      product:
        line.product && own
          ? {
              id: line.product.id,
              name: line.product.name,
              unitPriceCents: line.product.unitPriceCents,
              costCents: line.product.costCents,
              active: line.product.active,
              starred: own.preferredFor !== null,
              discountBp: own.discountBp,
              fromThisSheet: own.linkedRatesheetId === sheet.id,
            }
          : null,
    };
  });
  return NextResponse.json({ total, counts: { all, in: inCount, out: all - inCount }, rows }, { headers });
}
