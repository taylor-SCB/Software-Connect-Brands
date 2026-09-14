"use client";

import { useState, useTransition } from "react";
import { FormError, FormSuccess } from "@/components/ui";
import { markPaidThrough } from "./actions";

// Payroll went out Friday, so everything logged up to Friday is paid. One
// click instead of twenty, optionally for one crew when only the subs
// have been settled.
export function PaidThroughForm({
  projectId,
  crews,
  today,
}: {
  projectId: string;
  crews: { id: string; name: string }[];
  today: string;
}) {
  const [through, setThrough] = useState(today);
  const [crewId, setCrewId] = useState("");
  const [state, setState] = useState<{ error?: string; success?: string }>({});
  const [pending, start] = useTransition();

  return (
    <div className="flex flex-wrap items-end gap-2" data-testid="paid-through">
      <label className="block text-xs">
        <span className="faint block">Paid everything through</span>
        <input
          type="date"
          value={through}
          onChange={(event) => setThrough(event.target.value)}
          aria-label="Paid through this day"
          className="input input-sm"
          data-testid="paid-through-date"
        />
      </label>
      {crews.length > 1 && (
        <label className="block text-xs">
          <span className="faint block">For</span>
          <select
            value={crewId}
            onChange={(event) => setCrewId(event.target.value)}
            aria-label="Which crew was paid"
            className="select input-sm w-44"
            data-testid="paid-through-crew"
          >
            <option value="">Everyone on this job</option>
            {crews.map((crew) => (
              <option key={crew.id} value={crew.id}>
                {crew.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setState({});
            const result = await markPaidThrough(projectId, { through, crewId: crewId || undefined });
            setState(result ?? {});
          })
        }
        className="btn btn-ghost btn-sm"
        data-testid="paid-through-save"
      >
        {pending ? "Marking…" : "Mark paid"}
      </button>
      <div className="w-full">
        <FormError message={state.error} />
        <FormSuccess message={state.success} />
      </div>
    </div>
  );
}
