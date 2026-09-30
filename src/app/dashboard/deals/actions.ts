"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { DEAL_STAGES } from "@/lib/constants";
import type { ActionState } from "@/lib/forms";

export async function updateDealStage(
  dealId: string,
  stage: string,
): Promise<ActionState> {
  const { organizationId } = await requireSession();

  const parsed = z
    .object({ dealId: z.string().trim().min(1), stage: z.enum(DEAL_STAGES) })
    .safeParse({ dealId, stage });
  if (!parsed.success) return { error: "That stage isn't valid" };

  const result = await prisma.deal.updateMany({
    where: { id: parsed.data.dealId, organizationId },
    data: { stage: parsed.data.stage },
  });
  if (result.count === 0) return { error: "Deal not found" };

  revalidatePath("/dashboard/deals");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/contacts");
  revalidatePath("/dashboard/companies");
  return { success: "Stage updated" };
}

// Hands a deal to another rep, or back to nobody. The rep has to be on
// this workspace; someone already taken off the account can keep deals
// they had but cannot be given new ones.
export async function updateDealOwner(dealId: string, ownerId: string): Promise<ActionState> {
  const { organizationId } = await requireSession();

  const parsed = z
    .object({ dealId: z.string().trim().min(1), ownerId: z.string().trim().max(64) })
    .safeParse({ dealId, ownerId });
  if (!parsed.success) return { error: "That rep isn't valid" };

  const deal = await prisma.deal.findFirst({
    where: { id: parsed.data.dealId, organizationId },
    select: { ownerId: true },
  });
  if (!deal) return { error: "Deal not found" };

  if (parsed.data.ownerId && parsed.data.ownerId !== deal.ownerId) {
    const rep = await prisma.user.findFirst({
      where: { id: parsed.data.ownerId, organizationId, removedAt: null },
      select: { id: true },
    });
    if (!rep) return { error: "That person isn't on this account" };
  }

  await prisma.deal.updateMany({
    where: { id: parsed.data.dealId, organizationId },
    data: { ownerId: parsed.data.ownerId || null },
  });

  revalidatePath("/dashboard/deals");
  return { success: "Rep updated" };
}
