"use client";

import { useActionState } from "react";
import { signContract } from "@/app/dashboard/contracts/actions";
import { FormError } from "@/components/ui";
import type { ActionState } from "@/lib/forms";

export function SignForm({
  token,
  contactName,
}: {
  token: string;
  contactName: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    signContract,
    {},
  );

  // On success the page revalidates and re-renders as signed, so this
  // form disappears on its own.
  return (
    <div className="card card-lit p-5">
      <h2 className="text-sm font-semibold">Sign this contract</h2>
      <p className="faint mt-1 text-xs">
        Typing your full name below counts as your electronic signature.
      </p>

      <form action={formAction} className="mt-4 space-y-3">
        <input type="hidden" name="token" value={token} />
        <div>
          <label className="label" htmlFor="signerName">
            Full name
          </label>
          <input
            id="signerName"
            name="signerName"
            defaultValue={contactName}
            required
            className="input"
          />
        </div>

        <label className="flex items-start gap-2 text-xs leading-relaxed">
          <input
            type="checkbox"
            name="agree"
            required
            className="mt-0.5 h-4 w-4 accent-[var(--brand)]"
          />
          I have read this agreement and accept its terms on behalf of the
          company named above.
        </label>

        <FormError message={state?.error} />

        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? "Signing…" : "Sign contract"}
        </button>
      </form>
    </div>
  );
}
