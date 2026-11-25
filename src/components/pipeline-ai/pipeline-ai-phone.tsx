"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { IconSparkles, IconX } from "@/components/icons";
import { PipelineAiBar } from "./pipeline-ai-bar";

// The ✦ in the phone's top bar (Pipeline AI, decision 8, Nov 25, 2026):
// the Pipeline's bar on any page, as a full-screen sheet, so a rep in a
// truck can say what happened without finding the Pipeline first. Shown only
// while AI is switched on (the layout decides).
export function PipelineAiPhoneButton() {
  const [open, setOpen] = useState(false);
  // A read or save in flight: closing would lose its answer and its Undo.
  const [busy, setBusy] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();
  const [openedOn, setOpenedOn] = useState(pathname);
  // Build Quote goes on to the new quote: the sheet closes when the page
  // changes under it.
  if (open && openedOn !== pathname) {
    setOpen(false);
    setOpenedOn(pathname);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [open, busy]);

  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={() => {
          setOpenedOn(pathname);
          setOpen(true);
        }}
        aria-label="Tell me what happened"
        aria-haspopup="dialog"
        className="btn btn-ghost btn-sm h-11 w-11 shrink-0 justify-center !p-0"
        data-testid="pai-phone-button"
      >
        <IconSparkles size={16} />
      </button>
      {open &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Tell me what happened"
            className="fixed inset-0 z-[80] overflow-y-auto bg-[var(--bg)] px-4 pb-[calc(2rem+env(safe-area-inset-bottom,0px))] pt-[calc(0.75rem+env(safe-area-inset-top,0px))]"
            data-testid="pai-sheet"
          >
            <div className="mx-auto max-w-2xl">
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="text-base font-semibold">Tell me what happened</p>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    button.current?.focus();
                  }}
                  disabled={busy}
                  className="btn btn-ghost btn-sm h-11 w-11 justify-center !p-0"
                  aria-label="Close"
                  data-testid="pai-sheet-close"
                >
                  <IconX size={16} />
                </button>
              </div>
              <PipelineAiBar autoFocus onBusy={setBusy} />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
