"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { getTimeZone } from "@/lib/organization";
import { parseForm, type ActionState } from "@/lib/forms";
import { formatCents } from "@/lib/format";
import { isoToDate, todayIso } from "@/lib/payments";
import { refreshProjectTotals } from "@/lib/projects";
import { costsByDefault, ratesFor, timeEntryAmountCents, describeTime } from "@/lib/crews";

const idSchema = z.string().trim().min(1, "Missing record reference");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the day it was worked");

function revalidateJob(projectId: string) {
  revalidatePath(`/dashboard/projects/${projectId}`);
  revalidatePath(`/dashboard/projects/${projectId}/crew`);
  revalidatePath(`/dashboard/projects/${projectId}/money`);
  revalidatePath("/dashboard/projects");
  revalidatePath("/dashboard/projects/budgets");
  revalidatePath("/dashboard");
}

// A number typed into an hours or days box. Blank is nothing, not an
// error: a day's work is logged as days with hours left empty.
function amount(input: FormDataEntryValue | null) {
  if (typeof input !== "string" || input.trim() === "") return 0;
  const value = Number.parseFloat(input.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(value) || value < 0) return 0;
  // A day is 24 hours and a job is not 400 days long; a slipped decimal
  // would otherwise put six figures on a budget.
  return Math.min(value, 999);
}

const logSchema = z.object({
  projectId: idSchema,
  scopeId: z.string().trim().optional(),
  crewId: z.string().trim().optional(),
  workerId: z.string().trim().optional(),
  workedOn: isoDate,
  note: z.string().trim().max(300).optional(),
});

// Log time on a job. Either a crew as a whole or one person on it; hours,
// days, or both. The rates are copied onto the row as they stand today,
// so a rate rise later never rewrites what this day cost.
export async function logTime(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organizationId } = await requireSession();
  const timeZone = await getTimeZone();
  const parsed = parseForm(logSchema, {
    projectId: formData.get("projectId"),
    scopeId: formData.get("scopeId") ?? undefined,
    crewId: formData.get("crewId") ?? undefined,
    workerId: formData.get("workerId") ?? undefined,
    workedOn: formData.get("workedOn") || todayIso(timeZone),
    note: formData.get("note") ?? undefined,
  });
  if (!parsed.ok) return { error: parsed.error };

  const hours = amount(formData.get("hours"));
  const days = amount(formData.get("days"));
  if (hours === 0 && days === 0) return { error: "Enter the hours, the days, or both." };

  const project = await prisma.project.findFirst({
    where: { id: parsed.data.projectId, organizationId },
    select: { id: true },
  });
  if (!project) return { error: "Project not found" };

  const scope = parsed.data.scopeId
    ? await prisma.projectScope.findFirst({
        where: { id: parsed.data.scopeId, projectId: project.id },
        select: { id: true },
      })
    : null;

  const worker = parsed.data.workerId
    ? await prisma.worker.findFirst({
        where: { id: parsed.data.workerId, organizationId },
        select: { id: true, name: true, crewId: true, hourlyRateCents: true, dailyRateCents: true },
      })
    : null;

  // The crew picked, or the one the person belongs to.
  const crewId = parsed.data.crewId || worker?.crewId || "";
  const crew = crewId
    ? await prisma.crew.findFirst({
        where: { id: crewId, organizationId },
        select: { id: true, name: true, kind: true, hourlyRateCents: true, dailyRateCents: true },
      })
    : null;

  if (!crew && !worker) return { error: "Pick the crew or the person who did the work." };

  const rates = ratesFor(worker, crew);
  if (rates.hourlyRateCents === 0 && rates.dailyRateCents === 0) {
    return {
      error: `No rate on file for ${worker?.name ?? crew?.name}. Set one on the crew and log the time again.`,
    };
  }
  if (hours > 0 && rates.hourlyRateCents === 0) {
    return { error: `${worker?.name ?? crew?.name} has no hourly rate — log it in days, or add one.` };
  }
  if (days > 0 && rates.dailyRateCents === 0) {
    return { error: `${worker?.name ?? crew?.name} has no day rate — log it in hours, or add one.` };
  }

  // Whether this costs the job depends on who did it, and the form can
  // override it for a sub being paid by the hour with no order behind them.
  const override = formData.get("countsAsCost");
  const countsAsCost = override === null ? costsByDefault(crew?.kind ?? "OWN") : override === "on";

  const amountCents = timeEntryAmountCents({ hours, days, ...rates });

  await prisma.timeEntry.create({
    data: {
      organizationId,
      projectId: project.id,
      scopeId: scope?.id ?? null,
      crewId: crew?.id ?? null,
      workerId: worker?.id ?? null,
      workerName: worker?.name ?? crew?.name ?? "Crew",
      workedOn: isoToDate(parsed.data.workedOn)!,
      hours,
      days,
      hourlyRateCents: rates.hourlyRateCents,
      dailyRateCents: rates.dailyRateCents,
      amountCents,
      countsAsCost,
      note: parsed.data.note ?? "",
    },
  });

  await refreshProjectTotals(organizationId, project.id);
  revalidateJob(project.id);
  return {
    success: countsAsCost
      ? `${describeTime({ hours, days })} logged — ${formatCents(amountCents)} on the job`
      : `${describeTime({ hours, days })} logged for ${crew?.name ?? worker?.name}, tracked but not added to the budget`,
  };
}

