"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconCheck } from "@/components/icons";
import { confirmCompanyDetails } from "../actions";

// "Looks right" on a company's Details card: the person has read what
// the app filled in and is happy with it, so the "auto" marks come off.
export function LooksRightButton({ companyId }: { companyId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  return (
    <span className="inline-flex items-center gap-2">
      {error && <span className="text-xs text-[var(--danger)]">{error}</span>}
      <button
        type="button"
        disabled={pending}
        data-testid="looks-right"
        title="Confirm what the app filled in and remove the auto marks"
        onClick={() =>
          startTransition(async () => {
            const result = await confirmCompanyDetails(companyId);
            if ("error" in result) setError(result.error);
            else router.refresh();
          })
        }
        className="btn btn-ghost btn-sm"
      >
        <IconCheck size={12} />
        {pending ? "Saving…" : "Looks right"}
      </button>
    </span>
  );
}
