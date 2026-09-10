"use client";

import { useMemo, useState, useTransition } from "react";
import { formatCents, dollarsToCents, centsToDollarInput } from "@/lib/format";
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
import { FormError, FormSuccess } from "@/components/ui";
import { IconPlus, IconTrash } from "@/components/icons";
import { savePaymentSchedule } from "@/app/dashboard/deals/tracker/actions";

export type EditorPayment = {
  label: string;
  kind: PaymentKindValue;
  percent: number | null;
  amountCents: number;
  dueOn: string;
  paid: boolean;
};

type Row = ScheduleRowInput & { uid: number; fixedInput: string; paid: boolean };

let uid = 0;

function toRow(payment: EditorPayment): Row {
  return {
    uid: (uid += 1),
    label: payment.label,
    kind: payment.kind,
    percent: payment.percent,
    fixedCents: payment.kind === "FIXED" ? payment.amountCents : null,
    fixedInput: payment.kind === "FIXED" ? centsToDollarInput(payment.amountCents) : "",
    dueOn: payment.dueOn,
    paid: payment.paid,
  };
}

// The payment table on a contract. Rows are a percent of the total, a
// fixed amount, or the balance; the amounts recompute as you type, and
// the footer shows what is scheduled against the contract total and the
// final due date. Presets fill the table in one click.
export function PaymentScheduleEditor({
  contractId,
  totalCents,
  paymentTerms,
  initialRows,
  today,
  locked,
}: {
  contractId: string;
  totalCents: number;
  paymentTerms: string;
  initialRows: EditorPayment[];
  today: string;
  // A signed contract's amounts and dates are frozen; only "paid" moves.
  locked: boolean;
}) {
  const [terms, setTerms] = useState(paymentTerms);
  const [rows, setRows] = useState<Row[]>(() => initialRows.map(toRow));
  const [preset, setPreset] = useState<SchedulePreset>("DEPOSIT_BALANCE");
  const [presetCount, setPresetCount] = useState(3);
  const [presetUnit, setPresetUnit] = useState<InstallmentUnit>("MONTH");
  const [presetStart, setPresetStart] = useState(today);
  const [message, setMessage] = useState<{ error?: string; success?: string }>({});
  const [pending, startTransition] = useTransition();

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
    setRows(
      presetRows({ preset, start: presetStart, count: presetCount, unit: presetUnit }).map((row) => ({
        ...row,
        uid: (uid += 1),
        fixedInput: "",
        paid: false,
      })),
    );
  }

  function addRow() {
    setRows((all) => [
      ...all,
      { uid: (uid += 1), label: `Payment ${all.length + 1}`, kind: "FIXED", percent: null, fixedCents: 0, fixedInput: "0.00", dueOn: "", paid: false },
    ]);
  }

  function save() {
    setMessage({});
    startTransition(async () => {
      const result = await savePaymentSchedule({
        contractId,
        paymentTerms: terms,
        rows: rows.map((row) => ({
          label: row.label,
          kind: row.kind,
          percent: row.kind === "PERCENT" ? row.percent ?? 0 : null,
          fixedCents: row.kind === "FIXED" ? dollarsToCents(row.fixedInput) : null,
          dueOn: row.dueOn,
          paid: row.paid,
        })),
      });
      setMessage(result);
    });
  }

  const paidCents = schedule.rows.reduce((sum, row, index) => sum + (rows[index]?.paid ? row.amountCents : 0), 0);

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
            disabled={locked}
            onChange={(event) => setTerms(event.target.value)}
            placeholder="Net 30"
          />
          <datalist id="paymentTermsOptions">
            {PAYMENT_TERM_OPTIONS.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
        </div>
        {!locked && (
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
          </div>
        )}
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
              {!locked && <th />}
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
            {rows.map((row, index) => (
              <tr key={row.uid} data-testid="payment-row">
                <td>
                  <input className="input input-sm min-w-[10rem]" value={row.label} disabled={locked} onChange={(event) => patch(row.uid, { label: event.target.value })} aria-label="Payment label" />
                </td>
                <td>
                  <select className="select min-w-[7.5rem]" value={row.kind} disabled={locked} onChange={(event) => patch(row.uid, { kind: event.target.value as PaymentKindValue })} aria-label="Payment type">
                    {(Object.keys(PAYMENT_KIND_LABELS) as PaymentKindValue[]).map((kind) => (
                      <option key={kind} value={kind}>{PAYMENT_KIND_LABELS[kind]}</option>
                    ))}
                  </select>
                </td>
                <td>
                  {row.kind === "PERCENT" && (
                    <div className="flex items-center gap-1">
                      <input type="number" min={0} max={100} step="0.01" className="input input-sm num w-20" value={row.percent ?? ""} disabled={locked} onChange={(event) => patch(row.uid, { percent: event.target.value === "" ? null : Number(event.target.value) })} aria-label="Percent" />
                      <span className="faint text-xs">%</span>
                    </div>
                  )}
                  {row.kind === "FIXED" && (
                    <div className="flex items-center gap-1">
                      <span className="faint text-xs">$</span>
                      <input className="input input-sm num w-24" value={row.fixedInput} disabled={locked} onChange={(event) => patch(row.uid, { fixedInput: event.target.value })} aria-label="Fixed amount" />
                    </div>
                  )}
                  {row.kind === "BALANCE" && <span className="faint text-xs">whatever is left</span>}
                </td>
                <td className="num text-right font-medium" data-testid="payment-amount">{formatCents(schedule.rows[index]?.amountCents ?? 0)}</td>
                <td>
                  <input type="date" className="input input-sm" value={row.dueOn} disabled={locked} onChange={(event) => patch(row.uid, { dueOn: event.target.value })} aria-label="Due date" />
                </td>
                <td>
                  <input type="checkbox" checked={row.paid} onChange={(event) => patch(row.uid, { paid: event.target.checked })} aria-label={`${row.label} paid`} className="h-4 w-4" />
                </td>
                {!locked && (
                  <td>
                    <button type="button" onClick={() => setRows((all) => all.filter((r) => r.uid !== row.uid))} className="btn btn-icon-danger btn-sm" aria-label={`Remove ${row.label}`}>
                      <IconTrash size={13} />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} className="text-xs">
                {!locked && (
                  <button type="button" onClick={addRow} className="btn btn-ghost btn-sm">
                    <IconPlus size={13} />
                    Add payment
                  </button>
                )}
              </td>
              <td className="num text-right text-sm font-semibold" data-testid="scheduled-total">{formatCents(schedule.scheduledCents)}</td>
              <td colSpan={locked ? 2 : 3} className="text-xs">
                <span className="faint">of {formatCents(totalCents)}</span>
                {schedule.differenceCents !== 0 && (
                  <span className="ml-2 text-[var(--warn)]" data-testid="schedule-difference">
                    {schedule.differenceCents > 0 ? `${formatCents(schedule.differenceCents)} unscheduled` : `${formatCents(-schedule.differenceCents)} over`}
                  </span>
                )}
                {schedule.finalDueOn && <span className="ml-2 faint">· final payment {schedule.finalDueOn}</span>}
                <span className="ml-2 faint">· {formatCents(paidCents)} paid</span>
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
