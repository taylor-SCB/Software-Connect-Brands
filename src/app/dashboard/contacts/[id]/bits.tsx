"use client";

import { useState } from "react";
import { IconCheck, IconChevronDown, IconCopy } from "@/components/icons";

// A card whose body folds away on a phone (BDR redesign: Reach, Details,
// Paperwork and Notes start collapsed there, so the number to call and the
// history come first). On a computer it is always open and its header is
// plain. Collapsed by CSS, not by measuring the screen, so nothing jumps
// when the page loads.
export function Collapsible({
  title,
  subtitle,
  actions,
  id,
  testId,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  id?: string;
  testId?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section id={id} className={`card card-lit min-w-0 scroll-mt-20 ${className}`} data-testid={testId} data-open={open ? "" : undefined}>
      <div className={`flex flex-wrap items-center justify-between gap-3 border-b border-[var(--hairline-3)] px-5 py-3.5 max-lg:py-1.5 ${open ? "" : "max-lg:border-b-0"}`}>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left lg:hidden"
          data-testid={testId ? `${testId}-toggle` : undefined}
        >
          <span className="min-w-0">
            <span className="block text-sm font-semibold">{title}</span>
            {subtitle && <span className="faint mt-0.5 block text-xs">{subtitle}</span>}
          </span>
          <IconChevronDown size={14} className={`ml-auto shrink-0 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`} />
        </button>
        <div className="min-w-0 max-lg:hidden">
          <h2 className="text-sm font-semibold">{title}</h2>
          {subtitle && <p className="faint mt-0.5 text-xs">{subtitle}</p>}
        </div>
        {actions && <div className={`flex items-center gap-2 ${open ? "" : "max-lg:hidden"}`}>{actions}</div>}
      </div>
      <div className={open ? "" : "max-lg:hidden"}>{children}</div>
    </section>
  );
}

// "More details", "Show counts": a link that opens the rest in place.
export function Disclosure({
  label,
  openLabel,
  children,
  testId,
  className = "",
}: {
  label: string;
  openLabel?: string;
  children: React.ReactNode;
  testId?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={className}>
      <button
        type="button"
        className="link inline-flex min-h-8 items-center text-xs pointer-coarse:min-h-11"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        data-testid={testId}
      >
        {open ? (openLabel ?? "Hide") : label}
      </button>
      {open && <div data-testid={testId ? `${testId}-body` : undefined}>{children}</div>}
    </div>
  );
}

// Copy a number or an address, with a tick for a moment.
export function CopyButton({ value, label, testId }: { value: string; label: string; testId?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm px-2 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
      aria-label={copied ? "Copied" : `Copy ${label}`}
      title={copied ? "Copied" : `Copy ${label}`}
      data-testid={testId}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } catch {
          window.prompt(`Copy ${label}`, value);
        }
      }}
    >
      {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
    </button>
  );
}
