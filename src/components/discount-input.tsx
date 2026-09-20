"use client";

import { formatCents } from "@/lib/format";
import { resolveDiscount } from "@/lib/quote-math";

// A discount typed as a percent or a number of dollars, with what it
// comes to shown beside it. The parent keeps the typed text and the
// mode; `discountFromInput` turns them into cents against a base.
export type DiscountState = { input: string; mode: "percent" | "cents" };

export function discountFromInput(state: DiscountState, baseCents: number) {
  const typed = Number.parseFloat(state.input);
  if (state.mode === "percent") {
    return resolveDiscount({ percent: Number.isFinite(typed) ? typed : null, cents: 0 }, baseCents);
  }
  const cleaned = state.input.replace(/[^0-9.]/g, "");
  const dollars = Number.parseFloat(cleaned);
  return resolveDiscount({ percent: null, cents: Number.isFinite(dollars) ? Math.round(dollars * 100) : 0 }, baseCents);
}

export function DiscountInput({
  state,
  onChange,
  baseCents,
  id,
  label,
  compact = false,
}: {
  state: DiscountState;
  onChange: (state: DiscountState) => void;
  baseCents: number;
  id: string;
  label: string;
  compact?: boolean;
}) {
  const resolved = discountFromInput(state, baseCents);
  return (
    <span className={`inline-flex gap-1 ${compact ? "flex-col items-end" : "items-center"}`}>
      <span className="inline-flex items-center gap-1">
      <input
        id={id}
        inputMode="decimal"
        className={`input input-sm num ${compact ? "w-16" : "w-20"} text-right`}
        placeholder="0"
        value={state.input}
        onChange={(event) => onChange({ ...state, input: event.target.value })}
        aria-label={label}
      />
      <select
        id={`${id}Mode`}
        className="select input-sm !w-14 !px-1.5"
        value={state.mode}
        onChange={(event) => onChange({ ...state, mode: event.target.value as DiscountState["mode"] })}
        aria-label={`${label} type`}
      >
        <option value="percent">%</option>
        <option value="cents">$</option>
      </select>
      </span>
      {resolved.discountCents > 0 && (
        <span className="num whitespace-nowrap text-xs text-[var(--ok)]" data-testid="discount-cents">−{formatCents(resolved.discountCents)}</span>
      )}
    </span>
  );
}
