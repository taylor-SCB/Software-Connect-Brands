"use client";

import { useActionState } from "react";
import { FormError } from "@/components/ui";
import { IconTrash } from "@/components/icons";
import type { ActionState } from "@/lib/forms";

// The Danger-zone delete button. The action either redirects away or
// answers with why it won't ("$4,200 still owed — archive instead"), and
// that reason has to land on the screen, which a bare <form action> can't
// do.
export function DeleteRecordForm({
  action,
  hiddenName,
  hiddenValue,
  label,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  hiddenName: string;
  hiddenValue: string;
  label: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, {});
  return (
    <form action={formAction} className="space-y-3 p-5">
      <input type="hidden" name={hiddenName} value={hiddenValue} />
      <FormError message={state?.error} />
      <button type="submit" disabled={pending} className="btn btn-danger btn-sm" data-testid="delete-record">
        <IconTrash size={13} />
        {pending ? "Deleting…" : label}
      </button>
    </form>
  );
}
