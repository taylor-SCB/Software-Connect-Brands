"use client";

import { useMemo, useState, useTransition } from "react";
import { formatCents } from "@/lib/format";
import { lineTotalCents } from "@/lib/quote-math";
import { MAX_TRACKER_COLUMNS } from "@/lib/contracts";
import {
  PAYMENT_TERM_OPTIONS,
  SCHEDULE_PRESET_LABELS,
  computeSchedule,
  presetRows,
  type InstallmentUnit,
  type SchedulePreset,
} from "@/lib/payments";
import { TagBadge, Badge, FormError, StatusBadge } from "@/components/ui";
import { IconPlus, IconX, IconSignature } from "@/components/icons";
import type { TrackerPickers, TrackerQuote } from "@/lib/tracker";
import { createSplitContracts, setQuoteLineCancelled, type SplitInput } from "./actions";

const NEW = "__new__";

type Column = {
  key: number;
  companyId: string;
  newCompanyName: string;
  contactId: string;
  newContactName: string;
  templateId: string;
  title: string;
  paymentTerms: string;
  preset: SchedulePreset;
  start: string;
  depositPercent: number;
  count: number;
  unit: InstallmentUnit;
  selected: string[];
};

function letter(index: number) {
  return String.fromCharCode(65 + index);
}

