"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { undoLog } from "@/app/dashboard/contacts/actions";

// Delete on a history line you logged (BDR redesign, Nov 11, 2026). It
// takes back the whole save it came from — the line on everyone it was
// logged on, its calendar copy, follow-ups and meetings booked with it,
// and the status it moved — through undoLog, which allows only whoever
// logged it, or an Owner or Admin. Asks first.
export function ActivityDelete({ batchId, others }: { batchId: string; others: number }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [pending, start] = useTransition();
  if (!asking) {
    return (
      <button type="button" className="link text-[0.7rem] pointer-coarse:min-h-11" onClick={() => setAsking(true)} data-testid="activity-delete">
        Delete
      </button>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-[0.7rem]" data-testid="activity-delete-confirm">
      <span>
        Delete this{others > 0 ? ` and the same line on ${others} ${others === 1 ? "other" : "others"}` : ""}, with anything saved with it?
      </span>
      <button
        type="button"
        className="btn btn-danger btn-sm pointer-coarse:min-h-11"
        disabled={pending}
        data-testid="activity-delete-yes"
        onClick={() =>
          start(async () => {
            const result = await undoLog(batchId);
            if (result.error) return setError(result.error);
            setAsking(false);
            router.refresh();
          })
        }
      >
        {pending ? "Deleting…" : "Yes, delete"}
      </button>
      <button type="button" className="btn btn-ghost btn-sm pointer-coarse:min-h-11" onClick={() => setAsking(false)}>
        Keep it
      </button>
      {error && (
        <span role="alert" className="text-[var(--danger)]">
          {error}
        </span>
      )}
    </span>
  );
}
