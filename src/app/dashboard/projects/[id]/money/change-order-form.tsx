"use client";

import { useActionState, useState } from "react";
import { FormError, FormSuccess } from "@/components/ui";
import { IconPlus } from "@/components/icons";
import type { ActionState } from "@/lib/forms";
import { createChangeOrder } from "../../actions";

// More work, or less. One line, because that is how a change gets agreed
// on site: what changed, how much, who said yes.
export function ChangeOrderForm({
  projectId,
  scopes,
  today,
}: {
  projectId: string;
  scopes: { id: string; name: string }[];
  today: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(createChangeOrder, {});
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn btn-ghost btn-sm" data-testid="add-change-order">
        <IconPlus size={13} />
        Add a change order
      </button>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="projectId" value={projectId} />
      <p className="muted text-xs">
        A plus adds to the budget; a minus is a credit and comes off what they owe. Either way it is recorded
        as agreed, with a document you can open.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="block text-xs">
          <span className="faint block">What changed</span>
          <input
            name="description"
            placeholder="Two extra doors"
            className="input input-sm w-56"
            data-testid="change-description"
          />
        </label>
        <label className="block text-xs">
          <span className="faint block">Amount</span>
          <input
            name="amount"
            placeholder="2400.00"
            inputMode="decimal"
            className="input input-sm num w-28"
            data-testid="change-amount"
          />
        </label>
        {scopes.length > 1 && (
          <label className="block text-xs">
            <span className="faint block">Which work</span>
            <select name="scopeId" className="select input-sm w-40" data-testid="change-scope">
              {scopes.map((scope) => (
                <option key={scope.id} value={scope.id}>{scope.name}</option>
              ))}
            </select>
          </label>
        )}
        {scopes.length === 1 && <input type="hidden" name="scopeId" value={scopes[0].id} />}
        <label className="block text-xs">
          <span className="faint block">Who agreed</span>
          <input name="signerName" placeholder="Dana Ruiz" className="input input-sm w-36" data-testid="change-signer" />
        </label>
        <label className="block text-xs">
          <span className="faint block">When</span>
          <input type="date" name="signedOn" defaultValue={today} className="input input-sm" data-testid="change-date" />
        </label>
        <button type="submit" disabled={pending} className="btn btn-primary btn-sm" data-testid="change-save">
          {pending ? "Recording…" : "Record the change"}
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
