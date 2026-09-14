"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { IconHardHat } from "@/components/icons";
import { createProjectFromContract } from "./actions";

// For an agreement that was already signed before jobs were tracked, or
// one signed with no deal behind it. Everything else starts its job on
// its own at signature.
export function CreateProjectButton({ contractId }: { contractId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | undefined>();

  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(undefined);
            const result = await createProjectFromContract(contractId);
            if (result?.error) setError(result.error);
            else if (result?.projectId) router.push(`/dashboard/projects/${result.projectId}`);
          })
        }
        className="btn btn-ghost btn-sm"
        data-testid="create-project"
      >
        <IconHardHat size={13} />
        {pending ? "Starting…" : "Track this as a job"}
      </button>
      {error && <span className="text-[0.7rem] text-[var(--danger)]">{error}</span>}
    </span>
  );
}
