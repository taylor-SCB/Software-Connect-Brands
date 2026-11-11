"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { formatCents, dollarsToCents, centsToDollarInput } from "@/lib/format";
import {
  PAYMENT_KIND_LABELS,
  PAYMENT_TERM_OPTIONS,
  PAYMENT_LABEL_OPTIONS,
  ROW_TERM_OPTIONS,
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

// One payment table, used by both a quote and a contract so the two
// always behave the same way. The money half — what has actually been
// paid — belongs only to a contract and is injected by its wrapper, so a
// quote's bundle never pulls the payment actions in and nothing can
// record money against a quote.

export type PaymentTableRow = {
  // Stable handle for matching a saved id back to the right row. Not the
  // array index: a row added or removed shifts the array, and an id
  // written onto the wrong row deletes a live one on the next save.
  uid: number;
  id?: string;
  label: string;
  kind: PaymentKindValue;
  percent: number | null;
  fixedInput: string;
  dueOn: string;
  terms: string;
};

export type PaymentTableRowInput = {
  id?: string;
  label: string;
  kind: PaymentKindValue;
  percent: number | null;
  amountCents: number;
  dueOn: string;
  terms: string;
};

export type SaveRow = {
  uid: number;
  id?: string;
  label: string;
  kind: PaymentKindValue;
  percent: number | null;
  fixedCents: number | null;
  dueOn: string;
  terms: string;
};

export type SaveResult = {
  error?: string;
  success?: string;
  // uid → stored id, so a row created by this save carries its id from
  // now on instead of being deleted and recreated by the next one.
  saved?: { uid: number; id: string }[];
};

// Everything a contract adds and a quote does not have.
export type PaymentMoney = {
  pending: boolean;
  paidCents: number;
  hasPayments: (rowId: string | undefined) => boolean;
  isSettled: (rowId: string | undefined) => boolean;
  onTogglePaid: (row: PaymentTableRow, checked: boolean) => void;
  renderMoneyRow: (row: PaymentTableRow, amountCents: number) => ReactNode;
};

let uid = 0;
const nextUid = () => (uid += 1);

// On a phone (below `sm`) each payment is a block of its own — the label
// across the top, then Type / Value, Amount / Due, Paid — with its column
// name above each box, and the total under them. Scrolled sideways as a
// table, a contract's Amount, Due and the scheduled total sat off the
// screen (UX review, Nov 10, 2026).
const PHONE_CELL = "max-sm:block max-sm:border-0 max-sm:p-0";
function PhoneLabel({ children }: { children: ReactNode }) {
  return <span className="label font-sans sm:hidden">{children}</span>;
}

function toRow(input: PaymentTableRowInput): PaymentTableRow {
  return {
    uid: nextUid(),
    id: input.id,
    label: input.label,
    kind: input.kind,
    percent: input.percent,
    fixedInput: input.kind === "FIXED" ? centsToDollarInput(input.amountCents) : "",
    dueOn: input.dueOn,
    terms: input.terms ?? "",
  };
}

function freshRow(input: ScheduleRowInput): PaymentTableRow {
  return {
    uid: nextUid(),
    label: input.label,
    kind: input.kind,
    percent: input.percent,
    fixedInput: input.fixedCents ? centsToDollarInput(input.fixedCents) : "",
    dueOn: input.dueOn,
    terms: input.terms ?? "",
  };
}

export function PaymentTable({
  totalCents,
  paymentTerms,
  initialRows,
  today,
  onSave,
  money,
  saveLabel = "Save schedule",
  above,
  note,
  join,
}: {
  totalCents: number;
  paymentTerms: string;
  initialRows: PaymentTableRowInput[];
  today: string;
  onSave: (payload: { paymentTerms: string; rows: SaveRow[] }) => Promise<SaveResult>;
  // Contracts only. Absent on a quote, which takes no money.
  money?: PaymentMoney;
  saveLabel?: string;
  // Rendered above the preset bar (the quote puts Hide from Quote here).
  above?: ReactNode;
  // Rendered under the table (the contract's amended-from-quote note).
  note?: ReactNode;
  // Hands the table to a page-wide Save (the quote's, Nov 11, 2026): it
  // reports whether its rows or terms differ from what was last saved and
  // registers its save, and its own button goes. `extraDirty` is anything
  // the page keeps beside it (the quote's Hide from quote box).
  join?: {
    register: (state: { dirty: boolean; pending: boolean; save: () => Promise<boolean> }) => void;
    extraDirty?: boolean;
  };
}) {
  const [terms, setTerms] = useState(paymentTerms);
  const [rows, setRows] = useState<PaymentTableRow[]>(() => initialRows.map(toRow));
  const [preset, setPreset] = useState<SchedulePreset>("DEPOSIT_BALANCE");
  const [presetCount, setPresetCount] = useState(3);
  const [presetUnit, setPresetUnit] = useState<InstallmentUnit>("MONTH");
  const [presetStart, setPresetStart] = useState(today);
  const [message, setMessage] = useState<{ error?: string; success?: string }>({});
  const [pending, startTransition] = useTransition();
  const editedDuringSave = useRef(false);

  const schedule = useMemo(
    () =>
      computeSchedule(
        rows.map((row) => ({
          label: row.label,
          kind: row.kind,
          percent: row.percent,
          fixedCents: row.kind === "FIXED" ? dollarsToCents(row.fixedInput) : null,
          dueOn: row.dueOn,
          terms: row.terms,
        })),
        totalCents,
      ),
    [rows, totalCents],
  );

  const anyMoneyRecorded = rows.some((row) => money?.hasPayments(row.id));

  function patch(target: number, changes: Partial<PaymentTableRow>) {
    editedDuringSave.current = true;
    setRows((all) => all.map((row) => (row.uid === target ? { ...row, ...changes } : row)));
  }

  function applyPreset() {
    editedDuringSave.current = true;
    setRows(presetRows({ preset, start: presetStart, count: presetCount, unit: presetUnit }).map(freshRow));
  }

  function addRow() {
    editedDuringSave.current = true;
    setRows((all) => [
      ...all,
      {
        ...freshRow({ label: `Payment ${all.length + 1}`, kind: "FIXED", percent: null, fixedCents: 0, dueOn: "" }),
        fixedInput: "0.00",
      },
    ]);
  }

  function removeRow(target: number) {
    editedDuringSave.current = true;
    setRows((all) => all.filter((row) => row.uid !== target));
  }

  // What was last saved, to tell whether there is anything to save.
  const shape = (value: { paymentTerms: string; rows: SaveRow[] }) =>
    JSON.stringify([value.paymentTerms, value.rows.map(({ label, kind, percent, fixedCents, dueOn, terms: rowTerms }) => [label, kind, percent, fixedCents, dueOn, rowTerms])]);
  const [savedShape, setSavedShape] = useState(() => shape(currentPayload()));
  function currentPayload() {
    return {
      paymentTerms: terms,
      rows: rows.map((row) => ({
        uid: row.uid,
        id: row.id,
        label: row.label,
        kind: row.kind,
        percent: row.kind === "PERCENT" ? row.percent ?? 0 : null,
        fixedCents: row.kind === "FIXED" ? dollarsToCents(row.fixedInput) : null,
        dueOn: row.dueOn,
        terms: row.terms,
      })),
    };
  }
  const dirty = shape(currentPayload()) !== savedShape || Boolean(join?.extraDirty);

  function save(): Promise<boolean> {
    setMessage({});
    editedDuringSave.current = false;
    const payload = {
      paymentTerms: terms,
      rows: rows.map((row) => ({
        uid: row.uid,
        id: row.id,
        label: row.label,
        kind: row.kind,
        percent: row.kind === "PERCENT" ? row.percent ?? 0 : null,
        fixedCents: row.kind === "FIXED" ? dollarsToCents(row.fixedInput) : null,
        dueOn: row.dueOn,
        terms: row.terms,
      })),
    };

    return new Promise<boolean>((resolve) => startTransition(async () => {
      const result = await onSave(payload).catch(() => ({ error: "Couldn't reach the server. Nothing was saved; try again." }) as SaveResult);
      setMessage({ error: result.error, success: result.success });
      if (result.error) {
        resolve(false);
        return;
      }
      setSavedShape(shape(payload));

      // Same round-trip as the line items: without folding the stored ids
      // back, a second save sends none and every row is deleted and made
      // again — which on a contract would drop the money recorded on it.
      const byUid = new Map((result.saved ?? []).map((entry) => [entry.uid, entry.id]));
      if (byUid.size > 0) {
        setRows((current) =>
          current.map((row) => {
            const storedId = byUid.get(row.uid);
            return storedId ? { ...row, id: storedId } : row;
          }),
        );
      }
      resolve(true);
    }));
  }

  useEffect(() => {
    join?.register({ dirty, pending, save });
  });

  return (
    <div className="space-y-4 p-5" data-testid="payment-schedule">
      {above}

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
            {/* Must stay the first <select> inside payment-schedule. */}
            <select
              className="select w-auto"
              value={preset}
              onChange={(event) => setPreset(event.target.value as SchedulePreset)}
              aria-label="Preset"
            >
              {(Object.keys(SCHEDULE_PRESET_LABELS) as SchedulePreset[]).map((key) => (
                <option key={key} value={key}>
                  {SCHEDULE_PRESET_LABELS[key]}
                </option>
              ))}
            </select>
            {preset === "INSTALLMENTS" && (
              <>
                <input
                  type="number"
                  min={2}
                  max={60}
                  className="input input-sm num w-16"
                  value={presetCount}
                  onChange={(event) => setPresetCount(Number(event.target.value) || 2)}
                  aria-label="How many installments"
                />
                <select
                  className="select w-auto"
                  value={presetUnit}
                  onChange={(event) => setPresetUnit(event.target.value as InstallmentUnit)}
                  aria-label="Installment period"
                >
                  <option value="MONTH">Monthly</option>
                  <option value="YEAR">Yearly</option>
                </select>
              </>
            )}
            <input
              type="date"
              className="input input-sm w-auto"
              value={presetStart}
              onChange={(event) => setPresetStart(event.target.value)}
              aria-label="First due date"
            />
            {/* A preset replaces every row, which drops the ids — and with
                them the money recorded against those rows. The save then
                refuses and the table is stuck in a state it cannot save,
                so the button is disabled rather than merely warned about. */}
            <button
              type="button"
              onClick={applyPreset}
              disabled={anyMoneyRecorded}
              title={anyMoneyRecorded ? "Rows with payments recorded can't be replaced by a preset" : undefined}
              className="btn btn-ghost btn-sm"
              data-testid="apply-preset"
            >
              Apply
            </button>
          </div>
          {anyMoneyRecorded && (
            <p className="faint mt-1 text-xs">Rows with payments recorded can&apos;t be replaced by a preset.</p>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        {/* table-tight: the label box is wide enough for the labels the
            quote's table writes ("Final Pay — at project close"), and with
            the usual cell padding that pushed the Due column off a
            contract's card at 1440. */}
        <table className="table table-tight max-sm:block" data-testid="payment-table">
          <thead className="max-sm:hidden">
            <tr>
              <th>Payment</th>
              <th>Type</th>
              <th>Value</th>
              <th className="text-right">Amount</th>
              <th>Due</th>
              {money && <th>Paid</th>}
              <th />
            </tr>
          </thead>
          <tbody className="max-sm:block">
            {rows.length === 0 && (
              <tr className="max-sm:block">
                <td colSpan={money ? 7 : 6} className="faint py-6 text-center text-xs max-sm:block">
                  No payment schedule yet. Apply a preset or add a row.
                </td>
              </tr>
            )}
            {rows.map((row, index) => {
              const amount = schedule.rows[index]?.amountCents ?? 0;
              const locked = money?.hasPayments(row.id) ?? false;
              return (
                <Group key={row.uid}>
                  <tr
                    data-testid="payment-row"
                    className="max-sm:grid max-sm:grid-cols-2 max-sm:gap-x-3 max-sm:gap-y-2.5 max-sm:border-t max-sm:border-[var(--hairline)] max-sm:pt-4 max-sm:pb-2"
                  >
                    <td className={`${PHONE_CELL} max-sm:col-span-2`}>
                      <PhoneLabel>Payment</PhoneLabel>
                      {/* Wide enough for the labels the quote's table
                          writes itself ("Final Pay — at project close" was
                          cut to "Final Pay — at project" at 1440). */}
                      <input
                        className="input input-sm min-w-[12.5rem]"
                        list="paymentLabelOptions"
                        value={row.label}
                        onChange={(event) => patch(row.uid, { label: event.target.value })}
                        aria-label="Payment label"
                      />
                    </td>
                    <td className={PHONE_CELL}>
                      <PhoneLabel>Type</PhoneLabel>
                      {/* First <select> in the row. Keep it that way. */}
                      <select
                        className="select min-w-[6.75rem]"
                        value={row.kind}
                        onChange={(event) => patch(row.uid, { kind: event.target.value as PaymentKindValue })}
                        aria-label="Payment type"
                      >
                        {(Object.keys(PAYMENT_KIND_LABELS) as PaymentKindValue[]).map((kind) => (
                          <option key={kind} value={kind}>
                            {PAYMENT_KIND_LABELS[kind]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className={PHONE_CELL}>
                      <PhoneLabel>Value</PhoneLabel>
                      {row.kind === "PERCENT" && (
                        <div className="flex items-center gap-1">
                          {/* First input.num in the row. Keep it that way. */}
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step="0.01"
                            className="input input-sm num w-20"
                            value={row.percent ?? ""}
                            onChange={(event) =>
                              patch(row.uid, {
                                percent: event.target.value === "" ? null : Number(event.target.value),
                              })
                            }
                            aria-label="Percent"
                          />
                          <span className="faint text-xs">%</span>
                        </div>
                      )}
                      {row.kind === "FIXED" && (
                        <div className="flex items-center gap-1">
                          <span className="faint text-xs">$</span>
                          <input
                            className="input input-sm num w-24"
                            value={row.fixedInput}
                            onChange={(event) => patch(row.uid, { fixedInput: event.target.value })}
                            aria-label="Fixed amount"
                          />
                        </div>
                      )}
                      {row.kind === "BALANCE" && <span className="faint text-xs">whatever is left</span>}
                    </td>
                    <td className={`num text-right font-medium ${PHONE_CELL} max-sm:text-left`}>
                      <PhoneLabel>Amount</PhoneLabel>
                      <span data-testid="payment-amount">{formatCents(amount)}</span>
                    </td>
                    <td className={PHONE_CELL}>
                      <PhoneLabel>Due</PhoneLabel>
                      {/* The row's only input[type=date]. The terms box
                          below it is a plain text input with a datalist —
                          not a date, and not .num — so the positional
                          locators in the money suite still find the right
                          controls. */}
                      <input
                        type="date"
                        className="input input-sm"
                        value={row.dueOn}
                        onChange={(event) => patch(row.uid, { dueOn: event.target.value })}
                        aria-label="Due date"
                      />
                      <input
                        className="input input-sm mt-1 !text-[0.7rem]"
                        list="rowTermsOptions"
                        value={row.terms}
                        onChange={(event) => patch(row.uid, { terms: event.target.value })}
                        placeholder="Net 30"
                        aria-label="Payment terms for this row"
                        data-testid="row-terms"
                      />
                    </td>
                    {money && (
                      <td className={PHONE_CELL}>
                        <PhoneLabel>Paid</PhoneLabel>
                        <input
                          type="checkbox"
                          checked={money.isSettled(row.id)}
                          disabled={!row.id || money.pending}
                          title={row.id ? undefined : "Save the table first, then record payments"}
                          onChange={(event) => money.onTogglePaid(row, event.target.checked)}
                          aria-label={`${row.label} paid`}
                          className="h-4 w-4"
                          data-testid="paid-checkbox"
                        />
                      </td>
                    )}
                    <td className={`${PHONE_CELL} max-sm:self-end max-sm:text-right`}>
                      <button
                        type="button"
                        disabled={locked}
                        title={locked ? "Remove its payments first" : undefined}
                        onClick={() => removeRow(row.uid)}
                        className="btn btn-icon-danger btn-sm"
                        aria-label={`Remove ${row.label}`}
                      >
                        <IconTrash size={13} />
                      </button>
                    </td>
                  </tr>
                  {money && row.id && money.renderMoneyRow(row, amount)}
                </Group>
              );
            })}
          </tbody>
          <tfoot className="max-sm:block">
            <tr className="max-sm:flex max-sm:flex-wrap max-sm:items-baseline max-sm:gap-x-2 max-sm:gap-y-2 max-sm:border-t max-sm:border-[var(--hairline)] max-sm:pt-3">
              <td colSpan={3} className={`text-xs ${PHONE_CELL} max-sm:w-full`}>
                <button type="button" onClick={addRow} className="btn btn-ghost btn-sm">
                  <IconPlus size={13} />
                  Add payment
                </button>
              </td>
              <td className={`num text-right text-sm font-semibold ${PHONE_CELL}`} data-testid="scheduled-total">
                {formatCents(schedule.scheduledCents)}
              </td>
              <td colSpan={money ? 3 : 2} className={`text-xs ${PHONE_CELL}`}>
                <span className="faint">of {formatCents(totalCents)}</span>
                {/* Advisory, never blocking: a mismatch is worth saying out
                    loud but a half-built table still has to be savable. */}
                {schedule.differenceCents !== 0 && (
                  <span className="ml-2 text-[var(--warn)]" data-testid="schedule-difference">
                    {schedule.differenceCents > 0
                      ? `${formatCents(schedule.differenceCents)} unscheduled`
                      : `${formatCents(-schedule.differenceCents)} over`}
                  </span>
                )}
                {schedule.finalDueOn && <span className="ml-2 faint">· final payment {schedule.finalDueOn}</span>}
                {money && (
                  <span className="ml-2 faint" data-testid="paid-total">
                    · {formatCents(money.paidCents)} paid
                  </span>
                )}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <datalist id="paymentLabelOptions">
        {PAYMENT_LABEL_OPTIONS.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
      <datalist id="rowTermsOptions">
        {ROW_TERM_OPTIONS.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>

      {note}

      <FormError message={message.error} />
      <FormSuccess message={message.success} />

      {!join && (
        <button
          type="button"
          onClick={() => void save()}
          disabled={pending}
          className="btn btn-primary btn-sm"
          data-testid="save-schedule"
        >
          {pending ? "Saving…" : saveLabel}
        </button>
      )}
    </div>
  );
}

// Two <tr>s per row (the row itself and its money line) without a wrapper
// element the table would reject.
function Group({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
