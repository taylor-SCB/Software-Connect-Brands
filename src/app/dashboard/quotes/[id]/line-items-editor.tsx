"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { saveLineItems, type LineItemInput } from "../actions";
import { formatCents, dollarsToCents, centsToDollarInput } from "@/lib/format";
import { computeQuoteTotals, lineGrossCents, lineTotalCents, resolveDiscount, termTotalCents } from "@/lib/quote-math";
import {
  LINE_ITEM_TAGS,
  TAG_LABELS,
  TAG_COLORS,
  UNIT_GROUPS,
  UNIT_LABELS,
  SOFTWARE_RATES,
  SOFTWARE_BILLING_LABELS,
  tagHasUnits,
  unitGroupsForTag,
  type LineItemTagValue,
  type UnitOfMeasureValue,
  type SoftwareRateValue,
} from "@/lib/constants";
import { IconPlus, IconTrash } from "@/components/icons";
import { FormError, FormSuccess } from "@/components/ui";
import { SupplierCell, type SupplierOption } from "./supplier-cell";

export type EditorProduct = {
  id: string;
  name: string;
  description: string;
  unitPriceCents: number;
  defaultTag: string;
  serviceType: string | null;
  unitOfMeasure: string | null;
  softwareRate: string | null;
  softwareTerm: number | null;
};

export type EditorLine = {
  // The stored row's id, so a save keeps it (and the contract rows and
  // cancelled mark that point at it) instead of replacing it.
  id?: string | null;
  productId: string | null;
  name: string;
  description: string;
  projectNotes: string;
  quantity: number;
  unitPriceCents: number;
  // Money off this line, already in cents, and the percent it was typed
  // as when it was a percent.
  discountCents: number;
  discountPercent: number | null;
  tag: string;
  serviceType: string | null;
  supplierCompanyId: string | null;
  unitOfMeasure: string | null;
  softwareRate: string | null;
  softwareTermMonths: number | null;
};

// Quantity and price live as strings while the user types so a partially
// typed "1." or "" doesn't get coerced to 0 mid-keystroke.
type Row = {
  uid: string;
  id: string | null;
  productId: string | null;
  name: string;
  description: string;
  projectNotes: string;
  quantityInput: string;
  unitPriceInput: string;
  // The discount as typed, and whether it is a percent or dollars off.
  discountInput: string;
  discountMode: "percent" | "cents";
  tag: LineItemTagValue;
  // Which kind of work the row is, when the quote is split that way.
  serviceType: string;
  // Who we buy it from. Never leaves the workspace.
  supplierCompanyId: string | null;
  unitOfMeasure: string;
  softwareRate: string;
  // Typed as two boxes and stored as one number of months.
  termYearsInput: string;
  termMonthsInput: string;
  // Whether saving the quote should also put this line in the catalog.
  // Only ever offered for a line typed by hand that has never been saved.
  saveAsProduct: boolean;
};

let uidCounter = 0;
const nextUid = () => `row-${(uidCounter += 1)}`;

function splitTerm(months: number | null | undefined) {
  if (!months || months <= 0) return { years: "", months: "" };
  return {
    years: Math.floor(months / 12) ? String(Math.floor(months / 12)) : "",
    months: months % 12 ? String(months % 12) : "",
  };
}

function rowTermMonths(row: Row) {
  const years = Number.parseInt(row.termYearsInput, 10);
  const months = Number.parseInt(row.termMonthsInput, 10);
  const total = (Number.isFinite(years) ? years : 0) * 12 + (Number.isFinite(months) ? months : 0);
  return total > 0 ? total : null;
}

