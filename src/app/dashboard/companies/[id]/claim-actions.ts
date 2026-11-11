"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/session";
import { undoLogCore } from "@/lib/undo-log";
import { readClaim } from "@/lib/claim-token";
import type { ActionState } from "@/lib/forms";

// "Moved onto Eli Park · Undo" (company page, BDR redesign Nov 11, 2026):
// a claim taken back. The activities go back onto the company each came
// from with nobody linked, their calendar entries lose the person, a
// meeting the claim put on the Pipeline comes off it (and its tile, when
// the claim made it and nothing else is on it), and the statuses the claim
// moved go back while they are still where it left them (undoLogCore on
// the claim's batchId, which holds only its StatusChange rows). The touch
// and connect dates are recomputed by the database triggers as the rows
// move. Only whoever claimed, or an Owner or Admin.
//
// Everything it acts on comes from the claim's signed token
// (src/lib/claim-token.ts), never from the browser (audit, Nov 11, 2026:
// forged ids, a made-up batchId or another company could pull any touch
// off a person and delete Pipeline meetings).
export async function undoClaim(input: { token: string }): Promise<ActionState> {
  const session = await requireAdminSession();
  const { organizationId, userId } = session;
  const claim = readClaim(input?.token);
  if (!claim || claim.organizationId !== organizationId) return { error: "That can no longer be undone" };
  if (!session.allowed && claim.userId !== userId) return { error: "Only whoever claimed it, or an Owner or Admin, can undo it" };
  const { batchId, contactId } = claim;

  const companyIds = Object.keys(claim.from);
  const companies = await prisma.company.findMany({ where: { id: { in: companyIds }, organizationId }, select: { id: true } });
  const live = new Set(companies.map((row) => row.id));
  const claimedIds = companyIds.filter((id) => live.has(id)).flatMap((id) => claim.from[id] ?? []);
  if (!claimedIds.length) return { error: "That company is no longer here" };
  // Only rows still on the person the claim moved them to.
  const rows = await prisma.activity.findMany({
    where: { id: { in: claimedIds }, organizationId, contactId, companyId: null },
    select: { id: true },
  });
  if (rows.length === 0) return { error: "That has already been undone" };
  const still = new Set(rows.map((row) => row.id));
  const changes = await prisma.statusChange.count({ where: { organizationId, batchId } });

  const ids = rows.map((row) => row.id);
  const since = new Date(claim.at);
  const meetings = await prisma.opportunityMeeting.findMany({
    where: { activityId: { in: ids }, createdAt: { gte: since }, opportunity: { organizationId } },
    select: { id: true, opportunityId: true },
  });
  const opportunityIds = [...new Set(meetings.map((row) => row.opportunityId))];

  await prisma.$transaction(
    async (tx) => {
      for (const companyId of companyIds) {
        const back = (claim.from[companyId] ?? []).filter((id) => still.has(id));
        if (!back.length || !live.has(companyId)) continue;
        await tx.activity.updateMany({ where: { id: { in: back }, organizationId, contactId }, data: { contactId: null, companyId } });
      }
      await tx.calendarEvent.updateMany({ where: { activityId: { in: ids }, organizationId }, data: { contactId: null } });
      if (meetings.length) await tx.opportunityMeeting.deleteMany({ where: { id: { in: meetings.map((row) => row.id) } } });
      for (const opportunityId of opportunityIds) {
        const opportunity = await tx.opportunity.findFirst({
          where: { id: opportunityId, organizationId },
          select: { id: true, dealId: true, createdAt: true, _count: { select: { meetings: true } } },
        });
        if (!opportunity) continue;
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
  if (changes) {
    const result = await undoLogCore(organizationId, batchId, { userId, canManage: session.allowed });
    if ("error" in result && result.error !== "That has already been undone") return { error: result.error };
  }

  for (const companyId of companyIds) revalidatePath(`/dashboard/companies/${companyId}`);
  revalidatePath(`/dashboard/contacts/${contactId}`);
  revalidatePath("/dashboard/contacts");
  revalidatePath("/dashboard/companies");
  revalidatePath("/dashboard/calendar");
  if (opportunityIds.length) revalidatePath("/dashboard/deals");
  return { success: ids.length === 1 ? "Back on the company, not linked" : `${ids.length} back on the company, not linked` };
}
