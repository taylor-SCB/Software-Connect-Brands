"use client";

import { IconMessage, IconPhone, IconX } from "@/components/icons";
import { useContactPage } from "./contact-shell";

// "What happened with <name>?" (BDR redesign): the log form, folded into
// one bar until it is wanted. The bar, the header's Call and Text (on the
// way back from the phone), and the phone's Log button open it. The form
// inside is the shared log form (forms.tsx), mounted while open.
export function LogBar({ children }: { children: React.ReactNode }) {
  const page = useContactPage();
  if (!page.logOpen) {
    return (
      <section id="log" className="card card-lit min-w-0 scroll-mt-20">
        <button
          type="button"
          onClick={page.openLogHere}
          className="flex min-h-14 w-full items-center gap-3 rounded-[inherit] px-5 py-3 text-left hover:bg-[var(--hover)]"
          data-testid="log-bar"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--tint-2)] text-[var(--brand)]" aria-hidden="true">
            <IconPhone size={14} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">What happened with {page.firstName}?</span>
            <span className="muted block text-xs">Log a call, text, email or meeting</span>
          </span>
          <IconMessage size={14} className="faint shrink-0" aria-hidden="true" />
        </button>
      </section>
    );
  }
  return (
    <section id="log" className="card card-lit min-w-0 scroll-mt-20" data-testid="log-sheet">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--hairline-3)] px-5 py-3">
        <h2 className="text-sm font-semibold">What happened with {page.firstName}?</h2>
        <button type="button" onClick={page.closeLog} className="btn btn-ghost btn-sm pointer-coarse:min-h-11 pointer-coarse:min-w-11" aria-label="Close" data-testid="log-close">
          <IconX size={13} />
        </button>
      </div>
      {children}
    </section>
  );
}
