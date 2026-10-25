"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signup, type SignupState } from "./actions";
import { FormError } from "@/components/ui";
import { ACCOUNT_TYPES, ACCOUNT_TYPE_BLURBS, ACCOUNT_TYPE_LABELS } from "@/lib/account-types";

export default function SignupPage() {
  const [state, formAction, pending] = useActionState<SignupState, FormData>(signup, {});
  const kept = state.kept ?? {};
  const pickedType = kept.accountType ?? "BUSINESS";

  return (
    <div className="relative z-10 flex min-h-screen items-center justify-center px-5 py-12">
      <div className="fade-up w-full max-w-sm">
        <div className="card card-lit p-6">
          <h1 className="page-title !text-2xl">Create your workspace</h1>
          <p className="muted mt-1 text-sm">
            Your business gets its own branded CRM. New workspaces are reviewed
            before they open.
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
                defaultValue={kept.companyName}
                required
                className="input"
              />
            </div>
            <fieldset>
              <legend className="label">What kind of company are you?</legend>
              <div className="space-y-1.5" data-testid="signup-account-type">
                {ACCOUNT_TYPES.map((type) => (
                  <label
                    key={type}
                    className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-[var(--border)] px-3 py-2 has-[:checked]:border-[color-mix(in_srgb,var(--brand)_55%,transparent)] has-[:checked]:bg-[color-mix(in_srgb,var(--brand)_9%,transparent)]"
                  >
                    <input
                      type="radio"
                      name="accountType"
                      value={type}
                      defaultChecked={pickedType === type}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--brand)]"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{ACCOUNT_TYPE_LABELS[type]}</span>
                      <span className="faint block text-xs">{ACCOUNT_TYPE_BLURBS[type]}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div>
              <label className="label" htmlFor="name">
                Your name
              </label>
              <input
                id="name"
                name="name"
                placeholder="Jamie Rivera"
                autoComplete="name"
                defaultValue={kept.name}
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
                defaultValue={kept.email}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                inputMode="email"
                required
                className="input"
              />
            </div>
            <div>
              <label className="label" htmlFor="phone">
                Phone
              </label>
              <input
                id="phone"
                name="phone"
                type="tel"
                placeholder="(402) 555-0148"
                autoComplete="tel"
                defaultValue={kept.phone}
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
              {pending ? "Sending…" : "Request access"}
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
