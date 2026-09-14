"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { getTimeZone } from "@/lib/organization";
import { parseForm, type ActionState } from "@/lib/forms";
import { PROJECT_STAGES } from "@/lib/constants";
import { zonedNoon } from "@/lib/money";
import { refreshTotals, refreshProjectTotals, awardFromContract, DEFAULT_SCOPE_NAME } from "@/lib/projects";
import { ensureServiceType } from "@/lib/service-types";
import { advanceDealStage } from "@/lib/deals";
import { computeSchedule, isoToDate, presetRows, todayIso, type SchedulePreset } from "@/lib/payments";
import { contractTotalCents } from "@/lib/contracts";
import { loadMergeContext } from "@/lib/merge-data";
import { renderMergeFields } from "@/lib/merge";
import { publicToken } from "@/lib/tokens";
import { pickPrimaryQuote } from "@/lib/deals";

const idSchema = z.string().trim().min(1, "Missing record reference");

function revalidateProject(projectId: string) {
  revalidatePath("/dashboard/projects");
  revalidatePath("/dashboard/projects/budgets");
  revalidatePath(`/dashboard/projects/${projectId}`);
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/deals");
  revalidatePath("/dashboard/deals/tracker");
  revalidatePath("/dashboard/contracts/tracker");
}

/* ------------------------------ The project ------------------------------ */

export async function setProjectStage(projectId: string, stage: string): Promise<ActionState> {
  const { organizationId } = await requireSession();
  const parsed = z
    .object({ projectId: idSchema, stage: z.enum(PROJECT_STAGES) })
    .safeParse({ projectId, stage });
  if (!parsed.success) return { error: "That isn't a stage" };

  const result = await prisma.project.updateMany({
    where: { id: parsed.data.projectId, organizationId },
    data: {
      stage: parsed.data.stage,
      // Closing a job stamps when; reopening one clears it.
      closedAt: parsed.data.stage === "COMPLETED" ? new Date() : null,
    },
  });
  if (result.count === 0) return { error: "Project not found" };
  revalidateProject(parsed.data.projectId);
  return { success: "Stage saved" };
}

export async function updateProject(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organizationId } = await requireSession();
  const parsed = parseForm(
    z.object({
      projectId: idSchema,
      name: z.string().trim().min(1, "The job needs a name").max(160),
      siteAddress: z.string().trim().max(200).optional(),
    }),
    {
      projectId: formData.get("projectId"),
      name: formData.get("name"),
      siteAddress: formData.get("siteAddress") ?? undefined,
    },
  );
  if (!parsed.ok) return { error: parsed.error };

  const result = await prisma.project.updateMany({
    where: { id: parsed.data.projectId, organizationId },
    data: { name: parsed.data.name, siteAddress: parsed.data.siteAddress || null },
  });
  if (result.count === 0) return { error: "Project not found" };
  revalidateProject(parsed.data.projectId);
  return { success: "Saved" };
}

/* -------------------------------- Scopes -------------------------------- */

export async function addScope(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organizationId } = await requireSession();
  const parsed = parseForm(
    z.object({
      projectId: idSchema,
      name: z.string().trim().max(80).optional(),
      serviceType: z.string().trim().max(60).optional(),
    }),
    {
      projectId: formData.get("projectId"),
      name: formData.get("name") ?? undefined,
      serviceType: formData.get("serviceType") ?? undefined,
    },
  );
  if (!parsed.ok) return { error: parsed.error };

  const project = await prisma.project.findFirst({
    where: { id: parsed.data.projectId, organizationId },
    select: { id: true, _count: { select: { scopes: true } } },
  });
  if (!project) return { error: "Project not found" };

  const serviceType = parsed.data.serviceType
    ? await ensureServiceType(organizationId, parsed.data.serviceType)
    : null;
  const name = parsed.data.name || serviceType;
  if (!name) return { error: "Give the scope a name or pick a service type" };

  await prisma.projectScope.create({
    data: {
      projectId: project.id,
      name,
      serviceType,
      position: project._count.scopes,
    },
  });
  revalidateProject(project.id);
  return { success: "Scope added" };
}

export async function updateScope(
  scopeId: string,
  input: { name?: string; description?: string; crewLabel?: string },
): Promise<ActionState> {
  const { organizationId } = await requireSession();
  const scope = await prisma.projectScope.findFirst({
    where: { id: scopeId, project: { organizationId } },
    select: { id: true, projectId: true },
  });
  if (!scope) return { error: "Scope not found" };

  await prisma.projectScope.update({
    where: { id: scope.id },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim().slice(0, 80) || "Scope" } : {}),
      ...(input.description !== undefined ? { description: input.description.trim().slice(0, 2000) } : {}),
      ...(input.crewLabel !== undefined ? { crewLabel: input.crewLabel.trim().slice(0, 80) || null } : {}),
    },
  });
  revalidateProject(scope.projectId);
  return { success: "Saved" };
}

