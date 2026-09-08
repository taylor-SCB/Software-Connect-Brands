"use client";

import { useEffect, useRef, useState } from "react";
import { IconTrash } from "@/components/icons";

// Red trash icon that arms an inline "are you sure" instead of a browser
// dialog. The confirm panel floats next to the button so it works inside
// a table row as well as a card.
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
  const wrapper = useRef<HTMLDivElement>(null);

  // Click anywhere else or press Escape to back out.
  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapper} className="relative inline-block" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={label}
        title={label}
        aria-expanded={open}
        className="btn btn-icon-danger btn-sm"
      >
        <IconTrash size={13} />
      </button>

      {open && (
        <form
          action={action}
          className="card absolute right-0 top-full z-20 mt-1 w-64 border-[rgb(251_113_133/0.35)] bg-[#12141b] p-3 text-left shadow-2xl"
        >
          <input type="hidden" name={hiddenName} value={hiddenValue} />
          <p className="text-xs font-medium">{question}</p>
          {note && <p className="faint mt-1 text-xs leading-relaxed">{note}</p>}
          <div className="mt-3 flex items-center gap-2">
            <button type="submit" className="btn btn-danger btn-sm">
              <IconTrash size={12} />
              Delete
            </button>
            <button type="button" onClick={() => setOpen(false)} className="btn btn-ghost btn-sm">
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
