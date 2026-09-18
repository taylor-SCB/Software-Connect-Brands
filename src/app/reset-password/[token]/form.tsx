"use client";

import { useActionState } from "react";
import Link from "next/link";
import { setNewPassword } from "./actions";
import { FormError } from "@/components/ui";

type State = { error?: string; done?: boolean };

export function ResetPasswordForm({ token, email }: { token: string; email: string }) {
  const [state, formAction, pending] = useActionState<State, FormData>(setNewPassword, {});

  if (state?.done) {
    return (
      <div className="mt-6 space-y-4">
        <p
          role="status"
          className="rounded-lg border border-[rgb(52_211_153/0.3)] bg-[rgb(52_211_153/0.09)] px-3 py-2 text-xs text-[var(--ok)]"
        >
          Password changed. Log in with the new one.
        </p>
        <Link href="/login" className="btn btn-primary w-full">
          Go to log in
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="mt-6 space-y-4">
      <input type="hidden" name="token" value={token} />

      {/* Shown, not editable: the link decides whose password this is, and
          seeing the address confirms which account is being changed. It is
          also here so a password manager files the new password against
          the right account. */}
      <div>
        <label className="label" htmlFor="account">
          Account
        </label>
        <input
          id="account"
          type="email"
          value={email}
          readOnly
          autoComplete="username"
          className="input opacity-70"
        />
      </div>

      <div>
        <label className="label" htmlFor="password">
          New password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          className="input"
        />
        <p className="faint mt-1 text-xs">At least 8 characters.</p>
      </div>

      <div>
        <label className="label" htmlFor="confirm">
          Type it again
        </label>
        <input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          className="input"
        />
      </div>

      <FormError message={state?.error} />

      <button type="submit" disabled={pending} className="btn btn-primary w-full">
        {pending ? "Saving…" : "Set new password"}
      </button>
    </form>
  );
}
