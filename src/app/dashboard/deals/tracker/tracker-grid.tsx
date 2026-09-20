"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { formatCents, dollarsToCents, centsToDollarInput } from "@/lib/format";
import { lineGrossCents, lineTotalCents } from "@/lib/quote-math";
import { MAX_TRACKER_COLUMNS } from "@/lib/contracts";
import { PAYMENT_TERM_OPTIONS, computeSchedule, type ScheduleRowInput } from "@/lib/payments";
import { DIRECTION_LABEL, directionForType, type Direction } from "@/lib/direction";
import { TagBadge, Badge, FormError, StatusBadge } from "@/components/ui";
import { IconPlus, IconX, IconSignature } from "@/components/icons";
import {
  ScheduleRowsEditor,
  initialFillState,
  quickFillRows,
  rowsToInputs,
  type QuickFillState,
  type ScheduleRow,
} from "@/components/schedule-rows-editor";
import { DiscountInput, discountFromInput, type DiscountState } from "@/components/discount-input";
import type { TrackerPickers, TrackerQuote } from "@/lib/tracker";
import { createSplitContracts, setQuoteLineCancelled, updateQuoteLine, type SplitInput } from "./actions";

const NEW = "__new__";

type Column = {
  key: number;
  companyId: string;
  newCompanyName: string;
  contactId: string;
  newContactName: string;
  templateId: string;
  title: string;
  // Which way this contract's money goes. It follows the template until
  // someone sets it by hand, and then stays put.
  direction: Direction;
  directionSet: boolean;
  paymentTerms: string;
  // Money off the whole contract, as typed.
  discount: DiscountState;
  // The payment rows as written on the card, and the quick-fill controls
  // that last wrote them.
  schedule: ScheduleRow[];
  fill: QuickFillState;
  // True while the rows are the quote's own table, untouched.
  scheduleFromQuote: boolean;
  selected: string[];
};

// A quote row's price as it is being edited here. The typed text is kept
// so "12." survives a keystroke; what was last written to the quote is
// kept beside it so a blur with nothing changed is not a save.
type LineEdit = {
  quantityInput: string;
  priceInput: string;
  discount: DiscountState;
  saved: { quantity: number; unitPriceCents: number; discountCents: number; discountPercent: number | null };
  status: "idle" | "saving" | "saved" | "error";
  error?: string;
};

function letter(index: number) {
  return String.fromCharCode(65 + index);
}

function toEdit(row: TrackerQuote["lineItems"][number]): LineEdit {
  return {
    quantityInput: String(row.quantity),
    priceInput: centsToDollarInput(row.unitPriceCents),
    discount:
      row.discountPercent !== null
        ? { input: String(row.discountPercent), mode: "percent" }
        : row.discountCents
          ? { input: centsToDollarInput(row.discountCents), mode: "cents" }
          : { input: "", mode: "percent" },
    saved: {
      quantity: row.quantity,
      unitPriceCents: row.unitPriceCents,
      discountCents: row.discountCents,
      discountPercent: row.discountPercent,
    },
    status: "idle",
  };
}

// Why a row can't be saved as typed, or null when it can. A quantity or
// price that isn't a number would otherwise be written to the quote as
// zero, which is a silent way to lose a line.
function editProblem(edit: LineEdit): string | null {
  const quantity = Number.parseFloat(edit.quantityInput);
  if (!Number.isFinite(quantity) || quantity < 0) return "Quantity must be a number";
  const price = Number.parseFloat(edit.priceInput.replace(/[$,\s]/g, ""));
  if (edit.priceInput.trim() === "" || !Number.isFinite(price)) return "Unit price must be a number";
  if (edit.discount.input.trim() !== "" && !Number.isFinite(Number.parseFloat(edit.discount.input.replace(/[$,\s]/g, "")))) {
    return "Discount must be a number";
  }
  return null;
}

// What a row is worth right now, from the boxes rather than from the
// last save, so the card totals move as someone types.
function resolveEdit(edit: LineEdit) {
  const quantity = Number.parseFloat(edit.quantityInput);
  const unitPriceCents = dollarsToCents(edit.priceInput);
  const safeQuantity = Number.isFinite(quantity) && quantity >= 0 ? quantity : 0;
  const discount = discountFromInput(edit.discount, lineGrossCents(safeQuantity, unitPriceCents));
  return { quantity: safeQuantity, unitPriceCents, ...discount };
}

