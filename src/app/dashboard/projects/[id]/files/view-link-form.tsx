"use client";

import { useActionState } from "react";
import { FormError, FormSuccess } from "@/components/ui";
import { IconLink } from "@/components/icons";
import type { ActionState } from "@/lib/forms";
import { makeViewLink } from "../../photo-actions";

// Names who a look-only link is for, so it can be turned off on its own
// later: "Acme Property Management", "Dana, office".
export function ViewLinkForm({ projectId }: { projectId: string }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(makeViewLink, {});

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="projectId" value={projectId} />
      <label className="label" htmlFor="view-link-label">Who is it for?</label>
      <div className="flex flex-wrap gap-2">
        <input
          id="view-link-label"
          name="label"
          required
          maxLength={120}
          placeholder="A company or a person"
          defaultValue={state.kept?.label}
          className="input min-w-0 flex-1"
          data-testid="view-link-label"
        />
        <button type="submit" disabled={pending} className="btn btn-primary btn-sm" data-testid="view-link-make">
          <IconLink size={13} />
          Make link
        </button>
      </div>
      <FormError message={state.error} />
      <FormSuccess message={state.success} />
    </form>
  );
}
