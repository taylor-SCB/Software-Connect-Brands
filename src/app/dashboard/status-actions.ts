"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import {
  CONTACT_STATUSES,
  CONTACT_STATUS_LABELS,
  PASS_THROUGH_CONNECTED,
  PIPELINE_STEPS,
  STATUS_REASONS,
  type ContactStatusValue,
} from "@/lib/constants";
import { isRealDay } from "@/lib/calendar";
import { getTimeZone } from "@/lib/organization";
import { todayIso } from "@/lib/payments";
import { zonedNoon } from "@/lib/money";
import { advanceCompany, skippedSteps } from "@/lib/status";
import { followContactStatus } from "@/lib/opportunities";

const schema = z.object({
  kind: z.enum(["contact", "company"]),
  id: z.string().trim().min(1),
  target: z.enum(CONTACT_STATUSES),
  // yyyy-mm-dd per pipeline step being passed through, the target included.
  dates: z.record(z.string(), z.string()).default({}),
  // The optional one-tap reason for Not Interested or Lost (decision 14).
  reason: z.enum(STATUS_REASONS).nullish(),
});

export type StatusResult = { error?: string; success?: string };

// A status set by hand from a contact's or company's page. Moving into the
// pipeline past steps never recorded (Meeting Set straight to Quote Sent)
// needs the day each of those steps happened — Stats measures the time
// between them — so each is written with its own date. Anything else is
// written as happening today. Interested, Not Interested or Meeting Set
// (on its own or passed through) from Not Actioned or Attempted writes
// Connected first, on the same day (Nov 11, 2026). Not Interested and Lost
// keep the reason picked, if one was (Price, Timing, Has a vendor, No
// budget, Other), on their StatusChange row.
export async function setRecordStatus(input: {
  kind: "contact" | "company";
  id: string;
  target: string;
  dates?: Record<string, string>;
  reason?: string | null;
}): Promise<StatusResult> {
  const { organizationId, userId } = await requireSession();
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: "That status isn't one of the choices" };
  const { kind, id, target, dates } = parsed.data;
  const reason = target === "NOT_INTERESTED" || target === "LOST" ? (parsed.data.reason ?? null) : null;

  const record =
    kind === "contact"
      ? await prisma.contact.findFirst({ where: { id, organizationId }, select: { status: true } })
      : await prisma.company.findFirst({ where: { id, organizationId }, select: { status: true } });
  if (!record) return { error: kind === "contact" ? "Contact not found" : "Company not found" };
  if (record.status === target) return { success: "No change" };

  const timeZone = await getTimeZone();
  const today = todayIso(timeZone);
  const steps: ContactStatusValue[] = (PIPELINE_STEPS as readonly string[]).includes(target)
    ? [...skippedSteps(record.status, target), target as ContactStatusValue]
    : [target];
  // Only pipeline steps are dated by hand; the rest happen today.
  const needsDates = (PIPELINE_STEPS as readonly string[]).includes(target) && steps.length > 1;

  const days: string[] = [];
  for (const step of steps) {
    const day = needsDates ? dates[step] : today;
    if (!day || !isRealDay(day)) return { error: `Enter the date for ${CONTACT_STATUS_LABELS[step]}` };
    if (day > today) return { error: `${CONTACT_STATUS_LABELS[step]} can't be in the future` };
    days.push(day);
  }
  for (let index = 1; index < days.length; index += 1) {
    if (days[index] < days[index - 1]) {
      return { error: `${CONTACT_STATUS_LABELS[steps[index]]} can't be before ${CONTACT_STATUS_LABELS[steps[index - 1]]}` };
    }
  }

  // Connected first, the same day as the first step that needs it.
  const needsConnect =
    (record.status === "NOT_ACTIONED" || record.status === "CONTACTED") &&
    steps.findIndex((step) => PASS_THROUGH_CONNECTED.includes(step)) >= 0;
  if (needsConnect) {
    const at = steps.findIndex((step) => PASS_THROUGH_CONNECTED.includes(step));
    steps.splice(at, 0, "CONNECTED");
    days.splice(at, 0, days[at]);
  }

  const scope = kind === "contact" ? { contactId: id } : { companyId: id };
  let from: string = record.status;
  const writes = steps.map((step, index) => {
    const row = prisma.statusChange.create({
      data: {
        organizationId,
        ...scope,
        userId,
        fromStatus: from,
        toStatus: step,
        // A date typed for today is now; an earlier one is its midday.
        on: days[index] === today ? new Date() : zonedNoon(days[index], timeZone),
        // The pass-through is the app's step, not the person's pick.
        auto: needsConnect && step === "CONNECTED",
        reason: index === steps.length - 1 ? reason : null,
      },
    });
    from = step;
    return row;
  });

  await prisma.$transaction([
    ...(kind === "contact"
      ? [prisma.contact.updateMany({ where: { id, organizationId }, data: { status: target } })]
      : [prisma.company.updateMany({ where: { id, organizationId }, data: { status: target } })]),
    ...writes,
  ]);

  // A person's company comes along when they move forward, the same as
  // for the automatic moves; a company never goes back because of them.
  if (kind === "contact") {
    const company = await prisma.contact.findFirst({ where: { id, organizationId }, select: { companyId: true } });
    if (company?.companyId) {
      const at = days[days.length - 1] === today ? new Date() : zonedNoon(days[days.length - 1], timeZone);
      await advanceCompany({ organizationId, userId }, company.companyId, target, { on: at, auto: true });
      revalidatePath(`/dashboard/companies/${company.companyId}`);
    }
  }

  // Their opportunity follows a move made by hand (Oct 27, 2026), so
  // nobody leaves the Pipeline because their status went past a column
  // they had no deal for.
  if (kind === "contact") {
    await followContactStatus({ organizationId, userId }, id, target);
    revalidatePath("/dashboard/deals");
  }

  revalidatePath(kind === "contact" ? `/dashboard/contacts/${id}` : `/dashboard/companies/${id}`);
  revalidatePath(kind === "contact" ? "/dashboard/contacts" : "/dashboard/companies");
  return { success: `Now ${CONTACT_STATUS_LABELS[target]}` };
}
