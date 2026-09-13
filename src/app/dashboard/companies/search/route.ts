import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { cleanSearch } from "@/lib/list-params";

// Type-to-search behind the Company box on a contact form and the Company
// filter on the Contacts list. Ten best matches, never the whole table:
// a workspace can hold tens of thousands of companies.
export async function GET(request: Request) {
  const { organizationId } = await requireSession();
  const url = new URL(request.url);
  const q = cleanSearch(url.searchParams.get("q") ?? "").slice(0, 80);
  const ids = url.searchParams.getAll("id").slice(0, 50);

  const companies = await prisma.company.findMany({
    where: {
      organizationId,
      ...(ids.length > 0
        ? { id: { in: ids } }
        : q
          ? { name: { contains: q, mode: "insensitive" } }
          : {}),
    },
    orderBy: [{ favorite: "desc" }, { name: "asc" }],
    take: ids.length > 0 ? 50 : 10,
    select: { id: true, name: true, industries: true, companyTypes: true, city: true, state: true },
  });

  return NextResponse.json(companies, { headers: { "Cache-Control": "private, no-store" } });
}
