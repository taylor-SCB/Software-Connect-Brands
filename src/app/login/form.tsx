"use client";

import { useActionState } from "react";
import { login } from "./actions";
import { FormError } from "@/components/ui";

export function LoginForm({ notice }: { notice?: string }) {
  const [state, formAction, pending] = useActionState<{ error?: string }, FormData>(
    login,
    { error: undefined },
  );

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
          autoComplete="email"
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
