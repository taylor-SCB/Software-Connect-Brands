"use client";

import { useMemo, useState, useTransition } from "react";
import { formatCents, formatDate, dollarsToCents, centsToDollarInput } from "@/lib/format";
import {
  PAYMENT_KIND_LABELS,
  PAYMENT_TERM_OPTIONS,
  SCHEDULE_PRESET_LABELS,
  computeSchedule,
  presetRows,
  type InstallmentUnit,
  type PaymentKindValue,
  type SchedulePreset,
  type ScheduleRowInput,
} from "@/lib/payments";
import type { PaymentView } from "@/lib/money";
import { FormError, FormSuccess } from "@/components/ui";
import { IconPlus, IconTrash, IconX } from "@/components/icons";
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
  settled: boolean;
  payments: PaymentView[];
};

// A row the editor holds. `id` is set for a row that exists in the
// database (it keeps its id, and its payments, through a save); a row
// added here or filled from a preset has none until it is saved.
type Row = ScheduleRowInput & {
  uid: number;
  id?: string;
  fixedInput: string;
  settled: boolean;
  payments: PaymentView[];
};

const METHODS = ["Check", "Cash", "Card", "ACH", "Zelle", "Venmo"];

let uid = 0;

function toRow(payment: EditorPayment): Row {
  return {
    uid: (uid += 1),
    id: payment.id,
    label: payment.label,
    kind: payment.kind,
    percent: payment.percent,
    fixedCents: payment.kind === "FIXED" ? payment.amountCents : null,
    fixedInput: payment.kind === "FIXED" ? centsToDollarInput(payment.amountCents) : "",
    dueOn: payment.dueOn,
    settled: payment.settled,
    payments: payment.payments,
  };
}

function freshRow(input: ScheduleRowInput): Row {
  return { ...input, uid: (uid += 1), fixedInput: "", settled: false, payments: [] };
}

function receivedCents(row: Row) {
  return row.payments.reduce((sum, payment) => sum + payment.amountCents, 0);
}

