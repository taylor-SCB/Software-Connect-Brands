"use client";

import { useEffect, useState } from "react";
import { IconTrash } from "@/components/icons";

// Red trash icon that arms an inline "are you sure" instead of a browser
// dialog. The confirm takes the icon's place in the normal flow rather
// than floating over it, so it can't be clipped by a scrolling table
// wrapper or a tile.
export function DeleteButton({
  action,
  hiddenName,
  hiddenValue,
  label,
  question,
  note,
}: {
  action: (formData: FormData) => void | Promise<void>;
  hiddenName: string;
  hiddenValue: string;
  label: string;
  question: string;
  note?: string;
}) {
  const [open, setOpen] = useState(false);

  // Escape backs out.
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
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
        aria-label={label}
        title={label}
        aria-expanded={false}
        className="btn btn-icon-danger btn-sm"
      >
        <IconTrash size={13} />
      </button>
    );
  }

  return (
    <form
      action={action}
      onClick={(event) => event.stopPropagation()}
      className="inline-flex max-w-xs flex-col gap-2 rounded-lg border border-[rgb(251_113_133/0.35)] bg-[rgb(251_113_133/0.08)] px-3 py-2 text-left"
    >
      <input type="hidden" name={hiddenName} value={hiddenValue} />
      <p className="text-xs font-medium">{question}</p>
      {note && <p className="faint text-[0.7rem] leading-relaxed">{note}</p>}
      <div className="flex items-center gap-2">
        <button type="submit" className="btn btn-danger btn-sm">
          <IconTrash size={12} />
          Delete
        </button>
        <button type="button" onClick={() => setOpen(false)} className="btn btn-ghost btn-sm">
          Cancel
        </button>
      </div>
    </form>
  );
}
