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
import { canUserSend, contractSubtotalCents, contractTotalCents, MAX_TRACKER_COLUMNS } from "@/lib/contracts";
import {
  computeSchedule,
  dateToIso,
  isoToDate,
  presetRows,
  type SchedulePreset,
  type ScheduleRowInput,
} from "@/lib/payments";
import { formatCents } from "@/lib/format";
import { paidCentsOf, settleRow } from "@/lib/money";
import { lineGrossCents, resolveDiscount } from "@/lib/quote-math";
import { repriceQuotePayments } from "@/lib/quote-payments";
import { loadPaymentDefaults } from "@/lib/tracker";
import { discountInputSchema, newScheduleRowSchema } from "@/lib/schedule-input";
import { refreshTotals, refreshTotalsForContract, refreshProjectTotals, syncProjectScopes } from "@/lib/projects";

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
  // Money out (true: a purchase order we pay) or Money in (false: the
  // customer pays us). The grid defaults it from the template's type.
  payable: z.boolean(),
  paymentTerms: z.string().trim().max(120).optional(),
  // Money off the whole contract, after each row's own discount.
  discount: discountInputSchema.optional(),
  // The payment rows as written on the card. Left out by an older client,
  // the quote's own table carries over, else the workspace's preset.
  schedule: z.array(newScheduleRowSchema).max(60).optional(),
  // True when the rows above are the quote's own table, untouched, so the
  // contract can say so and flag a later change.
  scheduleFromQuote: z.boolean().optional(),
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

