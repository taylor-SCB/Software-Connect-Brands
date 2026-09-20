"use client";

import { useState } from "react";
import { formatCents, dollarsToCents, centsToDollarInput } from "@/lib/format";
import {
  PAYMENT_KIND_LABELS,
  PAYMENT_LABEL_OPTIONS,
  ROW_TERM_OPTIONS,
  addDays,
  computeSchedule,
  shiftDate,
  type PaymentKindValue,
  type ScheduleRowInput,
} from "@/lib/payments";
import { IconPlus, IconTrash } from "@/components/icons";

// A payment schedule being written before the contract exists: on a
// Contract Coordinator card, and on "Award without paperwork". Every row
// is editable — what it is called, a percent or a fixed amount or the
// balance, and its own due date — and the quick fills at the top only
// write rows; they never lock anything. The parent owns the rows (it
// sends them to the server when the contract is made), so this holds no
// state of its own beyond the quick-fill controls.
//
// The saved table on a quote or a contract is a different component
// (`PaymentTable`), because that one saves and records money; this one
// just describes rows that don't exist yet.

export type ScheduleRow = {
  uid: number;
  label: string;
  kind: PaymentKindValue;
  // As typed, so "33.33" survives a re-render; resolved in rowsToInputs.
  percentInput: string;
  fixedInput: string;
  // yyyy-mm-dd or "".
  dueOn: string;
  terms: string;
};

// The quick fills. Deposit + balance and Split into payments are what the
// old "preset" picker offered, with the rows they make now editable.
export type QuickFill = "__quote__" | "FULL" | "DEPOSIT_BALANCE" | "INSTALLMENTS";
export const CUSTOM_FILL = "__custom__";

export type QuickFillState = {
  fill: QuickFill | typeof CUSTOM_FILL;
  start: string;
  depositInput: string;
  depositMode: "percent" | "cents";
  balanceOn: string;
  count: number;
  every: "WEEK" | "TWO_WEEKS" | "MONTH" | "YEAR";
};

let uid = 0;
const nextUid = () => (uid += 1);

export function rowsToInputs(rows: ScheduleRow[]): ScheduleRowInput[] {
  return rows.map((row) => {
    const percent = Number.parseFloat(row.percentInput);
    return {
      label: row.label,
      kind: row.kind,
      percent: row.kind === "PERCENT" ? (Number.isFinite(percent) ? percent : 0) : null,
      fixedCents: row.kind === "FIXED" ? dollarsToCents(row.fixedInput) : null,
      dueOn: row.dueOn,
      terms: row.terms,
    };
  });
}

export function inputsToRows(inputs: ScheduleRowInput[]): ScheduleRow[] {
  return inputs.map((input) => ({
    uid: nextUid(),
    label: input.label,
    kind: input.kind,
    percentInput: input.kind === "PERCENT" && input.percent !== null ? trimPercent(input.percent) : "",
    fixedInput: input.kind === "FIXED" && input.fixedCents ? centsToDollarInput(input.fixedCents) : "",
    dueOn: input.dueOn,
    terms: input.terms ?? "",
  }));
}

// "33.33" rather than "33.333333333", "50" rather than "50.00". Four
// places, so a fixed amount carried over from the quote as a share still
// comes to the same cent on the contract it lands on.
function trimPercent(percent: number) {
  return String(Math.round(percent * 10000) / 10000);
}

function spread(start: string, index: number, every: QuickFillState["every"]): string {
  if (!start) return "";
  if (every === "WEEK") return addDays(start, 7 * index);
  if (every === "TWO_WEEKS") return addDays(start, 14 * index);
  return shiftDate(start, index, every);
}

