"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { DEAL_STAGES } from "@/lib/constants";
import type { ActionState } from "@/lib/forms";
import { getTimeZone } from "@/lib/organization";
import { todayIso } from "@/lib/payments";
import { zonedNoon } from "@/lib/money";
import { isRealDay } from "@/lib/calendar";
import { advanceContact, statusForDealStage } from "@/lib/status";

// A deal moved by hand on its tile, with the day it happened. Written to
// StatusChange like the automatic moves, and the contact follows it:
// Won or Lost on the deal is Won or Lost on the person.
export async function updateDealStage(dealId: string, stage: string, on?: string): Promise<ActionState> {
  const { organizationId, userId } = await requireSession();

  const parsed = z
    .object({ dealId: z.string().trim().min(1), stage: z.enum(DEAL_STAGES) })
    .safeParse({ dealId, stage });
  if (!parsed.success) return { error: "That stage isn't valid" };

  const timeZone = await getTimeZone();
  const today = todayIso(timeZone);
  const day = on && isRealDay(on) ? on : today;
  if (day > today) return { error: "That day hasn't happened yet" };
  const at = day === today ? new Date() : zonedNoon(day, timeZone);

  const deal = await prisma.deal.findFirst({
    where: { id: parsed.data.dealId, organizationId },
    select: { stage: true, contactId: true },
  });
  if (!deal) return { error: "Deal not found" };
  if (deal.stage === parsed.data.stage) return { success: "No change" };

  await prisma.$transaction([
    prisma.deal.updateMany({
      where: { id: parsed.data.dealId, organizationId },
      data: { stage: parsed.data.stage, stageChangedAt: at },
    }),
    prisma.statusChange.create({
      data: {
        organizationId,
        dealId: parsed.data.dealId,
        userId,
        fromStatus: deal.stage,
        toStatus: parsed.data.stage,
        on: at,
        auto: false,
      },
    }),
  ]);
  const status = statusForDealStage(parsed.data.stage);
  if (status) await advanceContact({ organizationId, userId }, deal.contactId, status, { on: at, dealId: parsed.data.dealId, auto: false });

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
