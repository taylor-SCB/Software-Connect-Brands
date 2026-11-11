"use client";

import { IconMessage, IconPhone } from "@/components/icons";
import { useContactPage } from "./contact-shell";

// "What happened with <name>?" (BDR redesign): one bar in the page that
// opens the shared How did it go? sheet (ContactShell draws it), set to
// Call. The header's Call and Text (on the way back from the phone), the
// phone's Log button and the Next step strip open the same sheet.
export function LogBar() {
  const page = useContactPage();
  return (
    <section id="log" className="card card-lit min-w-0 scroll-mt-20">
      <button
        type="button"
        onClick={() => page.openLog("PHONE_CALL")}
        aria-haspopup="dialog"
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
