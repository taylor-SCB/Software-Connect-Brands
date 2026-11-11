"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { IconX } from "@/components/icons";

// A dialog drawn on document.body: centred on a computer, a bottom sheet
// in thumb reach on a phone. Escape (caught first, so a panel under it
// stays open) and a tap outside close it; focus goes to its first control.
export function Sheet({
  title,
  subtitle,
  onClose,
  children,
  testId,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  testId?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      close.current();
    }
    document.addEventListener("keydown", onKey, true);
    const frame = requestAnimationFrame(() => {
      panel.current?.querySelector<HTMLElement>("[data-autofocus], button:not([aria-label=Close]), input, select, textarea")?.focus();
    });
    return () => {
      document.removeEventListener("keydown", onKey, true);
      cancelAnimationFrame(frame);
      before?.focus?.({ preventScroll: true });
    };
  }, []);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="modal-backdrop max-sm:items-end max-sm:p-0"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onClick={(event) => event.stopPropagation()}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="card card-lit popover flex max-h-[88vh] w-full max-w-md flex-col max-sm:max-w-none max-sm:rounded-b-none"
        data-testid={testId}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--hairline-3)] px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">{title}</h2>
            {subtitle && <p className="faint mt-0.5 text-xs">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="btn btn-ghost btn-sm pointer-coarse:min-h-11 pointer-coarse:min-w-11">
            <IconX size={13} />
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

// A one-of chip (day, time, reason): 44px on a touch screen.
export function Chip({
  on,
  onClick,
  children,
  testId,
  disabled,
  title,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
  testId?: string;
  disabled?: boolean;
  // The date under a day chip ("Fri Nov 20"), on hover.
  title?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      title={title}
      className={`btn btn-sm pointer-coarse:min-h-11 ${on ? "btn-primary" : "btn-ghost"}`}
      data-testid={testId}
    >
      {children}
    </button>
  );
}
