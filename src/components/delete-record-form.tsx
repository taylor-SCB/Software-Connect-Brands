"use client";

import { useActionState, useEffect, useState } from "react";
import { FormError } from "@/components/ui";
import { IconTrash } from "@/components/icons";
import type { ActionState } from "@/lib/forms";

// The Danger-zone delete button. The action either redirects away or
// answers with why it won't ("$4,200 still owed — archive instead"), and
// that reason has to land on the screen, which a bare <form action> can't
// do. Given a `question`, the first click asks it in place ("Yes, delete"
// / Cancel, no browser dialog) and only the second deletes — the quote's
// Danger zone, where one tap used to delete a sent quote (UX review, Nov
// 10, 2026).
export function DeleteRecordForm({
  action,
  hiddenName,
  hiddenValue,
  label,
  question,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  hiddenName: string;
  hiddenValue: string;
  label: string;
  question?: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, {});
  const [open, setOpen] = useState(false);

  // Escape backs out of the question.
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (question && !open) {
    return (
      <div className="p-5">
        <button type="button" onClick={() => setOpen(true)} className="btn btn-danger btn-sm" data-testid="delete-record">
          <IconTrash size={13} />
          {label}
        </button>
      </div>
    );
  }

  if (question) {
    return (
      <form action={formAction} className="space-y-3 p-5" data-testid="delete-record-confirm">
        <input type="hidden" name={hiddenName} value={hiddenValue} />
        <p className="text-sm text-[var(--danger)]">{question}</p>
        <FormError message={state?.error} />
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={pending} className="btn btn-danger btn-sm" data-testid="delete-record-yes">
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

  // Without a question, exactly as before: one press deletes (or says
  // why it won't, under the button's own form).
  return (
    <form action={formAction} className="space-y-3 p-5">
      <input type="hidden" name={hiddenName} value={hiddenValue} />
      <FormError message={state?.error} />
      <button type="submit" disabled={pending} className="btn btn-danger btn-sm" data-testid="delete-record">
        <IconTrash size={13} />
        {pending ? "Deleting…" : label}
      </button>
    </form>
  );
}
