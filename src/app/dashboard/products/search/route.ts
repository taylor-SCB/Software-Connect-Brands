import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { cleanSearch } from "@/lib/list-params";
import { productSearchWhere } from "@/lib/product-list";

// The most products one ratesheet holds (ratesheets/actions.ts).
const RATESHEET_MAX = 2000;

// Type-to-search behind the quote's "Add from catalog" box and the
// Create Ratesheet picker. The best matches, never the whole catalog: a
// distributor's sheet can bring in tens of thousands of products, and the
// pickers used to ship every one of them to the browser.
//
//   ?q=cat6          words matched against name, SKU, description, maker
//   ?active=1        only active products (the quote builder)
//   ?take=50         up to 50 (default 20)
//   ?skip=50         the next ones, for "Show 50 more"
//   ?all=1           every match up to 2,000 (a ratesheet's limit), for
//                    "Select all"
//   ?id=…&id=…       those products, for a picker showing what is ticked
export async function GET(request: Request) {
  const { organizationId } = await requireSession();
  const url = new URL(request.url);
  const q = cleanSearch(url.searchParams.get("q") ?? "").slice(0, 80);
  const ids = url.searchParams.getAll("id").slice(0, 200);
  const activeOnly = url.searchParams.get("active") === "1";
  const all = url.searchParams.get("all") === "1";
  const take = all ? RATESHEET_MAX : Math.min(50, Math.max(1, Number(url.searchParams.get("take")) || 20));
  const skip = all ? 0 : Math.min(100_000, Math.max(0, Math.floor(Number(url.searchParams.get("skip")) || 0)));

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
    q && !q.includes(" ") && skip === 0
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
      skip,
      take,
      select,
    }),
  ]);
  // Not cut back to `take`: the part number on top would push the last
  // match off this page, and "Show 50 more" starts after it.
  const seen = new Set<string>();
  const rows = [...exact, ...matches].filter((row) => (seen.has(row.id) ? false : (seen.add(row.id), true)));
  return NextResponse.json(rows.map(flatten), { headers: { "Cache-Control": "private, no-store" } });
}

function flatten<T extends { manufacturer: { name: string } | null }>(row: T) {
  const { manufacturer, ...rest } = row;
  return { ...rest, manufacturerName: manufacturer?.name ?? null };
}
