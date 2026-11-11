"use client";

import { useActionState, useEffect, useState } from "react";
import { FormError } from "@/components/ui";
import { IconTrash } from "@/components/icons";
import type { ActionState } from "@/lib/forms";
import { deleteQuote } from "../actions";

// The quote's Danger zone. One tap used to delete the quote, a sent one
// included (UX review, Nov 10, 2026), so the first press asks in place,
// the way a contact's header Delete does (no browser dialog, Escape backs
// out), and only "Yes, delete" deletes. A refusal shows under the
// question rather than vanishing.
export function DeleteQuoteButton({ quoteId, question }: { quoteId: string; question: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<ActionState, FormData>(deleteQuote, {});

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) {
    return (
      <div className="p-5">
        <button type="button" onClick={() => setOpen(true)} className="btn btn-danger btn-sm" data-testid="delete-quote">
          <IconTrash size={13} />
          Delete quote
        </button>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-3 p-5" data-testid="delete-quote-confirm">
      <input type="hidden" name="quoteId" value={quoteId} />
      <p className="text-sm text-[var(--danger)]">{question}</p>
      <FormError message={state?.error} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className="btn btn-danger btn-sm" data-testid="delete-quote-yes">
          <IconTrash size={13} />
          {pending ? "Deleting…" : "Yes, delete"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="btn btn-ghost btn-sm">
          Cancel
        </button>
      </div>
    </form>
  );
}
