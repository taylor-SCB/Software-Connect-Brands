"use client";

import { useTransition } from "react";
import { updateDealStage } from "./actions";

const STAGES = ["NEW", "CONTACTED", "WON", "LOST"];

export function StageSelect({ dealId, stage }: { dealId: string; stage: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <select
      defaultValue={stage}
      disabled={pending}
      onChange={(event) =>
        startTransition(() => {
          updateDealStage(dealId, event.target.value);
        })
      }
      className="rounded-md border border-gray-300 px-2 py-1 text-xs"
    >
      {STAGES.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  );
}
