"use client";

import { createContext, useContext, useId, useState } from "react";
import Link from "next/link";
import { IconCalendar, IconChevronDown, IconNote, IconPhone } from "@/components/icons";
import { useCompanyShell } from "./company-shell";

const CHEVRON = "shrink-0 transition-transform motion-reduce:transition-none";

// "Log a touch" (BDR redesign, Nov 11, 2026): the company's log form,
// folded to one line until it is wanted; the phone's sticky Log and the
// main button open it. Once opened it stays in the page while folded, so
// nothing typed is lost.
export function LogTouch({ children }: { children: React.ReactNode }) {
  const shell = useCompanyShell();
  const [mounted, setMounted] = useState(false);
  const bodyId = useId();
  const open = shell.logOpen;
  if (open && !mounted) setMounted(true);
  return (
    <div className="card card-lit scroll-mt-4" id="log">
      <h2>
        <button
          type="button"
          onClick={() => shell.setLogOpen(!open)}
          aria-expanded={open}
          aria-controls={bodyId}
          className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left pointer-coarse:min-h-11"
          data-testid="company-log-toggle"
        >
          <span>
            <span className="block text-sm font-semibold">Log a touch</span>
            <span className="faint block text-xs">A call, text, email or meeting with someone here, or the front desk.</span>
          </span>
          <IconChevronDown size={15} className={`${CHEVRON} ${open ? "rotate-180" : ""}`} />
        </button>
      </h2>
      <div id={bodyId} hidden={!open} className="border-t border-[var(--hairline-3)]">
        {mounted && children}
      </div>
    </div>
  );
}

// A card whose body folds away: on a phone only (`phone`, open on a wide
// screen, where there is room), or everywhere until opened (`closed`).
// The body stays in the page while folded.
export function FoldCard({
  title,
  subtitle,
  mode,
  defaultOpen = false,
  actions,
  id,
  testId,
  children,
}: {
  title: string;
  subtitle?: string;
  mode: "phone" | "closed";
  defaultOpen?: boolean;
  actions?: React.ReactNode;
  id?: string;
  testId?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  const shown = open ? "" : mode === "phone" ? "max-lg:hidden" : "hidden";
  return (
    <div className="card card-lit scroll-mt-4" id={id} data-testid={testId} data-open={open ? "" : undefined}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--hairline-3)] px-5 py-3.5">
        <h2 className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-controls={bodyId}
            className={`flex w-full items-center gap-2 text-left pointer-coarse:min-h-11 ${mode === "phone" ? "lg:pointer-events-none" : ""}`}
            data-testid={testId ? `${testId}-toggle` : undefined}
          >
            <span className="min-w-0">
              <span className="block text-sm font-semibold">{title}</span>
              {subtitle && <span className="faint mt-0.5 block text-xs font-normal">{subtitle}</span>}
            </span>
            <IconChevronDown size={14} className={`${CHEVRON} ml-auto ${open ? "rotate-180" : ""} ${mode === "phone" ? "lg:hidden" : ""}`} />
          </button>
        </h2>
        {actions && <div className={`flex items-center gap-2 ${shown}`}>{actions}</div>}
      </div>
      <div id={bodyId} className={shown}>
        {children}
      </div>
    </div>
  );
}

// "Show counts" under the header meter: the six count tiles of the old
// Activity overview, one tap away.
export function ShowCounts({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={bodyId}
        className="link text-xs pointer-coarse:min-h-11"
        data-testid="company-show-counts"
      >
        {open ? "Hide counts" : "Show counts"}
      </button>
      <div id={bodyId} hidden={!open} className="basis-full" data-testid="company-counts">
        {children}
      </div>
    </>
  );
}

// The history, newest first, grouped by day: five lines on a phone and
// thirty on a wide screen, then Show all. The server cuts the lines into
// chunks: "phone" chunks fold away on a phone, "more" chunks everywhere.
const HistoryAll = createContext(false);

export function HistoryShell({ total, children }: { total: number; children: React.ReactNode }) {
  const [all, setAll] = useState(false);
  return (
    <HistoryAll.Provider value={all}>
      {children}
      {!all && total > 5 && (
        <div className={`border-t border-[var(--hairline-3)] px-5 py-2 ${total <= 30 ? "lg:hidden" : ""}`}>
          <button type="button" onClick={() => setAll(true)} className="link text-sm pointer-coarse:min-h-11" data-testid="history-show-all">
            Show all {total.toLocaleString()}
          </button>
        </div>
      )}
    </HistoryAll.Provider>
  );
}

export function HistoryChunk({ tier, children }: { tier: "first" | "phone" | "more"; children: React.ReactNode }) {
  const all = useContext(HistoryAll);
  const hide = all || tier === "first" ? "" : tier === "phone" ? "max-lg:hidden" : "hidden";
  return <div className={hide}>{children}</div>;
}

// The next thing booked here ("Next: Site walk · Tue · 10:00 AM"), or
// "Nothing booked" with Book meeting and Log a touch.
export function NextStepStrip({ next, bookFor }: { next: { title: string; when: string; href: string } | null; bookFor: string | null }) {
  const shell = useCompanyShell();
  return (
    <div className="card card-lit flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3.5" data-testid="company-next-step">
      <IconCalendar size={15} className="shrink-0 text-[var(--text-dim)]" />
      {next ? (
        <p className="min-w-0 flex-1 text-sm">
          <span className="faint">Next: </span>
          <Link href={next.href} className="font-medium hover:underline">
            {next.title}
          </Link>
          {next.when && <span className="text-[var(--text-dim)]"> · {next.when}</span>}
        </p>
      ) : (
        <>
          <p className="min-w-0 flex-1 text-sm text-[var(--text-dim)]">Nothing booked</p>
          <span className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => shell.book(bookFor)} className="btn btn-ghost btn-sm pointer-coarse:min-h-11" data-testid="next-book">
              Book meeting
            </button>
            <button type="button" onClick={shell.openLog} className="btn btn-ghost btn-sm pointer-coarse:min-h-11" data-testid="next-log">
              Log a touch
            </button>
          </span>
        </>
      )}
    </div>
  );
}

// The phone's sticky bar: Call main line · Log · Book · ⋯.
export function PhoneBar({ mainLine, bookFor }: { mainLine: string | null; bookFor: string | null }) {
  const shell = useCompanyShell();
  const cell = "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[0.7rem] font-medium";
  return (
    <nav
      aria-label="Quick actions"
      className="popover fixed inset-x-0 bottom-0 z-40 flex border-t border-[var(--hairline-3)] pb-[env(safe-area-inset-bottom)] lg:hidden"
      data-testid="company-phone-bar"
    >
      {mainLine ? (
        <a href={`tel:${mainLine}`} onClick={() => shell.setLogOpen(true)} className={cell} data-testid="phone-bar-call">
          <IconPhone size={18} />
          Call main line
        </a>
      ) : (
        <span className={`${cell} text-[var(--text-dim)]`} aria-disabled="true">
          <IconPhone size={18} />
          No main line
        </span>
      )}
      <button type="button" onClick={shell.openLog} className={cell} data-testid="phone-bar-log">
        <IconNote size={18} />
        Log
      </button>
      <button type="button" onClick={() => shell.book(bookFor)} className={cell} data-testid="phone-bar-book">
        <IconCalendar size={18} />
        Book
      </button>
      <button type="button" onClick={shell.openMore} className={cell} aria-label="More actions" data-testid="phone-bar-more">
        <span className="text-lg leading-none" aria-hidden="true">
          ⋯
        </span>
        More
      </button>
    </nav>
  );
}
