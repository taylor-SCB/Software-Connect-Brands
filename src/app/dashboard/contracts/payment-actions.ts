"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { getTimeZone } from "@/lib/organization";
import { formatCents } from "@/lib/format";
import { dateToIso, isoToDate, todayIso } from "@/lib/payments";
import { paidCentsOf, settleRow, type PaymentView } from "@/lib/money";
import { publicToken } from "@/lib/tokens";
import { refreshProjectTotals } from "@/lib/projects";

// Recording money against one row of a contract's payment table. Each
// action answers with the row's new state so the editor can redraw that
// row without reloading, and revalidates every screen that adds money up.

const idSchema = z.string().trim().min(1, "Missing record reference");

export type RowState = {
  settled: boolean;
  receivedCents: number;
  payments: PaymentView[];
  // Set once the row has been sent as an invoice.
  invoiceNumber: number | null;
  invoiceToken: string | null;
  reference: string | null;
};

export type PaymentActionResult = { success?: string; error?: string; row?: RowState };

// Every screen that shows what is owed or paid.
function revalidateMoney(contract: { id: string; dealId: string | null; publicToken: string; projectId?: string | null }) {
  revalidatePath(`/dashboard/contracts/${contract.id}`);
  revalidatePath("/dashboard/deals/tracker");
  revalidatePath("/dashboard/contracts/tracker");
  revalidatePath("/dashboard/contracts");
  revalidatePath("/dashboard/deals");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/companies");
  revalidatePath("/dashboard/contacts");
  if (contract.dealId) revalidatePath(`/dashboard/deals/${contract.dealId}`);
  revalidatePath("/dashboard/projects");
  if (contract.projectId) revalidatePath(`/dashboard/projects/${contract.projectId}`);
  // The customer's copy prints "Paid <date>" on settled rows.
  revalidatePath(`/c/${contract.publicToken}`);
}

// The row, through its contract, with the workspace in the WHERE clause.
async function loadRow(contractPaymentId: string, organizationId: string) {
  return prisma.contractPayment.findFirst({
    where: { id: contractPaymentId, contract: { organizationId } },
    select: {
      id: true,
      label: true,
      amountCents: true,
      paidAt: true,
      invoiceNumber: true,
      invoiceToken: true,
      issuedAt: true,
      reference: true,
      contract: { select: { id: true, dealId: true, publicToken: true, projectId: true } },
      payments: {
        orderBy: [{ paidOn: "asc" }, { createdAt: "asc" }],
        select: { id: true, amountCents: true, paidOn: true, method: true, reference: true, note: true },
      },
    },
  });
}

type LoadedRow = NonNullable<Awaited<ReturnType<typeof loadRow>>>;

function rowState(row: LoadedRow): RowState {
  return {
    settled: Boolean(row.paidAt),
    receivedCents: paidCentsOf(row),
    invoiceNumber: row.invoiceNumber,
    invoiceToken: row.invoiceToken,
    reference: row.reference,
    payments: row.payments.map((payment) => ({
      id: payment.id,
      amountCents: payment.amountCents,
      paidOn: dateToIso(payment.paidOn),
      method: payment.method,
      reference: payment.reference,
      note: payment.note,
    })),
  };
}

async function reply(contractPaymentId: string, organizationId: string, success: string): Promise<PaymentActionResult> {
  const row = await loadRow(contractPaymentId, organizationId);
  if (!row) return { error: "Payment row not found" };
  // Money moving changes the job's budget bar too.
  await refreshProjectTotals(organizationId, row.contract.projectId);
  revalidateMoney(row.contract);
  return { success, row: rowState(row) };
}

const recordSchema = z.object({
  contractPaymentId: idSchema,
  amountCents: z.number().int().positive("Enter an amount"),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the date it was paid"),
  method: z.string().trim().max(60).optional(),
  reference: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
});

// "Record payment": $600 by check on the deposit row. Can't take the row
// past its amount; the row settles on its own when the payments add up.
export async function recordPayment(input: {
  contractPaymentId: string;
  amountCents: number;
  paidOn: string;
  method?: string;
  reference?: string;
  note?: string;
}): Promise<PaymentActionResult> {
  const { organizationId } = await requireSession();
  const parsed = recordSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the payment" };

  const row = await loadRow(parsed.data.contractPaymentId, organizationId);
  if (!row) return { error: "Payment row not found" };
  const paidOn = isoToDate(parsed.data.paidOn);
  if (!paidOn) return { error: "Pick the date it was paid" };

  const open = row.amountCents - paidCentsOf(row);
  if (parsed.data.amountCents > open) {
    return { error: `That's more than the ${formatCents(Math.max(open, 0))} still open on this row.` };
  }

  await prisma.$transaction(async (tx) => {
    await tx.payment.create({
      data: {
        organizationId,
        contractPaymentId: row.id,
        amountCents: parsed.data.amountCents,
        paidOn,
        method: parsed.data.method || null,
        reference: parsed.data.reference || null,
        note: parsed.data.note || null,
      },
    });
    await settleRow(tx, row.id);
  });

  return reply(row.id, organizationId, `${formatCents(parsed.data.amountCents)} recorded`);
}

