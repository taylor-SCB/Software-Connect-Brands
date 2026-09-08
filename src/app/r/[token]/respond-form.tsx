"use client";

import { useActionState } from "react";
import { respondToRatesheetInvite } from "./actions";
import { FormError } from "@/components/ui";
import { IconCheck, IconX } from "@/components/icons";
import type { ActionState } from "@/lib/forms";

// Approve / Decline. On success the page revalidates and re-renders with
// the answer recorded, so these buttons disappear on their own.
export function RespondForm({ token, senderName }: { token: string; senderName: string }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    respondToRatesheetInvite,
    {},
  );

  return (
    <div className="card card-lit p-5">
      <h2 className="text-sm font-semibold">Use this ratesheet?</h2>
      <p className="faint mt-1 text-xs leading-relaxed">
        Approve if you&apos;d like to work from these prices. {senderName} sees your answer in
        their dashboard.
      </p>

      <form action={formAction} className="mt-4 flex flex-wrap items-center gap-2">
        <input type="hidden" name="token" value={token} />
        <button
          type="submit"
          name="decision"
          value="APPROVE"
          disabled={pending}
          className="btn btn-primary"
        >
          <IconCheck size={14} />
          Approve
        </button>
        <button
          type="submit"
          name="decision"
          value="DECLINE"
          disabled={pending}
          className="btn btn-ghost"
        >
          <IconX size={14} />
          Decline
        </button>
      </form>
      <div className="mt-3">
        <FormError message={state?.error} />
      </div>
    </div>
  );
}
