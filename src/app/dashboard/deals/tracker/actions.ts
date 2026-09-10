"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { type ActionState } from "@/lib/forms";
import { publicToken } from "@/lib/tokens";
import { renderMergeFields } from "@/lib/merge";
import { loadMergeContext } from "@/lib/merge-data";
import { canUserSend, contractTotalCents, MAX_TRACKER_COLUMNS } from "@/lib/contracts";
import {
  computeSchedule,
  isoToDate,
  presetRows,
  type ScheduleRowInput,
} from "@/lib/payments";

const idSchema = z.string().trim().min(1, "Missing record reference");

// Every screen that shows a deal's paperwork.
function revalidateDeal(dealId: string, contractIds: string[] = []) {
  revalidatePath("/dashboard/deals/tracker");
  revalidatePath("/dashboard/contracts/tracker");
  revalidatePath("/dashboard/contracts");
  revalidatePath("/dashboard/deals");
  revalidatePath("/dashboard");
  for (const id of contractIds) revalidatePath(`/dashboard/contracts/${id}`);
  if (dealId) revalidatePath(`/dashboard/deals/${dealId}`);
}

/* ------------------------- Split a deal into contracts ------------------------- */

const columnSchema = z.object({
  companyId: z.string().trim().optional(),
  newCompanyName: z.string().trim().max(120).optional(),
  contactId: z.string().trim().optional(),
  newContactName: z.string().trim().max(120).optional(),
  templateId: z.string().trim().optional(),
  title: z.string().trim().max(160).optional(),
  paymentTerms: z.string().trim().max(120).optional(),
  schedule: z
    .object({
      preset: z.enum(["FULL", "DEPOSIT_BALANCE", "INSTALLMENTS"]),
      start: z.string().trim().optional(),
      depositPercent: z.number().min(1).max(99).optional(),
      count: z.number().int().min(2).max(60).optional(),
      unit: z.enum(["MONTH", "YEAR"]).optional(),
    })
    .optional(),
  lineItemIds: z.array(z.string().trim().min(1)).max(200),
});

const splitSchema = z.object({
  dealId: idSchema,
  quoteId: idSchema,
  signerName: z.string().trim().max(120).optional(),
  columns: z.array(columnSchema).min(1).max(MAX_TRACKER_COLUMNS),
  // Where to land afterwards: the tracker under Pipeline or under Contracts.
  returnTo: z.enum(["/dashboard/deals/tracker", "/dashboard/contracts/tracker"]),
});

export type SplitInput = z.infer<typeof splitSchema>;

