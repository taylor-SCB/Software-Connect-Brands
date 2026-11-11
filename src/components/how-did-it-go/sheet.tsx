"use client";

import { useEffect, useRef, type FormEvent, type ReactNode, type Ref } from "react";
import { createPortal } from "react-dom";
import { IconX } from "@/components/icons";

// The shell both sheets share: drawn on document.body (never inside the
// card that opened it), opaque (.popover), a bottom sheet on a phone with
// its footer pinned in thumb reach, a centred dialog from sm up. Escape
// and the scrim close it; focus moves in on open (a frame later, once it
// is on screen), Tab stays inside, and focus goes back to whatever opened
// it. No animation, so reduced motion has nothing to turn off.
export function Sheet({
  open,
  onClose,
  title,
  eyebrow,
  children,
  footer,
  testId,
  label,
  formRef,
  onSubmit,
  formTestId,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  eyebrow?: ReactNode;
  children: ReactNode;
  // Pinned at the foot: the Save / Book it row.
  footer?: ReactNode;
  testId?: string;
  // The dialog's accessible name when the title isn't plain words.
  label?: string;
  // With onSubmit, the body and the pinned footer are one <form>, so its
  // Save button and every field (and anything a test adds) post together.
  formRef?: Ref<HTMLFormElement>;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  formTestId?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    const frame = requestAnimationFrame(() => {
      const target = panel.current?.querySelector<HTMLElement>("[data-autofocus]") ?? panel.current?.querySelector<HTMLElement>("button, [href], input, textarea, select");
      target?.focus();
    });
    function onKey(event: KeyboardEvent) {
      // A dialog opened inside this one (+ others) handles its own Escape.
      if (event.key === "Escape") {
        const inner = panel.current?.querySelector(".modal-backdrop");
        if (inner) return;
        event.stopPropagation();
        close.current();
        return;
      }
      if (event.key !== "Tab" || !panel.current) return;
      const items = Array.from(
        panel.current.querySelectorAll<HTMLElement>("button:not([disabled]), [href], input:not([type=hidden]):not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])"),
      ).filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey, true);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = overflow;
      const back = opener.current as HTMLElement | null;
      if (back && typeof back.focus === "function" && document.contains(back)) back.focus();
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;
  const body = (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">{children}</div>
      {footer && (
        <div className="border-t border-[var(--hairline-3)] px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] pt-3 sm:px-5 sm:pb-4">{footer}</div>
      )}
    </>
  );
  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-[var(--scrim)] sm:items-center sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      // A portal still bubbles React events to whoever rendered it: a
      // sheet opened from a clickable tile must not click the tile.
      onClick={(event) => event.stopPropagation()}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label ?? (typeof title === "string" ? title : undefined)}
        className="card popover flex max-h-[92dvh] w-full min-w-0 flex-col rounded-b-none rounded-t-2xl sm:max-h-[88vh] sm:max-w-lg sm:rounded-2xl"
        data-testid={testId}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--hairline-3)] px-4 pb-3 pt-4 sm:px-5">
          <div className="min-w-0">
            {eyebrow && <p className="eyebrow mb-0.5 truncate">{eyebrow}</p>}
            <h2 className="text-base font-semibold leading-snug">{title}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="btn btn-ghost btn-sm h-11 w-11 shrink-0 !p-0 sm:h-8 sm:w-8" data-testid="sheet-close">
            <IconX size={14} />
          </button>
        </div>
        {onSubmit ? (
          <form ref={formRef} onSubmit={onSubmit} data-testid={formTestId} className="flex min-h-0 flex-1 flex-col" noValidate>
            {body}
          </form>
        ) : (
          body
        )}
      </div>
    </div>,
    document.body,
  );
}

// One chip: a 44px tap target everywhere, 56px on a phone where the
// chips sit two to a row. A green dot marks the outcomes that count as
// Connected (the fixed health colour, not the tenant's brand).
export function Chip({
  on,
  connect,
  onClick,
  children,
  sub,
  testId,
  disabled,
  title,
  role = "button",
  wide,
}: {
  on?: boolean;
  connect?: boolean;
  onClick: () => void;
  children: ReactNode;
  sub?: ReactNode;
  testId?: string;
  disabled?: boolean;
  title?: string;
  role?: "button" | "radio" | "checkbox";
  wide?: boolean;
}) {
  const pressed = role === "button" ? { "aria-pressed": Boolean(on) } : { "aria-checked": Boolean(on) };
  return (
    <button
      type="button"
      role={role === "button" ? undefined : role}
      {...pressed}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex min-h-14 min-w-0 items-center justify-center gap-2 rounded-[10px] border-[1.5px] px-3 py-1.5 text-center text-sm font-semibold leading-tight transition-colors sm:min-h-11 sm:justify-start sm:text-left ${
        wide ? "col-span-2" : ""
      } ${
        on
          ? "border-[var(--brand)] bg-[var(--brand)] text-[var(--brand-contrast)]"
          : `bg-[var(--surface)] text-[var(--text)] hover:border-[var(--border-strong)] ${connect ? "border-[var(--health-good)]" : "border-[var(--border)]"}`
      } disabled:cursor-not-allowed disabled:opacity-50`}
      data-testid={testId}
    >
      {connect && <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${on ? "bg-[var(--brand-contrast)]" : "bg-[var(--health-good)]"}`} />}
      <span className="min-w-0">
        <span className="block break-words">{children}</span>
        {sub && <span className={`block text-xs font-normal ${on ? "opacity-90" : "text-[var(--text-dim)]"}`}>{sub}</span>}
      </span>
    </button>
  );
}

// Two to a row on a phone, wrapping from sm up.
export function ChipGrid({ children, label, testId }: { children: ReactNode; label: string; testId?: string }) {
  return (
    <div role="group" aria-label={label} className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap" data-testid={testId}>
      {children}
    </div>
  );
}
