"use client";

import { useState, useTransition } from "react";
import { formatCents } from "@/lib/format";
import { PROJECT_STAGE_LABELS } from "@/lib/constants";
import { Badge, FormError, FormSuccess } from "@/components/ui";
import { setPropertyProjects } from "../actions";

export type JobChoice = {
  id: string;
  number: number;
  name: string;
  stage: string;
  awardedCents: number;
  // The property it is on now: another building's name means picking it
  // here moves it, which the screen says out loud.
  onOther: string | null;
};

// Which jobs are at this property. Multi-select, because a tower gets
// reroofed and rekeyed and repainted over three years and the person
// looking wants all of it in one number.
export function PickJobs({
  propertyId,
  jobs,
  picked,
}: {
  propertyId: string;
  jobs: JobChoice[];
  picked: string[];
}) {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<string[]>(picked);
  const [state, setState] = useState<{ error?: string; success?: string }>({});
  const [pending, start] = useTransition();

  const toggle = (id: string) =>
    setChosen((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]));

  const moving = chosen.filter((id) => {
    const job = jobs.find((entry) => entry.id === id);
    return job?.onOther && !picked.includes(id);
  }).length;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn btn-ghost btn-sm"
        data-testid="pick-jobs"
      >
        Pick the jobs
      </button>
    );
  }

  return (
    <div className="w-full space-y-2" data-testid="pick-jobs-panel">
      <p className="faint text-xs">
        A job is at one property, so picking one here takes it off whatever it was on. That is what keeps two
        buildings from claiming the same money.
      </p>
      <ul className="max-h-72 space-y-1 overflow-y-auto">
        {jobs.length === 0 && <li className="faint text-xs">No jobs in this workspace yet.</li>}
        {jobs.map((job) => {
          const on = chosen.includes(job.id);
          return (
            <li key={job.id}>
              <label className="flex flex-wrap items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggle(job.id)}
                  aria-label={`Put PRJ-${job.number} ${job.name} at this property`}
                />
                <span className="num faint text-xs">PRJ-{job.number}</span>
                <span>{job.name}</span>
                <Badge color="#94a3b8">{PROJECT_STAGE_LABELS[job.stage as never] ?? job.stage}</Badge>
                <span className="num faint text-xs">{formatCents(job.awardedCents)}</span>
                {job.onOther && !picked.includes(job.id) && (
                  <span className="faint text-xs">at {job.onOther}</span>
                )}
              </label>
            </li>
          );
        })}
      </ul>

      {moving > 0 && (
        <p className="text-xs text-[var(--warn)]" data-testid="pick-jobs-moving">
          {moving} {moving === 1 ? "job" : "jobs"} will move here from another property.
        </p>
      )}

      <FormError message={state.error} />
      <FormSuccess message={state.success} />

      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setState({});
              const result = await setPropertyProjects(propertyId, chosen);
              setState(result ?? {});
              if (!result?.error) setOpen(false);
            })
          }
          className="btn btn-primary btn-sm"
          data-testid="pick-jobs-save"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => {
            setChosen(picked);
            setOpen(false);
          }}
          className="btn btn-ghost btn-sm"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
