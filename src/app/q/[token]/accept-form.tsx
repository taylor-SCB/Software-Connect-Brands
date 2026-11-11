"use client";

import { useActionState } from "react";
import { acceptQuoteByCustomer } from "@/app/dashboard/quotes/actions";
import { FormError } from "@/components/ui";
import type { ActionState } from "@/lib/forms";

// "Accept this quote" (BDR redesign, Release 8): the customer types their
// name and says yes on their own copy. The page re-renders as accepted.
export function AcceptQuoteForm({ token, businessName }: { token: string; businessName: string }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(acceptQuoteByCustomer, {});
  return (
    <div className="card card-lit no-print mx-auto mt-5 max-w-4xl p-5" data-testid="accept-quote">
      <h2 className="text-sm font-semibold">Accept this quote</h2>
      <p className="faint mt-1 text-xs">
        Typing your name tells {businessName} you&apos;d like to go ahead. They&apos;ll send the agreement to sign.
      </p>
      <form action={formAction} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <input type="hidden" name="token" value={token} />
        <div className="min-w-0 flex-1">
          <label className="label" htmlFor="accept-name">
            Full name
          </label>
          <input id="accept-name" name="name" required placeholder="Type your full name" autoComplete="name" className="input" data-testid="accept-quote-name" />
        </div>
        <button type="submit" disabled={pending} className="btn btn-primary min-h-11" data-testid="accept-quote-submit">
          {pending ? "Accepting…" : "Accept this quote"}
        </button>
      </form>
      <div className="mt-2">
        <FormError message={state.error} />
      </div>
    </div>
  );
}
