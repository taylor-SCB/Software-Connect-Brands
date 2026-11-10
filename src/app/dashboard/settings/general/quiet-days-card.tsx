"use client";

import { useActionState } from "react";
import { FormError, FormSuccess } from "@/components/ui";
import type { ActionState } from "@/lib/forms";
import { updateQuietDays } from "./actions";

// Settings → General: after how many days without a touch an open
// opportunity reads "Quiet N days" on the Pipeline (Nov 10, 2026).
export function QuietDaysCard({ quietDays, canEdit }: { quietDays: number; canEdit: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateQuietDays, {});
  const value = state.kept?.quietDays ?? String(quietDays);
  return (
    <form action={action} className="space-y-2 px-5 pb-5" data-testid="quiet-days-form">
      <label className="flex flex-wrap items-center gap-2 text-sm">
        <span>Mark an opportunity quiet after</span>
        <input
          key={value}
          name="quietDays"
          type="number"
          min={1}
          max={365}
          defaultValue={value}
          disabled={!canEdit}
          className="input input-sm num w-20"
          data-testid="quiet-days-input"
        />
        <span>days with no call, text, email or meeting.</span>
      </label>
      <p className="faint text-xs">Marketing emails don&apos;t count as a touch.</p>
      {canEdit ? (
        <button type="submit" disabled={pending} className="btn btn-primary btn-sm" data-testid="quiet-days-save">
          {pending ? "Saving…" : "Save"}
        </button>
      ) : (
        <p className="faint text-xs">Only owners and admins can change this.</p>
      )}
      <FormError message={state.error} />
      <FormSuccess message={state.success} />
    </form>
  );
}
