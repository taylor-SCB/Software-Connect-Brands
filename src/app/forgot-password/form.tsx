"use client";

import { useActionState } from "react";
import Link from "next/link";
import { requestPasswordReset } from "./actions";
import { FormError } from "@/components/ui";

type State = { sent?: boolean; error?: string; kept?: Record<string, string> };

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState<State, FormData>(
    requestPasswordReset,
    {},
  );

  // Said whether or not the address is one we know. The form is replaced
  // rather than left on screen, so nobody sits there retrying and reading
  // meaning into how long each attempt takes.
  if (state?.sent) {
    return (
      <div className="mt-6 space-y-4">
        <p
          role="status"
          className="rounded-lg border border-[rgb(52_211_153/0.3)] bg-[rgb(52_211_153/0.09)] px-3 py-2 text-xs text-[var(--ok)]"
        >
          If that address has an account, a link to set a new password is on its way.
          It lasts an hour.
        </p>
        <p className="faint text-xs">
          Nothing arrived? Check the junk folder, then try again in a few minutes.
        </p>
        <Link href="/login" className="btn btn-ghost btn-sm w-full">
          Back to log in
        </Link>
      </div>
    );
  }

  // What was typed, handed back when the form refused. React empties a
  // form whose action is a server function, and retyping an address on a
  // phone is exactly the annoyance this page exists to end.
  const keptEmail = state?.kept?.email ?? "";

  return (
    <form action={formAction} className="mt-6 space-y-4">
      <div>
        <label className="label" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          key={keptEmail}
          defaultValue={keptEmail}
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          inputMode="email"
          required
          className="input"
        />
        <p className="faint mt-1 text-xs">The address you log in with.</p>
      </div>

      <FormError message={state?.error} />

      <button type="submit" disabled={pending} className="btn btn-primary w-full">
        {pending ? "Sending…" : "Email me a link"}
      </button>

      <Link href="/login" className="btn btn-ghost btn-sm w-full">
        Back to log in
      </Link>
    </form>
  );
}
