"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { FloatingMenu } from "@/components/floating-menu";
import { IconClock, IconLayers, IconPlus } from "@/components/icons";

// The Pipeline header's ⋯ (BDR redesign, Release 7): Show archived,
// Contract Coordinator and New quote, one tap deeper than they were.
export function PipelineMore({ showArchived, archivedCount }: { showArchived: boolean; archivedCount: number }) {
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const item = "flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--hover)] focus-visible:bg-[var(--hover)]";
  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={() => setOpen(!open)}
        aria-label="More: Show archived, Contract Coordinator, New quote"
        aria-haspopup="menu"
        aria-expanded={open}
        className="btn btn-ghost btn-sm min-h-11 min-w-11 justify-center text-base leading-none"
        data-testid="pipeline-more"
      >
        ⋯
      </button>
      <FloatingMenu anchor={button} open={open} onClose={() => setOpen(false)} width={240} testId="pipeline-more-menu" label="More">
        <div className="py-1" role="menu">
          <Link
            href={showArchived ? "/dashboard/deals" : "/dashboard/deals?archived=1"}
            className={item}
            role="menuitem"
            onClick={() => setOpen(false)}
            data-testid="toggle-archived"
          >
            <IconLayers size={14} className="faint" />
            {showArchived ? "Hide archived" : `Show archived${archivedCount ? ` (${archivedCount})` : ""}`}
          </Link>
          <Link href="/dashboard/deals/tracker" className={item} role="menuitem" data-testid="pipeline-coordinator">
            <IconClock size={14} className="faint" />
            Contract Coordinator
          </Link>
          <Link href="/dashboard/quotes/new" className={item} role="menuitem" data-testid="pipeline-new-quote">
            <IconPlus size={14} className="faint" />
            New quote
          </Link>
        </div>
      </FloatingMenu>
    </>
  );
}
