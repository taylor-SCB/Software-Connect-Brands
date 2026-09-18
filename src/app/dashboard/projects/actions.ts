"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { getTimeZone } from "@/lib/organization";
import { parseForm, type ActionState } from "@/lib/forms";
import { PROJECT_STAGES, PROJECT_FILE_CATEGORIES } from "@/lib/constants";
import { zonedNoon } from "@/lib/money";
import { dollarsToCents, formatCents, moneyTooBig, MAX_MONEY_CENTS } from "@/lib/format";
import { refreshTotals, refreshProjectTotals, awardFromContract, DEFAULT_SCOPE_NAME } from "@/lib/projects";
import { openItems } from "@/lib/close-out";
import { ensureServiceType } from "@/lib/service-types";
import { ensureDistributorTypeName } from "@/lib/distributors";
import { advanceDealStage } from "@/lib/deals";
import { computeSchedule, isoToDate, presetRows, todayIso, type SchedulePreset } from "@/lib/payments";
import { contractTotalCents } from "@/lib/contracts";
import { loadMergeContext } from "@/lib/merge-data";
import { renderMergeFields } from "@/lib/merge";
import { publicToken } from "@/lib/tokens";
import { hasFile, readUpload, MAX_DOCUMENT_BYTES } from "@/lib/uploads";
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
      // The note belongs to the closing that wrote it. Closing from the
      // stage dropdown writes no note, so an old one must not be paired
      // with today's date as though somebody had just written it.
      ...(parsed.data.stage === "COMPLETED" ? { closeOutNote: null } : {}),
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
  if (moneyTooBig(input.amountCents)) {
    return { error: `That is more than ${formatCents(MAX_MONEY_CENTS)}. Check the amount.` };
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

/* --------------------------- Ordering materials --------------------------- */

// The suppliers behind the materials on a job, from the distributor on
// each product, with what has not been ordered from them yet.
export async function materialsToOrder(projectId: string) {
  const { organizationId } = await requireSession();
  const project = await prisma.project.findFirst({
    where: { id: projectId, organizationId },
    select: { id: true, dealId: true },
  });
  if (!project) return [];

  // Rows on the customer's own signed paperwork are the work sold; the
  // ones with a product that has a distributor are what has to be bought.
  const lines = await prisma.contractLineItem.findMany({
    where: {
      contract: { organizationId, projectId: project.id, payable: false, status: "SIGNED" },
      quoteLineItem: { product: { distributorId: { not: null } } },
    },
    select: {
      id: true,
      name: true,
      quantity: true,
      unitCostCents: true,
      quoteLineItemId: true,
      quoteLineItem: {
        select: {
          id: true,
          product: {
            select: { id: true, name: true, distributor: { select: { id: true, name: true, companyId: true } } },
          },
        },
      },
    },
  });

  // Which rows are already on a purchase order for this job.
  const ordered = await prisma.contractLineItem.findMany({
    where: { contract: { organizationId, projectId: project.id, payable: true }, quoteLineItemId: { not: null } },
    select: { quoteLineItemId: true },
  });
  const alreadyOrdered = new Set(ordered.map((row) => row.quoteLineItemId));

  const bySupplier = new Map<
    string,
    { distributorId: string; name: string; companyId: string | null; lines: { id: string; name: string; quantity: number; costCents: number }[] }
  >();
  for (const line of lines) {
    const distributor = line.quoteLineItem?.product?.distributor;
    if (!distributor) continue;
    if (alreadyOrdered.has(line.quoteLineItemId)) continue;
    const entry = bySupplier.get(distributor.id) ?? {
      distributorId: distributor.id,
      name: distributor.name,
      companyId: distributor.companyId,
      lines: [],
    };
    entry.lines.push({
      id: line.id,
      name: line.name,
      quantity: line.quantity,
      costCents: Math.round((line.unitCostCents ?? 0) * line.quantity),
    });
    bySupplier.set(distributor.id, entry);
  }
  return Array.from(bySupplier.values());
}

// "Order materials": makes the purchase order to a supplier from the job's
// own rows, at what the products cost, ready to review and send. The
// distributor gets a company record the first time, so what is owed to
// them lands on one place rather than two.
export async function orderFromSupplier(
  projectId: string,
  distributorId: string,
): Promise<ActionState & { contractId?: string }> {
  const { organizationId, userId } = await requireSession();

  const project = await prisma.project.findFirst({
    where: { id: projectId, organizationId },
    select: { id: true, name: true, dealId: true, contactId: true },
  });
  if (!project) return { error: "Project not found" };

  const distributor = await prisma.distributor.findFirst({
    where: { id: distributorId, organizationId },
    select: {
      id: true,
      name: true,
      companyId: true,
      contacts: { orderBy: { createdAt: "asc" }, take: 1, select: { id: true, name: true, email: true, phone: true } },
    },
  });
  if (!distributor) return { error: "Supplier not found" };

  const suppliers = await materialsToOrder(projectId);
  const mine = suppliers.find((entry) => entry.distributorId === distributorId);
  if (!mine || mine.lines.length === 0) {
    return { error: `Nothing left to order from ${distributor.name}.` };
  }

  const template =
    (await prisma.contractTemplate.findFirst({
      where: { organizationId, type: "Purchase Order" },
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
    select: { defaultPaymentTerms: true },
  });
  const owner = await prisma.user.findFirst({ where: { id: userId }, select: { name: true } });

  const lines = await prisma.contractLineItem.findMany({
    where: { id: { in: mine.lines.map((line) => line.id) } },
    select: {
      name: true,
      description: true,
      quantity: true,
      unitCostCents: true,
      unitPriceCents: true,
      tag: true,
      serviceType: true,
      scopeId: true,
      quoteLineItemId: true,
    },
  });

  // Outside the transaction, and before the company is written: a company
  // tagged with a type the pick list doesn't carry renders as an orphan
  // and never appears in a picker that filters on the type.
  const distributorTypeName = await ensureDistributorTypeName(organizationId);

  const contractId = await prisma.$transaction(async (tx) => {
    // The supplier as a company, made once and reused after that.
    let companyId = distributor.companyId;
    if (!companyId) {
      const existing = await tx.company.findFirst({
        where: { organizationId, name: { equals: distributor.name, mode: "insensitive" } },
        select: { id: true },
      });
      companyId =
        existing?.id ??
        (
          await tx.company.create({
            data: {
              organizationId,
              name: distributor.name,
              industries: ["Service Provider"],
              companyTypes: [distributorTypeName],
              status: "CUSTOMER",
            },
            select: { id: true },
          })
        ).id;
      // Distributor.companyId is unique. If another distributor already
      // holds this company — two suppliers whose names differ only by the
      // company being renamed — claiming it here would throw and the
      // purchase order would fail outright. The order is addressed to the
      // right company either way; only the bridge is missing.
      const claimed = await tx.distributor.findUnique({
        where: { companyId },
        select: { id: true },
      });
      if (!claimed) {
        await tx.distributor.update({ where: { id: distributor.id }, data: { companyId } });
      }
    }

    // Someone to address it to. The distributor's own contact if there is
    // one, else a placeholder on their company that can be renamed.
    let contactId: string;
    const rep = distributor.contacts[0];
    const known = rep
      ? await tx.contact.findFirst({
          where: { organizationId, companyId, name: { equals: rep.name, mode: "insensitive" } },
          select: { id: true },
        })
      : await tx.contact.findFirst({ where: { organizationId, companyId }, select: { id: true } });
    if (known) {
      contactId = known.id;
    } else {
      const created = await tx.contact.create({
        data: {
          organizationId,
          companyId,
          name: rep?.name ?? `${distributor.name} orders`,
          email: rep?.email ?? null,
          phone: rep?.phone ?? null,
          status: "CUSTOMER",
        },
        select: { id: true },
      });
      contactId = created.id;
    }

    const numbered = await tx.organization.update({
      where: { id: organizationId },
      data: { nextContractNumber: { increment: 1 } },
      select: { nextContractNumber: true },
    });
    const number = numbered.nextContractNumber - 1;

    const context = await loadMergeContext({
      organizationId,
      contactId,
      companyId,
      dealId: project.dealId,
      quoteId: null,
      projectId: project.id,
      contractNumber: `CON-${number}`,
      paymentTerms: organization.defaultPaymentTerms,
      signerName: owner?.name ?? null,
    });

    // Priced at what the material costs, which is what a purchase order
    // is: the sell price is the customer's business, not the supplier's.
    const lineItems = lines.map((line, position) => ({
      name: line.name,
      description: line.description,
      quantity: line.quantity,
      unitPriceCents: line.unitCostCents ?? 0,
      tag: line.tag,
      serviceType: line.serviceType,
      unitCostCents: line.unitCostCents,
      scopeId: line.scopeId,
      quoteLineItemId: line.quoteLineItemId,
      position,
    }));
    const totalCents = contractTotalCents(lineItems);

    const contract = await tx.contract.create({
      data: {
        organizationId,
        contactId,
        companyId,
        dealId: project.dealId,
        projectId: project.id,
        templateId: template.id,
        number,
        title: `${distributor.name} — ${project.name}`,
        type: template.type,
        payable: true,
        body: renderMergeFields(template.body, context),
        publicToken: publicToken(),
        senderSignerName: owner?.name ?? null,
        paymentTerms: organization.defaultPaymentTerms,
        lineItems: { create: lineItems },
        payments: {
          create: [
            {
              organizationId,
              label: "Due on invoice",
              kind: "BALANCE",
              amountCents: totalCents,
              position: 0,
            },
          ],
        },
      },
      select: { id: true },
    });
    await refreshTotals(tx, organizationId, project.id);
    return contract.id;
  });

  revalidateProject(project.id);
  revalidatePath("/dashboard/contracts");
  revalidatePath("/dashboard/companies");
  return { success: `Purchase order drafted for ${distributor.name}`, contractId };
}

/* ------------------------------ Change orders ------------------------------ */

const changeOrderSchema = z.object({
  projectId: idSchema,
  scopeId: idSchema,
  description: z.string().trim().min(1, "Say what is changing").max(160),
  amount: z.string().trim().min(1, "Enter an amount"),
  signerName: z.string().trim().max(120).optional(),
  signedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date").optional(),
  dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

// More work, or less. A change order is an agreement of its own that
// names the one it changes; signing it moves that scope's awarded amount
// up or down. A credit reads as a credit and lowers what is owed.
export async function createChangeOrder(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { organizationId, userId } = await requireSession();
  const parsed = parseForm(changeOrderSchema, {
    projectId: formData.get("projectId"),
    scopeId: formData.get("scopeId"),
    description: formData.get("description"),
    amount: formData.get("amount"),
    signerName: formData.get("signerName") ?? undefined,
    signedOn: formData.get("signedOn") ?? undefined,
    dueOn: formData.get("dueOn") ?? undefined,
  });
  if (!parsed.ok) return { error: parsed.error };

  const amountCents = dollarsToCents(parsed.data.amount);
  if (amountCents === 0) return { error: "Enter how much more, or how much less with a minus." };
  if (moneyTooBig(amountCents)) {
    return { error: `That is more than ${formatCents(MAX_MONEY_CENTS)}. Check the amount.` };
  }

  const project = await prisma.project.findFirst({
    where: { id: parsed.data.projectId, organizationId },
    select: {
      id: true,
      name: true,
      dealId: true,
      contactId: true,
      companyId: true,
      contracts: {
        where: { payable: false, status: "SIGNED" },
        orderBy: { number: "asc" },
        take: 1,
        select: { id: true, number: true, templateId: true, paymentTerms: true },
      },
    },
  });
  if (!project) return { error: "Project not found" };
  if (!project.contactId) return { error: "This job has no customer on it." };

  const scope = await prisma.projectScope.findFirst({
    where: { id: parsed.data.scopeId, projectId: project.id },
    select: { id: true, name: true },
  });
  if (!scope) return { error: "Scope not found" };

  const template =
    (await prisma.contractTemplate.findFirst({
      where: { organizationId, type: "Change Order" },
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
    select: { defaultPaymentTerms: true },
  });
  const owner = await prisma.user.findFirst({ where: { id: userId }, select: { name: true } });
  const timeZone = await getTimeZone();
  const today = todayIso(timeZone);
  const signedOn = parsed.data.signedOn || today;
  const amends = project.contracts[0] ?? null;
  const credit = amountCents < 0;

  await prisma.$transaction(async (tx) => {
    const numbered = await tx.organization.update({
      where: { id: organizationId },
      data: { nextContractNumber: { increment: 1 } },
      select: { nextContractNumber: true },
    });
    const number = numbered.nextContractNumber - 1;

    const context = await loadMergeContext({
      organizationId,
      contactId: project.contactId!,
      companyId: project.companyId,
      dealId: project.dealId,
      quoteId: null,
      projectId: project.id,
      contractNumber: `CON-${number}`,
      paymentTerms: amends?.paymentTerms ?? organization.defaultPaymentTerms,
      signerName: owner?.name ?? null,
    });

    const contract = await tx.contract.create({
      data: {
        organizationId,
        contactId: project.contactId!,
        companyId: project.companyId,
        dealId: project.dealId,
        projectId: project.id,
        amendsContractId: amends?.id ?? null,
        templateId: template.id,
        number,
        title: parsed.data.description,
        type: template.type,
        payable: false,
        body: renderMergeFields(template.body, context),
        // Recorded as agreed: a change order is usually a conversation on
        // site, so it is signed the same way "Mark signed" records one.
        status: "SIGNED",
        signedAt: zonedNoon(signedOn, timeZone),
        signerName: parsed.data.signerName || null,
        signedOffline: true,
        signedNote: `Change order on ${project.name}`,
        publicToken: publicToken(),
        senderSignerName: owner?.name ?? null,
        paymentTerms: amends?.paymentTerms ?? organization.defaultPaymentTerms,
        lineItems: {
          create: [
            {
              name: parsed.data.description,
              description: credit ? `Credit on ${scope.name}` : `Added to ${scope.name}`,
              quantity: 1,
              unitPriceCents: amountCents,
              tag: "PROJECT_SERVICES",
              scopeId: scope.id,
              position: 0,
            },
          ],
        },
        payments: {
          create: [
            {
              organizationId,
              // A credit is not something to chase, so it says so.
              label: credit ? "Credit" : parsed.data.description.slice(0, 120),
              kind: "BALANCE",
              amountCents,
              dueOn: credit ? null : isoToDate(parsed.data.dueOn || signedOn),
              // Nothing to collect on a credit, so it is settled already.
              paidAt: credit ? new Date() : null,
              position: 0,
            },
          ],
        },
      },
      select: { id: true },
    });
    return contract.id;
  });

  // The rows are in place, so the award history and the bars follow.
  const latest = await prisma.contract.findFirst({
    where: { organizationId, projectId: project.id, type: template.type },
    orderBy: { number: "desc" },
    select: { id: true },
  });
  if (latest) await awardFromContract(organizationId, latest.id);

  revalidateProject(project.id);
  revalidatePath("/dashboard/contracts");
  revalidatePath("/dashboard/companies");
  revalidatePath("/dashboard/contacts");
  return {
    success: credit
      ? `Credit of ${formatCents(-amountCents)} recorded on ${scope.name}`
      : `${formatCents(amountCents)} added to ${scope.name}`,
  };
}

/* ------------------------------ Files on a job ------------------------------ */

export async function uploadProjectFile(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organizationId } = await requireSession();
  const file = formData.get("file");
  if (!hasFile(file)) return { error: "Choose a file to upload" };
  if (file.size > MAX_DOCUMENT_BYTES) {
    return { error: "That file is over 4 MB. Export a smaller version and try again." };
  }

  const parsed = parseForm(
    z.object({
      projectId: idSchema,
      name: z.string().trim().min(1).max(160),
      category: z.enum(PROJECT_FILE_CATEGORIES).optional(),
    }),
    {
      projectId: formData.get("projectId"),
      name: formData.get("name") || file.name.replace(/\.[^.]+$/, ""),
      category: formData.get("category") ?? undefined,
    },
  );
  if (!parsed.ok) return { error: parsed.error };

  const project = await prisma.project.findFirst({
    where: { id: parsed.data.projectId, organizationId },
    select: { id: true },
  });
  if (!project) return { error: "Project not found" };

  await prisma.upload.create({
    data: {
      organizationId,
      projectId: project.id,
      kind: "PROJECT_FILE",
      category: parsed.data.category ?? "Other",
      name: parsed.data.name,
      ...(await readUpload(file)),
    },
  });
  revalidatePath(`/dashboard/projects/${project.id}/files`);
  return { success: `${parsed.data.name} uploaded` };
}

export async function deleteProjectFile(formData: FormData) {
  const { organizationId } = await requireSession();
  const id = idSchema.safeParse(formData.get("uploadId"));
  if (!id.success) return;

  const upload = await prisma.upload.findFirst({
    where: { id: id.data, organizationId, kind: "PROJECT_FILE" },
    select: { projectId: true },
  });
  if (!upload) return;

  await prisma.upload.deleteMany({ where: { id: id.data, organizationId, kind: "PROJECT_FILE" } });
  if (upload.projectId) revalidatePath(`/dashboard/projects/${upload.projectId}/files`);
}

/* ------------------------------- Close out ------------------------------- */

// One press marks the job done. The list of loose ends is beside the
// button, not in the way of it: a contractor closing a job with $500
// still owed knows something the app does not.
export async function closeOutProject(
  projectId: string,
  note: string,
): Promise<ActionState & { openCount?: number }> {
  const { organizationId } = await requireSession();
  const id = idSchema.safeParse(projectId);
  if (!id.success) return { error: "Missing project reference" };

  const project = await prisma.project.findFirst({
    where: { id: id.data, organizationId },
    select: { id: true, name: true, stage: true },
  });
  if (!project) return { error: "Project not found" };
  if (project.stage === "COMPLETED") return { error: `${project.name} is already closed out.` };

  const open = await openItems(organizationId, project.id);

  await prisma.project.updateMany({
    where: { id: project.id, organizationId },
    data: {
      stage: "COMPLETED",
      closedAt: new Date(),
      closeOutNote: note.trim().slice(0, 1000) || null,
    },
  });

  revalidateProject(project.id);
  revalidatePath("/dashboard/projects/properties");
  return {
    success:
      open.length > 0
        ? `${project.name} closed out with ${open.length} ${
            open.length === 1 ? "loose end" : "loose ends"
          } still open.`
        : `${project.name} closed out.`,
    openCount: open.length,
  };
}

// Reopening a closed job. Back to Active, because a job being worked on
// again is active by definition, and the closing note is kept as history.
export async function reopenProject(projectId: string): Promise<ActionState> {
  const { organizationId } = await requireSession();
  const id = idSchema.safeParse(projectId);
  if (!id.success) return { error: "Missing project reference" };

  const result = await prisma.project.updateMany({
    where: { id: id.data, organizationId, stage: "COMPLETED" },
    data: { stage: "ACTIVE", closedAt: null },
  });
  if (result.count === 0) return { error: "That job is not closed out." };
  revalidateProject(id.data);
  return { success: "Reopened" };
}

/* --------------------------- Notes on a job --------------------------- */

// A note about the job rather than about a person: "owner wants the north
// side done first". Kept on the job so it outlives whoever said it.
export async function addProjectNote(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organizationId, userId } = await requireSession();
  const parsed = parseForm(
    z.object({
      projectId: idSchema,
      body: z.string().trim().min(1, "Write the note first").max(4000),
    }),
    { projectId: formData.get("projectId"), body: formData.get("body") },
  );
  if (!parsed.ok) return { error: parsed.error };

  const project = await prisma.project.findFirst({
    where: { id: parsed.data.projectId, organizationId },
    select: { id: true },
  });
  if (!project) return { error: "Project not found" };

  await prisma.note.create({
    data: { organizationId, projectId: project.id, authorId: userId, body: parsed.data.body },
  });
  revalidateProject(project.id);
  return { success: "Note added" };
}

export async function deleteProjectNote(noteId: string): Promise<ActionState> {
  const { organizationId } = await requireSession();
  const note = await prisma.note.findFirst({
    where: { id: noteId, organizationId, projectId: { not: null } },
    select: { id: true, projectId: true },
  });
  if (!note) return { error: "That note is gone" };

  await prisma.note.deleteMany({ where: { id: note.id, organizationId } });
  if (note.projectId) revalidateProject(note.projectId);
  return { success: "Note removed" };
}