// Deleting a scope moves its rows and its award history to the default
// scope rather than losing them, so the project's total never changes.
export async function deleteScope(scopeId: string): Promise<ActionState> {
  const { organizationId } = await requireSession();
  const scope = await prisma.projectScope.findFirst({
    where: { id: scopeId, project: { organizationId } },
    select: { id: true, projectId: true, isDefault: true },
  });
  if (!scope) return { error: "Scope not found" };
  if (scope.isDefault) return { error: "The whole-job scope stays — it holds anything untagged." };

  await prisma.$transaction(async (tx) => {
    const fallback = await tx.projectScope.findFirst({
      where: { projectId: scope.projectId, isDefault: true },
      select: { id: true },
    });
    const defaultScopeId =
      fallback?.id ??
      (
        await tx.projectScope.create({
          data: { projectId: scope.projectId, name: DEFAULT_SCOPE_NAME, isDefault: true, position: 0 },
          select: { id: true },
        })
      ).id;

    await tx.contractLineItem.updateMany({ where: { scopeId: scope.id }, data: { scopeId: defaultScopeId } });
    await tx.scopeAward.updateMany({ where: { scopeId: scope.id }, data: { scopeId: defaultScopeId } });
    await tx.projectScope.delete({ where: { id: scope.id } });
    await refreshTotals(tx, organizationId, scope.projectId);
  });
  revalidateProject(scope.projectId);
  return { success: "Scope removed" };
}

// Moving one contract row between scopes: both bars change, the
// project's does not.
export async function moveLineToScope(lineId: string, scopeId: string): Promise<ActionState> {
  const { organizationId } = await requireSession();
  const line = await prisma.contractLineItem.findFirst({
    where: { id: lineId, contract: { organizationId } },
    select: { id: true, contract: { select: { id: true, projectId: true } } },
  });
  if (!line?.contract.projectId) return { error: "That row isn't on a job" };

  const scope = await prisma.projectScope.findFirst({
    where: { id: scopeId, projectId: line.contract.projectId },
    select: { id: true },
  });
  if (!scope) return { error: "Scope not found" };

  await prisma.$transaction(async (tx) => {
    await tx.contractLineItem.update({ where: { id: line.id }, data: { scopeId: scope.id } });
    // The award rows follow the money, so re-award from every signed
    // agreement on the job.
    const contracts = await tx.contract.findMany({
      where: { organizationId, projectId: line.contract.projectId, payable: false, status: "SIGNED" },
      select: { id: true },
    });
    for (const contract of contracts) {
      await tx.scopeAward.deleteMany({ where: { contractId: contract.id } });
    }
  });
  for (const contract of await prisma.contract.findMany({
    where: { organizationId, projectId: line.contract.projectId, payable: false, status: "SIGNED" },
    select: { id: true },
  })) {
    await awardFromContract(organizationId, contract.id);
  }
  await refreshProjectTotals(organizationId, line.contract.projectId);
  revalidateProject(line.contract.projectId);
  return { success: "Moved" };
}

// A typed adjustment, with a reason, for the times the paperwork does not
// tell the whole story.
export async function adjustAward(
  scopeId: string,
  input: { amountCents: number; note: string },
): Promise<ActionState> {
  const { organizationId } = await requireSession();
  const scope = await prisma.projectScope.findFirst({
    where: { id: scopeId, project: { organizationId } },
    select: { id: true, projectId: true },
  });
  if (!scope) return { error: "Scope not found" };
  const note = input.note.trim();
  if (!note) return { error: "Say why the awarded amount is changing" };
  if (!Number.isInteger(input.amountCents) || input.amountCents === 0) {
    return { error: "Enter an amount to add or take off" };
  }

  await prisma.$transaction(async (tx) => {
    await tx.scopeAward.create({
      data: { scopeId: scope.id, kind: "MANUAL", deltaCents: input.amountCents, note: note.slice(0, 300) },
    });
    await refreshTotals(tx, organizationId, scope.projectId);
  });
  revalidateProject(scope.projectId);
  return { success: "Awarded amount changed" };
}

/* ------------------------- Awarding without paperwork ------------------------- */

