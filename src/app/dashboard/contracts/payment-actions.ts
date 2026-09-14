"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { getTimeZone } from "@/lib/organization";
import { formatCents } from "@/lib/format";
import { dateToIso, isoToDate, todayIso } from "@/lib/payments";
import { paidCentsOf, settleRow, type PaymentView } from "@/lib/money";

// Recording money against one row of a contract's payment table. Each
// action answers with the row's new state so the editor can redraw that
// row without reloading, and revalidates every screen that adds money up.

const idSchema = z.string().trim().min(1, "Missing record reference");

export type RowState = {
  settled: boolean;
  receivedCents: number;
  payments: PaymentView[];
};

export type PaymentActionResult = { success?: string; error?: string; row?: RowState };

// Every screen that shows what is owed or paid.
function revalidateMoney(contract: { id: string; dealId: string | null; publicToken: string }) {
  revalidatePath(`/dashboard/contracts/${contract.id}`);
  revalidatePath("/dashboard/deals/tracker");
  revalidatePath("/dashboard/contracts/tracker");
  revalidatePath("/dashboard/contracts");
  revalidatePath("/dashboard/deals");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/companies");
  revalidatePath("/dashboard/contacts");
  if (contract.dealId) revalidatePath(`/dashboard/deals/${contract.dealId}`);
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
      contract: { select: { id: true, dealId: true, publicToken: true } },
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
