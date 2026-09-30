"use client";

import { useActionState, useEffect, useState } from "react";
import { IconTrash } from "@/components/icons";
import type { ActionState } from "@/lib/forms";

// "Delete" in a contact's or company's page header. The first click arms
// a confirm in place (no browser dialog); the second deletes. A refusal
// ("$4,200 still owed — archive instead") shows under the buttons rather
// than vanishing, which a bare <form action> would do.
export function HeaderDeleteButton({
  action,
  hiddenName,
  hiddenValue,
  question,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  hiddenName: string;
  hiddenValue: string;
  question: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, {});

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
      <button type="button" onClick={() => setOpen(true)} className="btn btn-ghost btn-sm text-[var(--danger)]" data-testid="header-delete">
        <IconTrash size={13} />
        Delete
      </button>
    );
  }

  return (
    <form action={formAction} className="flex basis-full flex-col items-end gap-1.5 sm:basis-auto" data-testid="header-delete-confirm">
      <input type="hidden" name={hiddenName} value={hiddenValue} />
      <p className="text-xs text-[var(--danger)]">{question}</p>
      <div className="flex gap-1.5">
        <button type="submit" disabled={pending} className="btn btn-danger btn-sm" data-testid="header-delete-yes">
          <IconTrash size={13} />
          {pending ? "Deleting…" : "Yes, delete"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="btn btn-ghost btn-sm">
          Cancel
        </button>
      </div>
      {state?.error && (
        <p role="alert" className="max-w-xs text-right text-xs text-[var(--danger)]" data-testid="header-delete-error">
          {state.error}
        </p>
      )}
    </form>
  );
}
