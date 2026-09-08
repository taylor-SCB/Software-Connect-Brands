"use client";

import { useActionState, useEffect, useRef } from "react";
import { FormError, FormSuccess } from "@/components/ui";
import { IconSend } from "@/components/icons";
import { sendRatesheetInvite } from "../actions";
import type { ActionState } from "@/lib/forms";

export function SendInviteForm({ ratesheetId, disabled }: { ratesheetId: string; disabled: boolean }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    sendRatesheetInvite,
    {},
  );
  const formRef = useRef<HTMLFormElement>(null);

  // Clear the boxes once a link exists so the next partner can go in.
  useEffect(() => {
    if (state?.success) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="space-y-3 p-5">
      <input type="hidden" name="ratesheetId" value={ratesheetId} />
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div>
          <label className="label" htmlFor="partnerEmail">
            Partner email
          </label>
          <input
            id="partnerEmail"
            name="partnerEmail"
            type="email"
            required
            placeholder="buyer@partner.com"
            disabled={disabled}
            className="input input-sm"
          />
        </div>
        <div>
          <label className="label" htmlFor="partnerName">
            Partner / company<span className="faint font-normal"> · optional</span>
          </label>
          <input
            id="partnerName"
            name="partnerName"
            placeholder="Acme Supply"
            disabled={disabled}
            className="input input-sm"
          />
        </div>
        <button type="submit" disabled={pending || disabled} className="btn btn-primary btn-sm">
          <IconSend size={12} />
          {pending ? "Creating…" : "Send to partner"}
        </button>
      </div>
      {disabled && (
        <p className="faint text-xs">Reactivate the sheet or move its expiry date to send it again.</p>
      )}
      <FormError message={state?.error} />
      <FormSuccess message={state?.success} />
    </form>
  );
}
