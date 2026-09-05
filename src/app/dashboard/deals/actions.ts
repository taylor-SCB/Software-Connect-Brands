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
  return { success: "Stage updated" };
}
