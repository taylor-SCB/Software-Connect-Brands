"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { formatCents, formatDate } from "@/lib/format";
import { FormError } from "@/components/ui";
import { IconSend, IconExternal, IconX } from "@/components/icons";
import { recordPayment, removePayment, sendInvoice } from "@/app/dashboard/contracts/payment-actions";
import type { PaymentView } from "@/lib/money";

type Row = {
  id: string;
  label: string;
  amountCents: number;
  receivedCents: number;
  dueOn: string | null;
  settled: boolean;
  invoiceNumber: number | null;
  invoiceToken: string | null;
  payments: PaymentView[];
};

// One payment the customer owes: what it is for, what is left on it, and
// the two things you do with it — send it as an invoice, or record what
// came in.
export function InvoiceRow({
  row: initial,
  contract,
  today,
  timeZone,
}: {
  row: Row;
  contract: { id: string; number: number; type: string };
  today: string;
  timeZone: string;
}) {
  const [row, setRow] = useState(initial);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | undefined>();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(today);
  const [method, setMethod] = useState("");
  const [reference, setReference] = useState("");

  const balanceCents = row.amountCents - row.receivedCents;
  const overdue = !row.settled && row.dueOn && row.dueOn < today;

  const apply = (next: { settled: boolean; receivedCents: number; payments: PaymentView[]; invoiceNumber: number | null; invoiceToken: string | null }) =>
    setRow((current) => ({ ...current, ...next }));

  return (
    <li className="px-5 py-3" data-testid="owed-row">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">{row.label}</p>
          <p className="faint num text-xs">
            <Link href={`/dashboard/contracts/${contract.id}`} className="link">
              CON-{contract.number}
            </Link>
            {row.invoiceNumber !== null && ` · INV-${row.invoiceNumber}`}
            {row.dueOn && (
              <span className={overdue ? "text-[var(--danger)]" : ""}>
                {" · "}
                {overdue ? "was due " : "due "}
                {formatDate(new Date(`${row.dueOn}T12:00:00Z`), timeZone)}
              </span>
            )}
            {row.receivedCents > 0 && ` · ${formatCents(row.receivedCents)} in`}
          </p>
        </div>
        <span
          className={`num text-sm font-medium ${row.settled ? "text-[var(--ok)]" : overdue ? "text-[var(--danger)]" : ""}`}
          data-testid="owed-balance"
          data-cents={Math.max(0, balanceCents)}
        >
          {row.settled ? "Paid" : formatCents(balanceCents)}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {row.invoiceToken ? (
          <a
            href={`/i/${row.invoiceToken}`}
            target="_blank"
            rel="noreferrer"
            className="btn btn-ghost btn-sm"
            data-testid="open-invoice"
          >
            <IconExternal size={13} />
            The invoice they see
          </a>
        ) : (
          <button
            type="button"
            disabled={pending || row.settled}
            onClick={() =>
              start(async () => {
                setError(undefined);
                const result = await sendInvoice(row.id);
                if (result?.error) setError(result.error);
                else if (result?.row) apply(result.row);
              })
            }
            className="btn btn-ghost btn-sm"
            data-testid="send-invoice"
          >
            <IconSend size={13} />
            {pending ? "Making it…" : "Send as an invoice"}
          </button>
        )}
        {!row.settled && (
          <button
            type="button"
            onClick={() => {
              setOpen(!open);
              setAmount((balanceCents / 100).toFixed(2));
            }}
            className="btn btn-ghost btn-sm"
            data-testid="record-payment"
          >
            Record payment
          </button>
        )}
      </div>

      {open && !row.settled && (
        <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-[var(--border)] bg-[rgb(255_255_255/0.02)] p-2.5">
          <label className="block text-xs">
            <span className="faint block">Amount</span>
            <input
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="decimal"
              aria-label="Payment amount"
              className="input input-sm num w-24"
              data-testid="payment-amount-input"
            />
          </label>
          <label className="block text-xs">
            <span className="faint block">Date</span>
            <input
              type="date"
              value={paidOn}
              onChange={(event) => setPaidOn(event.target.value)}
              aria-label="Payment date"
              className="input input-sm"
              data-testid="payment-date"
            />
          </label>
          <label className="block text-xs">
            <span className="faint block">How</span>
            <input
              value={method}
              onChange={(event) => setMethod(event.target.value)}
              list="projectPaymentMethods"
              placeholder="Check"
              aria-label="How it was paid"
              className="input input-sm w-24"
              data-testid="payment-method"
            />
            <datalist id="projectPaymentMethods">
              <option value="Check" />
              <option value="Cash" />
              <option value="Card" />
              <option value="ACH" />
              <option value="Zelle" />
              <option value="Venmo" />
            </datalist>
          </label>
          <label className="block text-xs">
            <span className="faint block">Reference</span>
            <input
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              placeholder="Check #"
              aria-label="Payment reference"
              className="input input-sm w-24"
              data-testid="payment-reference"
            />
          </label>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(undefined);
                const result = await recordPayment({
                  contractPaymentId: row.id,
                  amountCents: Math.round(Number(amount.replace(/[^0-9.-]/g, "")) * 100),
                  paidOn,
                  method,
                  reference,
                });
                if (result?.error) {
                  setError(result.error);
                  return;
                }
                if (result?.row) apply(result.row);
                setOpen(false);
              })
            }
            className="btn btn-primary btn-sm"
            data-testid="payment-save"
          >
            Record
          </button>
        </div>
      )}

      {row.payments.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {row.payments.map((payment) => (
            <li key={payment.id} className="faint num flex items-center gap-2 text-xs" data-testid="recorded-payment">
              <span>
                {formatDate(new Date(`${payment.paidOn}T12:00:00Z`), timeZone)} · {formatCents(payment.amountCents)}
                {payment.method ? ` · ${payment.method}` : ""}
                {payment.reference ? ` · ${payment.reference}` : ""}
              </span>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const result = await removePayment(payment.id);
                    if (result?.error) setError(result.error);
                    else if (result?.row) apply(result.row);
                  })
                }
                aria-label={`Remove the ${formatCents(payment.amountCents)} payment`}
                className="btn btn-ghost btn-sm !px-1"
                data-testid="payment-remove"
              >
                <IconX size={11} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <FormError message={error} />
    </li>
  );
}