// For a job won on a handshake: writes the Sales Order the quote implies,
// marks it signed on paper, and awards it. Keeps every project backed by
// a signed agreement, so the budget always has one source.
export async function awardWithoutPaperwork(
  dealId: string,
  input: { signerName: string; signedOn: string; note?: string; preset?: SchedulePreset },
): Promise<ActionState & { projectId?: string }> {
  const { organizationId, userId } = await requireSession();
  const parsed = z
    .object({
      dealId: idSchema,
      signerName: z.string().trim().min(2, "Who agreed to it?").max(120),
      signedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the date it was agreed"),
      note: z.string().trim().max(500).optional(),
      preset: z.enum(["FULL", "DEPOSIT_BALANCE", "INSTALLMENTS"]).optional(),
    })
    .safeParse({ dealId, ...input });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form" };

  const deal = await prisma.deal.findFirst({
    where: { id: parsed.data.dealId, organizationId },
    select: {
      id: true,
      title: true,
      contactId: true,
      contact: { select: { id: true, name: true, companyId: true } },
      project: { select: { id: true } },
      quotes: {
        select: {
          id: true,
          status: true,
          updatedAt: true,
          lineItems: {
            orderBy: { position: "asc" },
            select: {
              id: true,
              name: true,
              description: true,
              quantity: true,
              unitPriceCents: true,
              tag: true,
              serviceType: true,
              cancelledAt: true,
              product: { select: { costCents: true } },
            },
          },
        },
      },
      contracts: { select: { id: true, number: true, status: true, payable: true } },
    },
  });
  if (!deal) return { error: "Deal not found" };
  if (deal.project) return { error: "This deal is already an awarded job." };

  const standing = deal.contracts.find(
    (contract) => !contract.payable && (contract.status === "SENT" || contract.status === "SIGNED"),
  );
  if (standing) {
    return { error: `CON-${standing.number} is already out — use Mark signed on it instead.` };
  }

  const quote = pickPrimaryQuote(deal.quotes);
  const rows = (quote?.lineItems ?? []).filter((line) => !line.cancelledAt);
  if (rows.length === 0) return { error: "Write the quote first — there is nothing priced to award." };

  const template =
    (await prisma.contractTemplate.findFirst({
      where: { organizationId, type: "Sales Order" },
      select: { id: true, name: true, type: true, body: true },
    })) ??
    (await prisma.contractTemplate.findFirst({
      where: { organizationId },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, type: true, body: true },
    }));
  if (!template) return { error: "Add a contract template first." };

  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: {
      defaultPaymentTerms: true,
      defaultPaymentPreset: true,
      defaultDepositPercent: true,
      defaultInstallmentCount: true,
    },
  });
  const owner = await prisma.user.findFirst({ where: { id: userId }, select: { name: true } });
  const timeZone = await getTimeZone();
  const signedAt = zonedNoon(parsed.data.signedOn, timeZone);

  const lineItems = rows.map((line, position) => ({
    quoteLineItemId: line.id,
    name: line.name,
    description: line.description,
    quantity: line.quantity,
    unitPriceCents: line.unitPriceCents,
    tag: line.tag,
    serviceType: line.serviceType,
    unitCostCents: line.product ? line.product.costCents : null,
    position,
  }));
  const totalCents = contractTotalCents(lineItems);

  const preset = (parsed.data.preset ?? organization.defaultPaymentPreset) as SchedulePreset;
  const schedule = computeSchedule(
    presetRows({
      preset,
      start: parsed.data.signedOn,
      depositPercent: organization.defaultDepositPercent,
      count: organization.defaultInstallmentCount,
      unit: "MONTH",
    }),
    totalCents,
  );

  const contractId = await prisma.$transaction(async (tx) => {
    const numbered = await tx.organization.update({
      where: { id: organizationId },
      data: { nextContractNumber: { increment: 1 } },
      select: { nextContractNumber: true },
    });
    const number = numbered.nextContractNumber - 1;

    const context = await loadMergeContext({
      organizationId,
      contactId: deal.contactId,
      companyId: deal.contact.companyId,
      dealId: deal.id,
      quoteId: quote?.id ?? null,
      contractNumber: `CON-${number}`,
      paymentTerms: organization.defaultPaymentTerms,
      signerName: owner?.name ?? null,
    });

    const contract = await tx.contract.create({
      data: {
        organizationId,
        contactId: deal.contactId,
        companyId: deal.contact.companyId,
        dealId: deal.id,
        quoteId: quote?.id ?? null,
        templateId: template.id,
        number,
        title: deal.title,
        type: template.type,
        payable: false,
        body: renderMergeFields(template.body, context),
        // Signed on paper, recorded here.
        status: "SIGNED",
        signedAt,
        signerName: parsed.data.signerName,
        signedOffline: true,
        signedNote: parsed.data.note || "Awarded without paperwork",
        publicToken: publicToken(),
        senderSignerName: owner?.name ?? null,
        paymentTerms: organization.defaultPaymentTerms,
        lineItems: { create: lineItems },
        payments: {
          create: schedule.rows.map((row, position) => ({
            organizationId,
            label: row.label,
            kind: row.kind,
            percent: row.kind === "PERCENT" ? row.percent : null,
            amountCents: row.amountCents,
            dueOn: row.dueOn ? isoToDate(row.dueOn) : null,
            position,
          })),
        },
      },
      select: { id: true },
    });
    return contract.id;
  });

  await advanceDealStage(deal.id, organizationId, "WON");
  const projectId = await awardFromContract(organizationId, contractId);
  if (projectId) revalidateProject(projectId);
  revalidatePath("/dashboard/contracts");
  return { success: "Awarded", projectId: projectId ?? undefined };
}

// For an agreement that was already signed before projects existed, or
// one signed with no deal behind it.
export async function createProjectFromContract(contractId: string): Promise<ActionState & { projectId?: string }> {
  const { organizationId } = await requireSession();
  const id = idSchema.safeParse(contractId);
  if (!id.success) return { error: "Missing contract reference" };

  const projectId = await awardFromContract(organizationId, id.data);
  if (!projectId) return { error: "Only a signed agreement for a customer can start a job." };
  revalidateProject(projectId);
  revalidatePath(`/dashboard/contracts/${id.data}`);
  return { success: "Job created", projectId };
}

export async function todayInZone() {
  return todayIso(await getTimeZone());
}
