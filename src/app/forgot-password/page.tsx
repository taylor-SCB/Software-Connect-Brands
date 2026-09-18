import type { Metadata } from "next";
import { ForgotPasswordForm } from "./form";

export const metadata: Metadata = {
  title: "Forgot password",
  robots: { index: false, follow: false },
};

export default function ForgotPasswordPage() {
  return (
    <div className="relative z-10 flex min-h-screen items-center justify-center px-5 py-12">
      <div className="fade-up w-full max-w-sm">
        <div className="card card-lit p-6">
          <h1 className="page-title !text-2xl">Forgot password</h1>
          <p className="muted mt-1 text-sm">
            We&apos;ll email you a link to set a new one.
          </p>
          <ForgotPasswordForm />
        </div>
      </div>
    </div>
  );
}
