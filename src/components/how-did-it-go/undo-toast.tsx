"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { undoLog } from "@/app/dashboard/contacts/actions";

export const UNDO_MS = 10_000;

// "Saved · Undo" for ten seconds after a save (BDR redesign, Nov 11, 2026).
// Undo takes the whole save back in one go (undoLog: the touch, its
// calendar copy, the next step and anything it booked, the status moves).
// Drawn on the body above everything, in thumb reach on a phone (clear of
// the phone's bottom bars), and read out politely.
export function UndoToast({
  saved,
  onDone,
  onUndone,
}: {
  saved: { batchId: string; words: string; href?: string | null; hrefLabel?: string; at: number } | null;
  // The ten seconds are up, or it was closed.
  onDone: () => void;
  // Undo worked; the sheet may want to reopen what was saved.
  onUndone?: () => void;
}) {
  const router = useRouter();
  const [state, setState] = useState<{ batchId: string | null; text: string | null; error?: string }>({ batchId: null, text: null });
  const [pending, start] = useTransition();

  const at = saved?.at ?? 0;
  useEffect(() => {
    if (!at) return;
    const left = Math.max(1500, UNDO_MS - (Date.now() - at));
    const timer = window.setTimeout(onDone, left);
    return () => window.clearTimeout(timer);
  }, [at, onDone]);

  if (!saved || typeof document === "undefined") return null;
  const undone = state.batchId === saved.batchId ? state : null;

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(7.5rem+env(safe-area-inset-bottom,0px))] z-[90] flex justify-center px-4 sm:bottom-6"
    >
      <div className="card popover pointer-events-auto flex min-w-0 max-w-full items-center gap-3 rounded-xl px-4 py-2.5 text-sm sm:max-w-xl" data-testid="log-toast">
        <span className="min-w-0 break-words" data-testid="log-toast-words">
          {undone?.text ?? saved.words}
          {!undone && saved.href && (
            <>
              {" "}
              <Link href={saved.href} className="link font-medium whitespace-nowrap" data-testid="log-toast-link">
                {saved.hrefLabel ?? "→"}
              </Link>
            </>
          )}
        </span>
        {undone?.error && <span className="text-xs text-[var(--danger)]">{undone.error}</span>}
        {!undone?.text && saved.batchId && (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const result = await undoLog(saved.batchId);
                if (result.error) {
                  setState({ batchId: saved.batchId, text: null, error: result.error });
                  return;
                }
                setState({ batchId: saved.batchId, text: "Undone" });
                router.refresh();
                onUndone?.();
              })
            }
            className="btn btn-ghost btn-sm min-h-11 shrink-0 sm:min-h-0"
            data-testid="log-toast-undo"
          >
            {pending ? "Undoing…" : "Undo"}
          </button>
        )}
        <button type="button" onClick={onDone} aria-label="Dismiss" className="btn btn-ghost btn-sm min-h-11 shrink-0 sm:min-h-0">
          ✕
        </button>
      </div>
    </div>,
    document.body,
  );
}
