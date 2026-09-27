import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { cleanSearch } from "@/lib/list-params";
import { companyIdsMatching } from "@/lib/list-query";

// Type-to-search for the Email window's To line. Like the contacts
// search, but it hands back the address and whether they unsubscribed,
// so the window can show who cannot be emailed before Send is pressed.
export async function GET(request: Request) {
  const { organizationId } = await requireSession();
  const url = new URL(request.url);
  const q = cleanSearch(url.searchParams.get("q") ?? "").slice(0, 80);
  const companyIds = await companyIdsMatching(organizationId, q);

  const contacts = await prisma.contact.findMany({
    where: {
      organizationId,
      status: { not: "ARCHIVED" },
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
              ...(companyIds.length ? [{ companyId: { in: companyIds } }] : []),
            ],
          }
        : {}),
    },
    orderBy: [{ favorite: "desc" }, { name: "asc" }],
    take: 25,
    select: { id: true, name: true, email: true, emailOptOutAt: true, company: { select: { name: true } } },
  });

  return NextResponse.json(
    contacts.map((contact) => ({
      id: contact.id,
      name: contact.name,
      company: contact.company?.name ?? null,
      email: contact.email,
      optedOut: Boolean(contact.emailOptOutAt),
    })),
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