// Turns the grid into contracts: one per column that has at least one
// row ticked. Companies and contacts typed as new are created on the
// way. All of it happens in one transaction so a bad column can't leave
// half the paperwork behind.
export async function createSplitContracts(raw: SplitInput): Promise<ActionState> {
  const { organizationId, userId } = await requireSession();

  const parsed = splitSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the grid and try again" };
  }
  const input = parsed.data;

  const quote = await prisma.quote.findFirst({
    where: { id: input.quoteId, organizationId, dealId: input.dealId },
    include: {
      deal: { select: { id: true, contactId: true } },
      lineItems: { orderBy: { position: "asc" } },
    },
  });
  if (!quote) return { error: "That quote isn't on this deal" };

  const lineById = new Map(quote.lineItems.map((item) => [item.id, item]));
  const active = input.columns.filter((column) => column.lineItemIds.length > 0);
  if (active.length === 0) return { error: "Tick at least one row in a contract column" };

  // Validate every column before writing anything.
  const templates = await prisma.contractTemplate.findMany({
    where: { organizationId },
    select: { id: true, name: true, type: true, body: true, allUsersCanSend: true, senderUserIds: true },
  });
  const templateById = new Map(templates.map((template) => [template.id, template]));

  type Plan = {
    label: string;
    column: (typeof active)[number];
    template: (typeof templates)[number];
    lines: typeof quote.lineItems;
  };
  const plans: Plan[] = [];
  for (const column of active) {
    const label = `Contract ${String.fromCharCode(65 + input.columns.indexOf(column))}`;
    const template = column.templateId ? templateById.get(column.templateId) : undefined;
    if (!template) return { error: `${label}: pick a template` };
    if (!canUserSend(template, userId)) {
      return { error: `${label}: you aren't on the "Who can send?" list for ${template.name}` };
    }
    if (!column.companyId && !column.newCompanyName) {
      return { error: `${label}: pick the company it goes to, or type a new one` };
    }
    if (!column.contactId && !column.newContactName) {
      return { error: `${label}: pick the person it goes to, or type a new one` };
    }
    const lines = column.lineItemIds.map((id) => lineById.get(id)).filter((line) => line !== undefined);
    if (lines.length !== column.lineItemIds.length) {
      return { error: `${label}: a ticked row is no longer on the quote. Reload and try again.` };
    }
    if (lines.some((line) => line.cancelledAt)) {
      return { error: `${label}: a ticked row has been cancelled. Restore it first.` };
    }
    plans.push({ label, column, template, lines });
  }

  const created: string[] = [];

  await prisma.$transaction(async (tx) => {
    for (const plan of plans) {
      const { column, template, lines } = plan;

      // Company: existing, or matched/created by name (same name, any
      // case, is the same company — the picker can't tell two apart).
      let companyId: string | null = null;
      if (column.companyId) {
        const company = await tx.company.findFirst({
          where: { id: column.companyId, organizationId },
          select: { id: true },
        });
        if (!company) throw new Error(`${plan.label}: that company doesn't exist`);
        companyId = company.id;
      } else if (column.newCompanyName) {
        const name = column.newCompanyName.replace(/\s+/g, " ");
        const existing = await tx.company.findFirst({
          where: { organizationId, name: { equals: name, mode: "insensitive" } },
          select: { id: true },
        });
        companyId = existing
          ? existing.id
          : (await tx.company.create({ data: { organizationId, name }, select: { id: true } })).id;
      }

      // Contact: existing (must be in this workspace), or created under
      // the chosen company.
      let contactId: string;
      if (column.contactId) {
        const contact = await tx.contact.findFirst({
          where: { id: column.contactId, organizationId },
          select: { id: true },
        });
        if (!contact) throw new Error(`${plan.label}: that contact doesn't exist`);
        contactId = contact.id;
      } else {
        const name = (column.newContactName ?? "").replace(/\s+/g, " ");
        const existing = await tx.contact.findFirst({
          where: { organizationId, companyId, name: { equals: name, mode: "insensitive" } },
          select: { id: true },
        });
        contactId = existing
          ? existing.id
          : (
              await tx.contact.create({
                data: { organizationId, companyId, name, status: "LEAD" },
                select: { id: true },
              })
            ).id;
      }

      const numbered = await tx.organization.update({
        where: { id: organizationId },
        data: { nextContractNumber: { increment: 1 } },
        select: { nextContractNumber: true },
      });
      const number = numbered.nextContractNumber - 1;

      const lineItems = lines.map((line, position) => ({
        quoteLineItemId: line.id,
        name: line.name,
        description: line.description,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
        tag: line.tag,
        position,
      }));
      const totalCents = contractTotalCents(lineItems);

      // Payment schedule from the preset, priced against this contract's
      // own total.
      const scheduleInput: ScheduleRowInput[] = column.schedule
        ? presetRows({
            preset: column.schedule.preset,
            start: column.schedule.start ?? "",
            depositPercent: column.schedule.depositPercent,
            count: column.schedule.count,
            unit: column.schedule.unit,
          })
        : [];
      const schedule = computeSchedule(scheduleInput, totalCents);
      const payments = schedule.rows.map((row, position) => ({
        label: row.label,
        kind: row.kind,
        percent: row.kind === "PERCENT" ? row.percent : null,
        amountCents: row.amountCents,
        dueOn: row.dueOn ? isoToDate(row.dueOn) : null,
        position,
      }));

      const signerName = input.signerName || null;
      const paymentTerms = column.paymentTerms || null;

      const context = await loadMergeContext({
        organizationId,
        contactId,
        companyId,
        dealId: quote.deal.id,
        quoteId: quote.id,
        contractNumber: `CON-${number}`,
        lineItems,
        payments: payments.map((payment) => ({
          label: payment.label,
          amountCents: payment.amountCents,
          dueOn: payment.dueOn,
        })),
        paymentTerms,
        signerName,
      });

      const contract = await tx.contract.create({
        data: {
          organizationId,
          contactId,
          companyId,
          dealId: quote.deal.id,
          quoteId: quote.id,
          templateId: template.id,
          number,
          title: column.title || template.name,
          type: template.type,
          body: renderMergeFields(template.body, context),
          publicToken: publicToken(),
          senderSignerName: signerName,
          paymentTerms,
          lineItems: { create: lineItems },
          payments: { create: payments },
        },
        select: { id: true },
      });
      created.push(contract.id);
    }
  });

  revalidateDeal(input.dealId, created);
  revalidatePath("/dashboard/contacts");
  revalidatePath("/dashboard/companies");
  redirect(`${input.returnTo}?dealId=${input.dealId}&quoteId=${input.quoteId}&created=${created.length}`);
}

