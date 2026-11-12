"use server";

import { setApparel } from "@/lib/apparel";

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
  // Both refusals below mean this page is out of date (another tab or
  // admin asked, or the operator changed the type), so it is refreshed:
  // the card then shows what is really waiting, with its Cancel button.
  if (parsed.data.toType === organization.accountType) {
    revalidatePath(PATH);
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
      revalidatePath(PATH);
      return { error: "A change is already waiting for approval. Cancel it first to ask for a different one.", kept };
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

export async function cancelAccountTypeRequest(): Promise<ActionState> {
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

// "Gone quiet after N days" (Nov 10, 2026): how long an open opportunity
// can go without a call, text, email or meeting before the Pipeline marks
// it quiet. Owners and admins only, like the rest of this page.
export async function updateQuietDays(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const kept = keepFields(formData, ["quietDays"]);
  const session = await requireAdminSession();
  if (!session.allowed) return { error: "Only owners and admins can change this.", kept };
  const parsed = parseForm(
    z.object({ quietDays: z.coerce.number().int("Use a whole number of days").min(1, "At least 1 day").max(365, "At most 365 days") }),
    { quietDays: formData.get("quietDays") },
  );
  if (!parsed.ok) return { error: parsed.error, kept };
  await prisma.organization.update({ where: { id: session.organizationId }, data: { quietDays: parsed.data.quietDays } });
  revalidatePath(PATH);
  revalidatePath("/dashboard/deals");
  return { success: `Saved: quiet after ${parsed.data.quietDays} ${parsed.data.quietDays === 1 ? "day" : "days"}` };
}

// Team goals and the try limit (BDR redesign, Nov 11, 2026; decisions 11
// and 12). Weekly tries, talks and meetings booked are optional: blank
// means no goal, and My day's rings then read "vs last week". The try
// limit is how many tries with no talk before Up next offers "Try again in
// 30 days". Owners and admins only.
const goal = z
  .string()
  .trim()
  .transform((value) => (value === "" ? null : Number(value)))
  .pipe(z.number().int("Use a whole number").min(1, "A goal is at least 1").max(10000, "A goal is at most 10,000").nullable());

export async function updateTeamGoals(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const fields = ["weeklyTryGoal", "weeklyTalkGoal", "weeklyMeetingGoal", "parkAfterTries"];
  const kept = keepFields(formData, fields);
  const session = await requireAdminSession();
  if (!session.allowed) return { error: "Only owners and admins can change this.", kept };
  const parsed = parseForm(
    z.object({
      weeklyTryGoal: goal,
      weeklyTalkGoal: goal,
      weeklyMeetingGoal: goal,
      parkAfterTries: z.coerce.number().int("Use a whole number of tries").min(1, "At least 1 try").max(50, "At most 50 tries"),
    }),
    Object.fromEntries(fields.map((field) => [field, String(formData.get(field) ?? "")])),
  );
  if (!parsed.ok) return { error: parsed.error, kept };
  await prisma.organization.update({ where: { id: session.organizationId }, data: parsed.data });
  revalidatePath(PATH);
  revalidatePath("/dashboard");
  const set = [parsed.data.weeklyTryGoal, parsed.data.weeklyTalkGoal, parsed.data.weeklyMeetingGoal].filter((value) => value !== null).length;
  return { success: set ? `Saved: ${set} weekly ${set === 1 ? "goal" : "goals"}, try limit ${parsed.data.parkAfterTries}` : `Saved: no weekly goals, try limit ${parsed.data.parkAfterTries}` };
}

// "We do apparel / custom print" (the apparel pack, Nov 12, 2026). Owners
// and admins only, like the rest of this page. Turning it on makes the
// Print location list; turning it off hides the apparel screens and
// deletes nothing.
export async function updateApparel(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireAdminSession();
  if (!session.allowed) return { error: "Only owners and admins can change this." };
  const wanted = formData.get("apparelOn") === "true";
  const result = await setApparel(session.organizationId, wanted);
  if ("error" in result) return { error: result.error };
  revalidatePath(PATH);
  revalidatePath("/dashboard", "layout");
  return { success: wanted ? "Apparel is on." : "Apparel is off. Nothing was deleted." };
}