function toRow(line: EditorLine): Row {
  const term = splitTerm(line.softwareTermMonths);
  return {
    uid: nextUid(),
    id: line.id ?? null,
    productId: line.productId,
    name: line.name,
    description: line.description,
    projectNotes: line.projectNotes,
    quantityInput: String(line.quantity),
    unitPriceInput: centsToDollarInput(line.unitPriceCents),
    discountInput:
      line.discountPercent !== null
        ? String(line.discountPercent)
        : line.discountCents
          ? centsToDollarInput(line.discountCents)
          : "",
    discountMode: line.discountPercent !== null || !line.discountCents ? "percent" : "cents",
    tag: line.tag as LineItemTagValue,
    serviceType: line.serviceType ?? "",
    supplierCompanyId: line.supplierCompanyId,
    unitOfMeasure: line.unitOfMeasure ?? "",
    softwareRate: line.softwareRate ?? "",
    termYearsInput: term.years,
    termMonthsInput: term.months,
    // Off for anything loaded from the database. A line typed by hand and
    // already saved comes back with productId null too, so productId alone
    // is not a reliable "typed by hand" signal — it would re-offer the tick
    // on every visit to an old quote.
    saveAsProduct: false,
  };
}

function rowQuantity(row: Row) {
  const value = Number.parseFloat(row.quantityInput);
  return Number.isFinite(value) ? value : 0;
}

function rowUnitCents(row: Row) {
  return dollarsToCents(row.unitPriceInput);
}

// The typed discount worked out against the line as it stands now.
function rowDiscount(row: Row) {
  const typed = Number.parseFloat(row.discountInput);
  const gross = lineGrossCents(rowQuantity(row), rowUnitCents(row));
  if (row.discountMode === "percent") {
    return resolveDiscount({ percent: Number.isFinite(typed) ? typed : null, cents: 0 }, gross);
  }
  return resolveDiscount({ percent: null, cents: dollarsToCents(row.discountInput) }, gross);
}

