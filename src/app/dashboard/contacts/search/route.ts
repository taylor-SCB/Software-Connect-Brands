import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { cleanSearch } from "@/lib/list-params";
import { companyIdsMatching } from "@/lib/list-query";

// Type-to-search behind "+ Include multiple contacts", the company page's
// Add person and the duplicate check on a new contact. Twenty-five best
// matches by name, company, email or phone, never the whole table. Each
// comes back with its email and phone so two Matt Smiths can be told
// apart before one is picked.
export async function GET(request: Request) {
  const { organizationId } = await requireSession();
  const url = new URL(request.url);
  const q = cleanSearch(url.searchParams.get("q") ?? "").slice(0, 80);
  const exclude = url.searchParams.get("exclude") ?? undefined;
  // The company page's activity form asks for that company's people only:
  // its own, and anyone linked to it as an additional account.
  const within = url.searchParams.get("companyId") ?? undefined;
  const companyIds = await companyIdsMatching(organizationId, q);

  const contacts = await prisma.contact.findMany({
    where: {
      organizationId,
      status: { not: "ARCHIVED" },
      ...(exclude ? { id: { not: exclude } } : {}),
      ...(within ? { AND: [{ OR: [{ companyId: within }, { accounts: { some: { companyId: within } } }] }] } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
              { email2: { contains: q, mode: "insensitive" } },
              ...(/\d{3}/.test(q) ? [{ phone: { contains: q } }, { phone2: { contains: q } }] : []),
              ...(companyIds.length ? [{ companyId: { in: companyIds } }] : []),
            ],
          }
        : {}),
    },
    orderBy: [{ favorite: "desc" }, { name: "asc" }],
    take: 25,
    select: { id: true, name: true, email: true, phone: true, company: { select: { id: true, name: true } } },
  });

  return NextResponse.json(
    contacts.map((contact) => ({
      id: contact.id,
      name: contact.name,
      company: contact.company?.name ?? null,
      companyId: contact.company?.id ?? null,
      email: contact.email,
      phone: contact.phone,
    })),
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
