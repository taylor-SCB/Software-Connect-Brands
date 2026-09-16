"use client";

import { useState, useTransition } from "react";
import { formatCents, formatDate, dollarsToCents, centsToDollarInput } from "@/lib/format";
import type { PaymentKindValue } from "@/lib/payments";
import type { PaymentView } from "@/lib/money";
import { IconX } from "@/components/icons";
import { PaymentTable, type PaymentTableRow } from "@/components/payment-table";
import { savePaymentSchedule } from "@/app/dashboard/deals/tracker/actions";
import {
  markRowPaid,
  recordPayment,
  removePayment,
  removeRowPayments,
  type PaymentActionResult,
  type RowState,
} from "@/app/dashboard/contracts/payment-actions";

export type EditorPayment = {
  id: string;
  label: string;
  kind: PaymentKindValue;
  percent: number | null;
  amountCents: number;
  dueOn: string;
  terms: string;
  settled: boolean;
  payments: PaymentView[];
};

const METHODS = ["Check", "Cash", "Card", "ACH", "Zelle", "Venmo"];

// The payment table on a contract: the shared table plus the half that is
// only true of a contract, which is money actually received. The table
// owns what the rows say; this owns what has been paid on them, keyed by
// the stored row id, so neither has to reach into the other's state.
//
// Stays editable after signature: dates, amounts and percents can be
// amended after award.
export function PaymentScheduleEditor({
  contractId,
  totalCents,
  paymentTerms,
  initialRows,
  today,
  note,
}: {
  contractId: string;
  totalCents: number;
  paymentTerms: string;
  initialRows: EditorPayment[];
  today: string;
  note?: React.ReactNode;
}) {
  const [moneyByRow, setMoneyByRow] = useState<Record<string, { settled: boolean; payments: PaymentView[] }>>(
    () =>
      Object.fromEntries(
        initialRows.map((row) => [row.id, { settled: row.settled, payments: row.payments }]),
      ),
  );
  const [message, setMessage] = useState<{ error?: string; success?: string }>({});
  const [moneyPending, startMoney] = useTransition();
  const [recording, setRecording] = useState<string | null>(null);

  const paymentsOf = (rowId: string | undefined) => (rowId ? moneyByRow[rowId]?.payments ?? [] : []);
  const receivedCents = (rowId: string | undefined) =>
    paymentsOf(rowId).reduce((sum, payment) => sum + payment.amountCents, 0);
  const paidCents = Object.values(moneyByRow).reduce(
    (sum, entry) => sum + entry.payments.reduce((rowSum, payment) => rowSum + payment.amountCents, 0),
    0,
  );

  // Runs a payment action and redraws that one row from the answer.
  function money(rowId: string, run: () => Promise<PaymentActionResult>) {
    setMessage({});
    startMoney(async () => {
      const result = await run();
      if (result.row) {
        const state: RowState = result.row;
        setMoneyByRow((all) => ({ ...all, [rowId]: { settled: state.settled, payments: state.payments } }));
      }
      setMessage({ error: result.error, success: result.success });
    });
  }

  function togglePaid(row: PaymentTableRow, checked: boolean) {
    if (!row.id) return;
    const id = row.id;
    if (checked) {
      money(id, () => markRowPaid(id));
      return;
    }
    const payments = paymentsOf(id);
    const list = payments
      .map(
        (payment) =>
          `• ${formatCents(payment.amountCents)} on ${payment.paidOn}${payment.method ? ` by ${payment.method}` : ""}`,
      )
      .join("\n");
    const ok = window.confirm(
      `Unticking Paid removes ${payments.length === 1 ? "the payment" : `all ${payments.length} payments`} recorded on '${row.label}':\n\n${list}\n\nRemove ${payments.length === 1 ? "it" : "them"}?`,
    );
    if (!ok) return;
    money(id, () => removeRowPayments(id));
  }

  return (
    <>
      <PaymentTable
        totalCents={totalCents}
        paymentTerms={paymentTerms}
        today={today}
        note={note}
        initialRows={initialRows.map((row) => ({
          id: row.id,
          label: row.label,
          kind: row.kind,
          percent: row.percent,
          amountCents: row.amountCents,
          dueOn: row.dueOn,
          terms: row.terms,
        }))}
        onSave={async (payload) => savePaymentSchedule({ contractId, ...payload })}
        money={{
          pending: moneyPending,
          paidCents,
          hasPayments: (rowId) => paymentsOf(rowId).length > 0,
          isSettled: (rowId) => (rowId ? moneyByRow[rowId]?.settled ?? false : false),
          onTogglePaid: togglePaid,
          renderMoneyRow: (row, amountCents) => (
            <tr className="border-t-0" data-testid="payment-money">
              <td colSpan={7} className="pt-0 text-xs">
                <MoneyLine
                  label={row.label}
                  rowId={row.id!}
                  payments={paymentsOf(row.id)}
                  amountCents={amountCents}
                  receivedCents={receivedCents(row.id)}
                  today={today}
                  open={recording === row.id}
                  pending={moneyPending}
                  onOpen={() => setRecording(recording === row.id ? null : row.id!)}
                  onRecord={(input) => {
                    money(row.id!, async () => {
                      const result = await recordPayment(input);
                      if (!result.error) setRecording(null);
                      return result;
                    });
                  }}
                  onRemove={(paymentId) => money(row.id!, () => removePayment(paymentId))}
                />
              </td>
            </tr>
          ),
        }}
      />
      {/* Messages from the money actions. The table reports its own saves. */}
      {message.error && <p className="px-5 pb-4 text-sm text-[var(--danger)]">{message.error}</p>}
      {message.success && <p className="px-5 pb-4 text-sm text-[var(--ok)]">{message.success}</p>}
    </>
  );
}

