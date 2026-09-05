"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signup } from "./actions";
import { FormError } from "@/components/ui";

export default function SignupPage() {
  const [state, formAction, pending] = useActionState<{ error?: string }, FormData>(
    signup,
    { error: undefined },
  );

  return (
    <div className="relative z-10 flex min-h-screen items-center justify-center px-5 py-12">
      <div className="fade-up w-full max-w-sm">
        <div className="card card-lit p-6">
          <h1 className="page-title !text-2xl">Create your workspace</h1>
          <p className="muted mt-1 text-sm">
            Your business gets its own branded CRM.
          </p>

          <form action={formAction} className="mt-6 space-y-4">
            <div>
              <label className="label" htmlFor="companyName">
                Company name
              </label>
              <input
                id="companyName"
                name="companyName"
                placeholder="Acme Plumbing"
                required
                className="input"
              />
            </div>
            <div>
              <label className="label" htmlFor="name">
                Your name
              </label>
              <input
                id="name"
                name="name"
                placeholder="Jamie Rivera"
                autoComplete="name"
                required
                className="input"
              />
            </div>
            <div>
              <label className="label" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                placeholder="you@company.com"
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
                placeholder="At least 8 characters"
                autoComplete="new-password"
                required
                className="input"
              />
            </div>

            <FormError message={state?.error} />

            <button type="submit" disabled={pending} className="btn btn-primary w-full">
              {pending ? "Creating…" : "Create account"}
            </button>
          </form>
        </div>

        <p className="faint mt-5 text-center text-xs">
          Already have an account?{" "}
          <Link href="/login" className="link">
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