export function LineItemsEditor({
  quoteId,
  initialLines,
  products,
  serviceTypes,
  suppliers,
  readOnly = false,
}: {
  quoteId: string;
  initialLines: EditorLine[];
  products: EditorProduct[];
  // The workspace's kinds of work, for splitting the quote by scope.
  serviceTypes: string[];
  // Companies tagged Distributor, plus any already linked to a line here.
  suppliers: SupplierOption[];
  readOnly?: boolean;
}) {
  const [rows, setRows] = useState<Row[]>(() => initialLines.map(toRow));
  // Grows when someone adds a distributor from inside a row, so every row's
  // picker sees it without a page reload.
  const [supplierOptions, setSupplierOptions] = useState<SupplierOption[]>(suppliers);
  // Off until it is wanted: a one-trade business never sees the column.
  // On by itself when the quote already has a service type on a row.
  const [splitByService, setSplitByService] = useState(() =>
    initialLines.some((line) => Boolean(line.serviceType)),
  );
  const [dirty, setDirty] = useState(false);
  const [state, setState] = useState<{ error?: string; success?: string }>({});
  const [pending, startTransition] = useTransition();
  // Set by any edit made while a save is in flight, so finishing that save
  // doesn't clear "Unsaved changes" on work it never sent.
  const editedDuringSave = useRef(false);

  const totals = useMemo(
    () =>
      computeQuoteTotals(
        rows.map((row) => ({
          quantity: rowQuantity(row),
          unitPriceCents: rowUnitCents(row),
          discountCents: rowDiscount(row).discountCents,
          tag: row.tag,
        })),
      ),
    [rows],
  );

  function mutate(next: Row[]) {
    setRows(next);
    setDirty(true);
    editedDuringSave.current = true;
    setState({});
  }

  // Applied to whatever the rows are NOW, not to the array captured when
  // the handler was created. Adding a supplier is a server round trip, and
  // its callback fires long after: mapping a stale array there replaced the
  // whole table and threw away anything typed while it ran.
  function updateRow(uid: string, patch: Partial<Row>) {
    setRows((current) => current.map((row) => (row.uid === uid ? { ...row, ...patch } : row)));
    setDirty(true);
    editedDuringSave.current = true;
    setState({});
  }

  function addBlankLine() {
    mutate([
      ...rows,
      {
        uid: nextUid(),
        id: null,
        productId: null,
        name: "",
        description: "",
        projectNotes: "",
        quantityInput: "1",
        unitPriceInput: "0.00",
        discountInput: "",
        discountMode: "percent",
        tag: "MATERIALS",
        serviceType: "",
        supplierCompanyId: null,
        unitOfMeasure: "",
        softwareRate: "",
        termYearsInput: "",
        termMonthsInput: "",
        // Typed once, kept forever — the default Taylor asked for.
        saveAsProduct: true,
      },
    ]);
  }

  function addProductLine(productId: string) {
    const product = products.find((item) => item.id === productId);
    if (!product) return;
    const term = splitTerm(
      product.softwareRate === "PER_MONTH"
        ? product.softwareTerm
        : product.softwareRate === "PER_YEAR" && product.softwareTerm
          ? product.softwareTerm * 12
          : product.softwareTerm,
    );
    mutate([
      ...rows,
      {
        uid: nextUid(),
        id: null,
        productId: product.id,
        name: product.name,
        description: product.description,
        projectNotes: "",
        quantityInput: "1",
        unitPriceInput: centsToDollarInput(product.unitPriceCents),
        discountInput: "",
        discountMode: "percent",
        tag: product.defaultTag as LineItemTagValue,
        // The catalog already knows what kind of work it is.
        serviceType: product.serviceType ?? "",
        supplierCompanyId: null,
        unitOfMeasure: product.unitOfMeasure ?? "",
        softwareRate: product.softwareRate ?? "",
        termYearsInput: term.years,
        termMonthsInput: term.months,
        // It is already in the catalog; that is where it came from.
        saveAsProduct: false,
      },
    ]);
  }

  // Changing the tag changes which units are legal, so a unit left over
  // from the old tag has to go — the server would null it anyway, and the
  // row would keep showing something nobody can see the source of.
  function changeTag(uid: string, tag: LineItemTagValue) {
    const row = rows.find((item) => item.uid === uid);
    if (!row) return;
    const stillLegal =
      row.unitOfMeasure &&
      unitGroupsForTag(tag).some((group) =>
        (UNIT_GROUPS[group] as readonly string[]).includes(row.unitOfMeasure),
      );
    updateRow(uid, {
      tag,
      unitOfMeasure: stillLegal ? row.unitOfMeasure : "",
      ...(tag === "SOFTWARE" ? {} : { softwareRate: "", termYearsInput: "", termMonthsInput: "" }),
    });
  }

  function addSupplierOption(option: SupplierOption) {
    setSupplierOptions((current) =>
      current.some((item) => item.id === option.id) ? current : [...current, option],
    );
  }

  function removeRow(uid: string) {
    mutate(rows.filter((row) => row.uid !== uid));
  }

  function save() {
    const payload: LineItemInput[] = rows.map((row) => ({
      id: row.id,
      uid: row.uid,
      productId: row.productId,
      name: row.name.trim(),
      description: row.description.trim(),
      projectNotes: row.projectNotes.trim(),
      quantity: rowQuantity(row),
      unitPriceCents: rowUnitCents(row),
      discountPercent: rowDiscount(row).discountPercent,
      discountCents: rowDiscount(row).discountCents,
      tag: row.tag,
      serviceType: splitByService ? row.serviceType.trim() || null : null,
      supplierCompanyId: row.supplierCompanyId,
      // The select only ever holds a value from the lists above or "", and
      // the server re-checks the pairing against the tag regardless.
      unitOfMeasure: (row.unitOfMeasure || null) as UnitOfMeasureValue | null,
      softwareRate: row.tag === "SOFTWARE" ? ((row.softwareRate || null) as SoftwareRateValue | null) : null,
      softwareTermMonths: row.tag === "SOFTWARE" ? rowTermMonths(row) : null,
      saveAsProduct: row.saveAsProduct && !row.id && !row.productId,
    }));

    const blank = payload.findIndex((line) => line.name.length === 0);
    if (blank >= 0) {
      setState({ error: `Line ${blank + 1} needs a product name.` });
      return;
    }

    editedDuringSave.current = false;
    startTransition(async () => {
      const result = await saveLineItems(quoteId, payload);
      setState({ error: result.error, success: result.success });
      if (result.error) return;

      // Take on the ids the save just handed back, matched by uid rather
      // than position: a row added or deleted mid-save shifts the array,
      // and writing an id onto the wrong row deletes a live one next time.
      const savedByUid = new Map((result.lines ?? []).map((line) => [line.uid, line]));
      setRows((current) =>
        current.map((row) => {
          const saved = savedByUid.get(row.uid);
          // saveAsProduct goes off once the row is stored: it is an
          // offer made about a brand-new line, not a standing setting.
          return saved
            ? { ...row, id: saved.id, productId: saved.productId, saveAsProduct: false }
            : row;
        }),
      );
      if (!editedDuringSave.current) setDirty(false);
    });
  }

  return (
    <div>
      {!readOnly && (
        <label className="mb-3 flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={splitByService}
            onChange={(event) => {
              setSplitByService(event.target.checked);
              setDirty(true);
              // Same as any row edit: a save already in flight was built
              // before this, so finishing it must not clear "Unsaved
              // changes" on a toggle it never sent.
              editedDuringSave.current = true;
            }}
            data-testid="split-by-service-type"
          />
          <span className="muted">
            Split by service type — give each kind of work its own budget on the job
          </span>
        </label>
      )}
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th className="w-[42%]">Product</th>
              <th className="w-24 text-right">Qty</th>
              <th className="w-32 text-right">Value</th>
              <th className="w-36 text-right">Discount</th>
              <th className="w-32 text-right">Total</th>
              <th className="w-44">Tag</th>
              {/* Internal. Never rendered on the customer's copy. */}
              <th className="w-44">Supplier / Contractor</th>
              {splitByService && <th className="w-44">Service type</th>}
              {!readOnly && <th className="w-10" />}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={(readOnly ? 7 : 8) + (splitByService ? 1 : 0)} className="faint py-8 text-center text-xs">
                  No line items yet. Add one from your catalog or start a blank line.
                </td>
              </tr>
            )}

            {rows.map((row, index) => {
              const discount = rowDiscount(row);
              const total = lineTotalCents(rowQuantity(row), rowUnitCents(row), discount.discountCents);
              const termTotal =
                row.tag === "SOFTWARE"
                  ? termTotalCents(
                      rowQuantity(row),
                      rowUnitCents(row),
                      row.softwareRate || null,
                      rowTermMonths(row),
                    )
                  : null;
              return (
                <tr key={row.uid} className="align-top">
                  <td>
                    <input
                      value={row.name}
                      onChange={(event) =>
                        updateRow(row.uid, { name: event.target.value })
                      }
                      placeholder="Product or service"
                      aria-label={`Line ${index + 1} product`}
                      disabled={readOnly}
                      className="input input-sm font-medium"
                    />
                    {/* Sub note 1 */}
                    <input
                      value={row.description}
                      onChange={(event) =>
                        updateRow(row.uid, { description: event.target.value })
                      }
                      placeholder="Product description"
                      aria-label={`Line ${index + 1} product description`}
                      disabled={readOnly}
                      className="input input-sm mt-1 border-transparent bg-transparent text-xs text-[var(--text-dim)]"
                    />
                    {/* Sub note 2 */}
                    <input
                      value={row.projectNotes}
                      onChange={(event) =>
                        updateRow(row.uid, { projectNotes: event.target.value })
                      }
                      placeholder="Project specific notes"
                      aria-label={`Line ${index + 1} project specific notes`}
                      disabled={readOnly}
                      className="input input-sm mt-1 border-transparent bg-transparent text-xs italic text-[var(--text-faint)]"
                    />

                    {/* Only for a brand-new hand-typed line. A line that
                        was typed and already saved comes back with no
                        product id too, so this would otherwise re-offer
                        itself on every visit to an old quote. */}
                    {!readOnly && row.id === null && row.productId === null && (
                      <label className="mt-1.5 flex items-center gap-1.5 text-[0.68rem]">
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5"
                          checked={row.saveAsProduct}
                          onChange={(event) =>
                            updateRow(row.uid, { saveAsProduct: event.target.checked })
                          }
                          aria-label={`Line ${index + 1} save as product`}
                          data-testid="save-as-product"
                        />
                        <span className="muted">Save as product?</span>
                      </label>
                    )}

                    {tagHasUnits(row.tag) && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1">
                        <select
                          value={row.unitOfMeasure}
                          onChange={(event) =>
                            updateRow(row.uid, { unitOfMeasure: event.target.value })
                          }
                          aria-label={`Line ${index + 1} unit`}
                          disabled={readOnly}
                          className="select input-sm !h-7 !py-0 !text-[0.68rem]"
                          data-testid="line-unit"
                        >
                          <option value="">Unit…</option>
                          {unitGroupsForTag(row.tag).flatMap((group) =>
                            (UNIT_GROUPS[group] as readonly string[]).map((unit) => (
                              <option key={unit} value={unit}>
                                {UNIT_LABELS[unit as UnitOfMeasureValue]}
                              </option>
                            )),
                          )}
                        </select>

                        {row.tag === "SOFTWARE" && (
                          <>
                            <select
                              value={row.softwareRate}
                              onChange={(event) =>
                                updateRow(row.uid, { softwareRate: event.target.value })
                              }
                              aria-label={`Line ${index + 1} billing`}
                              disabled={readOnly}
                              className="select input-sm !h-7 !py-0 !text-[0.68rem]"
                              data-testid="line-billing"
                            >
                              {/* Blank first, so a line with no rate set
                                  doesn't display one it never had and then
                                  write it on the next save. */}
                              <option value="">Billing…</option>
                              {SOFTWARE_RATES.map((rate) => (
                                <option key={rate} value={rate}>
                                  {SOFTWARE_BILLING_LABELS[rate as SoftwareRateValue]}
                                </option>
                              ))}
                            </select>
                            <input
                              value={row.termYearsInput}
                              onChange={(event) =>
                                updateRow(row.uid, { termYearsInput: event.target.value })
                              }
                              inputMode="numeric"
                              placeholder="yr"
                              aria-label={`Line ${index + 1} term years`}
                              disabled={readOnly}
                              className="input input-sm num !h-7 !w-11 !py-0 !text-[0.68rem]"
                            />
                            <input
                              value={row.termMonthsInput}
                              onChange={(event) =>
                                updateRow(row.uid, { termMonthsInput: event.target.value })
                              }
                              inputMode="numeric"
                              placeholder="mo"
                              aria-label={`Line ${index + 1} term months`}
                              disabled={readOnly}
                              className="input input-sm num !h-7 !w-11 !py-0 !text-[0.68rem]"
                            />
                          </>
                        )}
                      </div>
                    )}
                  </td>
                  <td>
                    <input
                      value={row.quantityInput}
                      onChange={(event) =>
                        updateRow(row.uid, { quantityInput: event.target.value })
                      }
                      inputMode="decimal"
                      aria-label={`Line ${index + 1} quantity`}
                      disabled={readOnly}
                      className="input input-sm num text-right"
                    />
                  </td>
                  <td>
                    <input
                      value={row.unitPriceInput}
                      onChange={(event) =>
                        updateRow(row.uid, { unitPriceInput: event.target.value })
                      }
                      inputMode="decimal"
                      aria-label={`Line ${index + 1} unit value`}
                      disabled={readOnly}
                      className="input input-sm num text-right"
                    />
                  </td>
                  <td>
                    <div className="flex items-center justify-end gap-1">
                      <input
                        value={row.discountInput}
                        onChange={(event) => updateRow(row.uid, { discountInput: event.target.value })}
                        inputMode="decimal"
                        placeholder="0"
                        aria-label={`Line ${index + 1} discount`}
                        disabled={readOnly}
                        className="input input-sm num w-20 text-right"
                        data-testid="line-discount"
                      />
                      <select
                        value={row.discountMode}
                        onChange={(event) => updateRow(row.uid, { discountMode: event.target.value as Row["discountMode"] })}
                        aria-label={`Line ${index + 1} discount type`}
                        disabled={readOnly}
                        className="select input-sm !w-14 !px-1.5"
                      >
                        <option value="percent">%</option>
                        <option value="cents">$</option>
                      </select>
                    </div>
                    {discount.discountCents > 0 && (
                      <p className="num mt-1 text-right text-[0.68rem] text-[var(--ok)]" data-testid="line-discount-cents">
                        −{formatCents(discount.discountCents)}
                      </p>
                    )}
                  </td>
                  <td className="num pt-3 text-right font-medium">
                    {formatCents(total)}
                    {/* What the line comes to over its whole term, so the
                        unit, the billing period and the term can be checked
                        against each other. Not part of the quote total. */}
                    {termTotal !== null && termTotal !== total && (
                      <span
                        className="faint block text-[0.68rem] font-normal"
                        data-testid="line-term-total"
                      >
                        {formatCents(termTotal)} term
                      </span>
                    )}
                  </td>
                  <td>
                    <select
                      value={row.tag}
                      onChange={(event) => changeTag(row.uid, event.target.value as LineItemTagValue)}
                      aria-label={`Line ${index + 1} tag`}
                      disabled={readOnly}
                      className="select input-sm"
                      style={{ color: TAG_COLORS[row.tag] }}
                    >
                      {LINE_ITEM_TAGS.map((tag) => (
                        <option key={tag} value={tag}>
                          {TAG_LABELS[tag]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <SupplierCell
                      value={row.supplierCompanyId}
                      options={supplierOptions}
                      onChange={(companyId) => updateRow(row.uid, { supplierCompanyId: companyId })}
                      onOptionAdded={addSupplierOption}
                      label={`Line ${index + 1} supplier`}
                      disabled={readOnly}
                    />
                  </td>
                  {splitByService && (
                    <td>
                      <select
                        value={row.serviceType}
                        onChange={(event) => updateRow(row.uid, { serviceType: event.target.value })}
                        aria-label={`Line ${index + 1} service type`}
                        disabled={readOnly}
                        className="select input-sm"
                        data-testid="line-service-type"
                      >
                        <option value="">Whole job</option>
                        {serviceTypes.map((name) => (
                          <option key={name} value={name}>{name}</option>
                        ))}
                      </select>
                    </td>
                  )}
                  {!readOnly && (
                    <td className="pt-2.5">
                      <button
                        type="button"
                        onClick={() => removeRow(row.uid)}
                        aria-label={`Delete line ${index + 1}`}
                        className="btn btn-ghost btn-sm !px-1.5"
                      >
                        <IconTrash size={13} />
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] px-5 py-3">
          <select
            value=""
            onChange={(event) => {
              if (event.target.value) addProductLine(event.target.value);
            }}
            aria-label="Add product from catalog"
            className="select input-sm w-56"
          >
            <option value="">Add from catalog…</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name} · {formatCents(product.unitPriceCents)}
              </option>
            ))}
          </select>
          <button type="button" onClick={addBlankLine} className="btn btn-ghost btn-sm">
            <IconPlus size={13} />
            Blank line
          </button>

          <div className="ml-auto flex items-center gap-3">
            {dirty && <span className="faint text-xs">Unsaved changes</span>}
            <button
              type="button"
              onClick={save}
              disabled={pending || !dirty}
              className="btn btn-primary btn-sm"
            >
              {pending ? "Saving…" : "Save line items"}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3 border-t border-[var(--border)] p-5">
        <FormError message={state.error} />
        <FormSuccess message={state.success} />

        <div className="rounded-xl border border-[var(--border)] bg-[rgb(255_255_255/0.03)] px-4 py-3">
          {totals.discountCents > 0 && (
            <div className="faint mb-1 flex items-center justify-between text-xs" data-testid="quote-discount-line">
              <span>Subtotal {formatCents(totals.grossCents)}</span>
              <span className="num text-[var(--ok)]">Discounts −{formatCents(totals.discountCents)}</span>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">Quote total</span>
            <span className="num text-xl font-semibold" data-testid="quote-total">
              {formatCents(totals.totalCents)}
            </span>
          </div>
        </div>

        {/* Tag rollup — always adds up to the quote total above. */}
        <div>
          <p className="eyebrow mb-2">Totals by tag</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {LINE_ITEM_TAGS.map((tag) => (
              <div
                key={tag}
                className="rounded-lg border px-3 py-2"
                style={{
                  borderColor: `color-mix(in srgb, ${TAG_COLORS[tag]} 28%, transparent)`,
                  background: `color-mix(in srgb, ${TAG_COLORS[tag]} 8%, transparent)`,
                }}
              >
                <p
                  className="text-[0.68rem] font-semibold"
                  style={{ color: TAG_COLORS[tag] }}
                >
                  {TAG_LABELS[tag]}
                </p>
                <p className="num mt-0.5 text-sm font-medium">
                  {formatCents(totals.byTag[tag])}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
