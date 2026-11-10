"use client";

import { createContext, useActionState, useContext, useEffect, useState } from "react";
import { IconSend } from "@/components/icons";
import type { ActionState } from "@/lib/forms";
import { markQuoteSent } from "../actions";

// Whether the Line items card holds edits nobody has saved. Mark as sent
// sits in the page header, away from the editor, and the customer's link
// prints only what is saved: pressing it with a line typed but not saved
// sent an empty $0.00 quote while the editor showed $2,100.00 (UX review,
// Nov 10, 2026).
const UnsavedLines = createContext<{ unsaved: boolean; setUnsaved: (unsaved: boolean) => void } | null>(null);

export function QuoteUnsavedProvider({ children }: { children: React.ReactNode }) {
  const [unsaved, setUnsaved] = useState(false);
  return <UnsavedLines.Provider value={{ unsaved, setUnsaved }}>{children}</UnsavedLines.Provider>;
}

// Called by the editor with its "Unsaved changes" flag.
export function useReportUnsavedLines(dirty: boolean) {
  const context = useContext(UnsavedLines);
  const setUnsaved = context?.setUnsaved;
  useEffect(() => {
    setUnsaved?.(dirty);
  }, [dirty, setUnsaved]);
}

export const UNSAVED_LINES_MESSAGE = "Save line items first. The customer's link shows only saved lines.";

export function MarkSentButton({ quoteId }: { quoteId: string }) {
  const unsaved = useContext(UnsavedLines)?.unsaved ?? false;
  const [state, formAction, pending] = useActionState<ActionState, FormData>(markQuoteSent, {});
  // Pressed while lines were unsaved; the words go once they are saved.
  const [blocked, setBlocked] = useState(false);
  // The server's refusal (no saved lines) stays until the lines are
  // edited again.
  const [dismissed, setDismissed] = useState<ActionState | null>(null);
  const [seenUnsaved, setSeenUnsaved] = useState(unsaved);
  if (unsaved !== seenUnsaved) {
    setSeenUnsaved(unsaved);
    if (unsaved) setDismissed(state);
  }
  const message = blocked && unsaved ? UNSAVED_LINES_MESSAGE : state !== dismissed ? state.error : undefined;

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        // Nothing is sent: the edits stay in the editor to be saved.
        if (unsaved) {
          event.preventDefault();
          setBlocked(true);
        } else {
          setBlocked(false);
        }
      }}
      className="flex flex-col items-end gap-1"
    >
      <input type="hidden" name="quoteId" value={quoteId} />
      <button type="submit" disabled={pending} className="btn btn-primary btn-sm" data-testid="mark-sent">
        <IconSend size={13} />
        {pending ? "Marking sent…" : "Mark as sent"}
      </button>
      {message && (
        <p role="alert" className="max-w-xs text-right text-xs text-[var(--danger)]" data-testid="mark-sent-error">
          {message}
        </p>
      )}
    </form>
  );
}
