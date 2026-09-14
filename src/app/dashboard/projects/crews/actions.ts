"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { parseForm, type ActionState } from "@/lib/forms";
import { dollarsToCents } from "@/lib/format";
import { CREW_KINDS } from "@/lib/crews";
import { ensureServiceType } from "@/lib/service-types";

function revalidateCrews(projectId?: string | null) {
  revalidatePath("/dashboard/projects/crews");
  revalidatePath("/dashboard/projects");
  if (projectId) revalidatePath(`/dashboard/projects/${projectId}/crew`);
}

// A rate left blank means "no rate", which is different from zero: a
// worker with no hourly rate falls back on the crew's, a worker with a
// rate of nothing does not.
function optionalRate(input: FormDataEntryValue | null) {
  if (typeof input !== "string" || input.trim() === "") return null;
  const cents = dollarsToCents(input);
  return cents > 0 ? cents : null;
}

const crewSchema = z.object({
  crewId: z.string().trim().optional(),
  name: z.string().trim().min(1, "Give the crew a name").max(80),
  kind: z.enum(CREW_KINDS),
  companyId: z.string().trim().optional(),
  contactId: z.string().trim().optional(),
  phone: z.string().trim().max(40).optional(),
  email: z.string().trim().max(160).optional(),
  notes: z.string().trim().max(2000).optional(),
});

// One form creates and edits. A subcontractor crew wants the company that
// bills you; your own crew has no company, so it is cleared rather than
// left behind from a kind change.
export async function saveCrew(_prev: ActionState, formData: FormData): Promise<ActionState & { crewId?: string }> {
  const { organizationId } = await requireSession();
  const parsed = parseForm(crewSchema, {
    crewId: formData.get("crewId") ?? undefined,
    name: formData.get("name"),
    kind: formData.get("kind") ?? "OWN",
    companyId: formData.get("companyId") ?? undefined,
    contactId: formData.get("contactId") ?? undefined,
    phone: formData.get("phone") ?? undefined,
    email: formData.get("email") ?? undefined,
    notes: formData.get("notes") ?? undefined,
  });
  if (!parsed.ok) return { error: parsed.error };

  const subcontractor = parsed.data.kind === "SUBCONTRACTOR";

  // The service types they cover, each added to the workspace's list if
  // it is new, so a crew can be set up without a trip to Settings.
  const serviceTypes: string[] = [];
  for (const value of formData.getAll("serviceTypes")) {
    if (typeof value !== "string" || !value.trim()) continue;
    const name = await ensureServiceType(organizationId, value);
    if (name && !serviceTypes.includes(name)) serviceTypes.push(name);
  }

  const company = subcontractor && parsed.data.companyId
    ? await prisma.company.findFirst({
        where: { id: parsed.data.companyId, organizationId },
        select: { id: true },
      })
    : null;
  const contact = parsed.data.contactId
    ? await prisma.contact.findFirst({
        where: { id: parsed.data.contactId, organizationId },
        select: { id: true },
      })
    : null;

  const data = {
    name: parsed.data.name,
    kind: parsed.data.kind,
    companyId: company?.id ?? null,
    contactId: contact?.id ?? null,
    serviceTypes,
    hourlyRateCents: optionalRate(formData.get("hourlyRate")),
    dailyRateCents: optionalRate(formData.get("dailyRate")),
    phone: parsed.data.phone || null,
    email: parsed.data.email || null,
    notes: parsed.data.notes ?? "",
  };

  if (parsed.data.crewId) {
    const result = await prisma.crew.updateMany({
      where: { id: parsed.data.crewId, organizationId },
      data,
    });
    if (result.count === 0) return { error: "Crew not found" };
    revalidateCrews();
    return { success: `${data.name} saved`, crewId: parsed.data.crewId };
  }

  const crew = await prisma.crew.create({
    data: { organizationId, ...data },
    select: { id: true },
  });
  revalidateCrews();
  return { success: `${data.name} added`, crewId: crew.id };
}

// Retiring a crew rather than deleting it: the hours they logged stay on
// the jobs they worked, which is the whole point of logging them.
export async function setCrewActive(crewId: string, active: boolean): Promise<ActionState> {
  const { organizationId } = await requireSession();
  const result = await prisma.crew.updateMany({ where: { id: crewId, organizationId }, data: { active } });
  if (result.count === 0) return { error: "Crew not found" };
  revalidateCrews();
  return { success: active ? "Back on the list" : "Retired" };
}

