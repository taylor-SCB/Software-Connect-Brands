"use client";

import { useActionState } from "react";
import { Field, FormError, FormSuccess } from "@/components/ui";
import { updateSigner } from "@/app/dashboard/deals/tracker/actions";
import type { ActionState } from "@/lib/forms";

// "Your Company Signer" on a contract that already exists.
export function SignerForm({ contractId, signerName, locked }: { contractId: string; signerName: string; locked: boolean }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(updateSigner, {});
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="contractId" value={contractId} />
      {locked ? (
        <p className="text-sm">{signerName || <span className="faint">Not set</span>}</p>
      ) : (
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Field label="Your company signer" name="senderSignerName" defaultValue={signerName} placeholder="Who signs for you" />
          </div>
          <button type="submit" disabled={pending} className="btn btn-ghost btn-sm">
            {pending ? "…" : "Save"}
          </button>
        </div>
      )}
      <FormError message={state?.error} />
      <FormSuccess message={state?.success} />
    </form>
  );
}
