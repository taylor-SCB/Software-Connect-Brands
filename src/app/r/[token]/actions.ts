"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { parseForm, type ActionState } from "@/lib/forms";
import { inviteState } from "@/lib/ratesheets";

// The partner's answer. Unauthenticated by design: the token in the link
// is the only key, the same as signing a contract. The transition is
// guarded in the WHERE clause so two clicks (or a stale tab) can't flip
// an answer that was already given.
export async function respondToRatesheetInvite(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = parseForm(
    z.object({
      token: z.string().trim().min(10),
      decision: z.enum(["APPROVE", "DECLINE"]),
    }),
    { token: formData.get("token"), decision: formData.get("decision") },
  );
  if (!parsed.ok) return { error: parsed.error };

  const invite = await prisma.ratesheetInvite.findUnique({
    where: { token: parsed.data.token },
    select: {
      id: true,
      status: true,
      respondBy: true,
      ratesheet: {
        select: { active: true, expiresOn: true, organization: { select: { status: true } } },
      },
    },
  });
  if (!invite || invite.ratesheet.organization.status !== "ACTIVE") {
    return { error: "This link isn't available" };
  }

  const state = inviteState(invite, invite.ratesheet);
  if (state === "APPROVED" || state === "DECLINED") {
    return { error: "This ratesheet has already been answered" };
  }
  if (state === "EXPIRED") {
    return { error: "This link has expired — ask the sender for a new one" };
  }

  const result = await prisma.ratesheetInvite.updateMany({
    where: { id: invite.id, status: "PENDING" },
    data: {
      status: parsed.data.decision === "APPROVE" ? "APPROVED" : "DECLINED",
      respondedAt: new Date(),
    },
  });
  if (result.count === 0) return { error: "This ratesheet has already been answered" };

  revalidatePath(`/r/${parsed.data.token}`);
  revalidatePath("/dashboard/products/ratesheets");
  return { success: parsed.data.decision === "APPROVE" ? "Approved" : "Declined" };
}
