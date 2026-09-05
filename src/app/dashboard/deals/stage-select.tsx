"use client";

import { useState, useTransition } from "react";
import { updateDealStage } from "./actions";
import { DEAL_STAGES, DEAL_STAGE_LABELS } from "@/lib/constants";

export function StageSelect({ dealId, stage }: { dealId: string; stage: string }) {
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(stage);
  const [failed, setFailed] = useState(false);

  return (
    <select
      value={value}
      disabled={pending}
      aria-label="Deal stage"
      title={failed ? "Couldn't update the stage — try again" : undefined}
      onChange={(event) => {
        const next = event.target.value;
        const previous = value;
        setValue(next);
        setFailed(false);
        startTransition(async () => {
          const result = await updateDealStage(dealId, next);
          // Roll the control back rather than showing a stage the
          // database never accepted.
          if (result?.error) {
            setValue(previous);
            setFailed(true);
          }
        });
      }}
      className={`select input-sm w-32 ${failed ? "border-[var(--danger)]" : ""}`}
    >
      {DEAL_STAGES.map((option) => (
        <option key={option} value={option}>
          {DEAL_STAGE_LABELS[option]}
        </option>
      ))}
    </select>
  );
}
