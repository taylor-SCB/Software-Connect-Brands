"use client";

import { useMemo, useState, useTransition } from "react";
import { saveLineItems, type LineItemInput } from "../actions";
import { formatCents, dollarsToCents, centsToDollarInput } from "@/lib/format";
import { computeQuoteTotals, lineTotalCents } from "@/lib/quote-math";
import {
  LINE_ITEM_TAGS,
  TAG_LABELS,
  TAG_COLORS,
  type LineItemTagValue,
} from "@/lib/constants";
import { IconPlus, IconTrash } from "@/components/icons";
import { FormError, FormSuccess } from "@/components/ui";

export type EditorProduct = {
  id: string;
  name: string;
  description: string;
  unitPriceCents: number;
  defaultTag: string;
};

export type EditorLine = {
  productId: string | null;
  name: string;
  description: string;
  projectNotes: string;
  quantity: number;
  unitPriceCents: number;
  tag: string;
};

// Quantity and price live as strings while the user types so a partially
// typed "1." or "" doesn't get coerced to 0 mid-keystroke.
type Row = {
  uid: string;
  productId: string | null;
  name: string;
  description: string;
  projectNotes: string;
  quantityInput: string;
  unitPriceInput: string;
  tag: LineItemTagValue;
};

let uidCounter = 0;
const nextUid = () => `row-${(uidCounter += 1)}`;

function toRow(line: EditorLine): Row {
  return {
    uid: nextUid(),
    productId: line.productId,
    name: line.name,
    description: line.description,
    projectNotes: line.projectNotes,
    quantityInput: String(line.quantity),
    unitPriceInput: centsToDollarInput(line.unitPriceCents),
    tag: line.tag as LineItemTagValue,
  };
}

function rowQuantity(row: Row) {
  const value = Number.parseFloat(row.quantityInput);
  return Number.isFinite(value) ? value : 0;
}

function rowUnitCents(row: Row) {
  return dollarsToCents(row.unitPriceInput);
}

export function LineItemsEditor({
  quoteId,
  initialLines,
  products,
  readOnly = false,
}: {
  quoteId: string;
  initialLines: EditorLine[];
  products: EditorProduct[];
  readOnly?: boolean;
}) {
  const [rows, setRows] = useState<Row[]>(() => initialLines.map(toRow));
  const [dirty, setDirty] = useState(false);
  const [state, setState] = useState<{ error?: string; success?: string }>({});
  const [pending, startTransition] = useTransition();

  const totals = useMemo(
    () =>
      computeQuoteTotals(
        rows.map((row) => ({
          quantity: rowQuantity(row),
          unitPriceCents: rowUnitCents(row),
          tag: row.tag,
        })),
      ),
    [rows],
  );

  function mutate(next: Row[]) {
    setRows(next);
    setDirty(true);
    setState({});
  }

  function updateRow(uid: string, patch: Partial<Row>) {
    mutate(rows.map((row) => (row.uid === uid ? { ...row, ...patch } : row)));
  }

  function addBlankLine() {
    mutate([
      ...rows,
      {
        uid: nextUid(),
        productId: null,
        name: "",
        description: "",
        projectNotes: "",
        quantityInput: "1",
        unitPriceInput: "0.00",
        tag: "MATERIALS",
      },
    ]);
  }

  function addProductLine(productId: string) {
    const product = products.find((item) => item.id === productId);
    if (!product) return;
    mutate([
      ...rows,
      {
        uid: nextUid(),
        productId: product.id,
        name: product.name,
        description: product.description,
        projectNotes: "",
        quantityInput: "1",
        unitPriceInput: centsToDollarInput(product.unitPriceCents),
        tag: product.defaultTag as LineItemTagValue,
      },
    ]);
  }

  function removeRow(uid: string) {
    mutate(rows.filter((row) => row.uid !== uid));
  }

  function save() {
    const payload: LineItemInput[] = rows.map((row) => ({
      productId: row.productId,
      name: row.name.trim(),
      description: row.description.trim(),
      projectNotes: row.projectNotes.trim(),
      quantity: rowQuantity(row),
      unitPriceCents: rowUnitCents(row),
      tag: row.tag,
    }));

    const blank = payload.findIndex((line) => line.name.length === 0);
    if (blank >= 0) {
      setState({ error: `Line ${blank + 1} needs a product name.` });
      return;
    }

    startTransition(async () => {
      const result = await saveLineItems(quoteId, payload);
      setState(result);
      if (!result.error) setDirty(false);
    });
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th className="w-[42%]">Product</th>
              <th className="w-24 text-right">Qty</th>
              <th className="w-32 text-right">Value</th>
              <th className="w-32 text-right">Total</th>
              <th className="w-44">Tag</th>
              {!readOnly && <th className="w-10" />}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={readOnly ? 5 : 6} className="faint py-8 text-center text-xs">
                  No line items yet. Add one from your catalog or start a blank line.
                </td>
              </tr>
            )}

            {rows.map((row, index) => {
              const total = lineTotalCents(rowQuantity(row), rowUnitCents(row));
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
                  <td className="num pt-3 text-right font-medium">
                    {formatCents(total)}
                  </td>
                  <td>
                    <select
                      value={row.tag}
                      onChange={(event) =>
                        updateRow(row.uid, { tag: event.target.value as LineItemTagValue })
                      }
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

        <div className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-[rgb(255_255_255/0.03)] px-4 py-3">
          <span className="text-sm font-semibold">Quote total</span>
          <span className="num text-xl font-semibold">
            {formatCents(totals.totalCents)}
          </span>
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
