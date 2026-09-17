"use client";

import { useState } from "react";
import { FormError } from "@/components/ui";

export function HelloSignForm({
  contractId,
  contractTitle,
}: {
  contractId: string;
  contractTitle: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignWithHelloSign() {
    setPending(true);
    setError(null);

    try {
      // Import the action dynamically to avoid issues
      const { sendContractToHelloSign } = await import("@/app/dashboard/contracts/actions");

      const formData = new FormData();
      formData.append("contractId", contractId);

      const result = await sendContractToHelloSign({}, formData);

      if (result.error) {
        setError(result.error);
        setPending(false);
      } else if ((result as any).signingUrl) {
        // Redirect to HelloSign signing URL
        window.location.href = (result as any).signingUrl;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to initiate signing");
      setPending(false);
    }
  }

  return (
    <div className="card card-lit p-5">
      <h2 className="text-sm font-semibold">Sign this contract</h2>
      <p className="faint mt-1 text-xs">
        Click below to sign this contract securely with HelloSign.
      </p>

      <div className="mt-4 space-y-3">
        <FormError message={error} />

        <button
          onClick={handleSignWithHelloSign}
          disabled={pending}
          className="btn btn-primary w-full"
        >
          {pending ? "Preparing signing…" : "Sign with HelloSign"}
        </button>

        <p className="faint text-xs">
          You'll be redirected to HelloSign to sign this document securely and legally.
        </p>
      </div>
    </div>
  );
}
