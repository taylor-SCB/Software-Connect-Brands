"use client";

import { useActionState } from "react";
import Link from "next/link";
import { login } from "./actions";
import { FormError } from "@/components/ui";

export default function LoginPage() {
  const [state, formAction, pending] = useActionState<{ error?: string }, FormData>(
    login,
    { error: undefined },
  );

  return (
    <div className="relative z-10 flex min-h-screen items-center justify-center px-5 py-12">
      <div className="fade-up w-full max-w-sm">
        <div className="card card-lit p-6">
          <h1 className="page-title !text-2xl">Log in</h1>
          <p className="muted mt-1 text-sm">Welcome back.</p>

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

            <FormError message={state?.error} />

            <button type="submit" disabled={pending} className="btn btn-primary w-full">
              {pending ? "Logging in…" : "Log in"}
            </button>
          </form>
        </div>

        <p className="faint mt-5 text-center text-xs">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="link">
            Create a workspace
          </Link>
        </p>
      </div>
    </div>
  );
}