// The payment table on a contract. Rows are a percent of the total, a
// fixed amount, or the balance; the amounts recompute as you type, and
// the footer shows what is scheduled against the contract total and the
// final due date. Presets fill the table in one click. Each saved row
// also carries the money recorded against it — "Paid $600 of $1,000" —
// with Record payment for a partial and the Paid tick for the rest.
// Stays editable after signature: dates, amounts and percents can be
// amended after award.
export function PaymentScheduleEditor({
  contractId,
  totalCents,
  paymentTerms,
  initialRows,
  today,
}: {
  contractId: string;
  totalCents: number;
  paymentTerms: string;
  initialRows: EditorPayment[];
  today: string;
}) {
  const [terms, setTerms] = useState(paymentTerms);
  const [rows, setRows] = useState<Row[]>(() => initialRows.map(toRow));
  const [preset, setPreset] = useState<SchedulePreset>("DEPOSIT_BALANCE");
  const [presetCount, setPresetCount] = useState(3);
  const [presetUnit, setPresetUnit] = useState<InstallmentUnit>("MONTH");
  const [presetStart, setPresetStart] = useState(today);
  const [message, setMessage] = useState<{ error?: string; success?: string }>({});
  const [pending, startTransition] = useTransition();
  const [moneyPending, startMoney] = useTransition();
  // Which row's Record payment form is open.
  const [recording, setRecording] = useState<number | null>(null);

  const schedule = useMemo(
    () =>
      computeSchedule(
        rows.map((row) => ({
          label: row.label,
          kind: row.kind,
          percent: row.percent,
          fixedCents: row.kind === "FIXED" ? dollarsToCents(row.fixedInput) : null,
          dueOn: row.dueOn,
        })),
        totalCents,
      ),
    [rows, totalCents],
  );

  function patch(target: number, changes: Partial<Row>) {
    setRows((all) => all.map((row) => (row.uid === target ? { ...row, ...changes } : row)));
  }

  function applyPreset() {
    setRows(presetRows({ preset, start: presetStart, count: presetCount, unit: presetUnit }).map(freshRow));
  }

  function addRow() {
    setRows((all) => [
      ...all,
      { ...freshRow({ label: `Payment ${all.length + 1}`, kind: "FIXED", percent: null, fixedCents: 0, dueOn: "" }), fixedInput: "0.00" },
    ]);
  }

  function save() {
    setMessage({});
    startTransition(async () => {
      const result = await savePaymentSchedule({
        contractId,
        paymentTerms: terms,
        rows: rows.map((row) => ({
          id: row.id,
          label: row.label,
          kind: row.kind,
          percent: row.kind === "PERCENT" ? row.percent ?? 0 : null,
          fixedCents: row.kind === "FIXED" ? dollarsToCents(row.fixedInput) : null,
          dueOn: row.dueOn,
        })),
      });
      setMessage(result);
    });
  }

  // Runs a payment action and redraws that one row from the answer.
  function money(target: number, run: () => Promise<PaymentActionResult>) {
    setMessage({});
    startMoney(async () => {
      const result = await run();
      if (result.row) {
        const state: RowState = result.row;
        patch(target, { settled: state.settled, payments: state.payments });
      }
      setMessage({ error: result.error, success: result.success });
    });
  }

  function togglePaid(row: Row, checked: boolean) {
    if (!row.id) return;
    const id = row.id;
    if (checked) {
      money(row.uid, () => markRowPaid(id));
      return;
    }
    const list = row.payments
      .map((payment) => `• ${formatCents(payment.amountCents)} on ${payment.paidOn}${payment.method ? ` by ${payment.method}` : ""}`)
      .join("\n");
    const ok = window.confirm(
      `Unticking Paid removes ${row.payments.length === 1 ? "the payment" : `all ${row.payments.length} payments`} recorded on '${row.label}':\n\n${list}\n\nRemove ${row.payments.length === 1 ? "it" : "them"}?`,
    );
    if (!ok) return;
    money(row.uid, () => removeRowPayments(id));
  }

  const paidCents = rows.reduce((sum, row) => sum + receivedCents(row), 0);

  return (
    <div className="space-y-4 p-5" data-testid="payment-schedule">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="paymentTerms">
            Payment terms
          </label>
          <input
            id="paymentTerms"
            list="paymentTermsOptions"
            className="input"
            value={terms}
            onChange={(event) => setTerms(event.target.value)}
            placeholder="Net 30"
          />
          <datalist id="paymentTermsOptions">
            {PAYMENT_TERM_OPTIONS.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
        </div>
        <div>
          <span className="label">Fill from a preset</span>
          <div className="flex flex-wrap items-center gap-1.5">
            <select className="select w-auto" value={preset} onChange={(event) => setPreset(event.target.value as SchedulePreset)} aria-label="Preset">
              {(Object.keys(SCHEDULE_PRESET_LABELS) as SchedulePreset[]).map((key) => (
                <option key={key} value={key}>{SCHEDULE_PRESET_LABELS[key]}</option>
              ))}
            </select>
            {preset === "INSTALLMENTS" && (
              <>
                <input type="number" min={2} max={60} className="input input-sm num w-16" value={presetCount} onChange={(event) => setPresetCount(Number(event.target.value) || 2)} aria-label="How many installments" />
                <select className="select w-auto" value={presetUnit} onChange={(event) => setPresetUnit(event.target.value as InstallmentUnit)} aria-label="Installment period">
                  <option value="MONTH">Monthly</option>
                  <option value="YEAR">Yearly</option>
                </select>
              </>
            )}
            <input type="date" className="input input-sm w-auto" value={presetStart} onChange={(event) => setPresetStart(event.target.value)} aria-label="First due date" />
            <button type="button" onClick={applyPreset} className="btn btn-ghost btn-sm" data-testid="apply-preset">
              Apply
            </button>
          </div>
          {rows.some((row) => row.payments.length > 0) && (
            <p className="faint mt-1 text-xs">Rows with payments recorded can&apos;t be replaced by a preset.</p>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Payment</th>
              <th>Type</th>
              <th>Value</th>
              <th className="text-right">Amount</th>
              <th>Due</th>
              <th>Paid</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="faint py-6 text-center text-xs">
                  No payment schedule yet. Apply a preset or add a row.
                </td>
              </tr>
            )}
            {rows.map((row, index) => {
              const amount = schedule.rows[index]?.amountCents ?? 0;
              const received = receivedCents(row);
              const hasPayments = row.payments.length > 0;
              return (
                <RowGroup key={row.uid}>
                  <tr data-testid="payment-row">
                    <td>
                      <input className="input input-sm min-w-[10rem]" value={row.label} onChange={(event) => patch(row.uid, { label: event.target.value })} aria-label="Payment label" />
                    </td>
                    <td>
                      <select className="select min-w-[7.5rem]" value={row.kind} onChange={(event) => patch(row.uid, { kind: event.target.value as PaymentKindValue })} aria-label="Payment type">
                        {(Object.keys(PAYMENT_KIND_LABELS) as PaymentKindValue[]).map((kind) => (
                          <option key={kind} value={kind}>{PAYMENT_KIND_LABELS[kind]}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      {row.kind === "PERCENT" && (
                        <div className="flex items-center gap-1">
                          <input type="number" min={0} max={100} step="0.01" className="input input-sm num w-20" value={row.percent ?? ""} onChange={(event) => patch(row.uid, { percent: event.target.value === "" ? null : Number(event.target.value) })} aria-label="Percent" />
                          <span className="faint text-xs">%</span>
                        </div>
                      )}
                      {row.kind === "FIXED" && (
                        <div className="flex items-center gap-1">
                          <span className="faint text-xs">$</span>
                          <input className="input input-sm num w-24" value={row.fixedInput} onChange={(event) => patch(row.uid, { fixedInput: event.target.value })} aria-label="Fixed amount" />
                        </div>
                      )}
                      {row.kind === "BALANCE" && <span className="faint text-xs">whatever is left</span>}
                    </td>
                    <td className="num text-right font-medium" data-testid="payment-amount">{formatCents(amount)}</td>
                    <td>
                      <input type="date" className="input input-sm" value={row.dueOn} onChange={(event) => patch(row.uid, { dueOn: event.target.value })} aria-label="Due date" />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={row.settled}
                        disabled={!row.id || moneyPending}
                        title={row.id ? undefined : "Save the table first, then record payments"}
                        onChange={(event) => togglePaid(row, event.target.checked)}
                        aria-label={`${row.label} paid`}
                        className="h-4 w-4"
                        data-testid="paid-checkbox"
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        disabled={hasPayments}
                        title={hasPayments ? "Remove its payments first" : undefined}
                        onClick={() => setRows((all) => all.filter((r) => r.uid !== row.uid))}
                        className="btn btn-icon-danger btn-sm"
                        aria-label={`Remove ${row.label}`}
                      >
                        <IconTrash size={13} />
                      </button>
                    </td>
                  </tr>
                  {row.id && (
                    <tr className="border-t-0" data-testid="payment-money">
                      <td colSpan={7} className="pt-0 text-xs">
                        <MoneyLine
                          row={row}
                          rowId={row.id}
                          amountCents={amount}
                          receivedCents={received}
                          today={today}
                          open={recording === row.uid}
                          pending={moneyPending}
                          onOpen={() => setRecording(recording === row.uid ? null : row.uid)}
                          onRecord={(input) => {
                            money(row.uid, async () => {
                              const result = await recordPayment(input);
                              if (!result.error) setRecording(null);
                              return result;
                            });
                          }}
                          onRemove={(paymentId) => money(row.uid, () => removePayment(paymentId))}
                        />
                      </td>
                    </tr>
                  )}
                </RowGroup>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} className="text-xs">
                <button type="button" onClick={addRow} className="btn btn-ghost btn-sm">
                  <IconPlus size={13} />
                  Add payment
                </button>
              </td>
              <td className="num text-right text-sm font-semibold" data-testid="scheduled-total">{formatCents(schedule.scheduledCents)}</td>
              <td colSpan={3} className="text-xs">
                <span className="faint">of {formatCents(totalCents)}</span>
                {schedule.differenceCents !== 0 && (
                  <span className="ml-2 text-[var(--warn)]" data-testid="schedule-difference">
                    {schedule.differenceCents > 0 ? `${formatCents(schedule.differenceCents)} unscheduled` : `${formatCents(-schedule.differenceCents)} over`}
                  </span>
                )}
                {schedule.finalDueOn && <span className="ml-2 faint">· final payment {schedule.finalDueOn}</span>}
                <span className="ml-2 faint" data-testid="paid-total">· {formatCents(paidCents)} paid</span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <FormError message={message.error} />
      <FormSuccess message={message.success} />

      <button type="button" onClick={save} disabled={pending} className="btn btn-primary btn-sm" data-testid="save-schedule">
        {pending ? "Saving…" : "Save schedule"}
      </button>
    </div>
  );
}

// Two <tr>s per row (the row itself and its money line) without a wrapper
// element the table would reject.
function RowGroup({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

// "Paid $600 of $1,000 · Record payment", the payments recorded so far,
// and the small form that records one more.
function MoneyLine({
  row,
  rowId,
  amountCents,
  receivedCents,
  today,
  open,
  pending,
  onOpen,
  onRecord,
  onRemove,
}: {
  row: Row;
  rowId: string;
  amountCents: number;
  receivedCents: number;
  today: string;
  open: boolean;
  pending: boolean;
  onOpen: () => void;
  onRecord: (input: { contractPaymentId: string; amountCents: number; paidOn: string; method?: string; reference?: string }) => void;
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
      {row.payments.length > 0 && (
        <ul className="space-y-0.5">
          {row.payments.map((payment) => (
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
        <RecordForm rowId={rowId} balanceCents={balance} today={today} pending={pending} onRecord={onRecord} onCancel={onOpen} />
      )}
    </div>
  );
}

function RecordForm({
  rowId,
  balanceCents,
  today,
  pending,
  onRecord,
  onCancel,
}: {
  rowId: string;
  balanceCents: number;
  today: string;
  pending: boolean;
  onRecord: (input: { contractPaymentId: string; amountCents: number; paidOn: string; method?: string; reference?: string }) => void;
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
    <div className="flex flex-wrap items-end gap-2 rounded-lg border border-[var(--border)] bg-[rgb(255_255_255/0.02)] p-2.5" data-testid="record-payment-form">
      <label className="block">
        <span className="faint block">Amount</span>
        <input className="input input-sm num w-24" value={amount} onChange={(event) => setAmount(event.target.value)} data-testid="payment-amount-input" aria-label="Payment amount" />
      </label>
      <label className="block">
        <span className="faint block">Date</span>
        <input type="date" className="input input-sm" value={paidOn} onChange={(event) => setPaidOn(event.target.value)} data-testid="payment-date" aria-label="Payment date" />
      </label>
      <label className="block">
        <span className="faint block">Method</span>
        <input className="input input-sm w-28" list="paymentMethods" value={method} onChange={(event) => setMethod(event.target.value)} placeholder="Check" data-testid="payment-method" aria-label="Payment method" />
        <datalist id="paymentMethods">
          {METHODS.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      </label>
      <label className="block">
        <span className="faint block">Reference</span>
        <input className="input input-sm w-28" value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Check #" data-testid="payment-reference" aria-label="Payment reference" />
      </label>
      <button
        type="button"
        disabled={pending || cents <= 0}
        onClick={() => onRecord({ contractPaymentId: rowId, amountCents: cents, paidOn, method: method || undefined, reference: reference || undefined })}
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