// The rows a quick fill makes. `quoteRows` is the quote's own table, when
// it has one; a fixed amount on it is carried as the share of the quote
// it was, so a $5,000 deposit on a $10,000 quote is 50% of whatever
// slice of the quote this contract turns out to be.
export function quickFillRows(
  state: QuickFillState,
  context: { quoteRows?: ScheduleRowInput[] | null; quoteTotalCents?: number; totalCents: number },
): ScheduleRow[] {
  if (state.fill === "__quote__") {
    const quoteTotal = context.quoteTotalCents ?? 0;
    return inputsToRows(
      (context.quoteRows ?? []).map((row) =>
        row.kind === "FIXED" && quoteTotal > 0
          ? {
              ...row,
              kind: "PERCENT" as const,
              percent: ((row.fixedCents ?? 0) / quoteTotal) * 100,
              fixedCents: null,
            }
          : row,
      ),
    );
  }
  if (state.fill === "FULL") {
    return inputsToRows([
      { label: "Payment in full", kind: "BALANCE", percent: null, fixedCents: null, dueOn: state.start },
    ]);
  }
  if (state.fill === "DEPOSIT_BALANCE") {
    const typed = Number.parseFloat(state.depositInput);
    const deposit: ScheduleRowInput =
      state.depositMode === "cents"
        ? { label: "Deposit", kind: "FIXED", percent: null, fixedCents: dollarsToCents(state.depositInput), dueOn: state.start }
        : {
            label: "Deposit",
            kind: "PERCENT",
            percent: Number.isFinite(typed) ? Math.min(Math.max(typed, 0), 100) : 50,
            fixedCents: null,
            dueOn: state.start,
          };
    return inputsToRows([
      deposit,
      { label: "Balance on completion", kind: "BALANCE", percent: null, fixedCents: null, dueOn: state.balanceOn },
    ]);
  }
  if (state.fill === "INSTALLMENTS") {
    const count = Math.min(Math.max(Math.round(state.count) || 2, 2), 60);
    const each = Math.floor(10000 / count) / 100;
    return inputsToRows(
      Array.from({ length: count }, (_, index) => ({
        label: `Payment ${index + 1} of ${count}`,
        kind: index === count - 1 ? ("BALANCE" as const) : ("PERCENT" as const),
        percent: index === count - 1 ? null : each,
        fixedCents: null,
        dueOn: spread(state.start, index, state.every),
      })),
    );
  }
  return [];
}