/* ------------------------------- Row state ------------------------------- */

// Cancel takes a row off the table without deleting it from the quote:
// it stays priced on the quote the customer saw, but can't go on a
// contract. Restore reverses it.
export async function setQuoteLineCancelled(formData: FormData) {
  const { organizationId } = await requireSession();
  const parsed = z
    .object({
      lineItemId: idSchema,
      dealId: idSchema,
      cancelled: z.enum(["true", "false"]),
    })
    .safeParse({
      lineItemId: formData.get("lineItemId"),
      dealId: formData.get("dealId"),
      cancelled: formData.get("cancelled"),
    });
  if (!parsed.success) return;

  await prisma.quoteLineItem.updateMany({
    where: { id: parsed.data.lineItemId, quote: { organizationId } },
    data: { cancelledAt: parsed.data.cancelled === "true" ? new Date() : null },
  });
  revalidateDeal(parsed.data.dealId);
}

/* ------------------------------ Contract state ------------------------------ */

// Withdraws a contract. Its rows go back to open on the tracker. A signed
// contract can't be cancelled from here — that is a conversation with the
// customer, not a button.
export async function cancelContract(formData: FormData) {
  const { organizationId } = await requireSession();
  const id = idSchema.safeParse(formData.get("contractId"));
  if (!id.success) return;

  const contract = await prisma.contract.findFirst({
    where: { id: id.data, organizationId },
    select: { status: true, dealId: true },
  });
  if (!contract || contract.status === "SIGNED") return;

  await prisma.contract.updateMany({
    where: { id: id.data, organizationId },
    data: { status: "CANCELLED", cancelledAt: new Date() },
  });
  revalidateDeal(contract.dealId ?? "", [id.data]);
}

// Puts a cancelled contract back to draft, so it can be sent again.
export async function reopenContract(formData: FormData) {
  const { organizationId } = await requireSession();
  const id = idSchema.safeParse(formData.get("contractId"));
  if (!id.success) return;

  const contract = await prisma.contract.findFirst({
    where: { id: id.data, organizationId },
    select: { status: true, dealId: true },
  });
  if (!contract || contract.status !== "CANCELLED") return;

  await prisma.contract.updateMany({
    where: { id: id.data, organizationId },
    data: { status: "DRAFT", cancelledAt: null, sentAt: null },
  });
  revalidateDeal(contract.dealId ?? "", [id.data]);
}

