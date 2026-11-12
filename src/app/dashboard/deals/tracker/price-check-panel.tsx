"use client";

import { IconFlame } from "@/components/icons";
import type { CheckProblem } from "@/lib/contract-checks";

// B1's list (Release B, Nov 12, 2026): what the price check found before
// the contracts are made, each with what to fix, and Create anyway. The
// rules' words show at once; Claude's plainer line replaces one when it
// arrives and passes its number check. Never blocks.
export function PriceCheckPanel({
  problems,
  lines,
  explaining,
  note,
  pending,
  onCreateAnyway,
  onBack,
}: {
  problems: CheckProblem[];
  lines: Record<string, string>;
  explaining: boolean;
  note?: string;
  pending: boolean;
  onCreateAnyway: () => void;
  onBack: () => void;
}) {
  return (
    <div
      role="alert"
      className="w-full rounded-lg border border-[color-mix(in_srgb,var(--warn)_45%,transparent)] bg-[color-mix(in_srgb,var(--warn)_8%,transparent)] p-3 text-left sm:max-w-xl"
      data-testid="price-check"
    >
      <p className="flex items-center gap-2 text-sm font-semibold text-[var(--text-strong)]">
        <IconFlame size={14} className="text-[var(--warn)]" />
        Check {problems.length === 1 ? "this" : `these ${problems.length}`} before you create
      </p>
      <ul className="mt-2 space-y-2">
        {problems.map((problem) => (
          <li key={problem.id} className="text-sm" data-testid="price-check-item" data-code={problem.code}>
            <span className="eyebrow mr-1">{problem.where}</span>
            <span data-testid="price-check-line" data-source={lines[problem.id] ? "ai" : "rules"}>
              {lines[problem.id] ?? problem.text}
            </span>
            <span className="muted block text-xs">{problem.fix}</span>
          </li>
        ))}
      </ul>
      {explaining && <p className="faint mt-2 text-xs" data-testid="price-check-explaining">Putting these in plain words…</p>}
      {note && <p className="faint mt-2 text-xs" data-testid="price-check-note">{note}</p>}
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onBack} className="btn btn-ghost btn-sm min-h-11 sm:min-h-0" data-testid="price-check-back">
          Go back and fix
        </button>
        <button
          type="button"
          onClick={onCreateAnyway}
          disabled={pending}
          className="btn btn-primary btn-sm min-h-11 sm:min-h-0"
          data-testid="price-check-create-anyway"
        >
          {pending ? "Creating…" : "Create anyway"}
        </button>
      </div>
    </div>
  );
}
