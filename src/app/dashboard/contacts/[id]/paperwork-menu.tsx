"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { FloatingMenu } from "@/components/floating-menu";
import { IconFileText, IconPlus, IconSignature } from "@/components/icons";
import { AddDealForm } from "./forms";

const ITEM = "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--hover)] pointer-coarse:min-h-11";

// The Paperwork card's ⋯: New quote, New contract, and — from Meeting
// Completed on, when there is a job to name — the Add deal form that used
// to sit open on the Deals card.
export function PaperworkMenu({ contactId, canAddDeal }: { contactId: string; canAddDeal: boolean }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  // Keyboard: the panel is drawn on the body, so focus goes into it when
  // it opens (a frame later, once it has placed itself) and back to the
  // button when it closes.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      const frame = requestAnimationFrame(() =>
        document.querySelector<HTMLElement>(`[data-testid=${"paperwork-more-menu"}] a, [data-testid=${"paperwork-more-menu"}] button`)?.focus({ preventScroll: true }),
      );
      return () => cancelAnimationFrame(frame);
    }
    if (wasOpen.current) {
      wasOpen.current = false;
      if (!document.activeElement || document.activeElement === document.body) anchor.current?.focus({ preventScroll: true });
    }
  }, [open]);

  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="btn btn-ghost btn-sm pointer-coarse:min-h-11"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="Paperwork actions"
        onClick={() => {
          setOpen(!open);
          setAdding(false);
        }}
        data-testid="paperwork-more"
      >
        ⋯
      </button>
      <FloatingMenu anchor={anchor} open={open} onClose={() => setOpen(false)} width={320} label="Paperwork" testId="paperwork-more-menu">
        {adding ? (
          <div data-testid="paperwork-add-deal">
            <button type="button" className="link px-3 pt-2 text-xs" onClick={() => setAdding(false)}>
              ← Paperwork
            </button>
            <AddDealForm contactId={contactId} />
          </div>
        ) : (
          <div className="py-1">
            <Link href={`/dashboard/quotes/new?contactId=${contactId}`} className={ITEM}>
              <IconFileText size={13} />
              New quote
            </Link>
            <Link href={`/dashboard/contracts/new?contactId=${contactId}`} className={ITEM}>
              <IconSignature size={13} />
              New contract
            </Link>
            {canAddDeal && (
              <button type="button" className={ITEM} onClick={() => setAdding(true)} data-testid="paperwork-add-deal-open">
                <IconPlus size={13} />
                Add deal
              </button>
            )}
          </div>
        )}
      </FloatingMenu>
    </>
  );
}
