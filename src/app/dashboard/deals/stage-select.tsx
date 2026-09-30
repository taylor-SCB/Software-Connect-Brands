"use client";

import { useState, useTransition } from "react";
import { updateDealStage } from "./actions";
import { BOARD_DEAL_STAGES, DEAL_STAGE_LABELS, type DealStageValue } from "@/lib/constants";

// A deal's stage on its pipeline tile. Moving it by hand asks the day it
// happened (Stats measures from it), today unless changed. The current
// stage is always among the options — an Archived deal shows Archived
// rather than silently reading as the first choice.
export function StageSelect({ dealId, stage, today }: { dealId: string; stage: string; today: string }) {
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(stage);
  const [asking, setAsking] = useState<string | null>(null);
  const [on, setOn] = useState(today);
  const [error, setError] = useState<string | undefined>();

  const options = (BOARD_DEAL_STAGES as readonly string[]).includes(stage) ? [...BOARD_DEAL_STAGES] : [stage, ...BOARD_DEAL_STAGES];

  function save(next: string) {
    const previous = value;
    setValue(next);
    setError(undefined);
    startTransition(async () => {
      const result = await updateDealStage(dealId, next, on);
      // Roll the control back rather than showing a stage the database
      // never accepted.
      if (result?.error) {
        setValue(previous);
        setError(result.error);
      }
      setAsking(null);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <select
        value={asking ?? value}
        disabled={pending}
        aria-label="Deal stage"
        title={error}
        onChange={(event) => {
          setOn(today);
          setAsking(event.target.value === value ? null : event.target.value);
        }}
        className={`select input-sm w-36 ${error ? "border-[var(--danger)]" : ""}`}
        data-testid="deal-stage"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {DEAL_STAGE_LABELS[option as DealStageValue] ?? option}
          </option>
        ))}
      </select>
      {asking && (
        <div className="flex items-center gap-1" data-testid="deal-stage-date">
          <input
            type="date"
            value={on}
            max={today}
            onChange={(event) => setOn(event.target.value)}
            aria-label="The day it happened"
            className="input input-sm w-36"
          />
          <button type="button" onClick={() => save(asking)} disabled={pending || !on} className="btn btn-primary btn-sm">
            Save
          </button>
          <button type="button" onClick={() => setAsking(null)} className="btn btn-ghost btn-sm">
            ×
          </button>
        </div>
      )}
      {error && <p className="text-[0.66rem] text-[var(--danger)]">{error}</p>}
    </div>
  );
}