// Deleting is refused once they have worked, because it would take the
// cost off a job's budget. Retire them instead.
export async function deleteCrew(crewId: string): Promise<ActionState> {
  const { organizationId } = await requireSession();
  const crew = await prisma.crew.findFirst({
    where: { id: crewId, organizationId },
    select: { id: true, name: true, _count: { select: { timeEntries: true } } },
  });
  if (!crew) return { error: "Crew not found" };
  if (crew._count.timeEntries > 0) {
    return {
      error: `${crew.name} has time logged on ${crew._count.timeEntries} ${
        crew._count.timeEntries === 1 ? "day" : "days"
      } of work. Retire them instead — deleting would take that cost off the jobs.`,
    };
  }
  await prisma.crew.deleteMany({ where: { id: crew.id, organizationId } });
  revalidateCrews();
  return { success: `${crew.name} removed` };
}

/* -------------------------------- Workers -------------------------------- */

const workerSchema = z.object({
  workerId: z.string().trim().optional(),
  crewId: z.string().trim().optional(),
  name: z.string().trim().min(1, "Who is it?").max(80),
  role: z.string().trim().max(80).optional(),
  phone: z.string().trim().max(40).optional(),
  email: z.string().trim().max(160).optional(),
});

export async function saveWorker(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organizationId } = await requireSession();
  const parsed = parseForm(workerSchema, {
    workerId: formData.get("workerId") ?? undefined,
    crewId: formData.get("crewId") ?? undefined,
    name: formData.get("name"),
    role: formData.get("role") ?? undefined,
    phone: formData.get("phone") ?? undefined,
    email: formData.get("email") ?? undefined,
  });
  if (!parsed.ok) return { error: parsed.error };

  const crew = parsed.data.crewId
    ? await prisma.crew.findFirst({ where: { id: parsed.data.crewId, organizationId }, select: { id: true } })
    : null;

  const data = {
    crewId: crew?.id ?? null,
    name: parsed.data.name,
    role: parsed.data.role || null,
    hourlyRateCents: optionalRate(formData.get("hourlyRate")),
    dailyRateCents: optionalRate(formData.get("dailyRate")),
    phone: parsed.data.phone || null,
    email: parsed.data.email || null,
  };

  if (parsed.data.workerId) {
    const result = await prisma.worker.updateMany({
      where: { id: parsed.data.workerId, organizationId },
      data,
    });
    if (result.count === 0) return { error: "Person not found" };
    revalidateCrews();
    return { success: `${data.name} saved` };
  }

  await prisma.worker.create({ data: { organizationId, ...data } });
  revalidateCrews();
  return { success: `${data.name} added` };
}

export async function setWorkerActive(workerId: string, active: boolean): Promise<ActionState> {
  const { organizationId } = await requireSession();
  const result = await prisma.worker.updateMany({ where: { id: workerId, organizationId }, data: { active } });
  if (result.count === 0) return { error: "Person not found" };
  revalidateCrews();
  return { success: active ? "Back on the crew" : "Off the crew" };
}

export async function deleteWorker(workerId: string): Promise<ActionState> {
  const { organizationId } = await requireSession();
  const worker = await prisma.worker.findFirst({
    where: { id: workerId, organizationId },
    select: { id: true, name: true, _count: { select: { timeEntries: true } } },
  });
  if (!worker) return { error: "Person not found" };
  if (worker._count.timeEntries > 0) {
    return {
      error: `${worker.name} has time logged. Take them off the crew instead — the hours they worked stay on the job either way.`,
    };
  }
  await prisma.worker.deleteMany({ where: { id: worker.id, organizationId } });
  revalidateCrews();
  return { success: `${worker.name} removed` };
}

/* ------------------------- Who is on a scope of work ------------------------- */

export async function assignCrewToScope(scopeId: string, crewId: string): Promise<ActionState> {
  const { organizationId } = await requireSession();
  const scope = await prisma.projectScope.findFirst({
    where: { id: scopeId, project: { organizationId } },
    select: { id: true, projectId: true },
  });
  if (!scope) return { error: "Scope not found" };

  // An empty pick means nobody, which also clears any typed name so the
  // field does not show two answers at once.
  if (!crewId) {
    await prisma.projectScope.update({
      where: { id: scope.id },
      data: { crewId: null, crewLabel: null },
    });
  } else {
    const crew = await prisma.crew.findFirst({ where: { id: crewId, organizationId }, select: { id: true } });
    if (!crew) return { error: "Crew not found" };
    await prisma.projectScope.update({
      where: { id: scope.id },
      data: { crewId: crew.id, crewLabel: null },
    });
  }

  revalidatePath(`/dashboard/projects/${scope.projectId}`);
  revalidatePath(`/dashboard/projects/${scope.projectId}/crew`);
  return { success: "Saved" };
}

export async function crewChoices() {
  const { organizationId } = await requireSession();
  return prisma.crew.findMany({
    where: { organizationId, active: true },
    orderBy: [{ kind: "asc" }, { name: "asc" }],
    select: { id: true, name: true, kind: true, serviceTypes: true },
  });
}