// The × next to a recorded payment.
export async function removePayment(paymentId: string): Promise<PaymentActionResult> {
  const { organizationId } = await requireSession();
  const id = idSchema.safeParse(paymentId);
  if (!id.success) return { error: "Missing payment reference" };

  const payment = await prisma.payment.findFirst({
    where: { id: id.data, organizationId },
    select: { contractPaymentId: true },
  });
  if (!payment) return { error: "Payment not found" };

  await prisma.$transaction(async (tx) => {
    await tx.payment.deleteMany({ where: { id: id.data, organizationId } });
    await settleRow(tx, payment.contractPaymentId);
  });

  return reply(payment.contractPaymentId, organizationId, "Payment removed");
}

// Ticking "Paid": one payment for whatever is still open, dated today.
export async function markRowPaid(contractPaymentId: string): Promise<PaymentActionResult> {
  const { organizationId } = await requireSession();
  const id = idSchema.safeParse(contractPaymentId);
  if (!id.success) return { error: "Missing payment row reference" };

  const row = await loadRow(id.data, organizationId);
  if (!row) return { error: "Payment row not found" };
  const open = row.amountCents - paidCentsOf(row);
  if (open <= 0) return { success: "Nothing left to pay on this row", row: rowState(row) };

  const timeZone = await getTimeZone();
  const paidOn = isoToDate(todayIso(timeZone)) ?? new Date();

  await prisma.$transaction(async (tx) => {
    await tx.payment.create({
      data: { organizationId, contractPaymentId: row.id, amountCents: open, paidOn, note: "Marked paid" },
    });
    await settleRow(tx, row.id);
  });

  return reply(row.id, organizationId, `${formatCents(open)} recorded`);
}

// Unticking "Paid": every payment on the row goes (the editor confirms
// first, listing them), and the row is open again.
export async function removeRowPayments(contractPaymentId: string): Promise<PaymentActionResult> {
  const { organizationId } = await requireSession();
  const id = idSchema.safeParse(contractPaymentId);
  if (!id.success) return { error: "Missing payment row reference" };

  const row = await loadRow(id.data, organizationId);
  if (!row) return { error: "Payment row not found" };

  await prisma.$transaction(async (tx) => {
    await tx.payment.deleteMany({ where: { contractPaymentId: row.id, organizationId } });
    await settleRow(tx, row.id);
  });

  return reply(row.id, organizationId, "Payments removed");
}

/* ------------------------------- Invoices ------------------------------- */

// Sending a row as an invoice: it gets INV-n and a link the customer can
// open without a login. The money was already owed the moment they
// signed; this is the piece of paper that goes out to chase it.
export async function sendInvoice(contractPaymentId: string): Promise<PaymentActionResult & { token?: string }> {
  const { organizationId } = await requireSession();
  const id = idSchema.safeParse(contractPaymentId);
  if (!id.success) return { error: "Missing payment row reference" };

  const row = await prisma.contractPayment.findFirst({
    where: { id: id.data, contract: { organizationId } },
    select: {
      id: true,
      label: true,
      amountCents: true,
      invoiceNumber: true,
      invoiceToken: true,
      contract: { select: { id: true, status: true, payable: true, dealId: true, publicToken: true, projectId: true } },
    },
  });
  if (!row) return { error: "Payment row not found" };
  if (row.contract.payable) return { error: "This is money going out — a supplier invoices you, not the other way round." };
  if (row.contract.status !== "SIGNED") return { error: "The customer has to sign before you invoice them." };
  if (row.amountCents <= 0) return { error: "There is nothing to invoice on this row." };
  // Already sent: hand back the same link rather than minting a second
  // number for the same money.
  if (row.invoiceToken) {
    return { success: `INV-${row.invoiceNumber} is already out`, token: row.invoiceToken };
  }

  const token = publicToken();
  const numbered = await prisma.$transaction(async (tx) => {
    const organization = await tx.organization.update({
      where: { id: organizationId },
      data: { nextInvoiceNumber: { increment: 1 } },
      select: { nextInvoiceNumber: true },
    });
    const number = organization.nextInvoiceNumber - 1;
    await tx.contractPayment.update({
      where: { id: row.id },
      data: { invoiceNumber: number, invoiceToken: token, issuedAt: new Date(), organizationId },
    });
    return number;
  });

  revalidateMoney(row.contract);
  const reply = await loadRow(row.id, organizationId);
  return {
    success: `INV-${numbered} ready to send`,
    token,
    row: reply ? rowState(reply) : undefined,
  };
}

// What the supplier's own invoice number is on a bill, so it can be
// matched against their paperwork.
export async function setRowReference(contractPaymentId: string, reference: string): Promise<PaymentActionResult> {
  const { organizationId } = await requireSession();
  const id = idSchema.safeParse(contractPaymentId);
  if (!id.success) return { error: "Missing payment row reference" };

  const row = await prisma.contractPayment.findFirst({
    where: { id: id.data, contract: { organizationId } },
    select: { id: true },
  });
  if (!row) return { error: "Payment row not found" };

  await prisma.contractPayment.update({
    where: { id: row.id },
    data: { reference: reference.trim().slice(0, 120) || null },
  });
  return reply(row.id, organizationId, "Saved");
}