export function ScheduleRowsEditor({
  rows,
  onChange,
  fillState,
  onFillChange,
  totalCents,
  quoteRows,
  quoteTotalCents,
  idPrefix,
  testId = "schedule-preview",
}: {
  rows: ScheduleRow[];
  // Called with the new rows and what produced them: the quick fill that
  // wrote them, or CUSTOM_FILL for a hand edit. Passed rather than read
  // back from the fill state, which the parent may not have applied yet.
  onChange: (rows: ScheduleRow[], source: QuickFillState["fill"]) => void;
  fillState: QuickFillState;
  onFillChange: (state: QuickFillState) => void;
  totalCents: number;
  quoteRows?: ScheduleRowInput[] | null;
  quoteTotalCents?: number;
  idPrefix: string;
  testId?: string;
}) {
  const [showTerms, setShowTerms] = useState(false);
  const schedule = computeSchedule(rowsToInputs(rows), totalCents);
  const id = (name: string) => `${idPrefix}-${name}`;

  // Changing any quick-fill control re-fills the rows straight away, the
  // way the old preset picker did; hand edits below then mark the table
  // custom until the next fill.
  function fill(changes: Partial<QuickFillState>) {
    const next = { ...fillState, ...changes };
    onFillChange(next);
    // Picking Custom keeps the rows as they are but they are custom from
    // here on: the parent must stop treating them as the quote's table.
    if (next.fill === CUSTOM_FILL) {
      onChange(rows, CUSTOM_FILL);
      return;
    }
    onChange(quickFillRows(next, { quoteRows, quoteTotalCents, totalCents }), next.fill);
  }

  function patch(target: number, changes: Partial<ScheduleRow>) {
    onFillChange({ ...fillState, fill: CUSTOM_FILL });
    onChange(rows.map((row) => (row.uid === target ? { ...row, ...changes } : row)), CUSTOM_FILL);
  }

  function addRow() {
    onFillChange({ ...fillState, fill: CUSTOM_FILL });
    onChange(
      [
        ...rows,
        {
          uid: nextUid(),
          label: `Payment ${rows.length + 1}`,
          kind: "FIXED",
          percentInput: "",
          fixedInput: "0.00",
          dueOn: "",
          terms: "",
        },
      ],
      CUSTOM_FILL,
    );
  }

  function removeRow(target: number) {
    onFillChange({ ...fillState, fill: CUSTOM_FILL });
    onChange(
      rows.filter((row) => row.uid !== target),
      CUSTOM_FILL,
    );
  }

  return (
    <div className="space-y-2" data-testid="schedule-editor">
      <div className="flex flex-wrap items-end gap-1.5">
        <label className="block text-xs">
          <span className="faint block">Quick fill</span>
          {/* Keeps the old preset picker's id, so the suites that pick a
              preset here still can. */}
          <select
            id={id("preset")}
            className="select input-sm !w-auto"
            value={fillState.fill}
            onChange={(event) => fill({ fill: event.target.value as QuickFillState["fill"] })}
            aria-label="Quick fill"
          >
            {quoteRows && quoteRows.length > 0 && <option value="__quote__">From the quote</option>}
            <option value="FULL">Pay in full</option>
            <option value="DEPOSIT_BALANCE">Deposit + balance</option>
            <option value="INSTALLMENTS">Split into payments</option>
            <option value={CUSTOM_FILL}>Custom</option>
          </select>
        </label>
        {fillState.fill === "DEPOSIT_BALANCE" && (
          <>
            <label className="block text-xs">
              <span className="faint block">Deposit</span>
              <span className="flex items-center gap-1">
                <input
                  id={id("depositPercent")}
                  inputMode="decimal"
                  className="input input-sm num w-20"
                  value={fillState.depositInput}
                  onChange={(event) => fill({ depositInput: event.target.value })}
                  aria-label="Deposit"
                />
                <select
                  id={id("depositMode")}
                  className="select input-sm !w-14 !px-1.5"
                  value={fillState.depositMode}
                  onChange={(event) => fill({ depositMode: event.target.value as QuickFillState["depositMode"] })}
                  aria-label="Deposit as percent or dollars"
                >
                  <option value="percent">%</option>
                  <option value="cents">$</option>
                </select>
              </span>
            </label>
            <label className="block text-xs">
              <span className="faint block">Deposit due</span>
              <input
                type="date"
                className="input input-sm !w-auto"
                value={fillState.start}
                onChange={(event) => fill({ start: event.target.value })}
                aria-label="Deposit due"
              />
            </label>
            <label className="block text-xs">
              <span className="faint block">Balance due <span className="faint">· optional</span></span>
              <input
                type="date"
                className="input input-sm !w-auto"
                value={fillState.balanceOn}
                onChange={(event) => fill({ balanceOn: event.target.value })}
                aria-label="Balance due"
              />
            </label>
          </>
        )}
        {fillState.fill === "INSTALLMENTS" && (
          <>
            <label className="block text-xs">
              <span className="faint block">How many</span>
              <input
                id={id("count")}
                type="number"
                min={2}
                max={60}
                className="input input-sm num w-16"
                value={fillState.count}
                onChange={(event) => fill({ count: Number(event.target.value) || 2 })}
                aria-label="How many payments"
              />
            </label>
            <label className="block text-xs">
              <span className="faint block">Every</span>
              <select
                className="select input-sm !w-auto"
                value={fillState.every}
                onChange={(event) => fill({ every: event.target.value as QuickFillState["every"] })}
                aria-label="How often"
              >
                <option value="WEEK">Week</option>
                <option value="TWO_WEEKS">2 weeks</option>
                <option value="MONTH">Month</option>
                <option value="YEAR">Year</option>
              </select>
            </label>
            <label className="block text-xs">
              <span className="faint block">First payment</span>
              <input
                type="date"
                className="input input-sm !w-auto"
                value={fillState.start}
                onChange={(event) => fill({ start: event.target.value })}
                aria-label="First payment"
              />
            </label>
          </>
        )}
        {fillState.fill === "FULL" && (
          <label className="block text-xs">
            <span className="faint block">Due</span>
            <input
              type="date"
              className="input input-sm !w-auto"
              value={fillState.start}
              onChange={(event) => fill({ start: event.target.value })}
              aria-label="Due"
            />
          </label>
        )}
        <button
          type="button"
          onClick={() => setShowTerms((value) => !value)}
          className="link ml-auto text-xs"
        >
          {showTerms ? "Hide terms" : "Terms per row"}
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="table table-tight text-xs" data-testid={testId}>
          <thead>
            <tr>
              <th>Payment</th>
              <th>Type</th>
              <th>Value</th>
              <th className="text-right">Amount</th>
              <th>Due</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="faint py-4 text-center text-xs">
                  No payments yet. Pick a quick fill or add a row.
                </td>
              </tr>
            )}
            {rows.map((row, index) => {
              const amount = schedule.rows[index]?.amountCents ?? 0;
              return (
                <tr key={row.uid} data-testid="schedule-row">
                  <td>
                    <input
                      className="input input-sm min-w-[7rem]"
                      list={id("label-options")}
                      value={row.label}
                      onChange={(event) => patch(row.uid, { label: event.target.value })}
                      aria-label={`Payment ${index + 1} label`}
                    />
                    {showTerms && (
                      <input
                        className="input input-sm mt-1 !text-[0.7rem]"
                        list={id("terms-options")}
                        value={row.terms}
                        onChange={(event) => patch(row.uid, { terms: event.target.value })}
                        placeholder="Net 30"
                        aria-label={`Payment ${index + 1} terms`}
                      />
                    )}
                  </td>
                  <td>
                    <select
                      className="select input-sm min-w-[6rem]"
                      value={row.kind}
                      onChange={(event) => patch(row.uid, { kind: event.target.value as PaymentKindValue })}
                      aria-label={`Payment ${index + 1} type`}
                    >
                      {(Object.keys(PAYMENT_KIND_LABELS) as PaymentKindValue[]).map((kind) => (
                        <option key={kind} value={kind}>{PAYMENT_KIND_LABELS[kind]}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {row.kind === "PERCENT" && (
                      <span className="flex items-center gap-1">
                        <input
                          inputMode="decimal"
                          className="input input-sm num w-16"
                          value={row.percentInput}
                          onChange={(event) => patch(row.uid, { percentInput: event.target.value })}
                          aria-label={`Payment ${index + 1} percent`}
                        />
                        <span className="faint">%</span>
                      </span>
                    )}
                    {row.kind === "FIXED" && (
                      <span className="flex items-center gap-1">
                        <span className="faint">$</span>
                        <input
                          inputMode="decimal"
                          className="input input-sm num w-20"
                          value={row.fixedInput}
                          onChange={(event) => patch(row.uid, { fixedInput: event.target.value })}
                          aria-label={`Payment ${index + 1} amount`}
                        />
                      </span>
                    )}
                    {row.kind === "BALANCE" && <span className="faint">what is left</span>}
                  </td>
                  <td
                    className={`num text-right font-medium ${amount < 0 ? "text-[var(--danger)]" : ""}`}
                    data-testid="schedule-amount"
                    data-negative={amount < 0 ? "1" : "0"}
                  >
                    {formatCents(amount)}
                  </td>
                  <td>
                    <input
                      type="date"
                      className="input input-sm !w-auto"
                      value={row.dueOn}
                      onChange={(event) => patch(row.uid, { dueOn: event.target.value })}
                      aria-label={`Payment ${index + 1} due date`}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      onClick={() => removeRow(row.uid)}
                      className="btn btn-icon-danger btn-sm"
                      aria-label={`Remove payment ${index + 1}`}
                    >
                      <IconTrash size={12} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3}>
                <button type="button" onClick={addRow} className="btn btn-ghost btn-sm">
                  <IconPlus size={12} />
                  Add payment
                </button>
              </td>
              <td className="num text-right font-semibold" data-testid="schedule-scheduled">
                {formatCents(schedule.scheduledCents)}
              </td>
              <td colSpan={2}>
                <span className="faint">of {formatCents(totalCents)}</span>
                {schedule.differenceCents !== 0 && (
                  <span className="ml-2 text-[var(--warn)]" data-testid="schedule-difference">
                    {schedule.differenceCents > 0
                      ? `${formatCents(schedule.differenceCents)} unscheduled`
                      : `${formatCents(-schedule.differenceCents)} over`}
                  </span>
                )}
                {schedule.finalDueOn && <span className="faint ml-2 block sm:inline">final {schedule.finalDueOn}</span>}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <datalist id={id("label-options")}>
        {PAYMENT_LABEL_OPTIONS.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
      <datalist id={id("terms-options")}>
        {ROW_TERM_OPTIONS.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
    </div>
  );
}

// What the quick-fill controls start as: the workspace's Preset Payment
// Table from Settings, or the quote's own table when it has one.
export function initialFillState(input: {
  today: string;
  hasQuoteRows: boolean;
  preset: "FULL" | "DEPOSIT_BALANCE" | "INSTALLMENTS";
  depositPercent: number;
  installmentCount: number;
}): QuickFillState {
  return {
    fill: input.hasQuoteRows ? "__quote__" : input.preset,
    start: input.today,
    depositInput: String(input.depositPercent),
    depositMode: "percent",
    balanceOn: "",
    count: input.installmentCount,
    every: "MONTH",
  };
}
