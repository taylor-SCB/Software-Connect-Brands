import type { Metadata } from "next";
import Link from "next/link";
import { findPasswordReset } from "@/lib/password-reset";
import { ResetPasswordForm } from "./form";

export const metadata: Metadata = {
  title: "Set a new password",
  robots: { index: false, follow: false },
};

// The token decides everything here, so nothing may be cached or
// prerendered against it.
export const dynamic = "force-dynamic";

// A link that has expired, been used, or never existed all say the same
// thing. Telling them apart would say whether a token was ever real.
const DEAD =
  "That link has already been used or has expired. Ask for a new one and it'll work.";

export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const found = await findPasswordReset(token);

  return (
    <div className="relative z-10 flex min-h-screen items-center justify-center px-5 py-12">
      <div className="fade-up w-full max-w-sm">
        <div className="card card-lit p-6">
          <h1 className="page-title !text-2xl">Set a new password</h1>

          {found.ok ? (
            <>
              <p className="muted mt-1 text-sm">Pick something you&apos;ll remember.</p>
              <ResetPasswordForm token={token} email={found.email} />
            </>
          ) : (
            <div className="mt-4 space-y-4">
              <p
                role="alert"
                className="rounded-lg border border-[rgb(251_113_133/0.3)] bg-[rgb(251_113_133/0.09)] px-3 py-2 text-xs text-[var(--danger)]"
              >
                {DEAD}
              </p>
              <Link href="/forgot-password" className="btn btn-primary w-full">
                Send me a new link
              </Link>
              <Link href="/login" className="btn btn-ghost btn-sm w-full">
                Back to log in
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