// The quote's own payment table as schedule rows for one slice of it. A
// fixed amount from the quote is a share of the WHOLE quote, so it
// carries as that share rather than as the number itself. A $5,000
// deposit on a $10,000 quote must not land whole on a $2,000 slice of
// it: that made a deposit bigger than the contract and a negative
// balance row, printed on the document the customer signs.
function quoteScheduleRows(
  payments: { label: string; kind: "PERCENT" | "FIXED" | "BALANCE"; percent: number | null; amountCents: number; dueOn: Date | null; terms: string | null }[],
  quoteTotalCents: number,
): ScheduleRowInput[] {
  return payments.map((row) => ({
    label: row.label,
    kind: row.kind === "FIXED" && quoteTotalCents > 0 ? "PERCENT" : row.kind,
    percent:
      row.kind === "FIXED" && quoteTotalCents > 0 ? (row.amountCents / quoteTotalCents) * 100 : row.percent,
    fixedCents: row.kind === "FIXED" && quoteTotalCents <= 0 ? row.amountCents : null,
    dueOn: dateToIso(row.dueOn),
    terms: row.terms,
  }));
}

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
      lineItems: {
        orderBy: { position: "asc" },
        include: { product: { select: { costCents: true } } },
      },
      // The terms the customer was already shown. Each contract starts
      // from these rather than a preset, so what was quoted is what gets
      // sent unless someone deliberately changes it.
      payments: { orderBy: { position: "asc" } },
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
  const defaults = await loadPaymentDefaults(organizationId);

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
        // The line's own discount travels with its price: the contract
        // asks for what the quote line comes to.
        discountCents: line.discountCents,
        discountPercent: line.discountPercent,
        tag: line.tag,
        // Copied like the tag is, so the job's budget can split itself by
        // scope of work and show the expected cost, and neither changes
        // later when the catalog or the quote does.
        serviceType: line.serviceType,
        unitCostCents: line.product ? line.product.costCents : null,
        position,
      }));
      // The whole-contract discount is worked out here against the rows
      // as stored, and capped at the subtotal, so no contract can total
      // less than nothing.
      const subtotalCents = contractSubtotalCents(lineItems);
      const discount = resolveDiscount(column.discount ?? { percent: null, cents: 0 }, subtotalCents);
      const totalCents = contractTotalCents(lineItems, discount.discountCents);
      // What the quote's own payment rows were priced against, so a fixed
      // amount can carry over as the share of the deal it represents.
      const quoteTotalCents = contractSubtotalCents(quote.lineItems);

      // The rows written on the card win — they were asked for here.
      // Left out, the quote's own table carries over so the customer is
      // asked to pay what they were quoted, else the workspace's preset.
      // Percentages re-price against this contract's total, not the
      // whole quote's, since a quote can split into as many as five.
      const fromQuote = column.schedule
        ? Boolean(column.scheduleFromQuote) && quote.payments.length > 0
        : quote.payments.length > 0;
      const scheduleInput: ScheduleRowInput[] = column.schedule
        ? column.schedule
        : quote.payments.length > 0
          ? quoteScheduleRows(quote.payments, quoteTotalCents)
          : presetRows({
              preset: defaults.preset as SchedulePreset,
              start: "",
              depositPercent: defaults.depositPercent,
              count: defaults.installmentCount,
              unit: "MONTH",
            });
      const schedule = computeSchedule(scheduleInput, totalCents);
      const payments = schedule.rows.map((row, position) => ({
        organizationId,
        label: row.label,
        kind: row.kind,
        percent: row.kind === "PERCENT" ? row.percent : null,
        // Never below zero. The two sibling save paths refuse an
        // over-total schedule outright; this one has no screen to refuse
        // on, and a negative row would print on the signed document and
        // then block every later edit of that contract's table.
        amountCents: Math.max(0, row.amountCents),
        dueOn: row.dueOn ? isoToDate(row.dueOn) : null,
        terms: row.terms ?? null,
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
        discountCents: discount.discountCents,
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
          payable: column.payable,
          body: renderMergeFields(template.body, context),
          publicToken: publicToken(),
          senderSignerName: signerName,
          paymentTerms: fromQuote ? paymentTerms ?? quote.paymentTerms : paymentTerms,
          discountCents: discount.discountCents,
          discountPercent: discount.discountPercent,
          // Remembered so the schedule can say it came from the quote, and
          // say so again if someone changes it afterwards.
          scheduleFromQuote: fromQuote,
          lineItems: { create: lineItems },
          payments: { create: payments },
        },
        select: { id: true },
      });
      created.push(contract.id);
    }

    // When the deal is already an awarded job, its new paperwork belongs
    // to that job: a purchase order split off the same quote is a cost on
    // it, and a change order will amend its budget when it is signed.
    const project = await tx.project.findFirst({
      where: { organizationId, dealId: input.dealId },
      select: { id: true },
    });
    if (project) {
      await tx.contract.updateMany({
        where: { id: { in: created }, organizationId },
        data: { projectId: project.id },
      });
      // File the new rows under the scope their service type names, so a
      // purchase order counts against the work it is buying for.
      await syncProjectScopes(tx, { organizationId, projectId: project.id, dealId: input.dealId });
      await refreshTotals(tx, organizationId, project.id);
    }
  });

  revalidateDeal(input.dealId, created);
  revalidatePath("/dashboard/contacts");
  revalidatePath("/dashboard/companies");
  revalidatePath("/dashboard/projects");
  redirect(`${input.returnTo}?dealId=${input.dealId}&quoteId=${input.quoteId}&created=${created.length}`);
}

/* ---------------------------- Pricing a quote row ---------------------------- */

const quoteLineEditSchema = z.object({
  dealId: idSchema,
  lineItemId: idSchema,
  quantity: z.number().finite().min(0, "Quantity can't be negative").max(1_000_000),
  unitPriceCents: z.number().int().min(-100_000_000).max(100_000_000),
  discountPercent: z.number().min(0).max(100).nullable(),
  discountCents: z.number().int().min(0).max(1_000_000_000),
});

export type QuoteLineEdit = z.infer<typeof quoteLineEditSchema>;

