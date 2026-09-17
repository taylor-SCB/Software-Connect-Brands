"use client";

import { useActionState } from "react";
import { login } from "./actions";
import { FormError } from "@/components/ui";

export function LoginForm({ notice }: { notice?: string }) {
  const [state, formAction, pending] = useActionState<
    { error?: string; kept?: Record<string, string> },
    FormData
  >(login, { error: undefined });

  // What was typed, handed back when the sign-in was refused, so a second
  // attempt is one tap on the password rather than the whole form again.
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
          // Keyed on what came back so React re-seeds the box after it
          // resets the form; defaultValue alone would keep the old value.
          key={keptEmail}
          defaultValue={keptEmail}
          autoComplete="email"
          // A phone capitalises the first letter of a text box and will
          // happily "correct" an address. The server matches without
          // regard to case anyway, but there is no reason to let the
          // keyboard put a capital in front of someone in the first place.
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          inputMode="email"
          required
          className="input"
        />
      </div>
      <div>
        <label className="label" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="input"
        />
      </div>

      {/* A submitted error wins: it describes this attempt, whereas the
          notice describes how the visitor arrived here. */}
      <FormError message={state?.error ?? notice} />

      <button type="submit" disabled={pending} className="btn btn-primary w-full">
        {pending ? "Logging in…" : "Log in"}
      </button>
    </form>
  );
}
