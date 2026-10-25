import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { cleanSearch } from "@/lib/list-params";
import { productSearchWhere } from "@/lib/product-list";

// Type-to-search behind the quote's "Add from catalog" box and the
// Create Ratesheet picker. The best matches, never the whole catalog: a
// distributor's sheet can bring in tens of thousands of products, and the
// pickers used to ship every one of them to the browser.
//
//   ?q=cat6          words matched against name, SKU, description, maker
//   ?active=1        only active products (the quote builder)
//   ?take=50         up to 50 (default 20)
//   ?id=…&id=…       those products, for a picker showing what is ticked
export async function GET(request: Request) {
  const { organizationId } = await requireSession();
  const url = new URL(request.url);
  const q = cleanSearch(url.searchParams.get("q") ?? "").slice(0, 80);
  const ids = url.searchParams.getAll("id").slice(0, 200);
  const activeOnly = url.searchParams.get("active") === "1";
  const take = Math.min(50, Math.max(1, Number(url.searchParams.get("take")) || 20));

  const select = {
    id: true,
    name: true,
    sku: true,
    description: true,
    unitPriceCents: true,
    defaultTag: true,
    serviceType: true,
    unitOfMeasure: true,
    softwareRate: true,
    softwareTerm: true,
    active: true,
    manufacturer: { select: { name: true } },
  } as const;
  const base = { organizationId, ...(activeOnly ? { active: true } : {}) };

  if (ids.length > 0) {
    const rows = await prisma.product.findMany({ where: { ...base, id: { in: ids } }, take: 200, select });
    return NextResponse.json(rows.map(flatten), { headers: { "Cache-Control": "private, no-store" } });
  }

  // A part number typed in full goes to the top, then everything that
  // matches every word, active first and by name.
  const [exact, matches] = await Promise.all([
    q && !q.includes(" ")
      ? prisma.product.findMany({
          where: { ...base, sku: { equals: q, mode: "insensitive" } },
          orderBy: [{ active: "desc" }, { name: "asc" }],
          take: 5,
          select,
        })
      : Promise.resolve([]),
    prisma.product.findMany({
      where: { ...base, AND: productSearchWhere(q) },
      orderBy: [{ active: "desc" }, { name: "asc" }, { id: "asc" }],
      take,
      select,
    }),
  ]);
  const seen = new Set<string>();
  const rows = [...exact, ...matches].filter((row) => (seen.has(row.id) ? false : (seen.add(row.id), true))).slice(0, take);
  return NextResponse.json(rows.map(flatten), { headers: { "Cache-Control": "private, no-store" } });
}

function flatten<T extends { manufacturer: { name: string } | null }>(row: T) {
  const { manufacturer, ...rest } = row;
  return { ...rest, manufacturerName: manufacturer?.name ?? null };
}