// Prices a row from the Contract Coordinator: the quantity, the unit price
// and the line's own discount, written straight back onto the quote so the
// quote page and the customer's copy say the same thing. The quote's
// payment rows are re-priced in the same breath. Contracts already made
// from the row keep their own copy of it, as they always have.
export async function updateQuoteLine(
  raw: QuoteLineEdit,
): Promise<ActionState & { line?: { id: string; quantity: number; unitPriceCents: number; discountCents: number; discountPercent: number | null } }> {
  const { organizationId } = await requireSession();
  const parsed = quoteLineEditSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the row" };
  const input = parsed.data;

  const line = await prisma.quoteLineItem.findFirst({
    where: { id: input.lineItemId, quote: { organizationId, dealId: input.dealId } },
    select: { id: true, quoteId: true },
  });
  if (!line) return { error: "That row isn't on this deal's quote. Reload and try again." };

  const discount = resolveDiscount(
    { percent: input.discountPercent, cents: input.discountCents },
    lineGrossCents(input.quantity, input.unitPriceCents),
  );

  const saved = await prisma.$transaction(async (tx) => {
    const updated = await tx.quoteLineItem.update({
      where: { id: line.id },
      data: {
        quantity: input.quantity,
        unitPriceCents: input.unitPriceCents,
        discountCents: discount.discountCents,
        discountPercent: discount.discountPercent,
      },
      select: { id: true, quantity: true, unitPriceCents: true, discountCents: true, discountPercent: true },
    });
    await repriceQuotePayments(tx, line.quoteId);
    await tx.quote.update({ where: { id: line.quoteId }, data: { updatedAt: new Date() } });
    return updated;
  });

  revalidateDeal(input.dealId);
  revalidatePath(`/dashboard/quotes/${line.quoteId}`);
  revalidatePath("/dashboard/quotes");
  return { success: "Saved", line: saved };
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
    select: { status: true, dealId: true, projectId: true },
  });
  if (!contract || contract.status === "SIGNED") return;

  await prisma.contract.updateMany({
    where: { id: id.data, organizationId },
    data: { status: "CANCELLED", cancelledAt: new Date() },
  });
  // A purchase order that is withdrawn stops being Committed on the job,
  // and one that is reopened stops counting until it goes out again.
  await refreshProjectTotals(organizationId, contract.projectId);
  revalidateDeal(contract.dealId ?? "", [id.data]);
}

// Puts a cancelled contract back to draft, so it can be sent again.
export async function reopenContract(formData: FormData) {
  const { organizationId } = await requireSession();
  const id = idSchema.safeParse(formData.get("contractId"));
  if (!id.success) return;

  const contract = await prisma.contract.findFirst({
    where: { id: id.data, organizationId },
    select: { status: true, dealId: true, projectId: true },
  });
  if (!contract || contract.status !== "CANCELLED") return;

  await prisma.contract.updateMany({
    where: { id: id.data, organizationId },
    data: { status: "DRAFT", cancelledAt: null, sentAt: null },
  });
  // A purchase order that is withdrawn stops being Committed on the job,
  // and one that is reopened stops counting until it goes out again.
  await refreshProjectTotals(organizationId, contract.projectId);
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
  // Set for a row that already exists, so it keeps its id (and the
  // payments recorded on it) through a re-save; absent for a new row.
  id: z.string().trim().min(1).optional(),
  // The editor's handle for the row, echoed back so a row created by this
  // save can be told its stored id without relying on array position.
  uid: z.number().int().optional(),
  label: z.string().trim().min(1, "Every payment needs a label").max(120),
  kind: z.enum(["PERCENT", "FIXED", "BALANCE"]),
  percent: z.number().min(0).max(100).nullable(),
  fixedCents: z.number().int().min(0).max(1_000_000_000).nullable(),
  dueOn: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A due date isn't valid")]),
  // A label beside the date — "Net 30" — shown when no date is picked.
  terms: z.string().trim().max(60).nullable().optional(),
});