// "Paid $600 of $1,000 · Record payment", the payments recorded so far,
// and the small form that records one more.
function MoneyLine({
  label,
  rowId,
  payments,
  amountCents,
  receivedCents,
  today,
  open,
  pending,
  onOpen,
  onRecord,
  onRemove,
}: {
  label: string;
  rowId: string;
  payments: PaymentView[];
  amountCents: number;
  receivedCents: number;
  today: string;
  open: boolean;
  pending: boolean;
  onOpen: () => void;
  onRecord: (input: {
    contractPaymentId: string;
    amountCents: number;
    paidOn: string;
    method?: string;
    reference?: string;
  }) => void;
  onRemove: (paymentId: string) => void;
}) {
  const balance = Math.max(amountCents - receivedCents, 0);
  return (
    <div className="space-y-1.5 pb-1">
      <p>
        <span className={receivedCents > 0 ? "text-[var(--ok)]" : "faint"} data-testid="paid-of">
          Paid {formatCents(receivedCents)} of {formatCents(amountCents)}
        </span>
        <span className="faint"> · </span>
        <button type="button" onClick={onOpen} className="link" data-testid="record-payment">
          Record payment
        </button>
      </p>
      {payments.length > 0 && (
        <ul className="space-y-0.5">
          {payments.map((payment) => (
            <li key={payment.id} className="flex items-center gap-2" data-testid="recorded-payment">
              <span className="faint">{formatDate(payment.paidOn, "UTC")}</span>
              <span className="num font-medium">{formatCents(payment.amountCents)}</span>
              {payment.method && <span className="faint">{payment.method}</span>}
              {payment.reference && <span className="faint">#{payment.reference}</span>}
              {!payment.method && payment.note && <span className="faint">{payment.note}</span>}
              <button
                type="button"
                disabled={pending}
                onClick={() => onRemove(payment.id)}
                className="btn btn-icon-danger btn-sm"
                aria-label={`Remove the ${formatCents(payment.amountCents)} payment`}
                data-testid="payment-remove"
              >
                <IconX size={11} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <RecordForm
          rowId={rowId}
          label={label}
          balanceCents={balance}
          today={today}
          pending={pending}
          onRecord={onRecord}
          onCancel={onOpen}
        />
      )}
    </div>
  );
}

function RecordForm({
  rowId,
  label,
  balanceCents,
  today,
  pending,
  onRecord,
  onCancel,
}: {
  rowId: string;
  label: string;
  balanceCents: number;
  today: string;
  pending: boolean;
  onRecord: (input: {
    contractPaymentId: string;
    amountCents: number;
    paidOn: string;
    method?: string;
    reference?: string;
  }) => void;
  onCancel: () => void;
}) {
  const [amount, setAmount] = useState(centsToDollarInput(balanceCents));
  const [paidOn, setPaidOn] = useState(today);
  const [method, setMethod] = useState("");
  const [reference, setReference] = useState("");
  // Prefilled with what is still open; the server refuses anything past it
  // with a plain message rather than the box silently clipping it.
  const cents = dollarsToCents(amount);

  return (
    <div
      className="flex flex-wrap items-end gap-2 rounded-lg border border-[var(--border)] bg-[rgb(255_255_255/0.02)] p-2.5"
      data-testid="record-payment-form"
      aria-label={`Record a payment on ${label}`}
    >
      <label className="block">
        <span className="faint block">Amount</span>
        <input
          className="input input-sm num w-24"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          data-testid="payment-amount-input"
          aria-label="Payment amount"
        />
      </label>
      <label className="block">
        <span className="faint block">Date</span>
        <input
          type="date"
          className="input input-sm"
          value={paidOn}
          onChange={(event) => setPaidOn(event.target.value)}
          data-testid="payment-date"
          aria-label="Payment date"
        />
      </label>
      <label className="block">
        <span className="faint block">Method</span>
        <input
          className="input input-sm w-28"
          list="paymentMethods"
          value={method}
          onChange={(event) => setMethod(event.target.value)}
          placeholder="Check"
          data-testid="payment-method"
          aria-label="Payment method"
        />
        <datalist id="paymentMethods">
          {METHODS.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      </label>
      <label className="block">
        <span className="faint block">Reference</span>
        <input
          className="input input-sm w-28"
          value={reference}
          onChange={(event) => setReference(event.target.value)}
          placeholder="Check #"
          data-testid="payment-reference"
          aria-label="Payment reference"
        />
      </label>
      <button
        type="button"
        disabled={pending || cents <= 0}
        onClick={() =>
          onRecord({
            contractPaymentId: rowId,
            amountCents: cents,
            paidOn,
            method: method || undefined,
            reference: reference || undefined,
          })
        }
        className="btn btn-primary btn-sm"
        data-testid="payment-save"
      >
        {pending ? "Saving…" : `Record ${formatCents(cents)}`}
      </button>
      <button type="button" onClick={onCancel} className="btn btn-ghost btn-sm">
        Cancel
      </button>
    </div>
  );
}