// The split grid: the quote's rows down the side, up to five contract
// columns across the top. Each column says who the contract goes to and
// which template it uses; each tick puts that row on that contract. A
// row can sit in several columns at once (the same materials line goes
// on the customer's Sales Order and on the supplier's Purchase Order),
// and a row ticked nowhere simply stays open on the deal.
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

  function blankColumn(key: number, first: boolean): Column {
    return {
      key,
      companyId: first ? dealContact.companyId ?? "" : "",
      newCompanyName: "",
      contactId: first ? dealContact.id : "",
      newContactName: "",
      templateId:
        (first ? templateOfType("Sales Order") : templateOfType("Purchase Order")) ?? firstTemplate,
      title: "",
      paymentTerms: "Net 30",
      preset: "FULL",
      start: today,
      depositPercent: 50,
      count: 3,
      unit: "MONTH",
      selected: [],
    };
  }

  const [columns, setColumns] = useState<Column[]>(() => [blankColumn(1, true)]);
  const [nextKey, setNextKey] = useState(2);
  const [signerName, setSignerName] = useState(pickers.ownerName);
  const [error, setError] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();
  const [rowPending, startRow] = useTransition();

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

  function columnTotal(column: Column) {
    return column.selected.reduce((sum, id) => {
      const row = rowsById.get(id);
      return row ? sum + lineTotalCents(row.quantity, row.unitPriceCents) : sum;
    }, 0);
  }

  function submit() {
    setError(undefined);
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
        paymentTerms: column.paymentTerms || undefined,
        schedule: {
          preset: column.preset,
          start: column.start,
          depositPercent: column.depositPercent,
          count: column.count,
          unit: column.unit,
        },
        lineItemIds: column.selected,
      })),
    };
    startTransition(async () => {
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

  return (
    <div className="space-y-4" data-testid="tracker-grid">
      <div className="-mx-5 overflow-x-auto px-5 sm:-mx-8 sm:px-8">
        <table className="table min-w-[720px]" style={{ minWidth: `${420 + columns.length * 260}px` }}>
          <thead>
            <tr>
              <th className="whitespace-normal align-bottom" style={{ minWidth: 380 }}>
                <span className="block">Line items on QUO-{quote.number}</span>
                <span className="faint mt-1 block font-normal normal-case tracking-normal">
                  Tick a row under each contract it belongs on. A row can be on several; an unticked row stays open.
                </span>
              </th>
              {columns.map((column, index) => (
                <th key={column.key} className="align-top" style={{ minWidth: 250 }}>
                  <ColumnHeader
                    column={column}
                    index={index}
                    pickers={pickers}
                    canRemove={columns.length > 1}
                    onChange={(changes) => patch(column.key, changes)}
                    onRemove={() => removeColumn(column.key)}
                  />
                </th>
              ))}
              <th className="w-10 align-top">
                {columns.length < MAX_TRACKER_COLUMNS && (
                  <button type="button" onClick={addColumn} className="btn btn-ghost btn-sm whitespace-nowrap" data-testid="add-column">
                    <IconPlus size={13} />
                    Add contract
                  </button>
                )}
              </th>
            </tr>
          </thead>
          <tbody>
            {quote.lineItems.length === 0 && (
              <tr>
                <td colSpan={columns.length + 2} className="faint py-8 text-center text-xs">
                  This quote has no line items yet. Add some on the quote, then come back.
                </td>
              </tr>
            )}
            {quote.lineItems.map((row) => {
              const total = lineTotalCents(row.quantity, row.unitPriceCents);
              return (
                <tr key={row.id} className={row.cancelled ? "opacity-50" : ""} data-testid="tracker-row" data-line-id={row.id}>
                  <td>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium">{row.name}</p>
                        {row.description && <p className="faint truncate text-xs">{row.description}</p>}
                        <p className="num muted mt-0.5 text-xs">
                          {row.quantity} × {formatCents(row.unitPriceCents)} = <span className="font-medium text-[var(--text)]">{formatCents(total)}</span>
                        </p>
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
                      </div>
                      <button
                        type="button"
                        disabled={rowPending}
                        onClick={() => setCancelled(row.id, !row.cancelled)}
                        className="btn btn-ghost btn-sm shrink-0"
                        data-testid={row.cancelled ? "restore-row" : "cancel-row"}
                      >
                        {row.cancelled ? "Restore" : "Cancel"}
                      </button>
                    </div>
                  </td>
                  {columns.map((column) => (
                    <td key={column.key} className="text-center align-middle">
                      <input
                        type="checkbox"
                        aria-label={`Put ${row.name} on Contract ${letter(columns.indexOf(column))}`}
                        checked={column.selected.includes(row.id)}
                        disabled={row.cancelled}
                        onChange={() => toggle(column.key, row.id)}
                        className="h-4 w-4"
                      />
                    </td>
                  ))}
                  <td />
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td className="faint text-xs">
                {quote.lineItems.filter((row) => !row.cancelled && row.onContracts.length === 0).length} open ·{" "}
                {quote.lineItems.filter((row) => row.cancelled).length} cancelled
              </td>
              {columns.map((column) => (
                <td key={column.key} className="whitespace-normal text-center align-top">
                  <button type="button" onClick={() => toggleAll(column.key)} className="link text-xs">
                    {column.selected.length ? "Clear" : "Select all"}
                  </button>
                  <p className="num mt-1 text-sm font-semibold" data-testid="column-total">{formatCents(columnTotal(column))}</p>
                  <p className="faint text-xs">
                    {column.selected.length} {column.selected.length === 1 ? "row" : "rows"}
                  </p>
                  <SchedulePreview column={column} totalCents={columnTotal(column)} />
                </td>
              ))}
              <td />
            </tr>
          </tfoot>
        </table>
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

function ColumnHeader({
  column,
  index,
  pickers,
  canRemove,
  onChange,
  onRemove,
}: {
  column: Column;
  index: number;
  pickers: TrackerPickers;
  canRemove: boolean;
  onChange: (changes: Partial<Column>) => void;
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

  return (
    <div className="space-y-2 whitespace-normal text-left font-normal normal-case tracking-normal" data-testid="column-header">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-[var(--text)]">Contract {letter(index)}</span>
        {canRemove && (
          <button type="button" onClick={onRemove} className="btn btn-ghost btn-sm" aria-label={`Remove Contract ${letter(index)}`}>
            <IconX size={12} />
          </button>
        )}
      </div>

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
            aria-label={`New company for Contract ${letter(index)}`}
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
            aria-label={`New contact for Contract ${letter(index)}`}
          />
        )}
      </div>

      <div>
        <label className="label" htmlFor={id("template")}>Template</label>
        <select
          id={id("template")}
          className="select"
          value={column.templateId}
          onChange={(event) => onChange({ templateId: event.target.value })}
        >
          {pickers.templates.map((template) => (
            <option key={template.id} value={template.id}>{template.name} · {template.type}</option>
          ))}
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
        <label className="label" htmlFor={id("preset")}>Payment schedule</label>
        <select
          id={id("preset")}
          className="select"
          value={column.preset}
          onChange={(event) => onChange({ preset: event.target.value as SchedulePreset })}
        >
          {(Object.keys(SCHEDULE_PRESET_LABELS) as SchedulePreset[]).map((preset) => (
            <option key={preset} value={preset}>{SCHEDULE_PRESET_LABELS[preset]}</option>
          ))}
        </select>
        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
          {column.preset === "DEPOSIT_BALANCE" && (
            <label className="block text-xs">
              <span className="faint block">Deposit %</span>
              <input
                type="number"
                min={1}
                max={99}
                className="input input-sm num"
                value={column.depositPercent}
                onChange={(event) => onChange({ depositPercent: Number(event.target.value) || 50 })}
              />
            </label>
          )}
          {column.preset === "INSTALLMENTS" && (
            <>
              <label className="block text-xs">
                <span className="faint block">How many</span>
                <input
                  type="number"
                  min={2}
                  max={60}
                  className="input input-sm num"
                  value={column.count}
                  onChange={(event) => onChange({ count: Number(event.target.value) || 2 })}
                />
              </label>
              <label className="block text-xs">
                <span className="faint block">Every</span>
                <select
                  className="select"
                  value={column.unit}
                  onChange={(event) => onChange({ unit: event.target.value as InstallmentUnit })}
                >
                  <option value="MONTH">Month</option>
                  <option value="YEAR">Year</option>
                </select>
              </label>
            </>
          )}
          <label className="col-span-2 block text-xs">
            <span className="faint block">{column.preset === "FULL" ? "Due" : "First payment"}</span>
            <input
              type="date"
              className="input input-sm"
              value={column.start}
              onChange={(event) => onChange({ start: event.target.value })}
            />
          </label>
        </div>
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
  );
}

// What the column's payment rows will be, priced live against the
// ticked rows, so the amounts and the final date are visible before the
// contract exists.
function SchedulePreview({ column, totalCents }: { column: Column; totalCents: number }) {
  const rows = presetRows({
    preset: column.preset,
    start: column.start,
    depositPercent: column.depositPercent,
    count: column.count,
    unit: column.unit,
  });
  const schedule = computeSchedule(rows, totalCents);
  if (totalCents === 0) return null;
  return (
    <ul className="mx-auto mt-2 max-w-[230px] space-y-0.5 text-left text-[0.7rem]" data-testid="schedule-preview">
      {schedule.rows.slice(0, 4).map((row, index) => (
        <li key={index} className="flex justify-between gap-2">
          <span className="faint truncate">{row.label}</span>
          <span className="num shrink-0 text-right">
            {formatCents(row.amountCents)}
            {row.dueOn && <span className="faint block">{row.dueOn}</span>}
          </span>
        </li>
      ))}
      {schedule.rows.length > 4 && <li className="faint">… {schedule.rows.length - 4} more</li>}
    </ul>
  );
}
