"use client";

import { useActionState, useState } from "react";
import { FormError, FormSuccess } from "@/components/ui";
import { IconPlus } from "@/components/icons";
import type { ActionState } from "@/lib/forms";
import { addScope } from "../actions";

// Splitting a job after the fact: a locksmith who quoted one line and
// then wants the access-control half tracked on its own.
export function AddScopeForm({
  projectId,
  serviceTypes,
  hasScopes,
}: {
  projectId: string;
  serviceTypes: string[];
  hasScopes: boolean;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(addScope, {});
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn btn-ghost btn-sm" data-testid="add-scope">
        <IconPlus size={13} />
        {hasScopes ? "Add a scope of work" : "Split this job into scopes of work"}
      </button>
    );
  }

  return (
    <form action={formAction} className="card space-y-3 p-4">
      <input type="hidden" name="projectId" value={projectId} />
      <p className="muted text-sm">
        A scope is one kind of work on this job, with its own budget, crew and change orders.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="block text-xs">
          <span className="faint block">Service type</span>
          <select name="serviceType" className="select input-sm w-48" data-testid="scope-service-type">
            <option value="">— Pick one —</option>
            {serviceTypes.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>
        <label className="block text-xs">
          <span className="faint block">Or call it something else</span>
          <input name="name" placeholder="Second floor" className="input input-sm w-52" data-testid="scope-name" />
        </label>
        <button type="submit" disabled={pending} className="btn btn-primary btn-sm" data-testid="scope-save">
          {pending ? "Adding…" : "Add scope"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="btn btn-ghost btn-sm">
          Cancel
        </button>
      </div>
      <FormError message={state?.error} />
      <FormSuccess message={state?.success} />
    </form>
  );
}