// Records that a reminder went out (copied and sent by hand — no email is
// sent from the app yet). The count and date show on the tracker.
export async function logReminder(contractId: string): Promise<ActionState> {
  const { organizationId } = await requireSession();
  const id = idSchema.safeParse(contractId);
  if (!id.success) return { error: "Missing contract reference" };

  const contract = await prisma.contract.findFirst({
    where: { id: id.data, organizationId },
    select: { status: true, dealId: true },
  });
  if (!contract) return { error: "Contract not found" };
  if (contract.status !== "SENT") return { error: "Only a sent contract can be chased" };

  await prisma.contract.updateMany({
    where: { id: id.data, organizationId },
    data: { reminderCount: { increment: 1 }, lastReminderAt: new Date() },
  });
  revalidateDeal(contract.dealId ?? "", [id.data]);
  return { success: "Reminder copied and logged" };
}

/* ----------------------------- Payment schedule ----------------------------- */

const scheduleRowSchema = z.object({
  label: z.string().trim().min(1, "Every payment needs a label").max(120),
  kind: z.enum(["PERCENT", "FIXED", "BALANCE"]),
  percent: z.number().min(0).max(100).nullable(),
  fixedCents: z.number().int().min(0).max(1_000_000_000).nullable(),
  dueOn: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A due date isn't valid")]),
  paid: z.boolean().optional(),
});

export async function savePaymentSchedule(input: {
  contractId: string;
  paymentTerms: string;
  rows: z.infer<typeof scheduleRowSchema>[];
}): Promise<ActionState> {
  const { organizationId } = await requireSession();

  const parsed = z
    .object({
      contractId: idSchema,
      paymentTerms: z.string().trim().max(120),
      rows: z.array(scheduleRowSchema).max(60),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the payment schedule" };
  }

  const contract = await prisma.contract.findFirst({
    where: { id: parsed.data.contractId, organizationId },
    select: {
      status: true,
      dealId: true,
      lineItems: { select: { quantity: true, unitPriceCents: true } },
      payments: { select: { id: true, position: true, paidAt: true }, orderBy: { position: "asc" } },
    },
  });
  if (!contract) return { error: "Contract not found" };

  const totalCents = contractTotalCents(contract.lineItems);
  const schedule = computeSchedule(parsed.data.rows, totalCents);
  if (schedule.rows.some((row) => row.amountCents < 0)) {
    return { error: "The fixed amounts add up to more than the contract total" };
  }

  // Paid marks survive a re-save by position; a row that moved keeps
  // whatever the editor sent for it.
  await prisma.$transaction([
    prisma.contract.update({
      where: { id: parsed.data.contractId },
      data: { paymentTerms: parsed.data.paymentTerms || null },
    }),
    prisma.contractPayment.deleteMany({ where: { contractId: parsed.data.contractId } }),
    prisma.contractPayment.createMany({
      data: schedule.rows.map((row, position) => ({
        contractId: parsed.data.contractId,
        label: row.label,
        kind: row.kind,
        percent: row.kind === "PERCENT" ? row.percent : null,
        amountCents: row.amountCents,
        dueOn: row.dueOn ? isoToDate(row.dueOn) : null,
        paidAt: parsed.data.rows[position]?.paid ? contract.payments[position]?.paidAt ?? new Date() : null,
        position,
      })),
    }),
  ]);

  revalidateDeal(contract.dealId ?? "", [parsed.data.contractId]);
  return { success: "Payment schedule saved" };
}

// Who signs for your company, editable on the contract page.
export async function updateSigner(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organizationId } = await requireSession();
  const parsed = z
    .object({ contractId: idSchema, senderSignerName: z.string().trim().max(120) })
    .safeParse({
      contractId: formData.get("contractId"),
      senderSignerName: formData.get("senderSignerName") ?? "",
    });
  if (!parsed.success) return { error: "Check the signer name" };

  const contract = await prisma.contract.findFirst({
    where: { id: parsed.data.contractId, organizationId },
    select: { status: true, dealId: true },
  });
  if (!contract) return { error: "Contract not found" };
  if (contract.status === "SIGNED") return { error: "This contract is signed and can no longer be edited" };

  await prisma.contract.updateMany({
    where: { id: parsed.data.contractId, organizationId },
    data: { senderSignerName: parsed.data.senderSignerName || null },
  });
  revalidateDeal(contract.dealId ?? "", [parsed.data.contractId]);
  return { success: "Signer saved" };
}
