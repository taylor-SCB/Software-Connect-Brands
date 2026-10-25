"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/session";
import { ACCOUNT_TYPES, ACCOUNT_TYPE_LABELS } from "@/lib/account-types";
import { keepFields, parseForm, type ActionState } from "@/lib/forms";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { absoluteUrl } from "@/lib/app-url";
import { escapeHtml } from "@/lib/email-marketing";

const PATH = "/dashboard/settings/general";
const OPERATOR_EMAILS_PER_HOUR = 3;

const requestSchema = z.object({
  toType: z.enum(ACCOUNT_TYPES, { message: "Pick the type you want to change to" }),
  note: z.string().trim().max(500, "Keep the note under 500 characters").optional(),
});

// "We're a Distributor now." A workspace's type is changed only by the
// operator, so this asks; nothing changes until the request is approved
// on /admin.
export async function requestAccountTypeChange(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const kept = keepFields(formData, ["toType", "note"]);
  const session = await requireAdminSession();
  if (!session.allowed) return { error: "Only owners and admins can ask to change the account type.", kept };

  const parsed = parseForm(requestSchema, {
    toType: formData.get("toType"),
    note: formData.get("note") ?? undefined,
  });
  if (!parsed.ok) return { error: parsed.error, kept };

  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: session.organizationId },
    select: { name: true, accountType: true },
  });
  if (parsed.data.toType === organization.accountType) {
    return { error: `You're already a ${ACCOUNT_TYPE_LABELS[organization.accountType]} account.`, kept };
  }

  try {
    await prisma.accountTypeRequest.create({
      data: {
        organizationId: session.organizationId,
        requestedById: session.userId,
        fromType: organization.accountType,
        toType: parsed.data.toType,
        note: parsed.data.note ?? "",
        // Unique: a second open request for this workspace is refused by
        // the database, whatever two tabs do at once.
        openFor: session.organizationId,
      },
    });
  } catch (error) {
    if ((error as { code?: string })?.code === "P2002") {
      return { error: "A change is already waiting for approval. Cancel it first to ask for a different one." };
    }
    throw error;
  }

  // Let the operator know. Best effort, like a declined ratesheet: the
  // request is in the queue on /admin either way. Asking and cancelling
  // over and over emails the first few times an hour, not every time:
  // the email provider's daily cap is shared by every workspace.
  const recent = await prisma.accountTypeRequest.count({
    where: { organizationId: session.organizationId, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
  });
  if (isEmailConfigured() && recent <= OPERATOR_EMAILS_PER_HOUR) {
    const operators = await prisma.user.findMany({
      where: { isSuperAdmin: true, removedAt: null },
      select: { email: true },
    });
    const link = await absoluteUrl("/admin#type-requests");
    const change = `${ACCOUNT_TYPE_LABELS[organization.accountType]} → ${ACCOUNT_TYPE_LABELS[parsed.data.toType]}`;
    for (const operator of operators) {
      await sendEmail({
        to: operator.email,
        subject: `Account type change — ${organization.name}`,
        text: [
          `${session.name} (${session.email}) asked to change ${organization.name}: ${change}.`,
          parsed.data.note ? `\nTheir note: "${parsed.data.note}"` : "",
          "",
          `Approve or decline it: ${link}`,
        ].join("\n"),
        html: [
          `<p>${escapeHtml(session.name)} (${escapeHtml(session.email)}) asked to change ${escapeHtml(organization.name)}: ${escapeHtml(change)}.</p>`,
          parsed.data.note ? `<p>Their note: &ldquo;${escapeHtml(parsed.data.note)}&rdquo;</p>` : "",
          `<p><a href="${link}">Approve or decline it</a></p>`,
        ].join("\n"),
      });
    }
  }

  revalidatePath(PATH);
  revalidatePath("/admin");
  return { success: "Sent. It changes once it's approved." };
}

export async function cancelAccountTypeRequest(_prev: ActionState, _formData: FormData): Promise<ActionState> {
  const session = await requireAdminSession();
  if (!session.allowed) return { error: "Only owners and admins can change this." };

  const cancelled = await prisma.accountTypeRequest.updateMany({
    where: { organizationId: session.organizationId, status: "PENDING" },
    data: { status: "CANCELLED", openFor: null },
  });
  revalidatePath(PATH);
  revalidatePath("/admin");
  if (cancelled.count === 0) return { error: "There was nothing waiting. It may have just been answered." };
  return { success: "Request cancelled." };
}
