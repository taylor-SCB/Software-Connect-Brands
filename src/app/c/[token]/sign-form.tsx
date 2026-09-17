"use client";

import { useState } from "react";
import { FormError } from "@/components/ui";

export function SignForm({
  token,
}: {
  token: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signerName, setSignerName] = useState("");
  const [agree, setAgree] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);

    try {
      const { signContract } = await import("@/app/dashboard/contracts/actions");

      const formData = new FormData();
      formData.append("token", token);
      formData.append("signerName", signerName);
      if (agree) formData.append("agree", "on");

      const result = await signContract({}, formData);

      if (result.error) {
        setError(result.error);
        setPending(false);
      } else if (result.success) {
        // Show success message and redirect
        window.location.href = `/c/${token}?signed=true`;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sign contract");
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card card-lit p-5">
      <h2 className="text-sm font-semibold">Sign this contract</h2>
      <p className="faint mt-1 text-xs">
        This workspace doesn't have HelloSign configured. Please enter your name and accept the terms below.
      </p>

      <div className="mt-4 space-y-3">
        <FormError message={error} />

        <div>
          <label htmlFor="signerName" className="block text-xs font-medium">
            Your Full Name
          </label>
          <input
            id="signerName"
            type="text"
            value={signerName}
            onChange={(e) => setSignerName(e.target.value)}
            placeholder="John Doe"
            className="input mt-1 w-full"
            disabled={pending}
            required
          />
        </div>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={agree}
            onChange={(e) => setAgree(e.target.checked)}
            className="checkbox"
            disabled={pending}
            required
          />
          <span className="text-xs">
            I accept the terms and agree to sign this contract.
          </span>
        </label>

        <button
          type="submit"
          disabled={pending || !signerName || !agree}
          className="btn btn-primary w-full"
        >
          {pending ? "Signing…" : "Sign Contract"}
        </button>
      </div>
    </form>
  );
}
