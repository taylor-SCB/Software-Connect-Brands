"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { undoLog } from "../actions";
import { BookMeetingSheet } from "./book-meeting-sheet";

// The contact page's shared state (BDR redesign, Nov 11, 2026): the
// "What happened with <name>?" bar, the Book meeting sheet and the "Saved
// · Undo" line are opened from the header's main button, the Next step
// strip and the phone's bottom bar alike, so they live here. A call or
// text tapped from the page opens the log when the rep comes back to it.

type Toast = { message: string; batchId?: string | null; href?: string; hrefLabel?: string };

type ContactPage = {
  contactId: string;
  name: string;
  firstName: string;
  companyId: string | null;
  today: string;
  logOpen: boolean;
  // Opens the log and brings it into view (from the header, the phone's
  // bar, the Next step strip, the way back from a call).
  openLog: () => void;
  // Opens it where it is: the bar itself was tapped.
  openLogHere: () => void;
  closeLog: () => void;
  // A tel: or sms: was tapped: open the log once the page is looked at again.
  armReturn: () => void;
  openBook: () => void;
  showToast: (toast: Toast) => void;
};

const Context = createContext<ContactPage | null>(null);

export function useContactPage() {
  const value = useContext(Context);
  if (!value) throw new Error("useContactPage outside ContactShell");
  return value;
}

export function ContactShell({
  contactId,
  name,
  companyId,
  today,
  children,
}: {
  contactId: string;
  name: string;
  companyId: string | null;
  today: string;
  children: React.ReactNode;
}) {
  const [logOpen, setLogOpen] = useState(false);
  const [bookOpen, setBookOpen] = useState(false);
  const [toast, setToast] = useState<(Toast & { id: number }) | null>(null);
  const armed = useRef(false);

  const openLog = useCallback(() => {
    setLogOpen(true);
    // After the bar has drawn the form, bring it into view.
    requestAnimationFrame(() => {
      const bar = document.getElementById("log");
      bar?.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      bar?.querySelector<HTMLElement>("button[aria-pressed], textarea")?.focus({ preventScroll: true });
    });
  }, []);

  useEffect(() => {
    function back() {
      if (document.visibilityState !== "visible" || !armed.current) return;
      armed.current = false;
      openLog();
    }
    document.addEventListener("visibilitychange", back);
    window.addEventListener("focus", back);
    return () => {
      document.removeEventListener("visibilitychange", back);
      window.removeEventListener("focus", back);
    };
  }, [openLog]);

  const value = useMemo<ContactPage>(
    () => ({
      contactId,
      name,
      firstName: name.trim().split(/\s+/)[0] || name,
      companyId,
      today,
      logOpen,
      openLog,
      openLogHere: () => {
        setLogOpen(true);
        requestAnimationFrame(() => document.getElementById("log")?.querySelector<HTMLElement>("button[aria-pressed], textarea")?.focus({ preventScroll: true }));
      },
      closeLog: () => setLogOpen(false),
      armReturn: () => {
        armed.current = true;
        // A desktop with no phone app never leaves the page; open it now.
        setTimeout(() => {
          if (armed.current && document.visibilityState === "visible" && document.hasFocus()) {
            armed.current = false;
            openLog();
          }
        }, 1500);
      },
      openBook: () => setBookOpen(true),
      showToast: (next) => setToast({ ...next, id: Date.now() }),
    }),
    [contactId, name, companyId, today, logOpen, openLog],
  );

  return (
    <Context.Provider value={value}>
      {children}
      {bookOpen && <BookMeetingSheet onClose={() => setBookOpen(false)} />}
      {toast && <UndoToast key={toast.id} toast={toast} onDone={() => setToast(null)} />}
    </Context.Provider>
  );
}

// "Saved · Undo" for ten seconds, above the phone's bottom bar. Undo takes
// the whole save back (undoLog).
function UndoToast({ toast, onDone }: { toast: Toast; onDone: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState(toast.message);
  const [undone, setUndone] = useState(false);
  useEffect(() => {
    const timer = setTimeout(onDone, undone ? 4000 : 10000);
    return () => clearTimeout(timer);
  }, [onDone, undone]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      role="status"
      aria-live="polite"
      className="card popover fixed left-1/2 z-[90] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 px-4 py-2.5 text-sm max-sm:bottom-[calc(var(--phone-tabbar-h,0px)+4.5rem)] sm:bottom-6"
      data-testid="undo-toast"
    >
      <span className="min-w-0" data-testid="undo-toast-message">
        {message}
      </span>
      {toast.href && !undone && (
        <Link href={toast.href} className="link shrink-0 text-xs">
          {toast.hrefLabel ?? "Open"} →
        </Link>
      )}
      {toast.batchId && !undone && (
        <button
          type="button"
          disabled={pending}
          className="btn btn-ghost btn-sm shrink-0 pointer-coarse:min-h-11"
          data-testid="undo-toast-undo"
          onClick={() =>
            start(async () => {
              const result = await undoLog(toast.batchId!);
              setUndone(true);
              setMessage(result.error ?? "Undone");
              router.refresh();
            })
          }
        >
          {pending ? "Undoing…" : "Undo"}
        </button>
      )}
      <button type="button" onClick={onDone} aria-label="Dismiss" className="faint shrink-0 px-1 text-base leading-none pointer-coarse:min-h-11 pointer-coarse:min-w-11">
        ×
      </button>
    </div>,
    document.body,
  );
}