// The Contract Coordinator's working area. The quote's rows run across
// the top of the page, priced and editable, with a tick column for every
// contract; below them each contract is a card of its own — who it goes
// to, which template, its discount and its payment schedule — so the
// whole width of the page is used and nothing hides off the right edge.
// A row can sit on several contracts at once (the same materials line
// goes on the customer's Sales Order and on the supplier's Purchase
// Order), and a row ticked nowhere simply stays open on the deal.
export function TrackerGrid({
  dealId,
  quote,
  dealContact,
  pickers,
  today,
  returnTo,
}: {
  dealId: string;
  quote: TrackerQuote;
  dealContact: { id: string; companyId: string | null };
  pickers: TrackerPickers;
  today: string;
  returnTo: SplitInput["returnTo"];
}) {
  const templateOfType = (type: string) => pickers.templates.find((t) => t.type === type)?.id;
  const firstTemplate = pickers.templates[0]?.id ?? "";
  const typeOfTemplate = (id: string) => pickers.templates.find((t) => t.id === id)?.type;
  const defaults = pickers.paymentDefaults;

  // The quote's own payment table, as rows a card can start from.
  const quoteRows: ScheduleRowInput[] | null =
    quote.payments.length > 0
      ? quote.payments.map((row) => ({
          label: row.label,
          kind: row.kind,
          percent: row.percent,
          fixedCents: row.kind === "FIXED" ? row.amountCents : null,
          dueOn: row.dueOn,
          terms: row.terms,
        }))
      : null;

  const [edits, setEdits] = useState<Record<string, LineEdit>>(() =>
    Object.fromEntries(quote.lineItems.map((row) => [row.id, toEdit(row)])),
  );

  // Every row's live value, from the boxes.
  const live = useMemo(() => {
    const map = new Map<string, ReturnType<typeof resolveEdit>>();
    for (const row of quote.lineItems) {
      const edit = edits[row.id];
      map.set(
        row.id,
        edit
          ? resolveEdit(edit)
          : { quantity: row.quantity, unitPriceCents: row.unitPriceCents, discountCents: row.discountCents, discountPercent: row.discountPercent },
      );
    }
    return map;
  }, [quote.lineItems, edits]);

  const lineNet = (id: string) => {
    const value = live.get(id);
    return value ? lineTotalCents(value.quantity, value.unitPriceCents, value.discountCents) : 0;
  };
  // What the quote's own payment rows are priced against, so a fixed
  // amount on the quote carries as the share of the quote it was.
  const quoteTotalCents = quote.lineItems.reduce((sum, row) => sum + lineNet(row.id), 0);

  function blankColumn(key: number, first: boolean): Column {
    const templateId =
      (first ? templateOfType("Sales Order") : templateOfType("Purchase Order")) ?? firstTemplate;
    const fill = initialFillState({
      today,
      hasQuoteRows: Boolean(quoteRows),
      preset: defaults.preset,
      depositPercent: defaults.depositPercent,
      installmentCount: defaults.installmentCount,
    });
    return {
      key,
      companyId: first ? dealContact.companyId ?? "" : "",
      newCompanyName: "",
      contactId: first ? dealContact.id : "",
      newContactName: "",
      templateId,
      title: "",
      direction: directionForType(typeOfTemplate(templateId)),
      directionSet: false,
      // The Preset Payment Table from Settings → Company Information.
      paymentTerms: defaults.terms,
      discount: { input: "", mode: "percent" },
      schedule: quickFillRows(fill, { quoteRows, quoteTotalCents, totalCents: 0 }),
      fill,
      scheduleFromQuote: fill.fill === "__quote__",
      selected: [],
    };
  }

  // Picking a different template re-reads the direction from it, unless
  // someone has already said which way this one goes.
  function pickTemplate(column: Column, templateId: string): Partial<Column> {
    return column.directionSet
      ? { templateId }
      : { templateId, direction: directionForType(typeOfTemplate(templateId)) };
  }

  const [columns, setColumns] = useState<Column[]>(() => [blankColumn(1, true)]);
  const [nextKey, setNextKey] = useState(2);
  const [signerName, setSignerName] = useState(pickers.ownerName);
  const [error, setError] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();
  const [rowPending, startRow] = useTransition();
  // Saves of row prices still in flight, awaited before contracts are
  // made so a price typed a moment ago is what goes on them.
  const inFlight = useRef(new Set<Promise<unknown>>());

  const rowsById = useMemo(() => new Map(quote.lineItems.map((item) => [item.id, item])), [quote.lineItems]);

  function patch(key: number, changes: Partial<Column>) {
    setColumns((all) => all.map((column) => (column.key === key ? { ...column, ...changes } : column)));
  }

  function toggle(key: number, lineId: string) {
    setColumns((all) =>
      all.map((column) => {
        if (column.key !== key) return column;
        const on = column.selected.includes(lineId);
        return {
          ...column,
          selected: on ? column.selected.filter((id) => id !== lineId) : [...column.selected, lineId],
        };
      }),
    );
  }

  function toggleAll(key: number) {
    const openIds = quote.lineItems.filter((item) => !item.cancelled).map((item) => item.id);
    setColumns((all) =>
      all.map((column) => {
        if (column.key !== key) return column;
        const every = openIds.every((id) => column.selected.includes(id));
        return { ...column, selected: every ? [] : openIds };
      }),
    );
  }

  function addColumn() {
    if (columns.length >= MAX_TRACKER_COLUMNS) return;
    setColumns((all) => [...all, blankColumn(nextKey, false)]);
    setNextKey((n) => n + 1);
  }

  function removeColumn(key: number) {
    setColumns((all) => (all.length > 1 ? all.filter((column) => column.key !== key) : all));
  }

  function columnSubtotal(column: Column) {
    return column.selected.reduce((sum, id) => sum + lineNet(id), 0);
  }

  function columnTotal(column: Column) {
    const subtotal = columnSubtotal(column);
    return subtotal - discountFromInput(column.discount, subtotal).discountCents;
  }

  /* ------------------------------ Row pricing ------------------------------ */

  function editRow(lineId: string, changes: Partial<LineEdit>) {
    setEdits((all) => ({ ...all, [lineId]: { ...(all[lineId] ?? toEdit(rowsById.get(lineId)!)), ...changes } }));
  }

  // Writes a row's boxes to the quote if they differ from what was last
  // saved. Returns whether the row is now in step with the quote.
  function saveRow(lineId: string): Promise<boolean> {
    const edit = edits[lineId];
    if (!edit) return Promise.resolve(true);
    const problem = editProblem(edit);
    if (problem) {
      editRow(lineId, { status: "error", error: problem });
      return Promise.resolve(false);
    }
    const next = resolveEdit(edit);
    const same =
      next.quantity === edit.saved.quantity &&
      next.unitPriceCents === edit.saved.unitPriceCents &&
      next.discountCents === edit.saved.discountCents &&
      next.discountPercent === edit.saved.discountPercent;
    if (same) return Promise.resolve(true);

    editRow(lineId, { status: "saving", error: undefined });
    const promise = updateQuoteLine({
      dealId,
      lineItemId: lineId,
      quantity: next.quantity,
      unitPriceCents: next.unitPriceCents,
      discountPercent: edit.discount.mode === "percent" ? next.discountPercent : null,
      discountCents: edit.discount.mode === "cents" ? next.discountCents : 0,
    })
      .then((result) => {
        if (result.error || !result.line) {
          editRow(lineId, { status: "error", error: result.error ?? "Couldn't save that row" });
          return false;
        }
        const line = result.line;
        editRow(lineId, {
          status: "saved",
          saved: {
            quantity: line.quantity,
            unitPriceCents: line.unitPriceCents,
            discountCents: line.discountCents,
            discountPercent: line.discountPercent,
          },
        });
        return true;
      })
      .finally(() => {
        inFlight.current.delete(promise);
      });
    inFlight.current.add(promise);
    return promise;
  }

  /* -------------------------------- Creating -------------------------------- */

  function submit() {
    setError(undefined);
    startTransition(async () => {
      // Anything typed into a row and not yet on the quote goes there
      // first, so the contracts copy the price on screen, not the old one.
      const outcomes = await Promise.all([
        ...quote.lineItems.map((row) => saveRow(row.id)),
        ...Array.from(inFlight.current),
      ]);
      if (outcomes.some((outcome) => outcome === false)) {
        setError("A row's price didn't save. Fix it above and try again.");
        return;
      }
      // The same refusal the server gives, without the round trip: a
      // table whose fixed rows add up to more than the contract.
      for (const [index, column] of columns.entries()) {
        if (column.selected.length === 0) continue;
        const over = computeSchedule(rowsToInputs(column.schedule), columnTotal(column)).rows.some(
          (row) => row.amountCents < 0,
        );
        if (over) {
          setError(`Contract ${letter(index)}: the fixed payments add up to more than the contract total. Fix the schedule on its card.`);
          return;
        }
      }
      const payload: SplitInput = {
        dealId,
        quoteId: quote.id,
        signerName,
        returnTo,
        columns: columns.map((column) => ({
          companyId: column.companyId === NEW ? undefined : column.companyId || undefined,
          newCompanyName: column.companyId === NEW ? column.newCompanyName : undefined,
          contactId: column.contactId === NEW ? undefined : column.contactId || undefined,
          newContactName: column.contactId === NEW ? column.newContactName : undefined,
          templateId: column.templateId || undefined,
          title: column.title || undefined,
          payable: column.direction === "out",
          paymentTerms: column.paymentTerms || undefined,
          discount:
            column.discount.mode === "percent"
              ? { percent: Number.parseFloat(column.discount.input) || 0, cents: 0 }
              : { percent: null, cents: dollarsToCents(column.discount.input) },
          schedule: rowsToInputs(column.schedule).map((row) => ({ ...row, terms: row.terms ?? null })),
          scheduleFromQuote: column.scheduleFromQuote,
          lineItemIds: column.selected,
        })),
      };
      const result = await createSplitContracts(payload);
      if (result?.error) setError(result.error);
    });
  }

  function setCancelled(lineId: string, cancelled: boolean) {
    const form = new FormData();
    form.set("lineItemId", lineId);
    form.set("dealId", dealId);
    form.set("cancelled", cancelled ? "true" : "false");
    // A cancelled row can't stay ticked anywhere.
    if (cancelled) {
      setColumns((all) => all.map((column) => ({ ...column, selected: column.selected.filter((id) => id !== lineId) })));
    }
    startRow(async () => {
      await setQuoteLineCancelled(form);
    });
  }

  const ticked = columns.filter((column) => column.selected.length > 0).length;
  const openCount = quote.lineItems.filter((row) => !row.cancelled && row.onContracts.length === 0).length;
  const cancelledCount = quote.lineItems.filter((row) => row.cancelled).length;

  return (
    <div className="space-y-5" data-testid="tracker-grid">
      {/* ------------------------------ The rows ------------------------------ */}
      <div className="-mx-5 overflow-x-auto px-5">
        <table className="table" data-testid="tracker-lines">
          <thead>
            <tr>
              <th className="whitespace-normal align-bottom" style={{ minWidth: 260 }}>
                <span className="block">Line items on QUO-{quote.number}</span>
                <span className="faint mt-1 block font-normal normal-case tracking-normal">
                  Change a quantity, price or discount here and it saves to the quote.
                </span>
              </th>
              <th className="text-right align-bottom">Qty</th>
              <th className="text-right align-bottom">Unit price</th>
              <th className="align-bottom">Discount</th>
              <th className="text-right align-bottom">Line total</th>
              {columns.map((column, index) => (
                <th key={column.key} className="text-center align-bottom" style={{ minWidth: 92 }}>
                  <span className="block">Contract {letter(index)}</span>
                  <button
                    type="button"
                    onClick={() => toggleAll(column.key)}
                    className="link mt-1 font-normal normal-case tracking-normal"
                  >
                    {column.selected.length ? "Clear" : "Select all"}
                  </button>
                </th>
              ))}
              <th className="w-10 align-bottom" />
            </tr>
          </thead>
          <tbody>
            {quote.lineItems.length === 0 && (
              <tr>
                <td colSpan={columns.length + 6} className="faint py-8 text-center text-xs">
                  This quote has no line items yet. Add some on the quote, then come back.
                </td>
              </tr>
            )}
            {quote.lineItems.map((row) => {
              const edit = edits[row.id] ?? toEdit(row);
              const value = live.get(row.id)!;
              const net = lineNet(row.id);
              const standing = row.onContracts.length > 0;
              return (
                <tr key={row.id} className={row.cancelled ? "opacity-50" : ""} data-testid="tracker-row" data-line-id={row.id}>
                  <td>
                    <p className="font-medium">{row.name}</p>
                    {row.description && <p className="faint truncate text-xs">{row.description}</p>}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <TagBadge tag={row.tag} />
                      {row.cancelled ? (
                        <StatusBadge status="CANCELLED" />
                      ) : row.onContracts.length === 0 ? (
                        <StatusBadge status="OPEN" />
                      ) : (
                        row.onContracts.map((contract) => (
                          <Badge key={contract.id} color={contract.status === "SIGNED" ? "#34d399" : contract.status === "SENT" ? "#38bdf8" : "#94a3b8"} dot>
                            CON-{contract.number} · {statusWord(contract.status)}
                          </Badge>
                        ))
                      )}
                    </div>
                    {standing && (
                      <p className="faint mt-1 text-[0.68rem]">
                        A contract already made from this row keeps the price it was made with.
                      </p>
                    )}
                  </td>
                  <td className="align-top">
                    <input
                      value={edit.quantityInput}
                      onChange={(event) => editRow(row.id, { quantityInput: event.target.value })}
                      onBlur={() => void saveRow(row.id)}
                      inputMode="decimal"
                      disabled={row.cancelled}
                      aria-label={`${row.name} quantity`}
                      className="input input-sm num w-16 text-right"
                      data-testid="line-quantity"
                    />
                  </td>
                  <td className="align-top">
                    <input
                      value={edit.priceInput}
                      onChange={(event) => editRow(row.id, { priceInput: event.target.value })}
                      onBlur={() => void saveRow(row.id)}
                      inputMode="decimal"
                      disabled={row.cancelled}
                      aria-label={`${row.name} unit price`}
                      className="input input-sm num w-24 text-right"
                      data-testid="line-price"
                    />
                  </td>
                  <td className="align-top" onBlur={() => void saveRow(row.id)}>
                    <DiscountInput
                      id={`line-${row.id}-discount`}
                      label={`${row.name} discount`}
                      state={edit.discount}
                      onChange={(discount) => editRow(row.id, { discount })}
                      baseCents={lineGrossCents(value.quantity, value.unitPriceCents)}
                      compact
                    />
                  </td>
                  <td className="num whitespace-nowrap text-right align-top font-medium" data-testid="line-total">
                    {formatCents(net)}
                    {edit.status === "saving" && <span className="faint block text-[0.68rem] font-normal">Saving…</span>}
                    {edit.status === "saved" && (
                      <span className="block text-[0.68rem] font-normal text-[var(--ok)]" data-testid="line-saved">
                        Saved to quote
                      </span>
                    )}
                    {edit.status === "error" && (
                      <span className="block text-[0.68rem] font-normal text-[var(--danger)]" role="alert">
                        {edit.error}
                      </span>
                    )}
                  </td>
                  {columns.map((column, index) => (
                    <td key={column.key} className="text-center align-top">
                      <input
                        type="checkbox"
                        aria-label={`Put ${row.name} on Contract ${letter(index)}`}
                        checked={column.selected.includes(row.id)}
                        disabled={row.cancelled}
                        onChange={() => toggle(column.key, row.id)}
                        className="mt-1.5 h-4 w-4"
                      />
                    </td>
                  ))}
                  <td className="align-top">
                    <button
                      type="button"
                      disabled={rowPending}
                      onClick={() => setCancelled(row.id, !row.cancelled)}
                      className="btn btn-ghost btn-sm shrink-0"
                      data-testid={row.cancelled ? "restore-row" : "cancel-row"}
                    >
                      {row.cancelled ? "Restore" : "Cancel"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4} className="faint text-xs">
                {openCount} open · {cancelledCount} cancelled
              </td>
              <td className="num text-right text-xs font-semibold" data-testid="quote-total">
                {formatCents(quoteTotalCents)}
              </td>
              {columns.map((column) => (
                <td key={column.key} className="num text-center text-xs font-semibold" data-testid="column-footer-total">
                  {formatCents(columnTotal(column))}
                  <span className="faint block font-normal">
                    {column.selected.length} {column.selected.length === 1 ? "row" : "rows"}
                  </span>
                </td>
              ))}
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* ------------------------------ The cards ------------------------------ */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">
          {columns.length === 1 ? "One contract" : `${columns.length} contracts`} from this quote
          <span className="faint ml-2 text-xs font-normal">Each card is one contract. Tick its rows in the table above.</span>
        </p>
        {columns.length < MAX_TRACKER_COLUMNS && (
          <button type="button" onClick={addColumn} className="btn btn-ghost btn-sm whitespace-nowrap" data-testid="add-column">
            <IconPlus size={13} />
            Add contract
          </button>
        )}
      </div>

      <div className={`grid gap-4 ${columns.length > 1 ? "2xl:grid-cols-2" : ""}`} data-testid="contract-cards">
        {columns.map((column, index) => (
          <ContractCard
            key={column.key}
            column={column}
            index={index}
            pickers={pickers}
            rows={quote.lineItems}
            lineNet={lineNet}
            quoteRows={quoteRows}
            quoteTotalCents={quoteTotalCents}
            canRemove={columns.length > 1}
            onChange={(changes) => patch(column.key, changes)}
            onPickTemplate={(templateId) => pickTemplate(column, templateId)}
            onUntick={(lineId) => toggle(column.key, lineId)}
            onRemove={() => removeColumn(column.key)}
          />
        ))}
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[rgb(255_255_255/0.02)] p-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="sm:w-80">
          <label className="label" htmlFor="signerName">
            Your Company Signer
          </label>
          <input
            id="signerName"
            value={signerName}
            onChange={(event) => setSignerName(event.target.value)}
            className="input"
            placeholder="Who signs for your company"
          />
          <p className="faint mt-1 text-xs">Printed under your signature line on every contract created here.</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <FormError message={error} />
          <button
            type="button"
            onClick={submit}
            disabled={pending || ticked === 0}
            className="btn btn-primary"
            data-testid="create-contracts"
          >
            <IconSignature size={14} />
            {pending
              ? "Creating…"
              : ticked === 0
                ? "Tick rows to create contracts"
                : `Create ${ticked} ${ticked === 1 ? "contract" : "contracts"}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function statusWord(status: string) {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

// One contract: who it goes to, which template, which way the money goes,
// its terms and title, the rows ticked onto it, a discount on the whole,
// and its payment schedule — priced live against the rows.
function ContractCard({
  column,
  index,
  pickers,
  rows,
  lineNet,
  quoteRows,
  quoteTotalCents,
  canRemove,
  onChange,
  onPickTemplate,
  onUntick,
  onRemove,
}: {
  column: Column;
  index: number;
  pickers: TrackerPickers;
  rows: TrackerQuote["lineItems"];
  lineNet: (id: string) => number;
  quoteRows: ScheduleRowInput[] | null;
  quoteTotalCents: number;
  canRemove: boolean;
  onChange: (changes: Partial<Column>) => void;
  onPickTemplate: (templateId: string) => Partial<Column>;
  onUntick: (lineId: string) => void;
  onRemove: () => void;
}) {
  // Contacts at the chosen company, plus people with no company at all
  // (a residential customer, or a rep not yet filed under anyone).
  const contacts = pickers.contacts.filter(
    (contact) =>
      column.companyId === NEW
        ? false
        : column.companyId
          ? contact.companyId === column.companyId || contact.companyId === null
          : true,
  );
  const id = (name: string) => `col-${column.key}-${name}`;
  const name = `Contract ${letter(index)}`;
  const subtotalCents = column.selected.reduce((sum, lineId) => sum + lineNet(lineId), 0);
  const discount = discountFromInput(column.discount, subtotalCents);
  const totalCents = subtotalCents - discount.discountCents;
  const selectedRows = column.selected.map((lineId) => rows.find((row) => row.id === lineId)).filter((row) => row !== undefined);

  return (
    <div
      className="space-y-3 rounded-xl border border-[var(--border)] bg-[rgb(255_255_255/0.02)] p-4"
      data-testid="column-header"
      data-column={letter(index)}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[var(--text)]">{name}</p>
          <p className="faint text-xs">
            {column.selected.length} {column.selected.length === 1 ? "row" : "rows"} · {DIRECTION_LABEL[column.direction]}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="num text-lg font-semibold" data-testid="column-total">{formatCents(totalCents)}</span>
          {canRemove && (
            <button type="button" onClick={onRemove} className="btn btn-ghost btn-sm" aria-label={`Remove ${name}`}>
              <IconX size={12} />
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-2.5 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={id("company")}>Company</label>
          <select
            id={id("company")}
            className="select"
            value={column.companyId}
            onChange={(event) => onChange({ companyId: event.target.value, contactId: event.target.value === NEW ? NEW : "", newContactName: "" })}
          >
            <option value="">Select a company…</option>
            {pickers.companies.map((company) => (
              <option key={company.id} value={company.id}>{company.name}</option>
            ))}
            <option value={NEW}>+ Add new company…</option>
          </select>
          {column.companyId === NEW && (
            <input
              className="input mt-1.5 block"
              placeholder="New company name"
              value={column.newCompanyName}
              onChange={(event) => onChange({ newCompanyName: event.target.value })}
              aria-label={`New company for ${name}`}
            />
          )}
        </div>

        <div>
          <label className="label" htmlFor={id("contact")}>Contact</label>
          <select
            id={id("contact")}
            className="select"
            value={column.contactId}
            onChange={(event) => onChange({ contactId: event.target.value })}
          >
            <option value="">Select a person…</option>
            {contacts.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.name}{contact.title ? ` · ${contact.title}` : ""}
              </option>
            ))}
            <option value={NEW}>+ Add new contact…</option>
          </select>
          {column.contactId === NEW && (
            <input
              className="input mt-1.5 block"
              placeholder="New contact name"
              value={column.newContactName}
              onChange={(event) => onChange({ newContactName: event.target.value })}
              aria-label={`New contact for ${name}`}
            />
          )}
        </div>

        <div>
          <label className="label" htmlFor={id("template")}>Template</label>
          <select
            id={id("template")}
            className="select"
            value={column.templateId}
            onChange={(event) => onChange(onPickTemplate(event.target.value))}
          >
            {pickers.templates.map((template) => (
              <option key={template.id} value={template.id}>{template.name} · {template.type}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor={id("direction")}>Which way the money goes</label>
          <select
            id={id("direction")}
            data-testid="column-direction"
            className="select"
            value={column.direction}
            onChange={(event) => onChange({ direction: event.target.value as Direction, directionSet: true })}
          >
            <option value="in">{DIRECTION_LABEL.in} · they pay us</option>
            <option value="out">{DIRECTION_LABEL.out} · we pay them</option>
          </select>
        </div>

        <div>
          <label className="label" htmlFor={id("terms")}>Payment terms</label>
          <select
            id={id("terms")}
            className="select"
            value={column.paymentTerms}
            onChange={(event) => onChange({ paymentTerms: event.target.value })}
          >
            {PAYMENT_TERM_OPTIONS.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor={id("title")}>Title <span className="faint font-normal">· optional</span></label>
          <input
            id={id("title")}
            className="input"
            placeholder="Uses the template name"
            value={column.title}
            onChange={(event) => onChange({ title: event.target.value })}
          />
        </div>
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[rgb(255_255_255/0.02)] p-3" data-testid="column-money">
        <div className="flex flex-wrap items-center gap-1.5" data-testid="column-rows">
          {selectedRows.length === 0 ? (
            <span className="faint text-xs">No rows yet — tick them under {name} in the table above.</span>
          ) : (
            selectedRows.map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => onUntick(row.id)}
                className="badge cursor-pointer"
                title={`Take ${row.name} off ${name}`}
                aria-label={`Take ${row.name} off ${name}`}
              >
                {row.name} · {formatCents(lineNet(row.id))}
                <IconX size={10} />
              </button>
            ))
          )}
        </div>
        <div className="mt-2 space-y-1 text-sm">
          <div className="flex items-center justify-between">
            <span className="muted text-xs">Subtotal</span>
            <span className="num" data-testid="column-subtotal">{formatCents(subtotalCents)}</span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="muted text-xs" htmlFor={id("discount")}>Discount on the whole contract</label>
            <DiscountInput
              id={id("discount")}
              label={`${name} discount`}
              state={column.discount}
              onChange={(discount) => onChange({ discount })}
              baseCents={subtotalCents}
            />
          </div>
          <div className="flex items-center justify-between border-t border-[var(--border)] pt-1.5">
            <span className="font-semibold">Total</span>
            <span className="num font-semibold">{formatCents(totalCents)}</span>
          </div>
        </div>
      </div>

      <div>
        <p className="label">Payment schedule</p>
        <ScheduleRowsEditor
          idPrefix={`col-${column.key}`}
          rows={column.schedule}
          onChange={(schedule, source) => onChange({ schedule, scheduleFromQuote: source === "__quote__" })}
          fillState={column.fill}
          onFillChange={(fill) => onChange({ fill })}
          totalCents={totalCents}
          quoteRows={quoteRows}
          quoteTotalCents={quoteTotalCents}
        />
      </div>
    </div>
  );
}
