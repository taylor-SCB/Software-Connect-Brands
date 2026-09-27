"use client";

import { centsToDollarInput, formatCents } from "@/lib/format";
import { resolveDiscount } from "@/lib/quote-math";

// A discount typed as a percent or a number of dollars, with what it
// comes to shown beside it. The parent keeps the typed text and the
// mode; `discountFromInput` turns them into cents against a base.
export type DiscountState = { input: string; mode: "percent" | "cents" };

// The number typed into a discount box, or null when it is not one.
// "$1,000" and "10 %" are numbers; "abc" and "" are not; "-5" is -5.
function typedNumber(input: string): number | null {
  const cleaned = input.replace(/[$,%\s]/g, "");
  if (cleaned === "") return null;
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? value : null;
}

// The most the server accepts as a dollar discount, in cents ($10 million).
// The total caps a discount at the subtotal anyway; this only keeps a
// runaway keystroke from being refused as not-a-number.
const MAX_DISCOUNT_CENTS = 1_000_000_000;

// What to send the server for a typed discount, clamped the same way the
// screen clamps it, so what was shown is what is asked for.
export function discountPayload(state: DiscountState): { percent: number | null; cents: number } {
  const typed = typedNumber(state.input);
  // An empty box, a word, or nothing off is no discount at all — not a
  // discount of 0%, which would be stored as one and show "0" in the box
  // from then on.
  if (typed === null || typed <= 0) return { percent: null, cents: 0 };
  if (state.mode === "percent") return { percent: Math.min(typed, 100), cents: 0 };
  return { percent: null, cents: Math.min(MAX_DISCOUNT_CENTS, Math.round(typed * 100)) };
}

// Why a discount box can't be saved as typed, or null when it can. A word
// or a negative number would otherwise be saved as no discount, silently.
export function discountProblem(input: string): string | null {
  if (input.trim() === "") return null;
  const typed = typedNumber(input);
  if (typed === null) return "Discount must be a number";
  if (typed < 0) return "Discount can't be negative";
  return null;
}

// The box's state for a discount already stored: the percent when it was
// typed as one, else the dollars, else empty.
export function discountStateOf(stored: {
  discountCents: number | null | undefined;
  discountPercent: number | null | undefined;
}): DiscountState {
  if (stored.discountPercent !== null && stored.discountPercent !== undefined) {
    return { input: String(stored.discountPercent), mode: "percent" };
  }
  if (stored.discountCents) return { input: centsToDollarInput(stored.discountCents), mode: "cents" };
  return { input: "", mode: "percent" };
}

// The typed discount in the shape a stored one has, for the totals math
// (`computeQuoteTotals` takes the quote's discount this way).
export function discountAsStored(state: DiscountState): { discountCents: number; discountPercent: number | null } {
  const payload = discountPayload(state);
  return { discountCents: payload.cents, discountPercent: payload.percent };
}

// What the typed discount is worth against a base — from the same payload
// the server gets, so the preview and the stored figure always agree.
export function discountFromInput(state: DiscountState, baseCents: number) {
  return resolveDiscount(discountPayload(state), baseCents);
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