// Saves the payment table. Rows the editor already had keep their ids —
// the payments recorded on them stay attached — and are updated in place;
// rows without an id are new; rows no longer present are deleted, unless
// money was recorded on them. Allowed on a signed contract too: the dates,
// amounts and percents can be amended after award. Paid is not part of
// this save; it is recorded per row by the payment actions.
export async function savePaymentSchedule(input: {
  contractId: string;
  paymentTerms: string;
  rows: z.infer<typeof scheduleRowSchema>[];
}): Promise<ActionState & { saved?: { uid: number; id: string }[] }> {
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
      scheduleFromQuote: true,
      scheduleAmendedAt: true,
      discountCents: true,
      lineItems: { select: { quantity: true, unitPriceCents: true, discountCents: true } },
      payments: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          label: true,
          kind: true,
          percent: true,
          amountCents: true,
          dueOn: true,
          terms: true,
          payments: { select: { amountCents: true } },
        },
      },
    },
  });
  if (!contract) return { error: "Contract not found" };

  const totalCents = contractTotalCents(contract.lineItems, contract.discountCents);
  const schedule = computeSchedule(parsed.data.rows, totalCents);
  if (schedule.rows.some((row) => row.amountCents < 0)) {
    return { error: "The fixed amounts add up to more than the contract total" };
  }

  const existingById = new Map(contract.payments.map((row) => [row.id, row]));
  const seen = new Set<string>();
  for (const [index, row] of parsed.data.rows.entries()) {
    if (!row.id) continue;
    const existing = existingById.get(row.id);
    // An id from another contract (or a stale one) is not this row.
    if (!existing || seen.has(row.id)) {
      return { error: "A row on this table has changed since the page loaded. Reload and try again." };
    }
    seen.add(row.id);
    const received = paidCentsOf(existing);
    if (schedule.rows[index].amountCents < received) {
      return {
        error: `'${row.label}' already has ${formatCents(received)} recorded on it — the amount can't go below that.`,
      };
    }
  }
  const removed = contract.payments.filter((row) => !seen.has(row.id));
  for (const row of removed) {
    const received = paidCentsOf(row);
    if (received > 0) {
      return { error: `'${row.label}' has ${formatCents(received)} recorded — remove that payment first.` };
    }
  }

  const saved: { uid: number; id: string }[] = [];

  // A schedule that came from the quote gets marked once it stops matching
  // what the customer was quoted, so the difference is visible on the
  // document rather than silent. Only the first change stamps it.
  const changedFromQuote =
    contract.scheduleFromQuote &&
    !contract.scheduleAmendedAt &&
    (contract.payments.length !== schedule.rows.length ||
      schedule.rows.some((row, index) => {
        const before = contract.payments[index];
        if (!before) return true;
        return (
          before.label !== row.label ||
          before.kind !== row.kind ||
          before.amountCents !== row.amountCents ||
          (before.terms ?? "") !== (parsed.data.rows[index]?.terms?.trim() || "") ||
          dateToIso(before.dueOn) !== row.dueOn
        );
      }));

  await prisma.$transaction(async (tx) => {
    await tx.contract.updateMany({
      where: { id: parsed.data.contractId, organizationId },
      data: {
        paymentTerms: parsed.data.paymentTerms || null,
        ...(changedFromQuote ? { scheduleAmendedAt: new Date() } : {}),
      },
    });
    if (removed.length) {
      await tx.contractPayment.deleteMany({
        where: { id: { in: removed.map((row) => row.id) }, contractId: parsed.data.contractId },
      });
    }
    for (const [position, row] of schedule.rows.entries()) {
      const source = parsed.data.rows[position];
      const data = {
        label: row.label,
        kind: row.kind,
        percent: row.kind === "PERCENT" ? row.percent : null,
        amountCents: row.amountCents,
        dueOn: row.dueOn ? isoToDate(row.dueOn) : null,
        terms: source?.terms?.trim() || null,
        position,
      };
      const id = source?.id;
      if (id) {
        await tx.contractPayment.update({ where: { id }, data });
        // A lower amount can settle a row that was partly paid.
        await settleRow(tx, id);
        if (source?.uid !== undefined) saved.push({ uid: source.uid, id });
      } else {
        const created = await tx.contractPayment.create({
          data: { ...data, contractId: parsed.data.contractId, organizationId },
          select: { id: true },
        });
        if (source?.uid !== undefined) saved.push({ uid: source.uid, id: created.id });
      }
    }
  });

  // What is billed and received on the job moved, so its bar moves too.
  await refreshTotalsForContract(organizationId, parsed.data.contractId);
  revalidateDeal(contract.dealId ?? "", [parsed.data.contractId]);
  revalidatePath("/dashboard/companies");
  revalidatePath("/dashboard/contacts");
  revalidatePath("/dashboard/projects");
  return { success: "Payment schedule saved", saved };
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
