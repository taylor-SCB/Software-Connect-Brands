import { prisma } from "@/lib/prisma";
import { ensureOpportunityForDeal } from "@/lib/opportunities";

// Turns what the DealPicker sent into a deal id. An existing deal must
// belong to this contact; a typed name is matched against the contact's
// deals first (so "Kitchen remodel" typed twice is one deal) and created
// only when nothing matches.
export async function resolveDeal(input: {
  dealId: string | null;
  dealTitle: string | null;
  contactId: string;
  organizationId: string;
  // Whoever is making the quote or contract: a deal made here is theirs.
  ownerId: string;
}): Promise<{ id: string } | null> {
  const { dealId, dealTitle, contactId, organizationId, ownerId } = input;

  if (dealId) {
    return prisma.deal.findFirst({
      where: { id: dealId, contactId, organizationId },
      select: { id: true },
    });
  }

  const title = dealTitle?.trim().replace(/\s+/g, " ");
  if (!title) return null;

  const existing = await prisma.deal.findFirst({
    where: { organizationId, contactId, title: { equals: title, mode: "insensitive" } },
    select: { id: true },
  });
  if (existing) return existing;

  const deal = await prisma.deal.create({
    data: { organizationId, contactId, title, ownerId },
    select: { id: true },
  });
  // No deal without an opportunity (Oct 27, 2026).
  await ensureOpportunityForDeal({ organizationId, userId: ownerId }, deal.id);
  return deal;
}
