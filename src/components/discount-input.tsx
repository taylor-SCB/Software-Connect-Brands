"use client";

import { formatCents } from "@/lib/format";
import { resolveDiscount } from "@/lib/quote-math";

// A discount typed as a percent or a number of dollars, with what it
// comes to shown beside it. The parent keeps the typed text and the
// mode; `discountFromInput` turns them into cents against a base.
export type DiscountState = { input: string; mode: "percent" | "cents" };

// What to send the server for a typed discount: clamped the same way the
// screen clamps it, so what was shown is what is asked for.
export function discountPayload(state: DiscountState): { percent: number | null; cents: number } {
  if (state.mode === "percent") {
    const typed = Number.parseFloat(state.input);
    return { percent: Number.isFinite(typed) ? Math.min(Math.max(typed, 0), 100) : 0, cents: 0 };
  }
  const dollars = Number.parseFloat(state.input.replace(/[^0-9.]/g, ""));
  return { percent: null, cents: Number.isFinite(dollars) ? Math.max(0, Math.round(dollars * 100)) : 0 };
}

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
  disabled = false,
}: {
  state: DiscountState;
  onChange: (state: DiscountState) => void;
  baseCents: number;
  id: string;
  label: string;
  compact?: boolean;
  disabled?: boolean;
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
        disabled={disabled}
      />
      <select
        id={`${id}Mode`}
        className="select input-sm !w-14 !px-1.5"
        value={state.mode}
        onChange={(event) => onChange({ ...state, mode: event.target.value as DiscountState["mode"] })}
        aria-label={`${label} type`}
        disabled={disabled}
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
