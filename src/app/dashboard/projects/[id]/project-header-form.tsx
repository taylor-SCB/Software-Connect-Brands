"use client";

import { useActionState, useState, useTransition } from "react";
import { FormError, FormSuccess } from "@/components/ui";
import { PROJECT_STAGES, PROJECT_STAGE_LABELS } from "@/lib/constants";
import type { ActionState } from "@/lib/forms";
import { setProjectStage, updateProject } from "../actions";

// The job's name, where the work happens, and where it stands. Kept in
// one small row rather than an edit page: a contractor changing a stage
// should not have to go somewhere else to do it.
export function ProjectHeaderForm({
  projectId,
  name,
  siteAddress,
  stage,
}: {
  projectId: string;
  name: string;
  siteAddress: string | null;
  stage: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(updateProject, {});
  const [stageValue, setStageValue] = useState(stage);
  const [stagePending, startStage] = useTransition();
  const [stageError, setStageError] = useState<string | undefined>();

  return (
    <div className="space-y-2">
      <form action={formAction} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="projectId" value={projectId} />
        <label className="block text-xs">
          <span className="faint block">Job name</span>
          <input
            name="name"
            defaultValue={name}
            className="input input-sm w-64"
            data-testid="project-name"
            aria-label="Job name"
          />
        </label>
        <label className="block text-xs">
          <span className="faint block">Where the work is</span>
          <input
            name="siteAddress"
            defaultValue={siteAddress ?? ""}
            placeholder="1200 Lakeside Dr, Austin"
            className="input input-sm w-72"
            data-testid="project-site"
            aria-label="Where the work is"
          />
        </label>
        <button type="submit" disabled={pending} className="btn btn-ghost btn-sm">
          {pending ? "Saving…" : "Save"}
        </button>
        <label className="ml-auto block text-xs">
          <span className="faint block">Stage</span>
          <select
            value={stageValue}
            disabled={stagePending}
            onChange={(event) => {
              const next = event.target.value;
              setStageValue(next);
              setStageError(undefined);
              startStage(async () => {
                const result = await setProjectStage(projectId, next);
                if (result?.error) {
                  setStageError(result.error);
                  setStageValue(stage);
                }
              });
            }}
            className="select input-sm w-40"
            data-testid="project-stage"
            aria-label="Stage"
          >
            {PROJECT_STAGES.map((option) => (
              <option key={option} value={option}>{PROJECT_STAGE_LABELS[option]}</option>
            ))}
          </select>
        </label>
      </form>
      <FormError message={state?.error ?? stageError} />
      <FormSuccess message={state?.success} />
    </div>
  );
}
