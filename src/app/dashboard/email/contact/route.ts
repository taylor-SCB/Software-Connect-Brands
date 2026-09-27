import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  name: z.string().trim().min(1, "Enter their name").max(120),
  email: z.string().trim().email("Enter a valid email address").max(200),
});

// "+ Add new contact" inside the Email window: a name and an address is
// enough to send to someone. If a contact already has that address, that
// one is handed back instead of making a twin.
export async function POST(request: Request) {
  const { organizationId } = await requireSession();
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the name and email." }, { status: 400 });
  }
  const email = parsed.data.email.toLowerCase();

  const existing = await prisma.contact.findFirst({
    where: { organizationId, email: { equals: email, mode: "insensitive" } },
    select: { id: true, name: true, email: true, emailOptOutAt: true, company: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  const contact =
    existing ??
    (await prisma.contact.create({
      data: { organizationId, name: parsed.data.name, email },
      select: { id: true, name: true, email: true, emailOptOutAt: true, company: { select: { name: true } } },
    }));

  return NextResponse.json({
    contact: {
      id: contact.id,
      name: contact.name,
      company: contact.company?.name ?? null,
      email: contact.email,
      optedOut: Boolean(contact.emailOptOutAt),
    },
    existed: Boolean(existing),
  });
}