// Marking one row paid, or unpaid again. Paid time is Spent; unpaid time
// is Committed, so this moves money from one part of the bar to the other.
export async function setTimePaid(entryId: string, paidOn: string | null): Promise<ActionState> {
  const { organizationId } = await requireSession();
  const entry = await prisma.timeEntry.findFirst({
    where: { id: entryId, organizationId },
    select: { id: true, projectId: true },
  });
  if (!entry) return { error: "That time entry is gone" };

  if (paidOn !== null && !isoDate.safeParse(paidOn).success) return { error: "Pick a date" };

  await prisma.timeEntry.updateMany({
    where: { id: entry.id, organizationId },
    data: { paidOn: paidOn ? isoToDate(paidOn) : null },
  });
  await refreshProjectTotals(organizationId, entry.projectId);
  revalidateJob(entry.projectId);
  return { success: paidOn ? "Marked paid" : "Back to unpaid" };
}

// "Mark paid through" — payroll went out on Friday, so everything logged
// up to and including that day is paid. One click instead of twenty.
export async function markPaidThrough(
  projectId: string,
  input: { through: string; crewId?: string },
): Promise<ActionState> {
  const { organizationId } = await requireSession();
  const parsed = z
    .object({ projectId: idSchema, through: isoDate, crewId: z.string().trim().optional() })
    .safeParse({ projectId, ...input });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the date" };

  const project = await prisma.project.findFirst({
    where: { id: parsed.data.projectId, organizationId },
    select: { id: true },
  });
  if (!project) return { error: "Project not found" };

  const through = isoToDate(parsed.data.through)!;
  const result = await prisma.timeEntry.updateMany({
    where: {
      organizationId,
      projectId: project.id,
      paidOn: null,
      countsAsCost: true,
      workedOn: { lte: through },
      ...(parsed.data.crewId ? { crewId: parsed.data.crewId } : {}),
    },
    data: { paidOn: through },
  });

  await refreshProjectTotals(organizationId, project.id);
  revalidateJob(project.id);
  if (result.count === 0) return { success: "Nothing was waiting to be paid." };
  return {
    success: `${result.count} ${result.count === 1 ? "entry" : "entries"} marked paid`,
  };
}

export async function deleteTimeEntry(entryId: string): Promise<ActionState> {
  const { organizationId } = await requireSession();
  const entry = await prisma.timeEntry.findFirst({
    where: { id: entryId, organizationId },
    select: { id: true, projectId: true, paidOn: true },
  });
  if (!entry) return { error: "That time entry is gone" };
  if (entry.paidOn) {
    return { error: "That time has been paid. Mark it unpaid first if it really needs removing." };
  }

  await prisma.timeEntry.deleteMany({ where: { id: entry.id, organizationId } });
  await refreshProjectTotals(organizationId, entry.projectId);
  revalidateJob(entry.projectId);
  return { success: "Removed" };
}
