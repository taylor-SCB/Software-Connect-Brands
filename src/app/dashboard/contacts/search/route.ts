import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

// Type-to-search behind "+ Include multiple contacts". Twenty-five best
// matches by name, company or email, never the whole table.
export async function GET(request: Request) {
  const { organizationId } = await requireSession();
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 80);
  const exclude = url.searchParams.get("exclude") ?? undefined;

  const contacts = await prisma.contact.findMany({
    where: {
      organizationId,
      status: { not: "ARCHIVED" },
      ...(exclude ? { id: { not: exclude } } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
              { company: { name: { contains: q, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    orderBy: [{ favorite: "desc" }, { name: "asc" }],
    take: 25,
    select: { id: true, name: true, company: { select: { name: true } } },
  });

  return NextResponse.json(
    contacts.map((contact) => ({ id: contact.id, name: contact.name, company: contact.company?.name ?? null })),
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
