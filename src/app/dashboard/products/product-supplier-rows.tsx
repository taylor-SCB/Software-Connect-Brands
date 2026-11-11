"use client";

import { createContext, useContext, useState } from "react";
import { formatCents } from "@/lib/format";
import { supplierMoney } from "@/lib/supplier-math";
import { IconChevronDown, IconStar } from "@/components/icons";

// A product's supplier sub-rows on the Products list (Release 3a): the
// product's own row stays one <tr>, and the suppliers open under it, one
// row each, only when asked for — so a page of 100 products is still 100
// rows until someone looks.

export type ListSupplier = {
  id: string;
  name: string;
  starred: boolean;
  costCents: number;
  discountBp: number;
  listPriceCents: number | null;
  minMarginBp: number | null;
};

const Open = createContext<{ open: boolean; toggle: () => void } | null>(null);

export function ProductRowGroup({
  productName,
  suppliers,
  colSpan,
  children,
}: {
  productName: string;
  suppliers: ListSupplier[];
  colSpan: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Open.Provider value={{ open, toggle: () => setOpen((was) => !was) }}>
      <tr>{children}</tr>
      {open &&
        suppliers.map((supplier) => (
          <tr key={supplier.id} className="supplier-subrow" data-testid="product-supplier-subrow">
            <td colSpan={colSpan} className="!pt-0">
              <SupplierFacts supplier={supplier} productName={productName} />
            </td>
          </tr>
        ))}
    </Open.Provider>
  );
}

/** "★ ADI · 3 suppliers ▾" under the product's name. */
export function SuppliersToggle({ starredName, count }: { starredName: string | null; count: number }) {
  const state = useContext(Open);
  if (!state) return null;
  // A product whose supplier rows haven't been written yet (they are on
  // its next save or import): its distributor, with nothing to open.
  if (count === 0) {
    return starredName ? (
      <span className="faint mt-0.5 inline-flex items-center gap-1 text-xs">
        <IconStar size={11} filled />
        <span className="muted">{starredName}</span>
      </span>
    ) : null;
  }
  return (
    <button
      type="button"
      onClick={state.toggle}
      aria-expanded={state.open}
      className="faint mt-0.5 inline-flex items-center gap-1 whitespace-nowrap text-xs hover:text-[var(--text)]"
      data-testid="product-suppliers-toggle"
    >
      {starredName && (
        <>
          <IconStar size={11} filled />
          <span className="muted">{starredName}</span>
          <span aria-hidden>·</span>
        </>
      )}
      <span>
        {count} {count === 1 ? "supplier" : "suppliers"}
      </span>
      <IconChevronDown size={12} className={state.open ? "rotate-180" : ""} />
    </button>
  );
}

function SupplierFacts({ supplier, productName }: { supplier: ListSupplier; productName: string }) {
  const money = supplierMoney(supplier);
  const discount = Math.min(Math.max(supplier.discountBp, 0), 9500);
  return (
    <div
      className="ml-3 flex flex-wrap items-baseline gap-x-5 gap-y-1 border-l border-[var(--hairline-3)] py-1 pl-3 text-xs"
      aria-label={`${supplier.name} for ${productName}`}
    >
      <span className="inline-flex items-center gap-1 font-medium">
        {supplier.starred && <IconStar size={11} filled />}
        {supplier.name}
        {supplier.starred && <span className="faint font-normal">(starred, sets your COGS)</span>}
      </span>
      <Fact label="Their price" value={formatCents(supplier.costCents)} />
      <Fact label="COGS discount" value={discount ? `${trimPercent(discount)}%` : "None"} />
      <Fact label="COGS" value={formatCents(money.cogsCents)} testId="product-supplier-subrow-cogs" />
      <Fact label="MSRP" value={supplier.listPriceCents !== null ? formatCents(supplier.listPriceCents) : "—"} />
      <Fact
        label="Minimum margin"
        value={
          supplier.minMarginBp && money.minPriceCents !== null && money.minMarginCents !== null
            ? `${trimPercent(supplier.minMarginBp)}% · ${formatCents(money.minPriceCents)} (you make ${formatCents(money.minMarginCents)})`
            : "None"
        }
        testId="product-supplier-subrow-minimum"
      />
    </div>
  );
}

function Fact({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <span data-testid={testId}>
      <span className="faint">{label} </span>
      <span className="num">{value}</span>
    </span>
  );
}

/** 1250 → "12.5", 1000 → "10". */
function trimPercent(bp: number): string {
  return (bp / 100).toFixed(2).replace(/\.?0+$/, "");
}
