"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ActivityTypeValue } from "@/lib/constants";
import { HowDidItGo } from "@/components/how-did-it-go/how-did-it-go";
import { useDialReturn } from "@/components/how-did-it-go/dial-return";
import { UndoToast } from "@/components/how-did-it-go/undo-toast";
import { BookMeetingSheet } from "@/components/book-meeting/book-meeting";

// The contact page's shared state (BDR redesign, Nov 11, 2026): the
// "What happened with <name>?" bar, the Book meeting sheet and the "Saved
// · Undo" line are opened from the header's main button, the Next step
// strip and the phone's bottom bar alike, so they live here. The log is
// the shared How did it go? sheet and booking the shared Book meeting
// sheet (src/components/how-did-it-go, src/components/book-meeting): one
// form for the whole app, not one per page. A call or text tapped from
// the page opens the log, set to Call or Text, when the rep comes back.

type Toast = { message: string; batchId?: string | null; href?: string; hrefLabel?: string };

type ContactPage = {
  contactId: string;
  name: string;
  firstName: string;
  companyId: string | null;
  today: string;
  logOpen: boolean;
  // Opens How did it go?, set to Call unless told otherwise (from the
  // bar, the header, the phone's bar, the Next step strip, the way back
  // from a call).
  openLog: (type?: ActivityTypeValue) => void;
  // The bar itself was tapped; the same sheet.
  openLogHere: () => void;
  closeLog: () => void;
  // A tel: or sms: was tapped: open the log, set to Call or Text, once
  // the page is looked at again.
  armReturn: (type?: ActivityTypeValue) => void;
  openBook: () => void;
  showToast: (toast: Toast) => void;
};

const Context = createContext<ContactPage | null>(null);

export function useContactPage() {
  const value = useContext(Context);
  if (!value) throw new Error("useContactPage outside ContactShell");
  return value;
}

const KINDS = new Set<string>(["PHONE_CALL", "TEXT", "EMAIL", "MEETING"]);
// openLog is often an onClick, which hands it the click event.
const kindOf = (value: unknown): ActivityTypeValue => (typeof value === "string" && KINDS.has(value) ? (value as ActivityTypeValue) : "PHONE_CALL");

export function ContactShell({
  contactId,
  name,
  companyId,
  companyName = null,
  today,
  children,
}: {
  contactId: string;
  name: string;
  companyId: string | null;
  // For the sheet's "+ others" picker.
  companyName?: string | null;
  today: string;
  children: React.ReactNode;
}) {
  const [log, setLog] = useState<{ open: boolean; type: ActivityTypeValue }>({ open: false, type: "PHONE_CALL" });
  const [bookOpen, setBookOpen] = useState(false);
  const [toast, setToast] = useState<{ batchId: string; words: string; href?: string | null; hrefLabel?: string; at: number } | null>(null);
  const armed = useRef<ActivityTypeValue | null>(null);

  const openLog = useCallback((type?: ActivityTypeValue) => setLog({ open: true, type: kindOf(type) }), []);
  const closeLog = useCallback(() => setLog((prev) => ({ ...prev, open: false })), []);
  const dismiss = useCallback(() => setToast(null), []);

  // Back from the phone app: the shared dial watcher (a tel: or sms: link
  // anywhere on this page, the page hidden and shown again).
  useDialReturn({ contactIds: [contactId], page: true }, (tap) => openLog(tap.type));

  // Back from a desktop dialler, which takes the focus but never hides the
  // page: the header's Call and Text arm this.
  useEffect(() => {
    function back() {
      if (document.visibilityState !== "visible" || !armed.current) return;
      const type = armed.current;
      armed.current = null;
      openLog(type);
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
      logOpen: log.open,
      openLog: (type) => openLog(kindOf(type)),
      openLogHere: () => openLog("PHONE_CALL"),
      closeLog,
      armReturn: (type) => {
        armed.current = kindOf(type);
        // A desktop with no phone app never leaves the page; open it now.
        setTimeout(() => {
          if (armed.current && document.visibilityState === "visible" && document.hasFocus()) {
            const kind = armed.current;
            armed.current = null;
            openLog(kind);
          }
        }, 1500);
      },
      openBook: () => setBookOpen(true),
      showToast: (next) =>
        setToast({
          batchId: next.batchId ?? "",
          words: next.message,
          href: next.href ?? null,
          hrefLabel: next.href ? `${next.hrefLabel ?? "Open"} →` : undefined,
          at: Date.now(),
        }),
    }),
    [contactId, name, companyId, today, log.open, openLog, closeLog],
  );

  return (
    <Context.Provider value={value}>
      {children}
      <HowDidItGo
        open={log.open}
        onClose={closeLog}
        target={{ contactId }}
        type={log.type}
        name={name}
        today={today}
        current={{ id: contactId, name, company: companyName }}
      />
      <BookMeetingSheet open={bookOpen} onClose={() => setBookOpen(false)} contactId={contactId} name={name} today={today} />
      <UndoToast saved={toast} onDone={dismiss} />
    </Context.Provider>
  );
}
