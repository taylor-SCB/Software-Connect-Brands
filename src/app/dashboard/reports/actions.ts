"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { getTimeZone, getOrganization } from "@/lib/organization";
import type { ActionState } from "@/lib/forms";
import { isReportKey, loadTeam, nameOf, REPORT_CODES } from "@/lib/reports/common";
import { loadReport, paramsFor, readChoice } from "@/lib/reports/index";
import { writeNarrative } from "@/lib/reports/narrative";
import { cadencesFor, isCadence } from "@/lib/reports/subscriptions";

// The report bar's two server-side buttons: the write-up (written or
// rewritten from the numbers as they stand right now — never from anything
// the browser sends but the choice of report) and "Email me this".

export async function narrativeAction(input: {
  report?: string;
  period?: string;
  rep?: string;
  by?: string;
  force?: boolean;
}): Promise<{ body: string; source: "CLAUDE" | "RULES" } | { error: string }> {
  const { organizationId, userId } = await requireSession();
  const [team, timeZone, organization] = await Promise.all([loadTeam(organizationId), getTimeZone(), getOrganization()]);
  const choice = readChoice(input, team.map((member) => member.id));
  const params = paramsFor(choice, { organizationId, timeZone, now: new Date() });
  try {
    const report = await loadReport(choice.report, params);
    const narrative = await writeNarrative({
      organizationId,
      userId,
      report,
      ctx: { choice, range: params.range, repName: choice.repId ? nameOf(team, choice.repId) : null, businessName: organization.name },
      force: Boolean(input.force),
    });
    return { body: narrative.body, source: narrative.source };
  } catch (error) {
    console.error("[report-narrative]", error);
    return { error: "The write-up couldn't be written just now. Try again." };
  }
}

export async function subscribeReport(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  const report = String(formData.get("report") ?? "");
  const cadence = String(formData.get("cadence") ?? "");
  const recipientId = String(formData.get("recipientId") ?? "") || session.userId;
  const repRaw = String(formData.get("repId") ?? "");
  if (!isReportKey(report)) return { error: "Pick a report." };
  if (!isCadence(cadence) || !cadencesFor(report).includes(cadence)) return { error: "Pick how often." };

  const admin = session.role === "OWNER" || session.role === "ADMIN";
  if (recipientId !== session.userId && !admin) return { error: "Only owners and admins can sign up a teammate." };
  const people = await prisma.user.findMany({
    where: { organizationId: session.organizationId, id: { in: [recipientId, ...(repRaw ? [repRaw] : [])] } },
    select: { id: true, name: true, removedAt: true },
  });
  const recipient = people.find((person) => person.id === recipientId);
  if (!recipient || recipient.removedAt) return { error: "That teammate isn't on this account." };
  const repId = repRaw && people.some((person) => person.id === repRaw) ? repRaw : null;
  if (repRaw && !repId) return { error: "That rep isn't on this account." };

  // The unique index can't see two "whole team" rows as the same (a null
  // rep is never equal to another), so look first.
  const existing = await prisma.reportSubscription.findFirst({
    where: { organizationId: session.organizationId, recipientId, report: REPORT_CODES[report], cadence, repId },
    select: { id: true },
  });
  if (existing) return { success: `${recipient.id === session.userId ? "You already get" : `${recipient.name} already gets`} this one.` };
  await prisma.reportSubscription.create({
    data: {
      organizationId: session.organizationId,
      recipientId,
      report: REPORT_CODES[report],
      cadence,
      repId,
      createdById: session.userId,
    },
  });
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/settings/account");
  return { success: recipient.id === session.userId ? "Done — it'll be in your inbox at 6am." : `Done — ${recipient.name} gets it at 6am.` };
}

// Your own, or anyone's on the account for an Owner or Admin.
export async function unsubscribeReport(formData: FormData) {
  const session = await requireSession();
  const id = String(formData.get("id") ?? "");
  const admin = session.role === "OWNER" || session.role === "ADMIN";
  await prisma.reportSubscription.deleteMany({
    where: { id, organizationId: session.organizationId, ...(admin ? {} : { recipientId: session.userId }) },
  });
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/settings/account");
}
