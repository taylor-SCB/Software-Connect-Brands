"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";

const STAGES = ["NEW", "CONTACTED", "WON", "LOST"] as const;

export async function updateDealStage(dealId: string, stage: string) {
  const { organizationId } = await requireSession();

  if (!STAGES.includes(stage as (typeof STAGES)[number])) {
    return;
  }

  await prisma.deal.updateMany({
    where: { id: dealId, organizationId },
    data: { stage: stage as (typeof STAGES)[number] },
  });

  revalidatePath("/dashboard/deals");
}
