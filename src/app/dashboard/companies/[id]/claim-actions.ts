"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/session";
import { undoLogCore } from "@/lib/undo-log";
import type { ActionState } from "@/lib/forms";

const idSchema = z.string().trim().min(1);

// When a claim's save began, from its batchId (newBatchId: base-36 clock,
// a dot, a uuid). Anything the claim made is no older than this.
function claimedAt(batchId: string): Date | null {
  const stamp = batchId.split(".")[0] ?? "";
  const ms = /^[0-9a-z]{6,10}$/.test(stamp) ? parseInt(stamp, 36) : NaN;
  return Number.isFinite(ms) && ms > 1_767_225_600_000 && ms < 4_102_444_800_000 ? new Date(ms) : null;
}

// "Moved onto Eli Park · Undo" (company page, BDR redesign Nov 11, 2026):
// a claim taken back. The activities go back onto the company with nobody
// linked, their calendar entries lose the person, a meeting the claim put
// on the Pipeline comes off it (and its tile, when the claim made it and
// nothing else is on it), and the statuses the claim moved go back while
// they are still where it left them (undoLogCore on the claim's batchId,
// which holds only its StatusChange rows). The touch and connect dates are
// recomputed by the database triggers as the rows move. Only whoever
// claimed, or an Owner or Admin.
export async function undoClaim(input: {
  batchId: string;
  activityIds: string[];
  contactId: string;
  companyId: string;
}): Promise<ActionState> {
  const session = await requireAdminSession();
  const { organizationId, userId } = session;
  const parsed = z
    .object({
      batchId: z.string().trim().min(1).max(200),
      activityIds: z.array(idSchema).min(1).max(500),
      contactId: idSchema,
      companyId: idSchema,
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Nothing to undo" };
  const { batchId, activityIds, contactId, companyId } = parsed.data;

  const company = await prisma.company.findFirst({ where: { id: companyId, organizationId }, select: { id: true } });
  if (!company) return { error: "That company is no longer here" };
  const rows = await prisma.activity.findMany({
    where: { id: { in: activityIds }, organizationId, contactId, companyId: null },
    select: { id: true },
  });
  if (rows.length === 0) return { error: "That has already been undone" };
  const changes = await prisma.statusChange.findMany({ where: { organizationId, batchId }, select: { userId: true } });
  if (!session.allowed && changes.some((row) => row.userId && row.userId !== userId)) {
    return { error: "Only whoever claimed it, or an Owner or Admin, can undo it" };
  }

  const ids = rows.map((row) => row.id);
  const since = claimedAt(batchId);
  const meetings = since
    ? await prisma.opportunityMeeting.findMany({
        where: { activityId: { in: ids }, createdAt: { gte: since }, opportunity: { organizationId } },
        select: { id: true, opportunityId: true },
      })
    : [];
  const opportunityIds = [...new Set(meetings.map((row) => row.opportunityId))];

  await prisma.$transaction(
    async (tx) => {
      await tx.activity.updateMany({ where: { id: { in: ids }, organizationId }, data: { contactId: null, companyId } });
      await tx.calendarEvent.updateMany({ where: { activityId: { in: ids }, organizationId }, data: { contactId: null } });
      if (meetings.length) await tx.opportunityMeeting.deleteMany({ where: { id: { in: meetings.map((row) => row.id) } } });
      for (const opportunityId of opportunityIds) {
        const opportunity = await tx.opportunity.findFirst({
          where: { id: opportunityId, organizationId },
          select: { id: true, dealId: true, createdAt: true, _count: { select: { meetings: true } } },
        });
        if (!opportunity || !since) continue;
        if (!opportunity.dealId && opportunity._count.meetings === 0 && opportunity.createdAt >= since) {
          await tx.opportunity.deleteMany({ where: { id: opportunity.id, organizationId } });
          continue;
        }
        await tx.opportunityContact.deleteMany({
          where: { opportunityId: opportunity.id, contactId, fromMeeting: true, createdAt: { gte: since }, role: { not: "PRIMARY" } },
        });
      }
    },
    { timeout: 20_000 },
  );

  // The statuses the claim moved. A claim that moved nobody (they were
  // already further along) has no rows to put back.
  if (changes.length) {
    const result = await undoLogCore(organizationId, batchId, { userId, canManage: session.allowed });
    if ("error" in result && result.error !== "That has already been undone") return { error: result.error };
  }

  revalidatePath(`/dashboard/companies/${companyId}`);
  revalidatePath(`/dashboard/contacts/${contactId}`);
  revalidatePath("/dashboard/contacts");
  revalidatePath("/dashboard/companies");
  revalidatePath("/dashboard/calendar");
  if (opportunityIds.length) revalidatePath("/dashboard/deals");
  return { success: ids.length === 1 ? "Back on the company, not linked" : `${ids.length} back on the company, not linked` };
}
