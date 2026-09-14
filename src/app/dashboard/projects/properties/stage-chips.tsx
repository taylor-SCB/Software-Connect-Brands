"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { PROJECT_STAGE_LABELS } from "@/lib/constants";
import { ALL_STAGES, DEFAULT_ROLLUP_STAGES, stagesToParam } from "@/lib/properties";

// Which stages count toward the roll-up. Not stored, because it is a
// judgement rather than a setting: cancelled work is money that never
// happened, and whether delayed work belongs in a total depends on why
// you are looking. It lives in the address bar so a view can be shared.
export function StageChips({ stages, basePath }: { stages: string[]; basePath: string }) {
  const router = useRouter();
  const params = useSearchParams();

  const toggle = (stage: string) => {
    const next = stages.includes(stage) ? stages.filter((value) => value !== stage) : [...stages, stage];
    // Turning them all off would show nothing at all, which is never what
    // somebody meant, so the last one stays on.
    const kept = next.length === 0 ? [stage] : next;
    const query = new URLSearchParams(params.toString());
    const value = stagesToParam(kept as never);
    if (value === null) query.delete("stages");
    else query.set("stages", value);
    const search = query.toString();
    router.push(search ? `${basePath}?${search}` : basePath);
  };

  const isDefault =
    stages.length === DEFAULT_ROLLUP_STAGES.length &&
    DEFAULT_ROLLUP_STAGES.every((stage) => stages.includes(stage));

  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="stage-chips">
      <span className="faint text-xs">Counting</span>
      {ALL_STAGES.map((stage) => {
        const on = stages.includes(stage);
        return (
          <button
            key={stage}
            type="button"
            onClick={() => toggle(stage)}
            aria-pressed={on}
            className={`btn btn-sm ${on ? "btn-primary" : "btn-ghost"}`}
            data-testid={`stage-chip-${stage}`}
          >
            {PROJECT_STAGE_LABELS[stage]}
          </button>
        );
      })}
      {!isDefault && (
        <button
          type="button"
          onClick={() => router.push(basePath)}
          className="btn btn-ghost btn-sm"
          data-testid="stage-chips-reset"
        >
          Reset
        </button>
      )}
    </div>
  );
}
